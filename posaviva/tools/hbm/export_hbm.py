# Exports the realistic female / male bodies of the Blender Studio "Human Base
# Meshes" bundle v1.4.1 (CC0 1.0, Blender Studio / Dan Ulrich) to numpy archives
# used by tools/hbm/fit.py and tools/hbm/bake.py.
#
#   <venv with bpy>/python -I tools/hbm/export_hbm.py -- <bundle.blend> <outDir>
#
# For each sex: the Multires cage (level 0) and the evaluated levels 1..3, as
# vertex positions (meters, three.js frame: Y up, facing +Z, character's left
# = +X), faces (quads, or triangles for the cage, which has a few n-gons), per-corner UVs, and the eyeball centres / radii.
# Blender's subdivision keeps the coarse vertices first, so vertex i < N0 of
# every level is cage vertex i on the subdivided surface.
import bpy, sys, os
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
BLEND, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=BLEND)


def to_three(co):
    # Blender (x, y, z) Z up, facing -Y  ->  three.js (x, z, -y) Y up, facing +Z
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)


def grab(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    oe = obj.evaluated_get(dg)
    me = oe.to_mesh()
    M = np.array(obj.matrix_world)
    nv = len(me.vertices)
    co = np.zeros(nv * 3, np.float64); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    co = co @ M[:3, :3].T + M[:3, 3]
    ls = np.zeros(len(me.polygons), np.int64); me.polygons.foreach_get('loop_total', ls)
    lv = np.zeros(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv)
    uv = np.zeros(len(me.loops) * 2, np.float64)
    if me.uv_layers:
        me.uv_layers[0].data.foreach_get('uv', uv)
    oe.to_mesh_clear()
    # polygons as fans of triangles (corner indices), quads stay quads when every face is one
    if (ls == 4).all():
        return to_three(co).astype(np.float32), lv.reshape(-1, 4).astype(np.int32), uv.reshape(-1, 4, 2).astype(np.float32)
    st = np.concatenate([[0], np.cumsum(ls)[:-1]])
    tri = np.array([[s, s + k, s + k + 1] for s, n in zip(st, ls) for k in range(1, n - 1)], np.int64)
    return to_three(co).astype(np.float32), lv[tri].astype(np.int32), uv.reshape(-1, 2)[tri].astype(np.float32)


for sex in ('female', 'male'):
    body = bpy.data.objects['GEO-body_%s_realistic' % sex]
    mr = [m for m in body.modifiers if m.type == 'MULTIRES'][0]
    data = {}
    for lvl in range(0, mr.total_levels + 1):
        mr.levels = lvl
        co, f, uv = grab(body)
        data['v%d' % lvl] = co; data['f%d' % lvl] = f; data['uv%d' % lvl] = uv
        print(sex, 'level', lvl, 'verts', len(co), 'quads', len(f))
    # eyes: centre and radius of each eyeball (separate objects parented to the body)
    for side in ('L', 'R'):
        e = bpy.data.objects['GEO-body_%s_realistic.eye.%s' % (sex, side)]
        co, _, _ = grab(e)
        c = (co.max(0) + co.min(0)) / 2
        data['eye' + side] = np.array([*c, float(np.linalg.norm(co - c, axis=1).max())], np.float32)
    n0 = len(data['v0'])
    for lvl in range(1, mr.total_levels + 1):
        d = np.linalg.norm(data['v%d' % lvl][:n0] - data['v0'], axis=1)
        print(sex, 'cage -> level', lvl, 'vertex offset mean %.4f max %.4f m' % (d.mean(), d.max()))
    np.savez(os.path.join(OUT, 'A_%s.npz' % sex), **data)
    print('wrote', os.path.join(OUT, 'A_%s.npz' % sex))
