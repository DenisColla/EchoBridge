# Shared helpers of the Human Base Meshes fitting tools (tools/hbm/*.py):
# MakeHuman dump / Human Base Meshes loaders, mesh utilities and linear blend
# skinning with the MakeHuman skeleton (joints = means of joint-cube vertices).
import json
import numpy as np
import scipy.sparse as sp

SEXES = {'f': ('female', 'f_normal'), 'm': ('male', 'm_normal')}


# ---------------------------------------------------------------- meshes
def quads_to_tris(F):
    """(n,4) faces with -1 or 0xffff in the 4th slot for triangles -> (m,3) triangles."""
    F = np.asarray(F, np.int64)
    if F.shape[1] == 3:
        return F
    tri = (F[:, 3] < 0) | (F[:, 3] == 0xffff)
    q = F[~tri]
    return np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]], F[tri][:, :3]])


def vertex_normals(V, T, n=None):
    """Area-weighted vertex normals of triangles T (unit, zero for unused vertices)."""
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    N = np.zeros((len(V) if n is None else n, 3))
    for k in range(3):
        np.add.at(N, T[:, k], fn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-20)


def edges_of(F):
    """Unique undirected edges of polygons given as (n,4) with -1 for triangles, or (n,3)."""
    F = np.asarray(F, np.int64)
    es = []
    k = F.shape[1]
    for i in range(k):
        a, b = F[:, i], F[:, (i + 1) % k]
        if k == 4 and i >= 2:  # triangles: last edge is c -> a
            tri = b < 0
            b = np.where(tri, F[:, 0], b)
            ok = a >= 0
            a, b = a[ok], b[ok]
        es.append(np.stack([a, b], 1))
    E = np.concatenate(es)
    E = E[(E >= 0).all(1)]
    E = np.sort(E, 1)
    return np.unique(E, axis=0)


def adjacency(E, n):
    """Symmetric 0/1 adjacency matrix (csr) from edges."""
    A = sp.coo_matrix((np.ones(len(E) * 2), (np.concatenate([E[:, 0], E[:, 1]]), np.concatenate([E[:, 1], E[:, 0]]))), shape=(n, n)).tocsr()
    A.data[:] = 1
    return A


def uniform_laplacian(A):
    """L = I - D^-1 A (rows of isolated vertices are zero)."""
    deg = np.asarray(A.sum(1)).ravel()
    inv = np.where(deg > 0, 1 / np.maximum(deg, 1), 0)
    return (sp.diags((deg > 0).astype(float)) - sp.diags(inv) @ A).tocsr()


def smooth_field(f, A, iters, lam=0.5):
    """Jacobi smoothing of a per-vertex field (scalar or vector) over adjacency A."""
    deg = np.asarray(A.sum(1)).ravel()
    inv = np.where(deg > 0, 1 / np.maximum(deg, 1), 0)
    f = np.array(f, np.float64)
    for _ in range(iters):
        avg = (A @ f) * (inv[:, None] if f.ndim == 2 else inv)
        keep = deg > 0
        f = np.where(keep[:, None] if f.ndim == 2 else keep, (1 - lam) * f + lam * avg, f)
    return f


# ---------------------------------------------------------------- MakeHuman dump
class MH:
    def __init__(self, path):
        d = json.load(open(path))
        self.d = d
        self.NV = d['NV']
        self.faceV = np.array(d['faceV'], np.int64).reshape(-1, 4)
        self.faceG = np.array(d['faceG'])
        self.faceRV = np.array(d['faceRV'], np.int64).reshape(-1, 4)
        self.rv2v = np.array(d['rv2v'], np.int64)
        self.rvUV = np.array(d['rvUV'], np.float64).reshape(-1, 2)
        self.groupOfV = np.array(d['groupOfV'])
        self.objGroup = np.array(d['objGroupOfV'])
        self.base = np.array(d['base'], np.float64).reshape(-1, 3)
        self.presets = {k: np.array(v, np.float64).reshape(-1, 3) for k, v in d['presets'].items()}
        self.skinIndex = np.array(d['skinIndex'], np.int64).reshape(-1, 4)
        self.skinWeight = np.array(d['skinWeight'], np.float64).reshape(-1, 4)
        self.bones = d['bones']
        self.boneIndex = {b['name']: i for i, b in enumerate(self.bones)}
        self.parent = np.array([b['parent'] for b in self.bones])
        self.joints = {k: np.array(v, np.int64) for k, v in d['allJoints'].items()}
        self.expressions = d['expressions']
        self.targets = d.get('targets', {})
        bf = self.faceV[self.faceG == 0].copy()
        bf[bf == 0xffff] = -1
        self.bodyFaces = bf
        self.bodyTris = quads_to_tris(bf)
        self.isBody = self.groupOfV == 0
        self.bodyIdx = np.nonzero(self.isBody)[0]
        self.E = edges_of(bf)
        self.A = adjacency(self.E, self.NV)
        # children lists (parent-first order already)
        self.children = [[] for _ in self.bones]
        for i, p in enumerate(self.parent):
            if p >= 0:
                self.children[p].append(i)

    def joint(self, P, name):
        return P[self.joints[name]].mean(0)

    def heads(self, P):
        return np.array([self.joint(P, b['head']) for b in self.bones])

    def tails(self, P):
        return np.array([self.joint(P, b['tail']) for b in self.bones])

    def subtree(self, b):
        out, st = [], [b]
        while st:
            x = st.pop(); out.append(x); st.extend(self.children[x])
        return out

    def bone_weight(self, bones):
        """Per vertex: summed skin weight on the given bone indices."""
        s = set(bones)
        m = np.isin(self.skinIndex, list(s))
        return (self.skinWeight * m).sum(1)

    def target_mag(self, rel, side=0):
        """Per vertex displacement magnitude of a MakeHuman target, normalized to 1 (side: +1 x>0, -1 x<0)."""
        t = self.targets[rel]
        m = np.zeros(self.NV)
        m[np.array(t['idx'])] = np.linalg.norm(np.array(t['d']).reshape(-1, 3), axis=1)
        if side:
            m[np.sign(self.base[:, 0]) != side] = 0
        return m / (m.max() or 1)

    def normals(self, P):
        return vertex_normals(P, self.bodyTris, len(P))


# ---------------------------------------------------------------- Human Base Meshes
def load_A(path, level=2):
    a = np.load(path)
    V = a['v%d' % level].astype(np.float64)
    F = a['f%d' % level].astype(np.int64)
    return a, V, F


# ---------------------------------------------------------------- rotations
def rot_axis_angle(axis, ang):
    axis = np.asarray(axis, float)
    l = np.linalg.norm(axis)
    if l < 1e-12 or abs(ang) < 1e-12:
        return np.eye(3)
    x, y, z = axis / l
    c, s = np.cos(ang), np.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def to_axis_angle(R):
    ang = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
    if ang < 1e-9:
        return np.array([1.0, 0, 0]), 0.0
    ax = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    n = np.linalg.norm(ax)
    if n < 1e-9:  # 180 deg
        w, v = np.linalg.eigh((R + np.eye(3)) / 2)
        return v[:, -1], ang
    return ax / n, ang


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    ax = np.cross(a, b)
    return rot_axis_angle(ax, np.arctan2(np.linalg.norm(ax), a @ b))


def kabsch(X, Y, w):
    """Rotation R minimizing sum w |R X - Y|^2 (X, Y already centred)."""
    H = (X * w[:, None]).T @ Y
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    return Vt.T @ D @ U.T


# ---------------------------------------------------------------- skinning
class Pose:
    """Rotations R[b] (3x3, world axes) applied hierarchically about rest joints.

    Forward map of bone b: T_b(x) = Q_b (x - jr_b) + jp_b with Q_b = Q_parent R_b and
    jp_b = T_parent(jr_b): rotations about the joints of the rest shape.
    """

    def __init__(self, mh, rest_heads):
        self.mh = mh
        self.jr = np.array(rest_heads, float)
        nb = len(mh.bones)
        self.R = np.repeat(np.eye(3)[None], nb, 0)
        self.D = np.zeros((nb, 3))  # translation of the bone head (parent rest frame): proportions
        self.S = np.ones(nb)  # uniform scale of the bone and its subtree about its head (hands)
        self.Rg = np.eye(3)  # global rotation about the root head
        self.tg = np.zeros(3)  # global translation

    def transforms(self):
        """(A, t) skinning transforms (A = scale x rotation), Q world rotations, jp posed heads."""
        mh, nb = self.mh, len(self.mh.bones)
        Q = np.zeros((nb, 3, 3)); jp = np.zeros((nb, 3)); sc = np.ones(nb)
        for b in range(nb):
            p = mh.parent[b]
            if p < 0:
                Q[b] = self.Rg @ self.R[b]
                jp[b] = self.jr[b] + self.tg
                sc[b] = self.S[b]
            else:
                Q[b] = Q[p] @ self.R[b]
                jp[b] = sc[p] * (Q[p] @ (self.jr[b] + self.D[b] - self.jr[p])) + jp[p]
                sc[b] = sc[p] * self.S[b]
        A = Q * sc[:, None, None]
        t = jp - np.einsum('bij,bj->bi', A, self.jr)
        self.sc = sc
        return A, t, Q, jp

    def apply(self, P, idx=None):
        A, t, _, _ = self.transforms()
        si, sw = self.mh.skinIndex, self.mh.skinWeight
        if idx is not None:
            si, sw, P = si[idx], sw[idx], P[idx]
        out = np.zeros_like(P)
        for k in range(4):
            out += sw[:, k, None] * (np.einsum('nij,nj->ni', A[si[:, k]], P) + t[si[:, k]])
        return out


def lbs_inverse(mh, A, t, X, idx=None):
    """Exact inverse of linear blend skinning: r = (sum w A)^-1 (x - sum w t)."""
    si, sw = mh.skinIndex, mh.skinWeight
    if idx is not None:
        si, sw = si[idx], sw[idx]
    M = np.zeros((len(X), 3, 3)); m = np.zeros((len(X), 3))
    for k in range(4):
        M += sw[:, k, None, None] * A[si[:, k]]
        m += sw[:, k, None] * t[si[:, k]]
    return np.linalg.solve(M, (X - m)[..., None])[..., 0]


def forward_from_posed_joints(mh, Q, jp, root_rest):
    """Forward LBS transforms (A, t) and rest joints jr for world rotations Q, posed joints
    jp and the rest position of the root joint: rotations about the joints of the shape."""
    nb = len(mh.bones)
    jr = np.zeros((nb, 3))
    for b in range(nb):
        p = mh.parent[b]
        jr[b] = root_rest if p < 0 else Q[p].T @ (jp[b] - jp[p]) + jr[p]
    t = jp - np.einsum('bij,bj->bi', Q, jr)
    return Q, t, jr
