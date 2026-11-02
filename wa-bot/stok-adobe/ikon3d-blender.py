# Render ikon 3D SEJATI dengan Blender (Cycles, CPU). Mengubah siluet SVG ikon menjadi model ekstrusi berlekuk (bevel), diberi material, cahaya studio, dan bayangan lembut.
# Dua cara menjalankan:
#   blender -b -P ikon3d-blender.py -- --svg ikon.svg --keluar hasil.jpg [--ukuran 2400] [--warna "#10b981"] [--bahan clay|kilap|logam] [--sampel 64]
#   python3 ikon3d-blender.py --svg ... (bila modul Python `bpy` terpasang: pip install bpy)
import sys, math, argparse, os

def argumen():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--svg", required=True); ap.add_argument("--keluar", required=True)
    ap.add_argument("--ukuran", type=int, default=2048); ap.add_argument("--warna", default="#10b981")
    ap.add_argument("--bahan", default="clay", choices=["clay", "kilap", "logam"]); ap.add_argument("--sampel", type=int, default=32)
    ap.add_argument("--tebal", type=float, default=0.28); ap.add_argument("--miring", type=float, default=1.0)
    return ap.parse_args(argv)

def hex_ke_linear(h):
    h = h.lstrip("#"); r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)

def main():
    import bpy
    from mathutils import Vector
    a = argumen()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try: bpy.ops.preferences.addon_enable(module="io_curve_svg")
    except Exception: pass
    bpy.ops.import_curve.svg(filepath=os.path.abspath(a.svg))
    kurva = [o for o in bpy.context.scene.objects if o.type == "CURVE"]
    if not kurva: raise SystemExit("SVG tidak menghasilkan kurva")
    bpy.ops.object.select_all(action="DESELECT")
    for o in kurva: o.select_set(True)
    bpy.context.view_layer.objects.active = kurva[0]
    if len(kurva) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    # ekstrusi relatif terhadap ukuran: ukur dulu lebar kurva, lalu skala kurva (belum mesh) lewat objek
    ob.data.dimensions = "2D"; ob.data.fill_mode = "BOTH"; ob.data.resolution_u = 24
    d = ob.dimensions; s = 2.0 / max(d.x, d.y, 1e-6)
    ob.data.extrude = (a.tebal / 2) / s  # setelah diskala s, ketebalan menjadi tebal/2 satuan
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.view_layer.objects.active
    ob.scale = (s, s, s); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS"); ob.location = (0, 0, 0)
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode="OBJECT")
    bev = ob.modifiers.new("Bevel", "BEVEL"); bev.width = 0.045; bev.segments = 8; bev.limit_method = "ANGLE"; bev.angle_limit = math.radians(35); bev.profile = 0.7
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    except Exception: bpy.ops.object.shade_smooth()
    # material
    mat = bpy.data.materials.new("Ikon"); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    warna = hex_ke_linear(a.warna)
    bsdf.inputs["Base Color"].default_value = warna
    bsdf.inputs["Roughness"].default_value = {"clay": 0.55, "kilap": 0.18, "logam": 0.25}[a.bahan]
    bsdf.inputs["Metallic"].default_value = 1.0 if a.bahan == "logam" else 0.0
    ob.data.materials.clear(); ob.data.materials.append(mat)  # buang material bawaan impor SVG
    # sedikit miring supaya ketebalan terlihat
    k = a.miring; ob.rotation_euler = (math.radians(-14 * k), math.radians(20 * k), math.radians(-6 * k))
    # lantai penangkap bayangan
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.62)); lantai = bpy.context.active_object
    lm = bpy.data.materials.new("Lantai"); lm.use_nodes = True; lb = lm.node_tree.nodes.get("Principled BSDF")
    lb.inputs["Base Color"].default_value = (0.9, 0.91, 0.94, 1); lb.inputs["Roughness"].default_value = 0.9; lantai.data.materials.append(lm)
    # dunia: terang lembut
    w = bpy.data.worlds.new("Dunia"); bpy.context.scene.world = w; w.use_nodes = True
    bg = w.node_tree.nodes.get("Background"); bg.inputs["Color"].default_value = (0.9, 0.91, 0.94, 1); bg.inputs["Strength"].default_value = 0.35
    def lampu(nama, loc, daya, ukuran, warna_l=(1, 1, 1)):
        bpy.ops.object.light_add(type="AREA", location=loc); L = bpy.context.active_object; L.name = nama
        L.data.energy = daya; L.data.size = ukuran; L.data.color = warna_l
        arah = Vector((0, 0, 0)) - Vector(loc); L.rotation_euler = arah.to_track_quat("-Z", "Y").to_euler()
    lampu("Utama", (-3.2, 3.4, 5.0), 420, 2.2); lampu("Isi", (4.0, -1.0, 3.0), 70, 4.0, (0.95, 0.97, 1.0)); lampu("Tepi", (0.5, 4.5, 1.5), 110, 2.5)
    # kamera dari atas, perspektif ringan
    bpy.ops.object.camera_add(location=(0, -0.0, 7.2), rotation=(0, 0, 0)); cam = bpy.context.active_object; cam.data.lens = 70; cam.data.clip_end = 100
    bpy.context.scene.camera = cam
    sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = a.sampel
    sc.cycles.use_denoising = True
    # percepat: pantulan dibatasi dan sampling adaptif (adegan sederhana, tidak perlu banyak pantulan)
    sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 3; sc.cycles.transmission_bounces = 0; sc.cycles.volume_bounces = 0; sc.cycles.transparent_max_bounces = 2
    sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.02
    sc.render.threads_mode = "AUTO"
    try: sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception: pass
    sc.render.resolution_x = a.ukuran; sc.render.resolution_y = a.ukuran; sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 95
    sc.render.filepath = os.path.abspath(a.keluar)
    os.makedirs(os.path.dirname(os.path.abspath(a.keluar)), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("SELESAI", sc.render.filepath)

if __name__ == "__main__":
    main()
