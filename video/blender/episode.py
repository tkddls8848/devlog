# 회차 사양(JSON)을 받아 밝은 모션그래픽 영상을 렌더링한다. 소리는 넣지 않는다(ffmpeg가 합친다).
# 실행: blender -b --factory-startup --python blender/episode.py -- spec.json <프레임 폴더> [최대 프레임] [--resume]
# 좌표계: 화면 가로 16, 세로 9 단위. 원점이 화면 중앙이다.
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
spec = json.load(open(argv[0], encoding="utf-8"))
output = argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = spec["width"]
scene.render.resolution_y = spec["height"]
scene.render.resolution_percentage = 100
scene.render.fps = spec["fps"]
scene.frame_start = 0
scene.frame_end = spec["frames"] - 1
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
# Flat emission shapes need little anti-aliasing; 8 samples keep text edges clean at a
# fraction of the default render time.
scene.eevee.taa_render_samples = spec.get("samples", 8)

BG = spec["theme"]["background"]
INK = spec["theme"]["ink"]
MUTED = spec["theme"]["muted"]
PAPER = spec["theme"]["paper"]

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (*BG, 1)
scene.world = world

camera_data = bpy.data.cameras.new("Camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = 16
camera = bpy.data.objects.new("Camera", camera_data)
camera.location = (0, 0, 10)
scene.collection.objects.link(camera)
scene.camera = camera

font = bpy.data.fonts.load(spec["font"])
font_bold = bpy.data.fonts.load(spec["fontBold"])

_materials = {}


def material(color):
    key = tuple(round(c, 4) for c in color)
    if key in _materials:
        return _materials[key]
    mat = bpy.data.materials.new(f"m{len(_materials)}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs[0].default_value = (*color, 1)
    out = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs[0], out.inputs[0])
    _materials[key] = mat
    return mat


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def add(obj, color, z):
    obj.location.z = z
    obj.data.materials.append(material(color))
    scene.collection.objects.link(obj)
    return obj


def text(body, size, x, y, color, bold=False, align="LEFT", width=None, z=0.2):
    curve = bpy.data.curves.new("text", "FONT")
    curve.body = body
    curve.font = font_bold if bold else font
    curve.size = size
    curve.align_x = align
    curve.align_y = "CENTER"
    # Hangul needs more room between lines than the default.
    curve.space_line = 1.3
    if width:
        curve.text_boxes[0].width = width
        curve.text_boxes[0].x = {"LEFT": 0, "CENTER": -width / 2, "RIGHT": -width}[align]
        curve.align_x = align
    obj = bpy.data.objects.new("text", curve)
    obj.location = (x, y, z)
    return add(obj, color, z)


def rect(w, h, x, y, color, z=0.1):
    mesh = bpy.data.meshes.new("rect")
    mesh.from_pydata([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new("rect", mesh)
    obj.location = (x, y, z)
    return add(obj, color, z)


def circle(r, x, y, color, z=0.05, segments=64):
    import math
    verts = [(0, 0, 0)] + [(r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments), 0) for i in range(segments)]
    faces = [(0, i + 1, (i + 1) % segments + 1) for i in range(segments)]
    mesh = bpy.data.meshes.new("circle")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new("circle", mesh)
    obj.location = (x, y, z)
    return add(obj, color, z)


def measure(obj):
    """Width of a text object in scene units."""
    bpy.context.view_layer.update()
    return obj.dimensions.x


def fit(obj, max_width):
    """Shrink a one-line text until it fits; wrapping would push it into the line above."""
    width = measure(obj)
    if width > max_width:
        obj.data.size *= max_width / width
    return obj


def visible(obj, start, end):
    """Show the object only in [start, end)."""
    obj.hide_render = True
    obj.keyframe_insert("hide_render", frame=0)
    obj.hide_render = False
    obj.keyframe_insert("hide_render", frame=start)
    obj.hide_render = True
    obj.keyframe_insert("hide_render", frame=end)


def slide_in(obj, start, dy=-0.35, frames=10):
    y = obj.location.y
    obj.location.y = y + dy
    obj.keyframe_insert("location", index=1, frame=start)
    obj.location.y = y
    obj.keyframe_insert("location", index=1, frame=start + frames)


def drift(obj, start, end, dx=0.0, dy=0.0, spin=0.0):
    x, y, r = obj.location.x, obj.location.y, obj.rotation_euler.z
    obj.keyframe_insert("location", frame=start)
    obj.keyframe_insert("rotation_euler", index=2, frame=start)
    obj.location.x, obj.location.y = x + dx, y + dy
    obj.rotation_euler.z = r + spin
    obj.keyframe_insert("location", frame=end)
    obj.keyframe_insert("rotation_euler", index=2, frame=end)


def title_scene(s):
    start, end = s["start"], s["start"] + s["frames"]
    accent = tuple(s["accent"])
    soft = mix(accent, PAPER, 0.78)
    big = circle(3.4, 5.2, 0.8, soft, z=0.02)
    small = circle(1.25, 6.6, -2.3, accent, z=0.03)
    ring = circle(0.55, 2.4, 2.9, mix(accent, PAPER, 0.5), z=0.03)
    for obj in (big, small, ring):
        visible(obj, start, end)
    drift(big, start, end, dx=-0.3, dy=0.2)
    drift(small, start, end, dx=0.25, dy=0.35)
    drift(ring, start, end, dx=-0.4, dy=-0.2)
    bar = rect(0.14, 1.4, -7.1, 0.55, accent)
    kicker = text(s["kicker"], 0.34, -6.75, 2.0, accent, bold=True)
    title = fit(text(s["title"], 1.0, -6.75, 0.85, INK, bold=True), 11.5)
    subtitle = text(s["subtitle"], 0.46, -6.75, -0.25, MUTED, width=10.5)
    for i, obj in enumerate((bar, kicker, title, subtitle)):
        visible(obj, start, end)
        slide_in(obj, start + i * 3)


def content_scene(s):
    start, end = s["start"], s["start"] + s["frames"]
    accent = tuple(s["accent"])
    soft = mix(accent, PAPER, 0.82)
    deco = circle(2.6, 6.4, 3.4, soft, z=0.02)
    visible(deco, start, end)
    drift(deco, start, end, dx=-0.35, dy=-0.15)
    bar = rect(0.12, 0.62, -7.35, 3.05, accent)
    repo = text(s["kicker"], 0.3, -7.1, 3.65, accent, bold=True)
    heading = fit(text(s["title"], 0.62, -7.1, 3.0, INK, bold=True), 10.3)
    for i, obj in enumerate((bar, repo, heading)):
        visible(obj, start, end)
        slide_in(obj, start + i * 3)
    # The session's commit subjects pop in as chips while the narrator talks about them.
    for i, chip in enumerate(s["chips"]):
        at = start + chip["at"]
        y = 1.55 - i * 1.0
        label = text(chip["text"], 0.36, -6.78, y, mix(accent, INK, 0.45), bold=True)
        # Size the box from the rendered text, not a character-count guess.
        width = measure(label) + 0.75
        box = rect(width, 0.72, -7.25 + width / 2, y, soft, z=0.1)
        dot = circle(0.1, -7.0, y, accent, z=0.15)
        for obj in (box, dot, label):
            visible(obj, at, end)
            slide_in(obj, at, dy=-0.25, frames=8)
    # Soft shapes on the right keep the frame moving; no text there.
    big = circle(1.9, 5.6, 0.2, mix(accent, PAPER, 0.88), z=0.02)
    dot = circle(0.45, 4.2, -1.2, mix(accent, PAPER, 0.55), z=0.03)
    for obj in (big, dot):
        visible(obj, start, end)
    drift(big, start, end, dx=-0.25, dy=0.2)
    drift(dot, start, end, dx=0.3, dy=0.25)


def subtitles(s):
    for cue in s["cues"]:
        start = s["start"] + cue["start"]
        end = s["start"] + cue["end"]
        # Cues arrive wrapped at spaces (Blender would break Korean mid-word); grow the band per line.
        rows = cue["text"].count("\n") + 1
        height = 0.7 + 0.55 * rows
        top = -4.5 + height
        band = rect(16.0, height, 0, -4.5 + height / 2, PAPER, z=0.3)
        edge = rect(16.0, 0.06, 0, top, mix(tuple(s["accent"]), PAPER, 0.4), z=0.31)
        line = text(cue["text"], 0.4, 0, -4.5 + height / 2, INK, align="CENTER", z=0.35)
        for obj in (band, edge, line):
            visible(obj, start, end)


def fade(obj, paper, color, keys):
    """Give the object its own material and key its color between paper (hidden) and color.
    On a flat paper background this reads as a fade without any transparency."""
    mat = material(color).copy()
    obj.data.materials[0] = mat
    socket = mat.node_tree.nodes["Emission"].inputs[0]
    for frame, t in keys:
        socket.default_value = (*mix(paper, color, t), 1)
        socket.keyframe_insert("default_value", frame=frame)


def minimal_scene(s, index, total):
    start, end = s["start"], s["start"] + s["frames"]
    closing = index == total - 1
    paper = (0.94, 0.93, 0.90)
    ink = (0.012, 0.015, 0.02)
    muted = (0.18, 0.20, 0.23)
    accent = (0.015, 0.09, 0.65)
    if closing:
        paper, ink, muted, accent = ink, paper, (0.50, 0.52, 0.55), (0.34, 0.52, 1.0)
    visible(rect(16, 9, 0, 0, paper, z=-0.1), start, end)
    # Fixed editorial grid: it stays put across scenes, so only the words appear to change.
    label = text(s.get("label") or f"{index + 1:02d} / DEVLOG", 0.23, -6.65, 3.35, muted)
    page = text(f"{index + 1:02d} / {total:02d}", 0.23, 6.65, 3.35, muted, align="RIGHT")
    rule = rect(13.3, 0.012, 0, 2.85, mix(muted, paper, 0.45))
    for obj in (label, page, rule):
        visible(obj, start, end)
    # A thin accent line on the rule fills across the whole video: where we are, nothing more.
    width = 13.3
    mesh = bpy.data.meshes.new("progress")
    mesh.from_pydata([(0, -0.02, 0), (width, -0.02, 0), (width, 0.02, 0), (0, 0.02, 0)], [], [(0, 1, 2, 3)])
    bar = bpy.data.objects.new("progress", mesh)
    bar.location = (-6.65, 2.85, 0)
    add(bar, accent, 0.12)
    visible(bar, start, end)
    # Linear keys (set through preferences, which works across Blender's action API changes).
    edit = bpy.context.preferences.edit
    previous = edit.keyframe_new_interpolation_type
    edit.keyframe_new_interpolation_type = "LINEAR"
    bar.scale.x = max(0.001, start / spec["frames"])
    bar.keyframe_insert("scale", index=0, frame=start)
    bar.scale.x = max(0.001, end / spec["frames"])
    bar.keyframe_insert("scale", index=0, frame=end)
    edit.keyframe_new_interpolation_type = previous

    out = max(start + 20, end - 7)  # words leave a few frames before the cut
    lines = s["title"].split("\n")
    for i, line in enumerate(lines):
        color = accent if i == len(lines) - 1 and len(lines) > 1 else ink
        heading = fit(text(line, 1.13, -6.65, 1.15 - i * 1.48, color, bold=True), 13.0)
        at = start + 2 + i * 6  # lines arrive one after another
        visible(heading, start, end)
        slide_in(heading, at, dy=-0.14, frames=12)
        fade(heading, paper, color, [(at, 0), (at + 12, 1), (out, 1), (end - 1, 0)])
    note = s.get("note") or ""
    if note:
        obj = fit(text(note, 0.29, -6.65, -1.85, muted), 12.8)
        at = start + 10 + len(lines) * 6
        visible(obj, start, end)
        fade(obj, paper, muted, [(at, 0), (at + 10, 1), (out, 1), (end - 1, 0)])
    # Captions sit on the same canvas, with no band, box or decorative shapes.
    for cue in s["cues"]:
        a, b = start + cue["start"], start + cue["end"]
        line = fit(text(cue["text"], 0.34, 0, -3.35, ink, align="CENTER"), 13.2)
        visible(line, a, b)
        fade(line, paper, ink, [(a, 0), (a + 4, 1), (max(a + 5, b - 4), 1), (b, 0)])


for index, s in enumerate(spec["scenes"]):
    if spec.get("layout") == "minimal":
        minimal_scene(s, index, len(spec["scenes"]))
    else:
        (title_scene if s["kind"] == "title" else content_scene)(s)
        subtitles(s)
        camera_data.ortho_scale = 16
        camera_data.keyframe_insert("ortho_scale", frame=s["start"])
        camera_data.ortho_scale = 15.55
        camera_data.keyframe_insert("ortho_scale", frame=s["start"] + s["frames"] - 1)

# Frames go out as PNG; ffmpeg encodes them together with the voice track. Blender 5 moved
# video output behind media_type, and a frame folder also survives an interrupted render.
render = scene.render
render.filepath = output.rstrip("/\\") + "/f"
render.image_settings.file_format = "PNG"
render.image_settings.color_mode = "RGB"
render.image_settings.compression = 15
render.use_overwrite = "--resume" not in argv
if len(argv) > 2 and argv[2].isdigit():
    scene.frame_end = min(scene.frame_end, int(argv[2]) - 1)
bpy.ops.render.render(animation=True)
print("RENDERED", output, scene.frame_end + 1)
