import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { generate, model, parseDraft, yaml } from "../tools/lib.mjs";

const fallback = {
  title: "기본 제목",
  summary: "기본 요약",
  body: "기본 본문",
};

test("정상 AI 초안을 파싱한다", () => {
  assert.deepEqual(parseDraft("TITLE: 제목\nSUMMARY: 요약\n\n본문", fallback), {
    title: "제목",
    summary: "요약",
    body: "본문",
  });
});

test("사고 블록, 코드 펜스와 본문 앞 구분선을 제거한다", () => {
  const source = [
    "<think>내부 추론</think>",
    "```markdown",
    "TITLE: 제목",
    "SUMMARY: 요약",
    "",
    "---",
    "본문",
    "```",
  ].join("\n");
  assert.equal(parseDraft(source, fallback).body, "본문");
});

test("형식이 잘못된 AI 응답 대신 안전한 기본 초안을 쓴다", () => {
  assert.deepEqual(parseDraft("형식이 없는 응답", fallback), fallback);
});

test("기본 초안도 없으면 잘못된 응답을 거부한다", () => {
  assert.throws(() => parseDraft(""), /제목, 요약 또는 본문/);
});

test("YAML 문자열의 따옴표, 역슬래시와 줄바꿈을 이스케이프한다", () => {
  assert.equal(yaml('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
});

// ------------------------------------------------------ Cloudflare 호출

// generate()는 Workers AI를 한 번 부르고 응답 모양을 여러 갈래로 읽는다.
// 네트워크를 스텁해 각 갈래와 실패 처리를 그대로 태운다.
const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of ["CF_ACCOUNT_ID", "CF_API_TOKEN"]) {
    if (realEnv[name] === undefined) delete process.env[name];
    else process.env[name] = realEnv[name];
  }
});

const withCredentials = () => {
  process.env.CF_ACCOUNT_ID = "account-1";
  process.env.CF_API_TOKEN = "token-1";
};

const stub = (handler) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
};

const reply = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("초안 본문을 돌려주고 계정과 모델을 주소에 담는다", async () => {
  withCredentials();
  const calls = stub(() => reply({ success: true, result: { response: "  초안 본문  " } }));

  assert.equal(await generate("커밋 목록"), "초안 본문");
  assert.equal(
    calls[0].url,
    `https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/${model}`
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer token-1");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].content, "커밋 목록");
});

test("OpenAI 형식으로 온 응답도 읽는다", async () => {
  withCredentials();
  stub(() => reply({ result: { choices: [{ message: { content: "메시지 본문" } }] } }));
  assert.equal(await generate("p"), "메시지 본문");

  stub(() => reply({ result: { choices: [{ text: "텍스트 본문" }] } }));
  assert.equal(await generate("p"), "텍스트 본문");

  // result로 감싸지 않고 최상위로 오는 응답도 있다.
  stub(() => reply({ output_text: "최상위 본문" }));
  assert.equal(await generate("p"), "최상위 본문");
});

test("환경 변수가 없으면 어느 값인지 알려 준다", async () => {
  delete process.env.CF_ACCOUNT_ID;
  process.env.CF_API_TOKEN = "token-1";
  stub(() => reply({ result: { response: "본문" } }));

  await assert.rejects(() => generate("p"), /호출 실패: 환경 변수 CF_ACCOUNT_ID가 필요합니다/);
});

test("네트워크 오류를 호출 실패로 감싼다", async () => {
  withCredentials();
  stub(() => {
    throw new Error("연결이 끊겼습니다");
  });

  await assert.rejects(() => generate("p"), /Cloudflare AI 호출 실패: 연결이 끊겼습니다/);
});

test("JSON이 아닌 응답은 상태 코드와 함께 알린다", async () => {
  withCredentials();
  stub(() => reply("<html>502 Bad Gateway</html>", 502));

  await assert.rejects(() => generate("p"), /응답이 JSON이 아닙니다 \(502\)/);
});

test("success가 거짓이면 오류 내용을 담아 실패한다", async () => {
  withCredentials();
  // 200과 함께 실패를 알려 오는 경우가 있어 상태 코드만 보면 놓친다.
  stub(() => reply({ success: false, errors: [{ code: 7000, message: "No route for model" }] }));

  await assert.rejects(() => generate("p"), /오류 \(200\): 7000 No route for model/);
});

test("본문이 비어 있으면 성공으로 보지 않는다", async () => {
  withCredentials();
  stub(() => reply({ success: true, result: { response: "   " } }));

  await assert.rejects(() => generate("p"), /Cloudflare AI 오류/);
});
