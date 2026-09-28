import assert from "node:assert/strict";
import test from "node:test";
import { STYLE, backgroundPrompt, credentials, parseSubjects, subjectsPrompt } from "../tools/backgrounds.mjs";

test("배경 묘사는 장면 전체를 한 번에 요청하고, 장면마다 다른 장소와 상투적인 책상 소품 금지를 요구한다", () => {
  const prompt = subjectsPrompt({ title: "기능 다음의 일" }, [
    { text: "내 컴퓨터에서\n다른 사람에게.", note: "첫 공개 배포", narration: "서비스를 처음 공개했습니다." },
    { text: "끝", narration: "마무리입니다." },
  ]);
  assert.match(prompt, /Scene 1: title "내 컴퓨터에서 다른 사람에게\." · note "첫 공개 배포"/);
  assert.match(prompt, /Scene 2: /);
  assert.match(prompt, /different setting/);
  assert.match(prompt, /Do not use desks, desk lamps, mugs/);
  assert.match(prompt, /No people, no text/);
});

test("모델 답에서 장면 수만큼의 묘사를 꺼내고, 모자라면 실패로 본다", () => {
  assert.deepEqual(parseSubjects('<think>x</think>\n["A boat  leaves.", "A mountain."]', 2), ["A boat leaves.", "A mountain."]);
  assert.throws(() => parseSubjects('["only one"]', 2), /2개/);
  assert.throws(() => parseSubjects("no json", 1));
});

test("그림 프롬프트는 묘사 뒤에 공통 화풍과 글자·사람 금지를 붙인다", () => {
  const prompt = backgroundPrompt(" A boat leaves the harbor. ");
  assert.equal(prompt, `A boat leaves the harbor. ${STYLE}`);
  assert.match(STYLE, /No text, letters, numbers/);
  assert.match(STYLE, /left side .* shadow for titles/);
});

test("API 토큰과 계정 ID가 있으면 wrangler 로그인을 보지 않는다", () => {
  assert.deepEqual(credentials({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }), { token: "t", account: "a" });
});
