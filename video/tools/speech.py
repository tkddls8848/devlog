"""회차 원고 전체를 edge-tts로 한 번에 합성하고, 단어별 발화 시각을 받아 쉼을 자리마다 조정한다.

stock_chatbot/shorts의 tts.py와 같은 방식이다.
- 장면별로 따로 합성해 이어 붙이면 경계마다 음색과 호흡이 다시 시작된다. 한 번에 합성한다.
- CLI는 문장 단위 시각만 주고 그 끝에 쉼(약 0.86초)이 붙어 자막이 늦게 뜬다. 라이브러리로
  WordBoundary를 받아 단어 시각으로 자막과 장면 전환을 맞춘다.
- edge-tts는 문장 사이와 장면 사이를 똑같이 쉰다. 합성 뒤 PCM에서 쉼 한가운데만 늘리거나 줄인다.

사용: python tools/speech.py request.json
request: {"narrations": [...], "audio": "narration.mp3", "words": "words.json",
          "voice": "ko-KR-InJoonNeural", "rate": "+30%", "ffmpeg": "ffmpeg"}
출력 words.json: 장면마다 [{"start": 초, "end": 초, "text": 단어}, ...]
"""
from __future__ import annotations

from array import array
import asyncio
import json
from pathlib import Path
import subprocess
import sys

import edge_tts

# 쉼(초). 도입→첫 장면은 흐름을 끊지 않을 만큼, 장면 사이는 주제가 바뀌므로 조금 더,
# 마무리 앞에서 가장 길게. 장면 안 문장 끝은 edge-tts 기본(0.86초)보다 짧게 줄인다.
OPENING_PAUSE = 0.6
TOPIC_PAUSE = 0.75
CLOSING_PAUSE = 0.9
SENTENCE_PAUSE = 0.45
SENTENCE_END = (".", "!", "?")
GUARD = 0.12  # 쉼을 줄일 때 말소리 양 끝에 남기는 여유
FADE = 0.02
RATE = 24000


def read_words(path: Path) -> list[dict]:
    words = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            event = json.loads(line)
            offset, duration = event["offset"], event["duration"]  # 100ns units
            words.append({"start": offset / 1e7, "end": (offset + duration) / 1e7, "text": event["text"]})
    return words


def locate(text: str, words: list[dict]) -> list[int]:
    positions, cursor = [], 0
    for word in words:
        at = text.find(word["text"], cursor)
        if at < 0:
            raise SystemExit(f"합성된 단어를 원고에서 찾지 못했습니다: {word['text']}")
        positions.append(at)
        cursor = at + len(word["text"])
    return positions


def split_by_scene(narrations: list[str], words: list[dict]) -> list[list[dict]]:
    script = "\n".join(narrations)
    positions = locate(script, words)
    scenes, start = [], 0
    for narration in narrations:
        end = start + len(narration)
        members = [w for w, at in zip(words, positions) if start <= at < end]
        if not members:
            raise SystemExit(f"장면 원고를 읽은 음성이 없습니다: {narration[:30]}")
        scenes.append(members)
        start = end + 1
    return scenes


def scene_pauses(count: int) -> list[float]:
    if count < 2:
        return []
    gaps = [TOPIC_PAUSE] * (count - 1)
    gaps[0] = OPENING_PAUSE
    gaps[-1] = CLOSING_PAUSE
    return gaps


def sentence_breaths(narration: str, words: list[dict]) -> dict[int, float]:
    starts = locate(narration, words)
    breaths = {}
    for i, (word, start) in enumerate(zip(words[:-1], starts)):
        between = narration[start + len(word["text"]):starts[i + 1]]
        if any(mark in between for mark in SENTENCE_END):
            breaths[i] = SENTENCE_PAUSE
    return breaths


def decode(path: Path, ffmpeg: str) -> array:
    out = subprocess.run([ffmpeg, "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(RATE), "-"],
                         capture_output=True, check=True).stdout
    samples = array("h")
    samples.frombytes(out[: len(out) // 2 * 2])
    return samples


def encode(samples: array, path: Path, ffmpeg: str) -> None:
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", "128k", str(path)], input=samples.tobytes(), check=True)


def fade(samples: array, start: int, length: int, rising: bool) -> None:
    end = min(len(samples), start + length)
    span = max(1, end - start)
    for offset, index in enumerate(range(max(0, start), end)):
        gain = (offset + 1) / span if rising else 1 - (offset + 1) / span
        samples[index] = int(samples[index] * gain)


def pace(path: Path, scenes: list[list[dict]], narrations: list[str], ffmpeg: str) -> list[list[dict]]:
    flat = [w for scene in scenes for w in scene]
    targets, boundaries, offset = {}, [], 0
    for narration, scene in zip(narrations, scenes):
        targets.update({offset + i: gap for i, gap in sentence_breaths(narration, scene).items()})
        offset += len(scene)
        boundaries.append(offset - 1)
    targets.update(zip(boundaries, scene_pauses(len(scenes))))
    targets.pop(len(flat) - 1, None)
    if not targets:
        return scenes
    source = decode(path, ffmpeg)
    ramp = round(FADE * RATE)
    paced, cursor, shift, marks = array("h"), 0, 0.0, {}
    for index in sorted(targets):
        before, after = flat[index], flat[index + 1]
        gap = after["start"] - before["end"]
        delta = targets[index] - gap
        middle = max(cursor, round((before["end"] + after["start"]) / 2 * RATE))
        if delta > 0:
            paced.extend(source[cursor:middle])
            fade(paced, len(paced) - ramp, ramp, rising=False)
            paced.extend(array("h", bytes(2 * round(delta * RATE))))
            cursor = middle
            head = len(paced)
            paced.extend(source[cursor:cursor + ramp])
            fade(paced, head, ramp, rising=True)
            cursor += ramp
            changed = delta
        else:
            cut = round(min(-delta, max(0.0, gap - 2 * GUARD)) * RATE)
            if cut <= 0:
                marks[index + 1] = shift
                continue
            left = max(cursor, middle - cut // 2)
            paced.extend(source[cursor:left])
            fade(paced, len(paced) - ramp, ramp, rising=False)
            cursor = left + cut
            head = len(paced)
            paced.extend(source[cursor:cursor + ramp])
            fade(paced, head, ramp, rising=True)
            cursor += ramp
            changed = -cut / RATE
        shift += changed
        marks[index + 1] = shift
    paced.extend(source[cursor:])
    encode(paced, path, ffmpeg)
    current, moved = 0.0, []
    for position, word in enumerate(flat):
        current = marks.get(position, current)
        moved.append({**word, "start": word["start"] + current, "end": word["end"] + current})
    it = iter(moved)
    return [[next(it) for _ in scene] for scene in scenes]


def main() -> None:
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    narrations = request["narrations"]
    audio, words_path = Path(request["audio"]), Path(request["words"])
    raw = words_path.with_suffix(".raw.jsonl")
    asyncio.run(edge_tts.Communicate("\n".join(narrations), request["voice"], rate=request["rate"],
                                     boundary="WordBoundary").save(str(audio), str(raw)))
    scenes = split_by_scene(narrations, read_words(raw))
    scenes = pace(audio, scenes, narrations, request.get("ffmpeg", "ffmpeg"))
    words_path.write_text(json.dumps(scenes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"SPEECH {audio} {sum(len(s) for s in scenes)} words")


if __name__ == "__main__":
    main()
