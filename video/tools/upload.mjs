// YouTube Data API로 final.mp4를 올리고 저장소별 재생목록에 넣은 뒤 series.json에 회차를 기록한다.
// 비밀값은 환경 변수 또는 video/.env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN.
// 리프레시 토큰은 `npm run auth`로 한 번 받는다. 검수받지 않은 OAuth 앱이 올린 영상은 YouTube가
// 비공개로 잠그므로 기본 공개 범위는 private이며 --privacy로 바꾼다.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordEpisode } from "./lib.mjs";
import { SERIES_FILE, VIDEO_ROOT } from "./plan.mjs";

const SCOPE = "https://www.googleapis.com/auth/youtube";
const API = "https://www.googleapis.com/youtube/v3";

function loadEnv() {
  const file = path.join(VIDEO_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const need = (name) => { if (!process.env[name]) throw new Error(`환경 변수 ${name}이 없습니다. video/.env 또는 셸에 넣으세요.`); return process.env[name]; };

async function json(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${init.method || "GET"} ${url} → ${response.status} ${data.error?.message || text.slice(0, 300)}`);
  return data;
}

async function accessToken() {
  const body = new URLSearchParams({ client_id: need("YOUTUBE_CLIENT_ID"), client_secret: need("YOUTUBE_CLIENT_SECRET"), refresh_token: need("YOUTUBE_REFRESH_TOKEN"), grant_type: "refresh_token" });
  const data = await json("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  return data.access_token;
}

// 루프백 리디렉션으로 동의 코드를 받아 리프레시 토큰을 출력한다. 토큰은 저장하지 않는다.
export async function auth() {
  const clientId = need("YOUTUBE_CLIENT_ID"), clientSecret = need("YOUTUBE_CLIENT_SECRET");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent" })}`;
  console.log(`브라우저에서 열어 동의하세요:\n${url}`);
  const code = await new Promise((resolve, reject) => {
    server.on("request", (request, response) => {
      const got = new URL(request.url, redirect).searchParams.get("code");
      response.end(got ? "인증이 끝났습니다. 터미널로 돌아가세요." : "code가 없습니다.");
      got ? resolve(got) : reject(new Error("동의 코드를 받지 못했습니다."));
    });
  });
  server.close();
  const data = await json("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" }) });
  if (!data.refresh_token) throw new Error("리프레시 토큰이 오지 않았습니다. Google 계정의 앱 접근 권한을 지우고 다시 시도하세요.");
  console.log(`YOUTUBE_REFRESH_TOKEN=${data.refresh_token}\n위 줄을 video/.env에 넣으세요. 커밋하지 않습니다.`);
}

export function videoResource(metadata, privacy) {
  return {
    snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId: metadata.categoryId, defaultLanguage: metadata.defaultLanguage, defaultAudioLanguage: metadata.defaultLanguage },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  };
}

async function uploadFile(token, metadata, privacy) {
  const size = statSync(metadata.file).size;
  const start = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(size) },
    body: JSON.stringify(videoResource(metadata, privacy)),
  });
  if (!start.ok) throw new Error(`업로드 세션 시작 실패 ${start.status}: ${await start.text()}`);
  const location = start.headers.get("location");
  const handle = await open(metadata.file);
  try {
    const put = await fetch(location, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4", "content-length": String(size) }, body: handle.readableWebStream(), duplex: "half" });
    const text = await put.text();
    if (!put.ok) throw new Error(`업로드 실패 ${put.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally { await handle.close(); }
}

async function ensurePlaylist(token, title) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let pageToken = "";
  do {
    const page = await json(`${API}/playlists?${new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50", pageToken })}`, { headers });
    const found = (page.items || []).find((item) => item.snippet?.title === title);
    if (found) return found.id;
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  const created = await json(`${API}/playlists?part=snippet,status`, { method: "POST", headers, body: JSON.stringify({ snippet: { title, description: "개발 일지 영상 시리즈" }, status: { privacyStatus: "public" } }) });
  return created.id;
}

export async function upload(dir, { privacy = "private", dryRun = false } = {}) {
  loadEnv();
  const metadata = JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
  const episode = JSON.parse(readFileSync(path.join(dir, "episode.json"), "utf8"));
  if (!existsSync(metadata.file)) throw new Error(`${metadata.file}이 없습니다. 먼저 assemble을 실행하세요.`);
  if (dryRun) { console.log(JSON.stringify({ ...videoResource(metadata, privacy), playlists: metadata.playlists }, null, 2)); return null; }
  const token = await accessToken();
  const video = await uploadFile(token, metadata, privacy);
  const playlistIds = [];
  for (const title of metadata.playlists) {
    const playlistId = await ensurePlaylist(token, title);
    await json(`${API}/playlistItems?part=snippet`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId: video.id } } }) });
    playlistIds.push(playlistId);
  }
  const series = JSON.parse(readFileSync(SERIES_FILE, "utf8"));
  writeFileSync(SERIES_FILE, `${JSON.stringify(recordEpisode(series, episode, { videoId: video.id, chapters: metadata.chapters }), null, 2)}\n`, "utf8");
  const result = { videoId: video.id, url: `https://youtu.be/${video.id}`, privacy, playlistIds, uploadedAt: new Date().toISOString() };
  writeFileSync(path.join(dir, "upload.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`${result.url} (${privacy}) · series.json 갱신됨. 커밋하세요.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const [command, dir] = argv.filter((arg) => !arg.startsWith("--"));
  const privacy = (argv.find((arg) => arg.startsWith("--privacy=")) || "--privacy=private").slice("--privacy=".length);
  (async () => {
    if (command === "auth") { loadEnv(); return auth(); }
    if (command === "upload" && dir) return upload(path.resolve(dir), { privacy, dryRun: argv.includes("--dry-run") });
    throw new Error("사용법: npm run auth | npm run upload -- out/<slug> [--privacy=private|unlisted|public] [--dry-run]");
  })().catch((error) => { console.error(error.message); process.exit(1); });
}
