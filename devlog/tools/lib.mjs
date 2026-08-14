const MODEL = process.env.CF_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name}가 필요합니다.`);
  return value;
};

export const model = MODEL;

export const yaml = (value) =>
  `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")}"`;

export async function generate(prompt) {
  let response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${required("CF_ACCOUNT_ID")}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${required("CF_API_TOKEN")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "자료에 없는 내용을 만들지 않는 한국어 기록자입니다.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 900,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(180000),
      }
    );
  } catch (error) {
    throw new Error(`Cloudflare AI 호출 실패: ${error.message}`);
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Cloudflare AI 응답이 JSON이 아닙니다 (${response.status}).`);
  }

  const result = data.result ?? data;
  const text = String(
    result.response ??
      result.choices?.[0]?.message?.content ??
      result.choices?.[0]?.text ??
      result.output_text ??
      ""
  ).trim();

  if (!response.ok || data.success === false || !text) {
    const detail =
      data.errors?.map((error) => `${error.code ?? ""} ${error.message ?? ""}`.trim()).join(", ") ||
      raw.slice(0, 300);
    throw new Error(`Cloudflare AI 오류 (${response.status}): ${detail}`);
  }
  return text;
}

export function parseDraft(text, fallback = {}) {
  const clean = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const lines = clean.split(/\r?\n/);
  const titleAt = lines.findIndex((line) => /^TITLE\s*:/i.test(line.trimStart()));
  const summaryAt = lines.findIndex((line) => /^SUMMARY\s*:/i.test(line.trimStart()));
  const valueAt = (index) => lines[index]?.replace(/^[^:]+:\s*/, "").trim();
  const markerAt = Math.max(titleAt, summaryAt);
  const parsedBody = (markerAt >= 0 ? lines.slice(markerAt + 1) : lines)
    .join("\n")
    .replace(/^(?:\s*(?:-{3,}|\*{3,}|_{3,})\s*\n)+/, "")
    .trim();
  const body = markerAt >= 0 ? parsedBody : fallback.body || parsedBody;
  const draft = {
    title: valueAt(titleAt) || fallback.title,
    summary: valueAt(summaryAt) || fallback.summary,
    body: body || fallback.body,
  };

  if (!draft.title || !draft.summary || !draft.body) {
    throw new Error("AI 응답에서 제목, 요약 또는 본문을 찾지 못했습니다.");
  }
  return draft;
}
