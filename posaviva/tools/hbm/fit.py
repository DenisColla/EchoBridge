# Non-rigid registration of the MakeHuman body (PosaViva topology, rig, weights,
# helpers) onto the realistic Blender Studio "Human Base Meshes" bodies (CC0).
#
#   <venv with bpy, scipy>/python -I tools/hbm/fit.py <cacheDir> <outDir> [f|m ...]
#
# cacheDir: mh.json (PV_DUMP_MH=... node tools/build-assets.mjs) and
#           A_female.npz / A_male.npz (tools/hbm/export_hbm.py).
# outDir:   fit_f.bin / fit_m.bin = Float32 (NV x 3) rest positions of EVERY
#           MakeHuman vertex (body + helpers + joint cubes), meters, MakeHuman
#           rest pose and frame (Y up, facing +Z, same ground height as the
#           MakeHuman preset); fit_<s>.json = landmarks and error statistics.
#
# Steps (per sex, MakeHuman shape at the f_normal / m_normal settings):
#  1. similarity: the target is scaled to the MakeHuman preset height, centred
#     on the eyes' midline, feet on the MakeHuman floor, torso depth aligned;
#  2. pose: MakeHuman bones are rotated (linear blend skinning with its own
#     weights) toward the target's limbs: articulated ICP, parent first, with
#     forward and reverse closest points (normal-compatible);
#  3. non-rigid ICP of the body surface in that pose: displacement field with a
#     bi-Laplacian + membrane stiffness schedule (stiff -> soft), point-to-plane
#     and point-to-point data terms (target -> source too), landmarks, normal and
#     distance rejection, digit labels (no matches across fingers / toes) and
#     protected regions where MakeHuman has its own structure (eyes and lids,
#     lips and mouth, nostrils, ears, nails; the genital area is only stiffer): there the
#     displacement is only the smooth continuation of the surroundings;
#  4. helpers (tights, skirt, hair, eyes, lashes, teeth, tongue, joint cubes,
#     genital helper) follow the body: per vertex, a moving-least-squares affine
#     map of the body displacement around it (radius ~ its depth, gated by skin
#     weight similarity) - joints stay centred in the limbs;
#  5. un-pose: exact inverse linear blend skinning with the same bone rotations
#     about the FITTED joints, so the result is in the MakeHuman rest pose (the
#     pose library, IK and clothing keep working) with the target's anatomy.
import os, sys, json, time
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (MH, SEXES, load_A, quads_to_tris, vertex_normals, edges_of, adjacency, uniform_laplacian,
                    smooth_field, rot_axis_angle, to_axis_angle, rot_between, kabsch, Pose, lbs_inverse,
                    forward_from_posed_joints)

LOG = []
GENITAL_W = float(os.environ.get('HBM_GENITAL_W', '1.0'))  # data weight of the genital area (1 = like the rest of the body)


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


# ---------------------------------------------------------------- target
class Target:
    def __init__(self, path, mh, P):
        a = np.load(path)
        self.raw = a
        body = mh.bodyIdx
        Hm = np.ptp(P[body, 1])
        V2 = a['v2'].astype(np.float64)
        Ha = np.ptp(V2[:, 1])
        s = Hm / Ha
        eyeL, eyeR = a['eyeL'][:3].astype(np.float64), a['eyeR'][:3].astype(np.float64)
        cx = (eyeL[0] + eyeR[0]) / 2
        miny = V2[:, 1].min()

        def tr(X):
            Y = (X - [cx, miny, 0]) * s
            Y[:, 1] += P[body, 1].min()
            return Y
        # torso depth: mean z of the central torso band
        Pb = P[body]
        band = lambda X, H0, H: (X[:, 1] > H0 + 0.45 * H) & (X[:, 1] < H0 + 0.7 * H) & (np.abs(X[:, 0]) < 0.12)
        Y2 = tr(V2)
        dz = Pb[band(Pb, Pb[:, 1].min(), Hm), 2].mean() - Y2[band(Y2, Y2[:, 1].min(), Hm), 2].mean()
        self.scale, self.offset = s, np.array([cx, miny, 0.0])
        self.dz = dz

        def T(X):
            Y = tr(X); Y[:, 2] += dz; return Y
        self.T = T
        self.V = {l: T(a['v%d' % l].astype(np.float64)) for l in (0, 1, 2)}
        self.F = {l: a['f%d' % l].astype(np.int64) for l in (0, 1, 2)}
        self.N = {l: vertex_normals(self.V[l], quads_to_tris(self.F[l])) for l in (1, 2)}
        self.eyes = T(np.stack([eyeL, eyeR]))
        self.eyeR = float(a['eyeL'][3]) * s
        self.kd = {l: cKDTree(self.V[l]) for l in (1, 2)}
        log(f'target {os.path.basename(path)}: scale {s:.4f} (height {Ha:.3f} -> {Hm:.3f}), dz {dz:.3f}')

    def level3(self):
        a = self.raw
        return self.T(a['v3'].astype(np.float64)), a['f3'].astype(np.int64)


# ---------------------------------------------------------------- bones fitted in the pose stage
def fit_bone_names(mh):
    names = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']
    for s in 'LR':
        names += [f'clavicle.{s}', f'shoulder01.{s}', f'upperarm01.{s}', f'lowerarm01.{s}', f'wrist.{s}']
        # fingers and toes keep the MakeHuman pose (the target's relaxed hands match it; the
        # non-rigid stage with digit labels and fingertip landmarks fits their shape)
        names += [f'upperleg01.{s}', f'lowerleg01.{s}', f'foot.{s}']
    return [mh.boneIndex[n] for n in names]


def region_component(V, F, sel, seed):
    """Connected component of the selected vertices (mesh edges) that contains `seed`."""
    from scipy.sparse.csgraph import connected_components
    E = edges_of(F)
    E = E[sel[E[:, 0]] & sel[E[:, 1]]]
    G = sp.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(len(V), len(V)))
    n, lab = connected_components(G, directed=False)
    return sel & (lab == lab[seed])


def align_hands(mh, P, pose, tgt, X):
    """Forearm twist (lowerarm02) that best matches the hand shapes (exhaustive search of
    the rotation of the hand about the forearm axis, chamfer distance), then the ICP refines."""
    A_, t_, Q, jp = pose.transforms()
    V, F = tgt.V[1], tgt.F[1]
    for s in 'LR':
        bw = mh.boneIndex[f'wrist.{s}']; bl = mh.boneIndex[f'lowerarm02.{s}']; be = mh.boneIndex[f'lowerarm01.{s}']
        wr, el = jp[bw], jp[be]
        f = (wr - el) / np.linalg.norm(wr - el)

        def cyl(Z):
            rel = Z - wr
            along = rel @ f
            radial = np.linalg.norm(rel - np.outer(along, f), axis=1)
            return (along > 0.01) & (along < 0.22) & (radial < 0.08)
        handb = [i for i, b in enumerate(mh.bones) if b['name'].endswith('.' + s) and (b['name'].startswith('finger') or b['name'].startswith('metacarpal') or b['name'].startswith('wrist'))]
        hm = mh.isBody & (mh.bone_weight(handb) > 0.5) & cyl(X)
        ptsM = X[hm]
        selA = cyl(V)
        seed = np.argmin(np.where(selA, np.linalg.norm(V - (wr + 0.03 * f), axis=1), 1e9))
        selA = region_component(V, F, selA, seed)
        ptsA = V[selA]
        kdA = cKDTree(ptsA)
        best = None
        for deg in range(-180, 180, 5):
            Rt = rot_axis_angle(f, np.radians(deg))
            Z = (ptsM - wr) @ Rt.T + wr
            Z += ptsA.mean(0) - Z.mean(0)
            d1, _ = kdA.query(Z)
            d2, _ = cKDTree(Z).query(ptsA)
            cost = d1.mean() + d2.mean()
            if best is None or cost < best[0]:
                best = (cost, deg)
        twist = np.radians(best[1])
        log(f'  hand {s}: forearm twist {best[1]} deg (chamfer {best[0] * 1000:.1f} mm; {len(ptsM)} / {len(ptsA)} pts)')
        A_, t_, Q, jp = pose.transforms()
        p = mh.parent[bl]
        pose.R[bl] = Q[p].T @ rot_axis_angle(f, twist) @ Q[p] @ pose.R[bl]


def articulated_fit(mh, P, tgt, sweeps=40, debug=None):
    """Rotations of the MakeHuman bones (about the rest joints of P) toward the target."""
    body = mh.bodyIdx
    pose = Pose(mh, mh.heads(P))
    order_all = fit_bone_names(mh)
    is_digit = {b: mh.bones[b]['name'].startswith(('finger', 'toe')) for b in order_all}
    sub_w = {b: mh.bone_weight(mh.subtree(b))[body] for b in order_all}
    digitV = mh.bone_weight([i for i, b in enumerate(mh.bones) if b['name'].startswith(('finger', 'toe'))])[body] > 0.3
    Y, NY = tgt.V[1], tgt.N[1]
    kdY = tgt.kd[1]
    rs = np.random.default_rng(1).choice(len(Y), min(len(Y), 30000), replace=False)
    MOVABLE = {mh.boneIndex[n] for n in ['neck01', 'head'] + [f'{b}.{s}' for s in 'LR' for b in ('clavicle', 'upperarm01', 'lowerarm01', 'wrist', 'upperleg01', 'lowerleg01', 'foot')]}
    HANDS_AT = 12
    tips = []
    wrists = {mh.boneIndex['wrist.L'], mh.boneIndex['wrist.R']}
    for it in range(sweeps):
        if it == HANDS_AT:
            A_, t_, Q_, jp_ = pose.transforms()
            tips = hand_tip_pairs(mh, pose.apply(P), jp_, tgt)
            log(f'  hand tips for the pose stage: {len(tips)}')
        order = [b for b in order_all if it >= HANDS_AT or not (is_digit[b] or mh.bones[b]['name'].startswith('wrist'))]
        tau = 0.12 if it < 6 else 0.07 if it < 16 else 0.04
        cos_min = 0.0 if it < 6 else 0.35
        X = pose.apply(P, body)
        Pp = np.zeros_like(P); Pp[body] = X
        NX = mh.normals(Pp)[body]
        d, j = kdY.query(X)
        okf = (d < np.where(digitV, min(tau, 0.02), tau)) & ((NX * NY[j]).sum(1) > cos_min)
        kdX = cKDTree(X)
        dr, i = kdX.query(Y[rs])
        okr = (dr < np.where(digitV[i], min(tau, 0.02), tau)) & ((NX[i] * NY[rs]).sum(1) > cos_min)
        src_i = np.concatenate([np.nonzero(okf)[0], i[okr]])
        dst = np.concatenate([Y[j[okf]], Y[rs][okr]])
        if it < 3 or it % 6 == 0 or it == sweeps - 1:
            log(f'  pose sweep {it}: fwd {okf.mean():.2f} rev {okr.mean():.2f} mean d {d[okf].mean() * 1000:.1f} mm')
        # root: rigid (rotation about the torso centroid + translation)
        wroot = mh.bone_weight([mh.boneIndex[n] for n in ('root', 'spine05', 'spine04', 'spine03', 'pelvis.L', 'pelvis.R')])[body][src_i]
        sel = wroot > 0.3
        if sel.sum() > 50:
            w = wroot[sel] ** 2
            Xs = pose.apply(P, body[src_i[sel]])
            cX = (Xs * w[:, None]).sum(0) / w.sum(); cY = (dst[sel] * w[:, None]).sum(0) / w.sum()
            dR = kabsch(Xs - cX, dst[sel] - cY, w)
            ax, ang = to_axis_angle(dR)
            dR = rot_axis_angle(ax, min(ang, np.radians(4)) * 0.7)
            pose.Rg = dR @ pose.Rg
            jr0 = pose.jr[0]
            jp0 = jr0 + pose.tg
            pose.tg = dR @ (jp0 - cX) + cX + 0.7 * (cY - cX) - jr0
        for b in order:
            A, t, Q, jp = pose.transforms()
            ws = sub_w[b][src_i]
            sel = ws > 0.4
            if sel.sum() < 12:
                continue
            w = ws[sel] ** 2
            Xs = pose.apply(P, body[src_i[sel]])
            c = jp[b]
            if b in wrists and tips:
                # hand: similarity (rotation, scale, translation) about the wrist, anchored by the fingertips
                side = mh.bones[b]['name'][-1]
                tp = [(i, y) for nm, i, y, _ in tips if nm.endswith(side)]
                ti = np.array([i for i, _ in tp]); ty = np.array([y for _, y in tp])
                Xt = pose.apply(P, ti)
                wt = np.full(len(ti), w.sum() / len(ti))
                Xa = np.concatenate([Xs, Xt]) - c; Ya = np.concatenate([dst[sel], ty]) - c; wa = np.concatenate([w, wt])
                mx = (Xa * wa[:, None]).sum(0) / wa.sum(); my = (Ya * wa[:, None]).sum(0) / wa.sum()
                Cx, Cy = Xa - mx, Ya - my
                Hm = (Cx * wa[:, None]).T @ Cy
                U, Sv, Vt = np.linalg.svd(Hm)
                dd = np.sign(np.linalg.det(Vt.T @ U.T))
                dR = Vt.T @ np.diag([1, 1, dd]) @ U.T
                sc = (Sv * [1, 1, dd]).sum() / ((Cx ** 2).sum(1) * wa).sum()
                tt = my - sc * dR @ mx
                ax, ang = to_axis_angle(dR)
                dR = rot_axis_angle(ax, min(ang * 0.6, np.radians(6)))
                p = mh.parent[b]
                pose.R[b] = Q[p].T @ dR @ Q[p] @ pose.R[b]
                pose.S[b] = float(np.clip(pose.S[b] * (1 + 0.6 * (sc - 1)), 0.85, 1.3))
                Dn = pose.D[b] + 0.6 * Q[p].T @ tt / pose.sc[p]
                pose.D[b] = Dn * min(1, 0.07 / max(np.linalg.norm(Dn), 1e-9))
                continue
            dR = kabsch(Xs - c, dst[sel] - c, w)
            ax, ang = to_axis_angle(dR)
            lim = np.radians((3 if is_digit[b] else 8) if it < 12 else (2 if is_digit[b] else 4))
            dR = rot_axis_angle(ax, min(ang * 0.6, lim))
            p = mh.parent[b]
            Qp = Q[p] if p >= 0 else pose.Rg
            Rn = Qp.T @ dR @ Qp @ pose.R[b]
            # digits: at most 30 deg from the MakeHuman rest pose
            if is_digit[b] and to_axis_angle(Rn)[1] > np.radians(30):
                continue
            pose.R[b] = Rn
            # proportions: the subtree's residual translation moves the bone head
            if b in MOVABLE and it >= 2:
                A, t, Q, jp = pose.transforms()
                Xs = pose.apply(P, body[src_i[sel]])
                tr = ((dst[sel] - Xs) * w[:, None]).sum(0) / w.sum()
                Qp = Q[p] if p >= 0 else pose.Rg
                Dn = pose.D[b] + 0.5 * Qp.T @ tr
                l = np.linalg.norm(Dn)
                pose.D[b] = Dn * min(1, 0.06 / max(l, 1e-9))
    X = pose.apply(P, body)
    d, j = kdY.query(X)
    log(f'  pose done: mean d {d.mean() * 1000:.1f} mm, p95 {np.percentile(d, 95) * 1000:.1f} mm')
    for n in ('upperarm01.L', 'lowerarm01.L', 'lowerarm02.L', 'wrist.L', 'finger2-1.L', 'upperleg01.L', 'lowerleg01.L', 'foot.L', 'head', 'neck01', 'spine01', 'clavicle.L'):
        ax, ang = to_axis_angle(pose.R[mh.boneIndex[n]])
        log(f'    {n}: {np.degrees(ang):.1f} deg about {np.round(ax, 2)}, head moved {np.round(pose.D[mh.boneIndex[n]] * 1000, 1)} mm, scale {pose.S[mh.boneIndex[n]]:.3f}')
    return pose


# ---------------------------------------------------------------- MakeHuman regions
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def expr_mag(mh, name):
    e = mh.expressions[name]
    m = np.zeros(mh.NV)
    d = np.array(e['d']).reshape(-1, 3)
    m[np.array(e['idx'])] = np.linalg.norm(d, axis=1)
    return m / (m.max() or 1)


def protect_weights(mh, P):
    """Data weight per vertex (0 = MakeHuman keeps its own local form) and region masks."""
    NV = mh.NV
    w = np.ones(NV)
    regions = {}
    og = mh.objGroup
    eyeC = {s: P[og == f'helper-{s.lower()}-eye'].mean(0) for s in 'LR'}
    # eyes, lids and sockets
    for s in 'LR':
        d = np.linalg.norm(P - eyeC[s], axis=1)
        r = np.linalg.norm(P[og == f'helper-{s.lower()}-eye'] - eyeC[s], axis=1).max()  # proxy eyeball radius
        regions['eye' + s] = mh.isBody & (d < 1.5 * r)
        w = np.minimum(w, smoothstep(1.35 * r, 2.4 * r, d))
    # lips and mouth (lip mask from the eversion / protrusion expression units, interior near teeth / tongue)
    ever, prot = expr_mag(mh, 'mouth-eversion'), expr_mag(mh, 'mouth-protusion')
    lip = np.clip((np.maximum(ever * 1.25, prot * 0.95) - 0.38) / 0.35, 0, 1)
    lipT = np.maximum(mh.target_mag('mouth/mouth-lowerlip-volume-incr.target'), mh.target_mag('mouth/mouth-upperlip-volume-incr.target'))
    lip = np.maximum(lip, np.clip((lipT - 0.25) / 0.3, 0, 1))
    mouthH = P[np.isin(og, ['helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue'])]
    dm, _ = cKDTree(mouthH).query(P)
    inner = smoothstep(0.004, 0.016, dm)
    lipw = 1 - smooth_field(np.maximum(lip, 1 - inner), mh.A, 3, 0.5)
    regions['mouth'] = mh.isBody & ((lip > 0.3) | (dm < 0.012))
    # mouth cavity (behind the lips): follows the jaw / cheeks around it instead of the lips only
    regions['mouthInner'] = mh.isBody & (dm < 0.012) & (lip < 0.3)
    w = np.minimum(w, np.clip(lipw * 1.4 - 0.2, 0, 1))
    # nostrils / nose base: ellipsoid under the nose tip
    head = mh.boneIndex['head']
    hw = mh.bone_weight([head])
    mid = mh.isBody & (np.abs(P[:, 0]) < 0.006) & (hw > 0.9) & (P[:, 1] < eyeC['L'][1] - 0.01) & (P[:, 1] > eyeC['L'][1] - 0.06)
    tip = np.nonzero(mid)[0][np.argmax(P[mid, 2])]
    c = P[tip] + [0, -0.011, -0.012]
    e = np.sqrt(((P - c) / [0.021, 0.011, 0.016]) ** 2 @ np.ones(3))
    nos = mh.target_mag('nose/nose-nostrils-width-incr.target')
    regions['nostrils'] = mh.isBody & ((e < 1) | (nos > 0.3))
    w = np.minimum(w, 0.15 + 0.85 * np.minimum(smoothstep(0.8, 1.4, e), 1 - smoothstep(0.15, 0.45, nos)))
    # ears: lateral protrusion of the head between the eye and the jaw
    ey, ez = eyeC['L'][1], eyeC['L'][2]
    for s, sg in (('L', 1), ('R', -1)):
        sel = mh.isBody & (hw > 0.9) & (P[:, 1] > ey - 0.06) & (P[:, 1] < ey + 0.04) & (P[:, 2] < ez - 0.045) & (P[:, 2] > ez - 0.16)
        # the ear stands out of the skull: farther from the head's mid-sagittal plane than the skull side at that height
        xs = sg * P[:, 0]
        ear = sel & (xs > 0.0)
        # skull side estimate: 85th percentile of |x| of the head band excluding the top of the range
        skull = np.percentile(xs[ear], 60)
        m = ear & (xs > skull)
        regions['ear' + s] = m
        earT = mh.target_mag(f'ears/{s.lower()}-ear-scale-incr.target', sg) > 0.25
        dd, _ = cKDTree(P[earT & mh.isBody]).query(P)
        w = np.minimum(w, np.where(mh.isBody, 0.25 + 0.75 * smoothstep(0.0, 0.012, dd), 1))
    # nails: dorsal side of the distal phalanges
    nail = np.zeros(NV)
    for s, sg in (('L', 1), ('R', -1)):
        w0, m0, i0, p0 = (mh.joint(P, n) for n in (f'wrist.{s}____head', f'finger3-1.{s}____head', f'finger2-1.{s}____head', f'finger5-1.{s}____head'))
        palmN = np.cross(m0 - w0, p0 - i0); palmN /= np.linalg.norm(palmN)
        if palmN @ [sg, 0, 0] > 0:
            palmN = -palmN
        N = mh.normals(P)
        for f in range(1, 6):
            b = mh.boneIndex[f'finger{f}-3.{s}']
            tipJ, baseJ = mh.joint(P, mh.bones[b]['tail']), mh.joint(P, mh.bones[b]['head'])
            dirv = tipJ - baseJ; L = np.linalg.norm(dirv); dirv /= L
            bw = mh.bone_weight([b])
            t = ((P - baseJ) @ dirv) / L
            dd = -(N @ palmN)
            m = (bw > 0.5) * np.clip((t - 0.38) / 0.18, 0, 1) * np.clip((dd - (0.0 if f == 1 else 0.35)) / 0.3, 0, 1)
            nail = np.maximum(nail, m)
    regions['nails'] = nail > 0.5
    w = np.minimum(w, 1 - 0.6 * nail)
    # genital area: follows the target, a little stiffer (MakeHuman's coarse neutral mound there)
    gen = P[og == 'helper-genital']
    dg, _ = cKDTree(gen).query(P)
    regions['genital'] = mh.isBody & (dg < 0.012)
    w = np.minimum(w, np.where(mh.isBody, GENITAL_W + (1 - GENITAL_W) * smoothstep(0.006, 0.03, dg), 1))
    w[~mh.isBody] = 0
    return w, regions, eyeC


def digit_labels(mh):
    """Per vertex: 1..10 finger (L 1-5, R 6-10), 11..20 toe, 0 = other (dominant bone)."""
    lab = np.zeros(mh.NV, np.int64)
    best = np.argmax(mh.skinWeight, 1)
    bb = mh.skinIndex[np.arange(mh.NV), best]
    for bi, b in enumerate(mh.bones):
        n = b['name']
        side = 0 if n.endswith('.L') else 5
        if n.startswith('finger'):
            lab[bb == bi] = int(n[6]) + side
        elif n.startswith('toe'):
            lab[bb == bi] = 10 + int(n[3]) + side
    return lab


# ---------------------------------------------------------------- landmarks
def detail_height(V, A_or_F, N, iters=40):
    """Local relief: (V - smoothed V) . N."""
    if isinstance(A_or_F, sp.spmatrix):
        Adj = A_or_F
    else:
        Adj = adjacency(edges_of(A_or_F), len(V))
    S = smooth_field(V, Adj, iters, 0.5)
    return ((V - S) * N).sum(1)


def front_envelope(V, sel, axis_val, step=0.002):
    """Profile of the front-most (max z) point of the selected vertices per bin of y."""
    idx = np.nonzero(sel)[0]
    y = V[idx, 1]
    bins = np.floor(y / step).astype(int)
    out = {}
    for b in np.unique(bins):
        k = idx[bins == b]
        out[b] = k[np.argmax(V[k, 2])]
    keys = sorted(out)
    return np.array([out[k] for k in keys])


def face_profile(V, is_head, eyeY):
    """Midline landmarks from the front envelope (max z per 1 mm of height) of the face:
    nose tip, stomion (deepest point between the lips), chin (most forward point below)."""
    sel = is_head & (np.abs(V[:, 0]) < 0.006) & (V[:, 1] < eyeY + 0.005) & (V[:, 1] > eyeY - 0.13)
    idx = np.nonzero(sel)[0]
    bins = np.floor((eyeY - V[idx, 1]) / 0.001).astype(int)  # mm below the eyes
    prof = {}
    for bb, i in zip(bins, idx):
        if bb not in prof or V[i, 2] > V[prof[bb], 2]:
            prof[bb] = i
    mm = np.arange(0, 130)
    z = np.array([V[prof[m], 2] if m in prof else np.nan for m in mm])
    ok = ~np.isnan(z)
    z = np.interp(mm, mm[ok], z[ok])
    zs = np.convolve(np.pad(z, 1, mode='edge'), np.ones(3) / 3, 'valid')
    at = lambda m: prof[min(prof, key=lambda k: abs(k - m))]
    nose = 15 + int(np.argmax(zs[15:46]))
    lips = np.arange(nose + 18, nose + 52)
    zl = zs[lips]
    pk = [k for k in range(1, len(zl) - 1) if zl[k] >= zl[k - 1] and zl[k] >= zl[k + 1]]
    pk = sorted(pk, key=lambda k: -zl[k])
    up = lo = None
    for k in pk:
        if up is None:
            up = k
        elif abs(k - up) >= 6:
            lo = k; break
    if lo is None:
        sto = lips[len(lips) // 2]
        lower = sto + 5
    else:
        a, b = sorted((up, lo))
        sto = lips[a + int(np.argmin(zl[a:b + 1]))]
        lower = lips[b]
    chin = lower + 10 + int(np.argmax(zs[lower + 10:lower + 40]))
    return {'noseTip': at(nose), 'stomion': at(sto), 'chin': at(chin), 'mm': {'nose': int(nose), 'stomion': int(sto), 'chin': int(chin)}}


def ear_region(V, N, is_head, eyeC, side):
    sg = 1 if side == 'L' else -1
    ey, ez = eyeC[1], eyeC[2]
    sel = is_head & (V[:, 1] > ey - 0.06) & (V[:, 1] < ey + 0.04) & (V[:, 2] < ez - 0.045) & (V[:, 2] > ez - 0.16) & (sg * V[:, 0] > 0)
    xs = sg * V[:, 0]
    skull = np.percentile(xs[sel], 60)
    return sel & (xs > skull)


def geodesic_tips(V, F, region, seed_point, n_tips, with_dist=False, axis=None):
    """Local maxima of the geodesic distance over the region (graph of edges) from seed_point,
    or, with axis, from every region vertex within 2 cm of the plane through seed_point."""
    from scipy.sparse.csgraph import dijkstra
    idx = np.nonzero(region)[0]
    remap = -np.ones(len(V), np.int64); remap[idx] = np.arange(len(idx))
    E = edges_of(F)
    E = E[region[E[:, 0]] & region[E[:, 1]]]
    e = remap[E]
    w = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
    G = sp.coo_matrix((np.concatenate([w, w]), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(len(idx), len(idx))).tocsr()
    if axis is None:
        s0 = np.argmin(np.linalg.norm(V[idx] - seed_point, axis=1))
        dist = dijkstra(G, indices=s0)
    else:
        src = np.nonzero((V[idx] - seed_point) @ axis < 0.02)[0]
        dist = dijkstra(G, indices=src, min_only=True)
    dist[~np.isfinite(dist)] = 0
    # local maxima over 1-ring, keep the n farthest separated by >= 1.2 cm
    order = np.argsort(-dist)
    tips, td = [], []
    for k in order:
        if dist[k] < 0.5 * dist.max():  # tips are far from the seed (the thumb is ~0.65 of the longest)
            break
        p = V[idx[k]]
        if all(np.linalg.norm(p - V[t]) > 0.012 for t in tips):
            # must be a local max among neighbours
            nb = G[k].indices
            if (dist[nb] <= dist[k]).all():
                tips.append(idx[k]); td.append(dist[k])
        if len(tips) == n_tips:
            break
    return (tips, np.array(td)) if with_dist else tips


def hand_tip_pairs(mh, X, jp, tgt):
    pairs = []
    # --- fingertips. MakeHuman: farthest vertex of each distal phalanx along it. Target: the
    # local maxima of the geodesic distance from the wrist plane over the hand; the four
    # farthest are the fingers, paired by their order across the hand; the thumb when a
    # fifth maximum lies near the MakeHuman thumb tip.
    V1, F1 = tgt.V[1], tgt.F[1]
    for s, sg in (('L', 1), ('R', -1)):
        wr = jp[mh.boneIndex[f'wrist.{s}']]; el = jp[mh.boneIndex[f'lowerarm01.{s}']]
        f = (wr - el) / np.linalg.norm(wr - el)
        tipm = {}
        for k in range(1, 6):
            b = mh.boneIndex[f'finger{k}-3.{s}']
            h0, t0 = mh.joint(X, mh.bones[b]['head']), mh.joint(X, mh.bones[b]['tail'])
            dirv = (t0 - h0) / np.linalg.norm(t0 - h0)
            cand = np.nonzero(mh.isBody & (mh.bone_weight([b]) > 0.5))[0]
            tipm[k] = cand[np.argmax((X[cand] - h0) @ dirv)]
        lat = mh.joint(X, f'finger2-1.{s}____head') - mh.joint(X, f'finger5-1.{s}____head')
        lat /= np.linalg.norm(lat)
        rel = V1 - wr; along = rel @ f; radial = np.linalg.norm(rel - np.outer(along, f), axis=1)
        cyl = (along > -0.01) & (along < 0.26) & (radial < 0.11)
        seed = np.argmin(np.where(cyl, np.linalg.norm(V1 - (wr + 0.03 * f), axis=1), 1e9))
        hand_a = region_component(V1, F1, cyl, seed)
        tips_a, gd_a = geodesic_tips(V1, F1, hand_a, wr, 5, with_dist=True, axis=f)
        if len(tips_a) < 4:
            log(f'  warning: fingertips {s}: only {len(tips_a)} found on the target')
            continue
        four = sorted(tips_a[:4], key=lambda q: V1[q] @ lat)
        for k, q in zip((5, 4, 3, 2), four):
            pairs.append((f'tip{k}{s}', int(tipm[k]), V1[q], 1.0))
        # thumb: the geodesically farthest point of the target hand within 4 cm of the MakeHuman thumb tip,
        # excluding the finger tips' neighbourhoods
        shift = np.mean([V1[q] for q in four], 0) - np.mean([X[tipm[k]] for k in (2, 3, 4, 5)], 0)
        near = hand_a & (np.linalg.norm(V1 - (X[tipm[1]] + shift), axis=1) < 0.03)
        for q in tips_a[:4]:
            near &= np.linalg.norm(V1 - V1[q], axis=1) > 0.025
        if near.sum() > 10:
            from scipy.sparse.csgraph import dijkstra
            idx = np.nonzero(hand_a)[0]; remap = -np.ones(len(V1), np.int64); remap[idx] = np.arange(len(idx))
            E = edges_of(F1); E = E[hand_a[E[:, 0]] & hand_a[E[:, 1]]]; e = remap[E]
            w = np.linalg.norm(V1[E[:, 0]] - V1[E[:, 1]], axis=1)
            G = sp.coo_matrix((np.concatenate([w, w]), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(len(idx), len(idx))).tocsr()
            src = np.nonzero((V1[idx] - wr) @ f < 0.02)[0]
            gd = dijkstra(G, indices=src, min_only=True)
            cand = np.nonzero(near)[0]
            q = cand[np.argmax(np.where(np.isfinite(gd[remap[cand]]), gd[remap[cand]], -1))]
            pairs.append((f'tip1{s}', int(tipm[1]), V1[q], 1.0))
        else:
            log(f'  fingertips {s}: no thumb tip candidate on the target')
    return pairs


class Landmarks:
    pass


def find_landmarks(mh, X, tgt, eyeC_mh, pose):
    """Corresponding points: MakeHuman vertex index -> target position (posed space)."""
    V, F, NA = tgt.V[2], tgt.F[2], tgt.N[2]
    body = mh.bodyIdx
    NX = mh.normals(X)
    hw = mh.bone_weight([mh.boneIndex['head']])
    A_, t_, Q, jp = pose.transforms()
    pairs = []  # (name, mh vertex, target point, weight)
    # --- face midline
    eyeY_mh = (eyeC_mh['L'][1] + eyeC_mh['R'][1]) / 2
    fm = face_profile(X, mh.isBody & (hw > 0.9), eyeY_mh)
    headA = (V[:, 1] > tgt.eyes[:, 1].mean() - 0.2)
    fa = face_profile(V, headA, tgt.eyes[:, 1].mean())
    log(f"  face profile (mm below the eyes) mh {fm['mm']} target {fa['mm']}")
    for k in ('noseTip', 'stomion'):
        pairs.append((k, fm[k], V[fa[k]], 1.0))
    # mouth corners: MakeHuman 'mouth-angles' target tips; target: deepest crease point beside the stomion
    hA6 = detail_height(V, F, NA, 6)
    ys = V[fa['stomion'], 1]
    for s, sg in (('L', 1), ('R', -1)):
        mc = int(np.argmax(mh.target_mag('mouth/mouth-angles-up.target', sg)))
        ca = (np.abs(V[:, 1] - ys) < 0.009) & (sg * V[:, 0] > 0.014) & (sg * V[:, 0] < 0.035) & (NA[:, 2] > 0.2) & headA
        ca &= V[:, 2] > V[fa['stomion'], 2] - 0.035
        pairs.append(('mouth' + s, mc, V[np.nonzero(ca)[0][np.argmin(hA6[ca])]], 0.7))
    # --- head top
    top_m = body[np.argmax(X[body, 1])]
    pairs.append(('headTop', top_m, V[np.argmax(V[:, 1])], 0.5))
    # --- crotch (lowest point of the midline between the legs, above the knees)
    H0 = X[body, 1].min(); H = np.ptp(X[body, 1])
    selm = mh.isBody & (np.abs(X[:, 0]) < 0.004) & (X[:, 1] > H0 + 0.35 * H) & (X[:, 1] < H0 + 0.6 * H)
    crm = np.nonzero(selm)[0][np.argmin(X[selm, 1])]
    sela = (np.abs(V[:, 0]) < 0.004) & (V[:, 1] > H0 + 0.35 * H) & (V[:, 1] < H0 + 0.6 * H)
    cra = np.nonzero(sela)[0][np.argmin(V[sela, 1])]
    # (the crotch is a saddle: no reliable single point)
    # --- nipples and navel from the local relief
    hX = np.zeros(mh.NV); hX[body] = detail_height(X, mh.A, NX, 8)[body]
    hA = detail_height(V, F, NA, 40)
    hA8 = detail_height(V, F, NA, 8)
    for s, sg in (('L', 1), ('R', -1)):
        # nipple: the most prominent small bump on the front of the chest
        cm = mh.isBody & (X[:, 1] > H0 + 0.66 * H) & (X[:, 1] < H0 + 0.78 * H) & (sg * X[:, 0] > 0.05) & (sg * X[:, 0] < 0.13) & (NX[:, 2] > 0.6)
        ca = (V[:, 1] > H0 + 0.66 * H) & (V[:, 1] < H0 + 0.78 * H) & (sg * V[:, 0] > 0.05) & (sg * V[:, 0] < 0.13) & (NA[:, 2] > 0.6)
        nm = int(np.argmax(mh.target_mag('breast/nipple-point-incr.target', sg)))
        # target nipple: the strongest small bump (fine-scale relief) on the front of the chest
        na = np.nonzero(ca)[0][np.argmax(hA8[ca] / max(hA8[ca].max(), 1e-9) + 0.15 * (V[ca, 2] - V[ca, 2].max()) / 0.02)]
        pairs.append(('nipple' + s, nm, V[na], 1.0))
    cm = mh.isBody & (X[:, 1] > H0 + 0.52 * H) & (X[:, 1] < H0 + 0.64 * H) & (np.abs(X[:, 0]) < 0.012) & (NX[:, 2] > 0.3)
    ca = (V[:, 1] > H0 + 0.52 * H) & (V[:, 1] < H0 + 0.64 * H) & (np.abs(V[:, 0]) < 0.012) & (NA[:, 2] > 0.3)
    pairs.append(('navel', int(np.argmax(mh.target_mag('stomach/stomach-navel-in.target'))), V[np.nonzero(ca)[0][np.argmin(hA[ca])]], 1.0))
    # --- knees: front-most point of the knee band (patella)
    for s, sg in (('L', 1), ('R', -1)):
        kn = jp[mh.boneIndex[f'lowerleg01.{s}']]
        bm = mh.isBody & (np.abs(X[:, 1] - kn[1]) < 0.06) & (sg * X[:, 0] > 0.02) & (np.abs(X[:, 0] - kn[0]) < 0.09)
        ba = (np.abs(V[:, 1] - kn[1]) < 0.06) & (sg * V[:, 0] > 0.02) & (np.abs(V[:, 0] - kn[0]) < 0.09)
        km = np.nonzero(bm)[0][np.argmax(X[bm, 2] + 0.3 * hX[bm])]
        ka = np.nonzero(ba)[0][np.argmax(V[ba, 2] + 0.3 * hA[ba])]
        pairs.append(('patella' + s, km, V[ka], 0.7))
    # --- feet: big toe tip (front-most), heel (back-most low point)
    for s, sg in (('L', 1), ('R', -1)):
        an = jp[mh.boneIndex[f'foot.{s}']]
        fmk = mh.isBody & (X[:, 1] < an[1] + 0.02) & (np.abs(X[:, 0] - an[0]) < 0.08)
        fak = (V[:, 1] < an[1] + 0.02) & (np.abs(V[:, 0] - an[0]) < 0.08)
        pairs.append(('toe' + s, np.nonzero(fmk)[0][np.argmax(X[fmk, 2])], V[np.nonzero(fak)[0][np.argmax(V[fak, 2])]], 1.0))
        lowm = fmk & (X[:, 1] < H0 + 0.03); lowa = fak & (V[:, 1] < H0 + 0.03)
        pairs.append(('heel' + s, np.nonzero(lowm)[0][np.argmin(X[lowm, 2])], V[np.nonzero(lowa)[0][np.argmin(V[lowa, 2])]], 0.5))
    pairs += hand_tip_pairs(mh, X, jp, tgt)
    return pairs


# ---------------------------------------------------------------- non-rigid ICP
def nicp(mh, X0, tgt, wdata, labels, pairs, centroids, schedule, debug=None):
    """Displacement of the body vertices (posed space). Returns X (NV x 3)."""
    body = mh.bodyIdx
    n = len(body)
    loc = -np.ones(mh.NV, np.int64); loc[body] = np.arange(n)
    Ab = mh.A[body][:, body]
    L = uniform_laplacian(Ab)
    LtL = (L.T @ L).tocsr()
    deg = np.asarray(Ab.sum(1)).ravel()
    G = (sp.diags(deg) - Ab).tocsr()
    I3 = sp.identity(3, format='csr')
    R_mem = sp.kron(G, I3, format='csr')
    V2, N2 = tgt.V[2], tgt.N[2]
    kd2 = tgt.kd[2]
    V1, N1 = tgt.V[1], tgt.N[1]
    # digit labels of the target (nearest posed source vertex), for matching
    _, nn = cKDTree(X0[body]).query(V2)
    labA2 = labels[body][nn]
    _, nn1 = cKDTree(X0[body]).query(V1)
    labA1 = labels[body][nn1]
    labB = labels[body]
    Xb = X0[body].copy()
    D = np.zeros((n, 3))
    wd = wdata[body]
    # landmarks
    lm_i = np.array([loc[p[1]] for p in pairs]); lm_p = np.array([p[2] for p in pairs]); lm_w = np.array([p[3] for p in pairs])
    # centroid groups: (local indices, target centroid, weight)
    KP = 2500.0  # extra bending stiffness of the protected regions: they move (locally) affinely
    KM = 40.0  # extra membrane stiffness there: no stretching / squashing of eyelids, lips, ears
    prot = 1 - np.clip(wd, 0, 1)
    Ab_coo = Ab.tocoo()
    ke = 0.5 * (prot[Ab_coo.row] + prot[Ab_coo.col])
    Aw = sp.coo_matrix((ke, (Ab_coo.row, Ab_coo.col)), shape=Ab.shape).tocsr()
    Gp = (sp.diags(np.asarray(Aw.sum(1)).ravel()) - Aw).tocsr()
    R_memp = sp.kron(Gp, I3, format='csr')
    for stage, (alpha, gamma, tau, cosmin, its, beta) in enumerate(schedule):
        kstiff = alpha + KP * prot
        R_bi = sp.kron((L.T @ sp.diags(kstiff) @ L).tocsr(), I3, format='csr') + KM * R_memp
        if stage:
            # digit labels of the target from the current fit (the hands have moved onto the target's)
            kdc = cKDTree(Xb + D)
            labA2 = labB[kdc.query(V2)[1]]
            labA1 = labB[kdc.query(V1)[1]]
        for it in range(its):
            X = Xb + D
            Pfull = X0.copy(); Pfull[body] = X
            NX = mh.normals(Pfull)[body]
            # forward: source -> target (closest target vertex, point-to-plane on its normal)
            d, j = kd2.query(X, k=3)
            # choose the first neighbour that passes the checks
            ok = np.zeros(n, bool); jj = np.zeros(n, np.int64)
            for k in range(3):
                jk = j[:, k]
                c = (d[:, k] < tau) & ((NX * N2[jk]).sum(1) > cosmin)
                lab_ok = (labB == 0) | (labA2[jk] == 0) | (labA2[jk] == labB)
                c &= lab_ok & ~ok
                jj[c] = jk[c]; ok |= c
            wf = wd * ok
            # reverse: target -> source (point-to-point, averaged per source vertex)
            dr, ir = cKDTree(X).query(V1)
            okr = (dr < tau) & ((NX[ir] * N1).sum(1) > cosmin) & ((labB[ir] == 0) | (labA1 == 0) | (labA1 == labB[ir]))
            okr &= wd[ir] > 0.5
            cnt = np.bincount(ir[okr], minlength=n).astype(float)
            acc = np.zeros((n, 3))
            np.add.at(acc, ir[okr], V1[okr])
            hasr = cnt > 0
            tr_ = np.where(hasr[:, None], acc / np.maximum(cnt, 1)[:, None], 0)
            wr = 0.5 * hasr * np.minimum(1, wd)
            # assemble
            nrm = N2[jj]
            eps = 0.15
            Bk = (nrm[:, :, None] * nrm[:, None, :] + eps * np.eye(3)[None]) * wf[:, None, None]
            rhs = np.einsum('nij,nj->ni', Bk, V2[jj] - X)
            Bk = Bk + wr[:, None, None] * np.eye(3)[None]
            rhs += wr[:, None] * (tr_ - X) * hasr[:, None]
            rows = (np.arange(n)[:, None, None] * 3 + np.arange(3)[None, :, None]).repeat(3, 2)
            cols = (np.arange(n)[:, None, None] * 3 + np.arange(3)[None, None, :]).repeat(3, 1)
            M = sp.coo_matrix((Bk.ravel(), (rows.ravel(), cols.ravel())), shape=(3 * n, 3 * n)).tocsr()
            # landmarks
            lw = np.zeros(n); lt = np.zeros((n, 3))
            np.add.at(lw, lm_i, beta * lm_w)
            np.add.at(lt, lm_i, (beta * lm_w)[:, None] * (lm_p - X[lm_i]))
            M = M + sp.diags(np.repeat(lw, 3))
            rhs += lt
            # centroid constraints (dense blocks)
            for gi, gc, gw in centroids:
                li = loc[gi]
                k = len(li)
                u = np.full(k, 1.0 / k)
                cur = X[li].mean(0)
                blk = gw * beta * np.outer(u, u)
                for c3 in range(3):
                    r = li * 3 + c3
                    M = M + sp.coo_matrix((blk.ravel(), (np.repeat(r, k), np.tile(r, k))), shape=(3 * n, 3 * n)).tocsr()
                    rhs[li, c3] += gw * beta * u * (gc[c3] - cur[c3])
            # regularizers act on the total displacement D + delta: rhs gets -R D
            K = M + R_bi + gamma * R_mem
            rhs_v = rhs.ravel() - (R_bi @ D.ravel() + gamma * (R_mem @ D.ravel()))
            delta = spla.spsolve(K.tocsc(), rhs_v).reshape(n, 3)
            D += delta
            res = np.abs(((Xb + D - V2[jj]) * nrm).sum(1))[ok]
            lme = np.linalg.norm(Xb[lm_i] + D[lm_i] - lm_p, axis=1)
            log(f'  nicp stage {stage} it {it}: alpha {alpha:g} matched {ok.mean():.2f} rev {okr.mean():.2f} '
                f'p2plane mean {res.mean() * 1000:.2f} mm p95 {np.percentile(res, 95) * 1000:.2f} mm, landmarks mean {lme.mean() * 1000:.1f} max {lme.max() * 1000:.1f} mm, |step| {np.abs(delta).max() * 1000:.1f} mm')
    out = X0.copy(); out[body] = Xb + D
    return out


# ---------------------------------------------------------------- helpers follow the body
def carry_helpers(mh, X0, X1, inner=None):
    """Moves every non-body vertex (and the `inner` body vertices: mouth cavity) with a
    moving-least-squares affine fit of the displacement of the (other) body vertices."""
    src = mh.isBody.copy()
    if inner is not None:
        src &= ~inner
    body = np.nonzero(src)[0]
    hel = np.nonzero(~src)[0]
    B0, B1 = X0[body], X1[body]
    kd = cKDTree(B0)
    # skin weight vectors (dense over bones) for gating
    nb = len(mh.bones)
    Wd = np.zeros((mh.NV, nb))
    for k in range(4):
        np.add.at(Wd, (np.arange(mh.NV), mh.skinIndex[:, k]), mh.skinWeight[:, k])
    out = X1.copy()
    dmin, _ = kd.query(X0[hel])
    for h, d0 in zip(hel, dmin):
        r = max(0.012, 1.7 * d0)
        nbrs = kd.query_ball_point(X0[h], r)
        if len(nbrs) < 12:
            _, nbrs = kd.query(X0[h], k=12)
        nbrs = np.asarray(nbrs)
        dist = np.linalg.norm(B0[nbrs] - X0[h], axis=1)
        sim = Wd[body[nbrs]] @ Wd[h] / (np.linalg.norm(Wd[body[nbrs]], axis=1) * np.linalg.norm(Wd[h]) + 1e-12)
        w = np.exp(-(dist / max(0.006, 0.8 * d0 + 0.004)) ** 2) * np.clip(sim, 0.05, 1) ** 2
        if w.sum() < 1e-9:
            w = np.ones(len(nbrs))
        w /= w.sum()
        p0 = B0[nbrs]; p1 = B1[nbrs]
        c0 = w @ p0; c1 = w @ p1
        Q0 = (p0 - c0) * np.sqrt(w)[:, None]; Q1 = (p1 - c1) * np.sqrt(w)[:, None]
        # affine part, ridge-regularized toward the identity (a pure translation when ill-posed)
        lam = 1e-4 + 0.05 * np.trace(Q0.T @ Q0)
        Mlin = np.linalg.solve(Q0.T @ Q0 + lam * np.eye(3), Q0.T @ Q1 + lam * np.eye(3))
        out[h] = c1 + (X0[h] - c0) @ Mlin
    return out


# ---------------------------------------------------------------- driver
def fit_sex(mh, cache, out, s):
    name, pid = SEXES[s]
    t0 = time.time()
    P = mh.presets[pid]
    tgt = Target(os.path.join(cache, f'A_{name}.npz'), mh, P)
    pose = articulated_fit(mh, P, tgt)
    np.save(os.path.join(out, f'pose_{s}.npy'), np.concatenate([pose.R.reshape(-1), pose.Rg.reshape(-1), pose.tg, pose.D.reshape(-1), pose.S]))
    if os.environ.get('FIT_STOP') == 'pose':
        return
    X0 = pose.apply(P)  # every vertex (helpers too) in the target's pose
    wdata, regions, eyeC_rest = protect_weights(mh, P)
    labels = digit_labels(mh)
    og = mh.objGroup
    eyeC = {sd: X0[og == f'helper-{sd.lower()}-eye'].mean(0) for sd in 'LR'}
    pairs = find_landmarks(mh, X0, tgt, eyeC, pose)
    for nm, i, p, w in pairs:
        log(f'  landmark {nm:9s} mh {i:5d} offset {np.round((p - X0[i]) * 1000, 1)} mm')
    json.dump({'landmarks': {nm: [int(i), [float(x) for x in p]] for nm, i, p, w in pairs}}, open(os.path.join(out, f'lm_{s}.json'), 'w'))
    np.save(os.path.join(out, f'wdata_{s}.npy'), wdata)
    if os.environ.get('FIT_STOP') == 'lm':
        return
    # centroid constraints: eye zones carry the eyeballs onto the target's eyes, ears and mouth onto theirs
    cents = []
    for sd, k in (('L', 0), ('R', 1)):
        zone = np.nonzero(regions['eye' + sd])[0]
        off = X0[zone].mean(0) - eyeC[sd]
        cents.append((zone, tgt.eyes[k] + off, 3.0))
        log(f'  eye {sd}: mh {np.round(eyeC[sd], 4)} -> target {np.round(tgt.eyes[k], 4)} (radius mh {np.linalg.norm(X0[og == f"helper-{sd.lower()}-eye"] - eyeC[sd], axis=1).max():.4f} target {tgt.eyeR:.4f})')
        NA = tgt.N[2]
        hA = tgt.V[2][:, 1] > tgt.eyes[:, 1].mean() - 0.2
        ea = ear_region(tgt.V[2], NA, hA, tgt.eyes[k], sd)
        ez = np.nonzero(regions['ear' + sd])[0]
        log(f'  ear {sd}: mh {np.round(X0[ez].mean(0), 4)} target {np.round(tgt.V[2][ea].mean(0), 4)} ({len(ez)} / {ea.sum()} verts)')
        cents.append((ez, tgt.V[2][ea].mean(0), 1.0))
    sto = [p for p in pairs if p[0] == 'stomion'][0]
    mz = np.nonzero(regions['mouth'])[0]
    cents.append((mz, X0[mz].mean(0) + (sto[2] - X0[sto[1]]), 2.0))
    # stiffness schedule: (alpha bi-Laplacian, gamma membrane, reject distance, min normal cos, iterations, landmark weight)
    schedule = [
        (3000, 1.0, 0.08, 0.0, 3, 20),
        (800, 0.5, 0.05, 0.3, 3, 20),
        (200, 0.3, 0.03, 0.4, 3, 15),
        (60, 0.2, 0.02, 0.5, 3, 10),
        (20, 0.1, 0.015, 0.5, 3, 6),
        (6, 0.05, 0.01, 0.5, 3, 4),
        (2, 0.03, 0.008, 0.5, 3, 3),
    ]
    X1 = nicp(mh, X0, tgt, wdata, labels, pairs, cents, schedule)
    X1 = carry_helpers(mh, X0, X1, inner=regions['mouthInner'])
    log(f"  carried {int((~mh.isBody).sum())} helper and {int(regions['mouthInner'].sum())} mouth-cavity vertices")
    # un-pose about the fitted joints
    A_, t_, Q, jp_old = pose.transforms()
    jp = mh.heads(X1)
    root_rest = mh.heads(P)[0]
    A, t, jr = forward_from_posed_joints(mh, Q, jp, root_rest)
    R = lbs_inverse(mh, A, t, X1)
    # keep the MakeHuman floor
    R[:, 1] += P[mh.bodyIdx, 1].min() - R[mh.bodyIdx, 1].min()
    np.save(os.path.join(out, f'posed_{s}.npy'), X1)
    R.astype('<f4').tofile(os.path.join(out, f'fit_{s}.bin'))
    d, _ = tgt.kd[2].query(X1[mh.bodyIdx])
    rep = {'sex': s, 'scale': tgt.scale, 'dist_mean_mm': float(d.mean() * 1000), 'dist_p95_mm': float(np.percentile(d, 95) * 1000),
           'dist_p99_mm': float(np.percentile(d, 99) * 1000), 'height': float(np.ptp(R[mh.bodyIdx, 1])),
           'landmarks': {nm: [int(i), [float(x) for x in p]] for nm, i, p, w in pairs}}
    json.dump(rep, open(os.path.join(out, f'fit_{s}.json'), 'w'), indent=1)
    log(f'{s}: fitted in {time.time() - t0:.0f} s; distance to target mean {rep["dist_mean_mm"]:.2f} mm p95 {rep["dist_p95_mm"]:.2f} mm; height {rep["height"]:.3f}')
    np.save(os.path.join(out, f'wdata_{s}.npy'), wdata)


def main():
    cache, out = sys.argv[1], sys.argv[2]
    sexes = sys.argv[3:] or ['f', 'm']
    os.makedirs(out, exist_ok=True)
    mh = MH(os.path.join(cache, 'mh.json'))
    for s in sexes:
        fit_sex(mh, cache, out, s)
    open(os.path.join(out, 'fit.log'), 'w').write('\n'.join(LOG) + '\n')


if __name__ == '__main__':
    main()
