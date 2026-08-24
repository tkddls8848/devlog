import { runDigest } from "./digest.mjs";
import { runArchive } from "./archive.mjs";
import { runDevlog } from "./devlog.mjs";
import { createStore } from "./repository.mjs";
import { renderArchive, renderDevlogHome, renderDevlogPost, renderFeed, renderHome, renderIssue, renderNotFound } from "./render.mjs";

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
  const store = createStore(env.DB);
  await store.ensureLegacyArchive();

  if (url.pathname === "/healthz") {
    const [latestRun, latestArchiveRun, latestDevlogRun] = await Promise.all([store.latestRun(), store.latestArchiveRun(), store.latestDevlogRun()]);
    return Response.json(
      { ok: true, latestRun, latestArchiveRun, latestDevlogRun },
      { headers: { "cache-control": "no-store" } }
    );
  }

  if (url.pathname === "/" || url.pathname === "") {
    return html(renderHome(await store.listIssues(100), env, origin));
  }

  if (url.pathname === "/feed.xml") {
    return new Response(renderFeed(await store.listIssues(20), origin), {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, max-age=900",
      },
    });
  }

  if (url.pathname === "/archive" || url.pathname === "/archive/") {
    return html(renderArchive(await store.listVendorDocuments(), env, origin), 200, "public, max-age=900");
  }

  if (url.pathname === "/devlog" || url.pathname === "/devlog/") {
    return html(renderDevlogHome(await store.listDevlogPosts(), env, origin));
  }

  const devlogMatch = url.pathname.match(/^\/devlog\/posts\/([a-z0-9-]+)\/?$/i);
  if (devlogMatch) {
    const post = await store.getDevlogPost(devlogMatch[1]);
    return post ? html(renderDevlogPost(post, env, origin), 200, "public, max-age=3600") : html(renderNotFound(env), 404, "no-store");
  }

  const match = url.pathname.match(/^\/issues\/([a-z0-9-]+)\/?$/i);
  if (match) {
    const issue = await store.getIssue(match[1]);
    return issue
      ? html(renderIssue(issue, env, origin), 200, "public, max-age=3600")
      : html(renderNotFound(env), 404, "no-store");
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  return html(renderNotFound(env), 404, "no-store");
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
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
    const store = createStore(env.DB);
    const archiveCron = "25 0 * * *";
    const devlogCron = "10 0 * * *";
    const now = new Date(controller.scheduledTime);
    const run = controller.cron === archiveCron ? runArchive({ env, store, now })
      : controller.cron === devlogCron ? runDevlog({ env, store, now })
      : runDigest({ env, store, now });
    ctx.waitUntil(
      run.catch((error) => {
        console.error(controller.cron === archiveCron ? "예약 아카이브 수집 실패" : controller.cron === devlogCron ? "예약 개발일지 발행 실패" : "예약 뉴스레터 발행 실패", error);
        throw error;
      })
    );
  },
};
