import assert from "node:assert/strict";
import test from "node:test";
import { parseDraft, yaml } from "../tools/lib.mjs";

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
