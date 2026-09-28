"""Blender VSE 합성기. stock_chatbot/shorts의 vse_render.py를 가로 화면으로 옮겼다.

채널 1·2 배경(영상 또는 사진, 장면 강조색으로 색조, 번갈아 놓고 겹쳐 서서히 넘김. 사진은 천천히
밀고 흐름), 채널 3 투명 카드 PNG, 채널 4 자막 text 스트립(외곽선·그림자), 채널 5 내레이션. Blender가 H.264/AAC로 바로 인코딩한다.
실행: blender -b --factory-startup --python-exit-code 1 --python blender/vse.py -- manifest.json
"""
import json
import math
from pathlib import Path
import sys

import bpy


def tone(strip, row):
    # Color multiply and brightness offset per channel, in sRGB like the card colors.
    modifier = strip.modifiers.new("tone", "CURVES")
    mapping = modifier.curve_mapping
    for curve, multiply in zip(mapping.curves[:3], row["multiply"]):
        curve.points[0].location = (0, row["brightness"])
        curve.points[-1].location = (1, multiply + row["brightness"])
    mapping.update()


# Motion history (2026-09-28/29): 1.02 -> 1.10 and 36 px drew the eye; a fifth of that was invisible;
# 0.3 was still too slow. Now 0.6 of the original.
DRIFT_SCALE = (1.02, 1.068)
DRIFT_PX = 10.8


def drift(strip, start, end, index):
    """A still picture slowly pushes in and slides sideways over its scene (the card stays put)."""
    t = strip.transform
    direction = 1 if index % 2 == 0 else -1
    t.scale_x = t.scale_y = DRIFT_SCALE[0]
    t.offset_x = -DRIFT_PX * direction
    t.keyframe_insert("scale_x", frame=start)
    t.keyframe_insert("scale_y", frame=start)
    t.keyframe_insert("offset_x", frame=start)
    t.scale_x = t.scale_y = DRIFT_SCALE[1]
    t.offset_x = DRIFT_PX * direction
    t.keyframe_insert("scale_x", frame=end)
    t.keyframe_insert("scale_y", frame=end)
    t.keyframe_insert("offset_x", frame=end)


def render(manifest):
    scene = bpy.context.scene
    width, height, fps = manifest["width"], manifest["height"], manifest["fps"]
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.frame_start, scene.frame_end = 1, max(1, round(manifest["duration"] * fps))
    if manifest.get("max_frames"):
        scene.frame_end = min(scene.frame_end, manifest["max_frames"])
    if manifest.get("range"):
        # Render one scene only; strips keep their full-timeline positions so sound stays in sync.
        first, last = manifest["range"]
        scene.frame_start, scene.frame_end = 1 + round(first * fps), round(last * fps)
    scene.render.use_sequencer = True
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.ffmpeg.audio_codec = "AAC"
    scene.render.ffmpeg.audio_bitrate = 192
    scene.render.ffmpeg.audio_mixrate = 48000
    scene.render.ffmpeg.audio_channels = "STEREO"
    scene.render.filepath = manifest["output"]
    # Keep PNG sRGB values as they are; AgX would shift the card colors.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.sequencer_colorspace_settings.name = "sRGB"
    editor = scene.sequence_editor_create()
    strips = editor.strips

    def frame(seconds):
        return 1 + round(seconds * fps)

    fade = round(manifest.get("crossfade", 0) * fps)
    for index, row in enumerate(manifest["backgrounds"]):
        # Each background after the first starts `fade` frames early on the other channel and fades
        # in over the previous one, so scenes dissolve instead of cutting.
        lead = fade if index else 0
        start, end = frame(row["start"]) - lead, frame(row["start"] + row["duration"])
        channel = 1 + index % 2
        if end <= start:
            continue
        if row.get("path") is None:
            pieces = [strips.new_effect(f"bg-{index}", type="COLOR", channel=channel, frame_start=start, length=end - start)]
            pieces[0].color = row.get("color", (0.04, 0.07, 0.1))
        elif row["kind"] == "image":
            strip = strips.new_image(f"bg-{index}", row["path"], channel=channel, frame_start=start, fit_method="FILL")
            strip.frame_final_end = end
            tone(strip, row)
            drift(strip, start, end, index)
            pieces = [strip]
        else:
            pieces, cursor = [], start
            while cursor < end:  # loop a clip that is shorter than its scene
                movie = strips.new_movie(f"bg-{index}-{cursor}", row["path"], channel=channel, frame_start=cursor, fit_method="FILL")
                length = movie.frame_final_duration
                if abs(movie.fps - fps) > 0.01:
                    # Keep playback speed when the clip is 24 fps and the video is 30.
                    last = movie.retiming_keys.add(timeline_frame=cursor + length)
                    length = max(1, round(length * fps / movie.fps))
                    last.timeline_frame = cursor + length
                movie.frame_final_end = min(cursor + length, end)
                tone(movie, row)
                pieces.append(movie)
                cursor += length
        if lead:
            first = pieces[0]
            first.blend_type = "ALPHA_OVER"
            first.blend_alpha = 0.0
            first.keyframe_insert("blend_alpha", frame=start)
            first.blend_alpha = 1.0
            first.keyframe_insert("blend_alpha", frame=start + lead)

    for index, row in enumerate(manifest["cards"]):
        start, end = frame(row["start"]), frame(row["start"] + row["duration"])
        if end <= start:
            continue
        strip = strips.new_image(f"card-{index}", row["path"], channel=3, frame_start=start)
        strip.frame_final_end = end
        strip.blend_type = "ALPHA_OVER"

    caption = manifest["caption"]
    font = bpy.data.fonts.load(caption["font"])
    for index, row in enumerate(manifest["subtitles"]):
        start, end = frame(row["start"]), frame(row["end"])
        if end <= start:
            continue
        text = strips.new_effect(f"caption-{index}", type="TEXT", channel=4, frame_start=start, length=end - start)
        text.text, text.font, text.font_size = row["text"], font, caption["em_size"]
        text.anchor_x, text.anchor_y = "CENTER", "BOTTOM"
        if hasattr(text, "alignment_x"):
            text.alignment_x = "CENTER"
        text.color = (*[c / 255 for c in caption["color"]], 1)
        text.location = (0.5, caption["bottom"] / height)
        text.wrap_width = 0
        text.use_outline = True
        text.outline_color = (17 / 255, 13 / 255, 8 / 255, 1)
        text.outline_width = 5 / caption["em_size"]
        text.use_shadow = True
        text.shadow_color = (0, 0, 0, 0.41)
        text.shadow_offset = 2 / caption["em_size"]
        text.shadow_angle = math.radians(135)

    strips.new_sound("narration", manifest["audio"], channel=5, frame_start=1)
    bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    render(json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text(encoding="utf-8")))
