// 하루 작업 기록 본문을 Workers AI로 쓴다. Cron의 자동 발행과 편집기의 "AI로 다시 쓰기"가 함께 쓴다.
// 저장소마다 따로 불러 병렬로 쓴다. 하루치를 한 번에 쓰면 바쁜 날에는 출력 상한에 잘리거나
// 업스트림 시간 제한(약 4분)에 걸렸다.
import { cleanSection, copiesExample, postIntro, postSystem, postTitle, repoHeading, sectionLengths, sectionPrompt, summaryPrompt } from "../../shared/devlog-writing.mjs";

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
  const lengths = sectionLengths(groups);
  const sections = await Promise.all(repos.map(async ([repo, commits]) => {
    // Reasoning tokens count toward the cap and vary per run; retry a failed, copied or
    // runaway section. If every usable attempt runs long, keep the shortest one.
    const target = lengths.get(repo);
    let lastError;
    let shortest = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = cleanSection(await ask(env, sectionPrompt(day, repo, commits, target), 16000));
        if (text.length < 20) throw new Error(`${repoHeading(repo)} 부분이 비어 있습니다.`);
        if (copiesExample(text)) throw new Error(`${repoHeading(repo)} 부분이 형식 예시의 문장을 옮겨 썼습니다.`);
        if (text.length <= target * 2) return `## ${repoHeading(repo)}\n\n${text}`;
        if (!shortest || text.length < shortest.length) shortest = text;
      } catch (error) { lastError = error; }
    }
    if (shortest) return `## ${repoHeading(repo)}\n\n${shortest}`;
    throw lastError;
  }));
  const body = `${postIntro(groups)}\n\n${sections.join("\n\n")}`;
  // A missing summary is not worth losing the post over.
  let summary = "";
  for (let attempt = 0; attempt < 3 && !summary; attempt++) {
    try {
      const text = cleanSection(await ask(env, summaryPrompt(day, body), 4000));
      // Accept the answer even when the model drops the "SUMMARY:" label.
      const candidate = (text.match(/^SUMMARY\s*:\s*(.+)$/m)?.[1] || text.split("\n").find((line) => line.trim()) || "").trim().slice(0, 200);
      // The model once answered in English; the site is Korean.
      if (/[가-힣]/.test(candidate)) summary = candidate;
    } catch (error) { console.warn("개발 기록 요약 작성 실패", error.message); }
  }
  return { title: postTitle(day), summary, body };
}
