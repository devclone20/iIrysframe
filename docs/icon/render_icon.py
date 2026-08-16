# Render do rosto do rover 01 laranja para o ícone do iIrys Frame.
# Base: _animado_tools/render_tex.py (mesmo material, mesma luz), com três
# diferenças de propósito: fundo transparente (composição do ícone), 2048px,
# e enquadramento calculado a partir da bounding box real do OBJ — este modelo
# vem de DADOS/ e não há garantia de que a escala bata com os GLB numerados.
import bpy, sys
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
obj_in, tex, out_dir = a[0], a[1], a[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC.render.engine = 'CYCLES'
SC.cycles.device = 'GPU'
try:
    pr = bpy.context.preferences.addons['cycles'].preferences
    pr.compute_device_type = 'METAL'
    pr.get_devices()
    for d in pr.devices:
        d.use = True
except Exception:
    pass
SC.cycles.samples = 128
SC.view_settings.view_transform = 'Filmic'
SC.render.film_transparent = True
SC.render.resolution_x = 2048
SC.render.resolution_y = 2048

bpy.ops.wm.obj_import(filepath=obj_in)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]

mat = bpy.data.materials.new("m")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
bsdf.inputs["Roughness"].default_value = 0.62
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = 0.3
t = nt.nodes.new("ShaderNodeTexImage")
t.image = bpy.data.images.load(tex)
t.interpolation = 'Linear'
nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
ob.data.materials.clear()
ob.data.materials.append(mat)

w = bpy.data.worlds.new("w")
SC.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.04, 0.04, 0.045, 1)

def light(n, loc, e, s):
    ld = bpy.data.lights.new(n, 'AREA')
    ld.energy = e
    ld.size = s
    lo = bpy.data.objects.new(n, ld)
    SC.collection.objects.link(lo)
    lo.location = loc
    dd = (Vector((0, 0, 0)) - lo.location).normalized()
    lo.rotation_mode = 'QUATERNION'
    lo.rotation_quaternion = dd.to_track_quat('-Z', 'Y')

light("k", (2.2, -2.6, 2.2), 620, 3.0)
light("f", (-2.6, -2.0, 0.6), 230, 3.5)
light("r", (0.4, 2.8, 1.6), 480, 2.5)

# bounding box real, em coordenadas de mundo
bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
zmin = min(v.z for v in bb); zmax = max(v.z for v in bb)
xmid = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
h = zmax - zmin
print("BBOX", zmin, zmax, h)

cam_d = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_d)
SC.collection.objects.link(cam)
SC.camera = cam

# A cabeça destes rovers ocupa aproximadamente o terço superior.
head_z = zmin + h * 0.80          # centro da cabeça
face_z = zmin + h * 0.82          # ecrã do rosto, um pouco acima do centro

shots = {
    # rosto a encher o quadro (como os renders face.png existentes)
    "icon_face":  dict(lens=120, tgt=Vector((xmid, -0.10 * h, face_z)),
                       loc=Vector((xmid, -1.05 * h, face_z))),
    # cabeça inteira com a pala do boné — enquadramento de ícone
    "icon_head":  dict(lens=85,  tgt=Vector((xmid, 0, head_z)),
                       loc=Vector((xmid, -1.55 * h, head_z + 0.02 * h))),
    # três-quartos, como a pose do GIF que o dono enviou
    "icon_34":    dict(lens=85,  tgt=Vector((xmid, 0, head_z)),
                       loc=Vector((xmid - 0.95 * h, -1.25 * h, head_z + 0.06 * h))),
}
for name, s in shots.items():
    cam_d.lens = s["lens"]
    cam.location = s["loc"]
    dd = (s["tgt"] - cam.location).normalized()
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = dd.to_track_quat('-Z', 'Y')
    SC.render.filepath = f"{out_dir}/{name}.png"
    bpy.ops.render.render(write_still=True)
    print("ok", name)
