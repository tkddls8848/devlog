import assert from "node:assert/strict";
import test from "node:test";
import { geminiAudio, pickProvider } from "../tools/voice.mjs";

test("Gemini 선택과 명시적 공급자 우선순위, 오타 시 중단", () => {
  const env = { GEMINI_API_KEY: "test", ELEVENLABS_API_KEY: "test", ELEVENLABS_VOICE_ID: "test" };
  assert.equal(pickProvider(env), "gemini");
  assert.equal(pickProvider({ ...env, TTS_PROVIDER: "edge" }), "edge");
  assert.equal(pickProvider({ ...env, TTS_PROVIDER: "edge" }, "gemini"), "gemini");
  assert.throws(() => pickProvider(env, "gmini"), /지원하지/);
});

test("Gemini는 말투를 대본과 분리하고 설계 음성 ID를 보내며 WAV를 반환한다", async () => {
  const wav = Buffer.alloc(48);
  wav.write("RIFF"); wav.write("WAVE", 8);
  const result = await geminiAudio("오늘 배포했습니다.", { GEMINI_API_KEY: "secret", GEMINI_TTS_VOICE: "voice_custom", GEMINI_TTS_STYLE: "친근하게" }, async (url, options) => {
    assert.match(url, /gemini-3\.8-flash-tts:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "secret");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.contents[0].parts, [{ text: "오늘 배포했습니다.", speech_metadata: { style: "친근하게" } }]);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.voice, "voice_custom");
    return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { data: wav.toString("base64") } }] } }] }) };
  });
  assert.deepEqual(result, wav);
});

test("키 누락, HTTP 오류, 차단 또는 잘못된 오디오는 생성 성공으로 처리하지 않는다", async () => {
  await assert.rejects(geminiAudio("text", {}, () => { throw Error("호출되면 안 됨"); }), /GEMINI_API_KEY/);
  await assert.rejects(geminiAudio("text", { GEMINI_API_KEY: "test" }, async () => ({ ok: false, status: 429 })), /HTTP 429/);
  for (const payload of [{}, { candidates: [{ finishReason: "SAFETY" }] }, { candidates: [{ content: { parts: [{ inlineData: { data: "YmFk" } }] } }] }]) {
    await assert.rejects(geminiAudio("text", { GEMINI_API_KEY: "test" }, async () => ({ ok: true, json: async () => payload })), /Gemini TTS/);
  }
});
