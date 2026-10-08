import { runDevlog } from "./devlog.mjs";
import { createStore } from "./repository.mjs";
import { handleDevlogAdmin } from "./devlog-admin.mjs";
import { isAdmin } from "./devlog-auth.mjs";
import { movedResponse } from "./redirects.mjs";
import { renderDevlogHome, renderDevlogPost, renderNotFound } from "./render.mjs";

export const DEVLOG_CRON = "10 0 * * *";

const html = (body, status = 200, cache = "public, max-age=300") =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    },
  });

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;

  const moved = movedResponse(url);
  if (moved) return moved;

  const store = createStore(env.DB);

  if (url.pathname === "/healthz") {
    return Response.json({ ok: true, latestDevlogRun: await store.latestDevlogRun() }, { headers: { "cache-control": "no-store" } });
  }

  const adminResponse = await handleDevlogAdmin(request, env, store);
  if (adminResponse) return adminResponse;

  // The author sees edit links, so their copy of a page must never be cached or shared.
  if (url.pathname === "/devlog" || url.pathname === "/devlog/") {
    const admin = await isAdmin(request, env);
    const page = Number.parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 100);
    const listing = await store.listDevlogPage({ page, perPage: 5, query });
    return html(renderDevlogHome(listing, env, origin, { admin }), 200, admin ? "private, no-store" : undefined);
  }

  const devlogMatch = url.pathname.match(/^\/devlog\/posts\/([a-z0-9-]+)\/?$/i);
  if (devlogMatch) {
    const admin = await isAdmin(request, env);
    const post = await store.getDevlogPost(devlogMatch[1]);
    return post ? html(renderDevlogPost(post, env, origin, { admin }), 200, admin ? "private, no-store" : "public, max-age=3600") : html(renderNotFound(env), 404, "no-store");
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  return html(renderNotFound(env), 404, "no-store");
}

export default {
  async fetch(request, env) {
    // Only the devlog writing desk accepts form posts.
    const writable = request.method === "POST" && new URL(request.url).pathname.startsWith("/devlog/admin");
    if (!["GET", "HEAD"].includes(request.method) && !writable) {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    try {
      const response = await handle(request, env);
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch (error) {
      console.error("요청 처리 실패", error);
      return html("<h1>일시적인 오류가 발생했습니다.</h1>", 500, "no-store");
    }
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron !== DEVLOG_CRON) {
      console.warn("알 수 없는 Cron이라 건너뜀", controller.cron);
      return;
    }
    const store = createStore(env.DB);
    ctx.waitUntil(
      runDevlog({ env, store, now: new Date(controller.scheduledTime) }).catch((error) => {
        console.error("예약 개발일지 발행 실패", error);
        throw error;
      })
    );
  },
};
