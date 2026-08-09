const MODEL = process.env.CF_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name}가 필요합니다.`);
  return value;
};

export const model = MODEL;

export const yaml = (value) =>
  `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function generate(prompt) {
  const response = await fetch(
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

  const data = await response.json();
  const text = data.result?.response?.trim();
  if (!response.ok || !data.success || !text) {
    throw new Error(`Cloudflare AI 오류 (${response.status})`);
  }
  return text;
}

export function parseDraft(text) {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = clean.match(/^TITLE:\s*(.+)\r?\nSUMMARY:\s*(.+)\r?\n+([\s\S]+)$/m);
  if (!match) throw new Error("AI 응답 형식이 올바르지 않습니다.");
  return { title: match[1].trim(), summary: match[2].trim(), body: match[3].trim() };
}
