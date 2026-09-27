// 하루 작업 기록 본문을 Workers AI로 쓴다. Cron의 자동 발행과 편집기의 "AI로 다시 쓰기"가 함께 쓴다.
// 저장소마다 따로 불러 병렬로 쓴다. 하루치를 한 번에 쓰면 바쁜 날에는 출력 상한에 잘리거나
// 업스트림 시간 제한(약 4분)에 걸렸다.
import { cleanSection, postIntro, postSystem, repoHeading, sectionPrompt, titlePrompt } from "../../shared/devlog-writing.mjs";

export const WRITER_MODEL = "@cf/openai/gpt-oss-120b";

const responseText = (result) => String(result?.response ?? result?.choices?.[0]?.message?.content ?? result?.output_text ?? "");

async function ask(env, content, maxTokens) {
  const result = await env.AI.run(env.DEVLOG_WRITER_MODEL || WRITER_MODEL, {
    messages: [{ role: "system", content: postSystem }, { role: "user", content }],
    max_tokens: maxTokens, temperature: 0.4,
  });
  if (result?.choices?.[0]?.finish_reason === "length") throw new Error("AI 응답이 길이 상한에서 잘렸습니다.");
  return responseText(result);
}

export async function writePost(env, day, groups) {
  const repos = [...groups].sort((a, b) => b[1].length - a[1].length);
  const sections = await Promise.all(repos.map(async ([repo, commits]) => {
    // Reasoning tokens count toward the cap and vary per run, so retry a failed section once.
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = cleanSection(await ask(env, sectionPrompt(day, repo, commits), 16000));
        if (text.length < 20) throw new Error(`${repoHeading(repo)} 부분이 비어 있습니다.`);
        return `## ${repoHeading(repo)}\n\n${text}`;
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }));
  const body = `${postIntro(groups)}\n\n${sections.join("\n\n")}`;
  const head = await ask(env, titlePrompt(day, body), 1500);
  const title = head.match(/^TITLE\s*:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const summary = head.match(/^SUMMARY\s*:\s*(.+)$/m)?.[1]?.trim() || "";
  if (!title) throw new Error("AI가 제목을 쓰지 못했습니다.");
  return { title, summary, body };
}
