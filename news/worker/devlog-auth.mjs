// 개발 기록 작성자 한 명을 위한 로그인. 비밀번호는 Worker secret
// DEVLOG_ADMIN_PASSWORD에만 있고, 로그인하면 만료 시각에 HMAC 서명을 붙인
// 쿠키를 준다. 비밀번호를 바꾸면 서명 키가 바뀌어 기존 세션이 모두 끊긴다.
export const COOKIE = "devlog_admin";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const toBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (value) => {
  const text = atob(String(value).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
};

// An empty secret must never let anyone in; any non-empty value is the author's choice.
export const adminConfigured = (env) => String(env?.DEVLOG_ADMIN_PASSWORD || "").length > 0;

const sessionKey = (env) => crypto.subtle.importKey(
  "raw", encoder.encode(`devlog-admin-session:${env.DEVLOG_ADMIN_PASSWORD}`),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
);

export async function passwordMatches(env, candidate) {
  if (!adminConfigured(env)) return false;
  // Compare digests so the loop length never depends on the input.
  const [a, b] = await Promise.all([candidate, env.DEVLOG_ADMIN_PASSWORD].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(String(value ?? "")))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

export async function createSession(env, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(env), encoder.encode(`v1.${expires}`));
  return `v1.${expires}.${toBase64Url(signature)}`;
}

export async function sessionValid(env, token, now = Date.now()) {
  if (!adminConfigured(env)) return false;
  const [version, expires, signature] = String(token || "").split(".");
  if (version !== "v1" || !/^\d+$/.test(expires || "") || !signature || Number(expires) * 1000 <= now) return false;
  try {
    return await crypto.subtle.verify("HMAC", await sessionKey(env), fromBase64Url(signature), encoder.encode(`v1.${expires}`));
  } catch {
    return false;
  }
}

export const readCookie = (request, name = COOKIE) => {
  for (const part of String(request.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
};

export const isAdmin = (request, env) => sessionValid(env, readCookie(request));

// SameSite=Strict keeps the cookie off cross-site requests; Path limits it to the devlog.
export const sessionCookie = (token) => `${COOKIE}=${token}; Path=/devlog; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
export const clearedCookie = () => `${COOKIE}=; Path=/devlog; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// Every write must come from this site's own pages.
export function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) return origin === url.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
