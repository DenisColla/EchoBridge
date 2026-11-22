# Bakes the sculpted detail of the realistic Human Base Meshes bodies (Multires
# level 3, ~1.4 M triangles) into tangent-space normal maps in MakeHuman body UV
# space, against the fitted MakeHuman surface (tools/hbm/fit.py).
#
#   <venv with bpy, scipy, pillow>/python -I tools/hbm/bake.py <cacheDir> <fitOutDir> <dataDir> [f|m ...] [--size 2048]
#
# Per texel of every body triangle: position, smooth normal and the UV tangent
# frame of the fitted MakeHuman body (the frame Character._computeTangents gives
# the renderer: T = dP/du orthogonalized against N, B = cross(N, T) * handedness,
# interpolated per texel like the shader does); a ray along +-N finds the sculpt
# surface (mathutils BVH), whose smooth normal (barycentric interpolation of its
# vertex normals) is written in that frame. Image row 0 is v = 1 (same as the
# previous procedural maps in tools/build-assets.mjs).
#
# Amplitude: the slopes are stored divided by STORE_GAIN, so the material's
# normalScale (= definition x style factor, ~2.6 at the presets' default
# definition in the realistic style) reproduces the sculpt 1:1; the Definizione
# muscolare slider still scales it (0 = flat, 1 = ~1.7x the sculpt).
# Faded to flat where MakeHuman keeps its own geometry (eyes and lids, lips and
# mouth, nostrils, ears, nails, genital area) and where no sculpt surface is
# found within MAX_DIST, or its normal disagrees with the body's.
import os, sys, time
import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import MH, SEXES, quads_to_tris, vertex_normals, smooth_field
from fit import Target, protect_weights, smoothstep

STORE_GAIN = 2.6
MAX_DIST = 0.009
FACE_GAIN = 0.75  # the face keeps most of its sculpted skin (expressions move it)


def tangent_frames(mh, X, N):
    """Per render vertex (T, B, N) as in Character._computeTangents (body triangles)."""
    rv2v, UV = mh.rv2v, mh.rvUV
    F = mh.faceRV[mh.faceG == 0]
    tri = np.concatenate([F[:, [0, 1, 2]], F[F[:, 3] != 0xffff][:, [0, 2, 3]]])
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    pa, pb, pc = X[rv2v[a]], X[rv2v[b]], X[rv2v[c]]
    e1, e2 = pb - pa, pc - pa
    du1, dv1 = UV[b, 0] - UV[a, 0], UV[b, 1] - UV[a, 1]
    du2, dv2 = UV[c, 0] - UV[a, 0], UV[c, 1] - UV[a, 1]
    det = du1 * dv2 - du2 * dv1
    ok = np.abs(det) > 1e-12
    r = np.where(ok, 1 / np.where(ok, det, 1), 0)
    t = (e1 * dv2[:, None] - e2 * dv1[:, None]) * r[:, None]
    bb = (e2 * du1[:, None] - e1 * du2[:, None]) * r[:, None]
    NR = len(rv2v)
    accT = np.zeros((NR, 3)); accB = np.zeros((NR, 3))
    for k in (a, b, c):
        np.add.at(accT, k, t); np.add.at(accB, k, bb)
    Nr = N[rv2v]
    T = accT - Nr * (accT * Nr).sum(1, keepdims=True)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-20
    w = np.where((np.cross(Nr, T) * accB).sum(1) < 0, -1.0, 1.0)
    B = np.cross(Nr, T) * w[:, None]
    return tri, T, B, Nr


def rasterize(mh, tri, S):
    """Texel -> (triangle, barycentrics) for the body triangles in UV space (row 0 = v 1)."""
    UV = mh.rvUV
    tid = np.full(S * S, -1, np.int64); bary = np.zeros((S * S, 3))
    u = UV[tri][:, :, 0] * S; v = (1 - UV[tri][:, :, 1]) * S
    for i in range(len(tri)):
        ua, ub, uc = u[i]; va, vb, vc = v[i]
        x0, x1 = max(0, int(np.floor(min(ua, ub, uc))) - 1), min(S - 1, int(np.ceil(max(ua, ub, uc))) + 1)
        y0, y1 = max(0, int(np.floor(min(va, vb, vc))) - 1), min(S - 1, int(np.ceil(max(va, vb, vc))) + 1)
        den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc)
        if abs(den) < 1e-12:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        l1 = ((vb - vc) * (gx - uc) + (uc - ub) * (gy - vc)) / den
        l2 = ((vc - va) * (gx - uc) + (ua - uc) * (gy - vc)) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01)
        if not m.any():
            continue
        o = (gy[m].astype(np.int64)) * S + gx[m].astype(np.int64)
        tid[o] = i
        bary[o] = np.stack([l1[m], l2[m], l3[m]], 1)
    return tid, bary


def bake(mh, cache, fitout, data, s, S):
    import bpy  # noqa: F401  (registers mathutils)
    import mathutils
    from mathutils.bvhtree import BVHTree
    from PIL import Image
    name, pid = SEXES[s]
    t0 = time.time()
    P = mh.presets[pid]
    X = np.load(os.path.join(fitout, f'posed_{s}.npy'))
    tgt = Target(os.path.join(cache, f'A_{name}.npz'), mh, P)
    V3, F3 = tgt.level3()
    N3 = vertex_normals(V3, quads_to_tris(F3))
    print(f'{s}: sculpt level 3: {len(V3)} verts, {len(F3)} quads; building BVH', flush=True)
    bvh = BVHTree.FromPolygons(V3.tolist(), F3.tolist(), all_triangles=False, epsilon=0.0)
    print(f'  BVH ready ({time.time() - t0:.0f} s)', flush=True)
    N = mh.normals(X)
    tri, T, B, Nr = tangent_frames(mh, X, N)
    tid, bary = rasterize(mh, tri, S)
    cov = tid >= 0
    idx = np.nonzero(cov)[0]
    tt = tri[tid[idx]]
    l = bary[idx]
    rv2v = mh.rv2v
    pos = (X[rv2v[tt]] * l[:, :, None]).sum(1)
    nrm = (Nr[tt] * l[:, :, None]).sum(1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    Tt = (T[tt] * l[:, :, None]).sum(1); Tt /= np.linalg.norm(Tt, axis=1, keepdims=True) + 1e-20
    Bt = (B[tt] * l[:, :, None]).sum(1); Bt /= np.linalg.norm(Bt, axis=1, keepdims=True) + 1e-20
    # fade weights per mesh vertex (protected regions; face reduced), interpolated per texel
    wd, regions, _ = protect_weights(mh, P)
    amp = np.clip((wd - 0.2) / 0.6, 0, 1)
    hw = mh.bone_weight([mh.boneIndex['head']])
    amp *= 1 - (1 - FACE_GAIN) * smoothstep(0.5, 0.95, hw)
    amp = smooth_field(np.where(mh.isBody, amp, 0), mh.A, 2, 0.5)
    ampT = (amp[rv2v[tt]] * l).sum(1)
    print(f'  {len(idx)} texels; ray casting', flush=True)
    hitF = np.full(len(idx), -1, np.int64); hitP = np.zeros((len(idx), 3)); hitD = np.full(len(idx), np.inf)
    for k in range(len(idx)):
        if ampT[k] <= 0.01:
            continue
        p = mathutils.Vector(pos[k]); n = mathutils.Vector(nrm[k])
        best = None
        for dirv in (n, -n):
            loc, fn, fi, dist = bvh.ray_cast(p, dirv, MAX_DIST)
            if loc is not None and (best is None or dist < best[2]):
                best = (loc, fi, dist)
        if best is not None:
            hitP[k] = best[0]; hitF[k] = best[1]; hitD[k] = best[2]
        if k % 500000 == 0:
            print(f'    {k} / {len(idx)} ({time.time() - t0:.0f} s)', flush=True)
    ok = hitF >= 0
    # smooth sculpt normal at the hit: barycentric interpolation inside the hit quad (two triangles)
    q = F3[np.where(ok, hitF, 0)]
    m = np.zeros((len(idx), 3))
    for (i0, i1, i2) in ((0, 1, 2), (0, 2, 3)):
        a, b, c = V3[q[:, i0]], V3[q[:, i1]], V3[q[:, i2]]
        v0, v1, v2 = b - a, c - a, hitP - a
        d00 = (v0 * v0).sum(1); d01 = (v0 * v1).sum(1); d11 = (v1 * v1).sum(1); d20 = (v2 * v0).sum(1); d21 = (v2 * v1).sum(1)
        den = d00 * d11 - d01 * d01
        bv = (d11 * d20 - d01 * d21) / np.where(den == 0, 1, den); bw = (d00 * d21 - d01 * d20) / np.where(den == 0, 1, den); bu = 1 - bv - bw
        inside = (bu >= -1e-3) & (bv >= -1e-3) & (bw >= -1e-3)
        nn = N3[q[:, i0]] * bu[:, None] + N3[q[:, i1]] * bv[:, None] + N3[q[:, i2]] * bw[:, None]
        sel = inside & ok & ~(np.abs(m).sum(1) > 0)
        m[sel] = nn[sel]
    miss = ok & ~(np.abs(m).sum(1) > 0)
    m[miss] = N3[q[miss, 0]]
    m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-20
    agree = (m * nrm).sum(1)
    fade = ampT * ok * smoothstep(0.35, 0.6, agree) * (1 - smoothstep(0.6 * MAX_DIST, MAX_DIST, np.where(ok, hitD, MAX_DIST)))
    ts = np.stack([(m * Tt).sum(1), (m * Bt).sum(1), (m * nrm).sum(1)], 1)
    # stored slope = true slope / STORE_GAIN, faded toward flat
    xy = ts[:, :2] / np.maximum(ts[:, 2:3], 0.2) / STORE_GAIN * fade[:, None]
    z = np.ones(len(idx))
    vec = np.concatenate([xy, z[:, None]], 1)
    vec /= np.linalg.norm(vec, axis=1, keepdims=True)
    sl = np.linalg.norm(vec[:, :2], axis=1)
    lim = sl > 0.707
    vec[lim, :2] *= (0.707 / sl[lim])[:, None]; vec[lim, 2] = 0.707
    img = np.zeros((S * S, 3)); img[:, 2] = 1
    img[idx] = vec
    # dilate the islands 8 px (mip-mapping / filtering at the seams)
    covered = cov.copy().reshape(S, S)
    im = img.reshape(S, S, 3)
    for _ in range(8):
        acc = np.zeros_like(im); cnt = np.zeros((S, S))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(im, dy, 0), dx, 1); sc = np.roll(np.roll(covered, dy, 0), dx, 1)
            acc += sh * sc[..., None]; cnt += sc
        grow = ~covered & (cnt > 0)
        im[grow] = acc[grow] / cnt[grow][:, None]
        covered |= grow
    rgb = np.clip(np.round((im * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
    out = os.path.join(data, f'skin_normal_{s}.png')
    Image.fromarray(rgb, 'RGB').save(out, optimize=True)
    dist_ok = hitD[ok]
    print(f'{s}: {out} {S}x{S}, {os.path.getsize(out) / 1e3:.0f} KB; hits {ok.mean() * 100:.1f}% of texels, '
          f'hit distance median {np.median(dist_ok) * 1000:.2f} mm p95 {np.percentile(dist_ok, 95) * 1000:.2f} mm; '
          f'true slope p50 {np.median(np.linalg.norm(ts[ok, :2], axis=1)):.3f} p95 {np.percentile(np.linalg.norm(ts[ok, :2], axis=1), 95):.3f}; '
          f'{time.time() - t0:.0f} s', flush=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    S = 2048
    if '--size' in sys.argv:
        S = int(sys.argv[sys.argv.index('--size') + 1]); args.remove(str(S))
    cache, fitout, data = args[0], args[1], args[2]
    sexes = args[3:] or ['f', 'm']
    os.makedirs(data, exist_ok=True)
    mh = MH(os.path.join(cache, 'mh.json'))
    for s in sexes:
        bake(mh, cache, fitout, data, s, S)


if __name__ == '__main__':
    main()
