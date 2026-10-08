# 뉴스·아카이브 specsheet 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 뉴스 다이제스트와 벤더 문서 아카이브를 새 저장소 `tkddls8848/specsheet`의 Worker `specsheet`와 D1 `specsheet`로 옮기고, devlog Worker는 작업 회고만 남긴 채 옛 경로를 301로 넘긴다.

**Architecture:** devlog 저장소를 `git filter-repo`로 걸러 specsheet 저장소를 만들고(이력 보존), 양쪽에서 상대 기능 코드를 지운다. 데이터는 Cron이 돌지 않는 시간대에 `wrangler d1 export --table`로 테이블별로 떠서 새 D1에 넣고, 행 수를 맞춘 뒤 두 저장소를 함께 배포한다. 옛 테이블은 1주일 뒤 migration으로 지운다.

**Tech Stack:** Cloudflare Workers, D1, Workers Builds, wrangler 4.125.0, Node 24(`node --test`), Eleventy 3, GitHub Actions, git-filter-repo.

**Spec:** `docs/superpowers/specs/2026-10-09-specsheet-split-design.md`

## Global Constraints

- 새 Worker 이름 `specsheet`, 주소 `https://specsheet.tkddls8848.workers.dev`.
- 새 D1 이름 `specsheet`, 위치 `apac`, binding 이름 `DB`.
- specsheet Cron: `0 22 * * *`(뉴스), `25 0 * * *`(아카이브). devlog Cron: `10 0 * * *`(작업 회고)만.
- 옛 경로 `/issues/*`, `/feed.xml`, `/archive`, `/archive/*` → `301 https://specsheet.tkddls8848.workers.dev` + 같은 경로 + 같은 쿼리. devlog의 `/` → `301 /devlog/`.
- `DEVLOG_URL = "https://devlog.tkddls8848.workers.dev/devlog/"`, `ARCHIVE_URL = "https://specsheet.tkddls8848.workers.dev/archive/"`, devlog의 `NEWS_URL = "https://specsheet.tkddls8848.workers.dev/"`.
- 전환 작업(Task 6~7)은 KST 10:00~다음 날 06:30 사이에만 한다.
- 옛 테이블 DROP(Task 8)은 전환 후 최소 7일, 정상 확인 뒤에만 한다.
- 폴더 이름 `news/`는 두 저장소 모두 바꾸지 않는다.
- 커밋 메시지는 한국어 한 줄 요약 + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- specsheet 저장소는 Task 7 전까지 GitHub에 push하지 않는다(그 전에는 로컬 커밋만, 첫 배포는 wrangler 직접 배포).

## Review Focus

1. 옛 RSS 주소를 `HEAD`나 쿼리(`/feed.xml?utm=x`)로 요청해도 301과 쿼리가 보존된 Location이 나와야 한다 → Task 4 테스트.
2. 슬래시 없는 `/archive`, `/issues/<slug>`(끝 슬래시 없음)도 새 주소로 넘어가야 한다 → Task 4 테스트.
3. 대시보드나 이전 배포에 남은 옛 Cron 이벤트가 오면 엉뚱한 작업(뉴스 발행 두 번)을 돌리지 말고 건너뛰어야 한다 → Task 2(specsheet)·Task 4(devlog) 테스트.
4. specsheet에 `/devlog/...`나 `/devlog/admin` POST가 와도 500 없이 404/405로 끝나야 한다 → Task 2 테스트.
5. `/devlog/`처럼 비슷하지만 옮기지 않는 경로(`/archived`, `/issues`)를 잘못 리다이렉트하지 않아야 한다 → Task 4 테스트.

---

## 파일 구조

specsheet 저장소(`C:\Users\tkddl\orca\specsheet`, devlog의 `news/`, `archive/`, `shared/` 그대로):

| 파일 | 책임 |
| --- | --- |
| `news/worker/index.mjs` | 라우팅(뉴스·아카이브), Cron 분기. devlog 부분 제거 |
| `news/worker/repository.mjs` | 뉴스·아카이브 D1 저장소. devlog 메서드 제거 |
| `news/worker/render.mjs` | 뉴스·아카이브 HTML·RSS. devlog 렌더러 제거, `NEWS_URL` 내비 |
| `news/test/worker-index.test.mjs` | 새 파일. 라우팅과 Cron 분기 검증 |
| `news/wrangler.jsonc` | specsheet Worker·D1·Cron |
| `news/tools/push-vendor-docs.mjs` | 대상 D1을 specsheet로 |
| `news/package.json` | `pretest`로 legacy 데이터 생성 |
| `shared/sync.mjs` | devlog 자산 복사 제거 |
| `.github/workflows/test.yml`, `hpe-archive.yml` | CI, HPE 수집 |
| `README.md`, `news/README.md`, `archive/README.md` | specsheet 기준 문서 |

devlog 저장소(`C:\Users\tkddl\orca\devlog`, 브랜치 `specsheet-split`):

| 파일 | 책임 |
| --- | --- |
| `news/worker/redirects.mjs` | 새 파일. 옛 경로 → 새 주소 301 응답 생성 |
| `news/test/redirects.test.mjs` | 새 파일. 리다이렉트 규칙 검증 |
| `news/test/worker-index.test.mjs` | 새 파일. devlog 라우팅·Cron 분기 검증 |
| `news/worker/index.mjs` | 작업 회고 라우팅 + 리다이렉트 |
| `news/worker/repository.mjs`, `render.mjs` | 뉴스·아카이브 부분 제거 |
| `news/wrangler.jsonc`, `news/package.json` | Cron 하나, vars 정리 |
| `news/migrations/0007_drop_news_archive.sql` | Task 8에서만 추가 |

---

### Task 1: specsheet 저장소를 이력과 함께 추출

**Files:**
- Create: `C:\Users\tkddl\orca\specsheet\` (devlog 저장소에서 걸러 낸 git 저장소)

**Interfaces:**
- Produces: 로컬 저장소 `C:\Users\tkddl\orca\specsheet`, 브랜치 `main`, 원격 `origin = https://github.com/tkddls8848/specsheet.git`(push는 Task 7).

- [ ] **Step 1: git-filter-repo 설치**

```bash
python -m pip install --user git-filter-repo
git filter-repo --version
```
Expected: 버전 문자열 출력. 실패하면 `python -m git_filter_repo --version`으로 실행하고 이후 명령의 `git filter-repo`를 `python -m git_filter_repo`로 바꾼다.

- [ ] **Step 2: devlog main을 새 폴더로 복제하고 걸러 내기**

```bash
cd /c/Users/tkddl/orca
git clone --no-local --branch main devlog specsheet
cd specsheet
git filter-repo --force \
  --path news/ --path archive/ --path shared/ \
  --path .editorconfig --path .gitattributes --path .gitignore --path .env.example \
  --path .github/workflows/test.yml --path .github/workflows/hpe-archive.yml
git remote add origin https://github.com/tkddls8848/specsheet.git
ls -a
git log --oneline | head -5
```
Expected: `ls`에 `news archive shared .github .gitignore ...`만 있고 `devlog/`, `video/`, `docs/`는 없다. 커밋 이력이 남아 있다.

- [ ] **Step 3: 기준선 테스트**

```bash
cd /c/Users/tkddl/orca/specsheet/news && npm ci && node tools/export-legacy-archive.mjs && npm test
cd ../archive && npm ci && npm test
```
Expected: news `pass 107 fail 0`(devlog 저장소와 같음), archive 전부 통과.

커밋 없음(이력 추출만).

---

### Task 2: specsheet에서 작업 회고 코드 제거

**Files:**
- Delete: `news/worker/devlog.mjs`, `devlog-writer.mjs`, `devlog-admin.mjs`, `devlog-auth.mjs`, `devlog-spellcheck.mjs`
- Delete: `news/tools/devlog-journal.mjs`, `backfill-private.mjs`, `rename-private-labels.mjs`
- Delete: `shared/devlog-privacy.mjs`, `devlog-writing.mjs`, `devlog.css`, `devlog.js`, `devlog-editor.js`
- Delete: `news/migrations/0003_devlog.sql`, `0004_devlog_journal.sql`, `0005_devlog_privacy.sql`, `0006_private_project_labels.sql`
- Delete: `news/test/devlog-admin.test.mjs`, `devlog-journal.test.mjs`, `devlog-privacy.test.mjs`, `devlog-privacy-storage.test.mjs`, `worker-devlog.test.mjs`
- Modify: `news/worker/index.mjs`(전체 교체), `news/worker/repository.mjs`, `news/worker/render.mjs`, `news/test/render.test.mjs`, `news/package.json`, `shared/sync.mjs`, `.gitignore`
- Create: `news/test/worker-index.test.mjs`

**Interfaces:**
- Consumes: Task 1의 저장소.
- Produces: `export default { fetch(request, env), scheduled(controller, env, ctx) }`, `export const DIGEST_CRON = "0 22 * * *"`, `export const ARCHIVE_CRON = "25 0 * * *"` (`news/worker/index.mjs`). `createStore(db)`는 뉴스·아카이브 메서드만 가진다.

- [ ] **Step 1: 실패하는 라우팅 테스트 작성** — `news/test/worker-index.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import worker, { ARCHIVE_CRON, DIGEST_CRON } from "../worker/index.mjs";

// D1 stub: 모든 조회가 빈 결과. legacy 이관은 이미 끝난 것으로 둔다.
const fakeDb = () => {
  const statement = {
    bind() { return statement; },
    async first() { return { value: "done" }; },
    async all() { return { results: [] }; },
    async run() { return { meta: { changes: 0 } }; },
  };
  return { prepare: () => statement, batch: async () => [] };
};
const env = () => ({
  DB: fakeDb(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  DEVLOG_URL: "https://devlog.tkddls8848.workers.dev/devlog/",
});
const get = (path, init) => worker.fetch(new Request(`https://specsheet.tkddls8848.workers.dev${path}`, init), env());

test("뉴스·아카이브·RSS·healthz는 200으로 응답한다", async () => {
  for (const path of ["/", "/archive/", "/archive", "/feed.xml", "/healthz"]) {
    assert.equal((await get(path)).status, 200, path);
  }
  const health = await (await get("/healthz")).json();
  assert.deepEqual(Object.keys(health).sort(), ["latestArchiveRun", "latestRun", "ok"]);
});

test("작업 회고 경로는 옮겨 오지 않았으므로 404이고, POST는 405다", async () => {
  assert.equal((await get("/devlog/")).status, 404);
  assert.equal((await get("/devlog/posts/2026-10-01-devlog/")).status, 404);
  assert.equal((await get("/devlog/admin/login", { method: "POST", body: "x" })).status, 405);
});

test("Cron은 뉴스·아카이브만 돌리고 모르는 Cron은 건너뛴다", async () => {
  const ran = [];
  const ctx = { waitUntil: (promise) => ran.push(promise) };
  await worker.scheduled({ cron: "10 0 * * *", scheduledTime: Date.now() }, env(), ctx);
  assert.equal(ran.length, 0);
  assert.equal(DIGEST_CRON, "0 22 * * *");
  assert.equal(ARCHIVE_CRON, "25 0 * * *");
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/tkddl/orca/specsheet/news && node --test test/worker-index.test.mjs`
Expected: FAIL — `ARCHIVE_CRON`/`DIGEST_CRON` export 없음, `/devlog/`가 200, 모르는 Cron에 digest 실행.

- [ ] **Step 3: devlog 파일·테스트·migration 삭제**

```bash
cd /c/Users/tkddl/orca/specsheet
git rm -q news/worker/devlog.mjs news/worker/devlog-writer.mjs news/worker/devlog-admin.mjs news/worker/devlog-auth.mjs news/worker/devlog-spellcheck.mjs \
  news/tools/devlog-journal.mjs news/tools/backfill-private.mjs news/tools/rename-private-labels.mjs \
  shared/devlog-privacy.mjs shared/devlog-writing.mjs shared/devlog.css shared/devlog.js shared/devlog-editor.js \
  news/migrations/0003_devlog.sql news/migrations/0004_devlog_journal.sql news/migrations/0005_devlog_privacy.sql news/migrations/0006_private_project_labels.sql \
  news/test/devlog-admin.test.mjs news/test/devlog-journal.test.mjs news/test/devlog-privacy.test.mjs news/test/devlog-privacy-storage.test.mjs news/test/worker-devlog.test.mjs
```

- [ ] **Step 4: `news/worker/index.mjs` 전체 교체**

```js
import { runDigest } from "./digest.mjs";
import { runArchive } from "./archive.mjs";
import { createStore } from "./repository.mjs";
import { renderArchive, renderFeed, renderHome, renderIssue, renderNotFound } from "./render.mjs";

export const DIGEST_CRON = "0 22 * * *";
export const ARCHIVE_CRON = "25 0 * * *";

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
    const [latestRun, latestArchiveRun] = await Promise.all([store.latestRun(), store.latestArchiveRun()]);
    return Response.json({ ok: true, latestRun, latestArchiveRun }, { headers: { "cache-control": "no-store" } });
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
    if (!["GET", "HEAD"].includes(request.method)) {
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
    const jobs = {
      [DIGEST_CRON]: [runDigest, "예약 뉴스레터 발행 실패"],
      [ARCHIVE_CRON]: [runArchive, "예약 아카이브 수집 실패"],
    };
    const job = jobs[controller.cron];
    if (!job) {
      console.warn("알 수 없는 Cron이라 건너뜀", controller.cron);
      return;
    }
    const [run, failure] = job;
    const store = createStore(env.DB);
    ctx.waitUntil(
      run({ env, store, now: new Date(controller.scheduledTime) }).catch((error) => {
        console.error(failure, error);
        throw error;
      })
    );
  },
};
```

- [ ] **Step 5: `news/worker/repository.mjs`에서 devlog 부분 제거**

- 3~4행 import 두 줄 삭제: `import { repoOutline } from "../../shared/devlog-writing.mjs";`, `import { privateProjectLabel } from "../../shared/devlog-privacy.mjs";`
- `createStore` 안에서 `listDevlogPage`부터 `latestDevlogRun`까지 메서드 전부 삭제(현재 248~394행: `listDevlogPage`, `getDevlogPost`, `publishedDevlogShas`, `privateRepoAlias`, `nextDevlogSlug`, `listDevlogAdmin`, `getDevlogPostForEdit`, `updateDevlogPost`, `createDevlogEntry`, `findDevlogDraft`, `saveDevlogDraft`, `saveDevlogRun`, `latestDevlogRun`). `saveArchiveRun` 다음이 객체를 닫는 `};`가 되게 한다.
- 파일 끝 쪽에 devlog 전용 helper가 남았는지 확인:

```bash
cd /c/Users/tkddl/orca/specsheet/news && grep -n "repoOutline\|privateProjectLabel\|devlog" worker/repository.mjs
```
Expected: 출력 없음. 남은 줄은 함께 삭제한다.

- [ ] **Step 6: `news/worker/render.mjs`에서 devlog 부분 제거**

- `pageWindow`, `devlogPagination`, `renderDevlogHome`, `renderDevlogPost` 함수 삭제(현재 243~318행).
- `layout()`의 devlog 분기 삭제: `const isDevlog = ...`, `if (isDevlog) {...}` 줄과, 템플릿 안의 `${isDevlog ? ... : ""}` 세 군데(devlog.css 링크, skip-link, devlog.js 스크립트)를 지운다. `<body>`는 `<body${wide ? ' class="wide"' : ""}>`로, 사이트 제목 링크는 `href="/"`로.
- 확인:

```bash
grep -n "isDevlog\|Devlog\|devlog.css\|devlog.js" worker/render.mjs
```
Expected: `devlogUrl`(내비 링크) 관련 줄만 남는다.

- [ ] **Step 7: `news/test/render.test.mjs` 정리**

- 3행 import를 `import { markdownToHtml, renderArchive, renderFeed, renderHome, renderIssue } from "../worker/render.mjs";`로.
- 테스트 "개발 기록은 실제 데이터로 목록, 목차, 근거를 표시한다"와 "개발 기록 목록은 페이지 번호로 나누고 검색어를 유지한다" 두 개를 통째로 삭제.

- [ ] **Step 8: 테스트 실행 전 legacy 데이터 생성을 자동화** — `news/package.json`의 `scripts`에 한 줄 추가

```json
    "pretest": "node tools/export-legacy-archive.mjs",
```
`journal` 스크립트 줄(`"journal": "node tools/devlog-journal.mjs",`)은 삭제.

- [ ] **Step 9: 공유 자산 복사 목록 정리** — `shared/sync.mjs`의 `FILES`

```js
const FILES = [
  ["theme.css", "src/assets/css/theme.css"],
  ["theme-init.js", "src/assets/js/theme-init.js"],
  ["theme-toggle.js", "src/assets/js/theme-toggle.js"],
  ["theme-toggle.njk", "src/_includes/partials/theme-toggle.njk"],
];
```
루트 `.gitignore`에서 다음 줄 삭제: `**/src/assets/css/devlog.css`, `**/src/assets/js/devlog.js`, `**/src/assets/js/devlog-editor.js`, `# npm run journal -- pull 로 받는 작업 사본. 원본은 D1이다.`, `devlog/journal/`.
남은 사본도 지운다: `rm -f news/src/assets/css/devlog.css news/src/assets/js/devlog.js news/src/assets/js/devlog-editor.js archive/src/assets/css/devlog.css archive/src/assets/js/devlog.js archive/src/assets/js/devlog-editor.js`

- [ ] **Step 10: 남은 참조 확인**

```bash
cd /c/Users/tkddl/orca/specsheet && grep -rn "devlog-writing\|devlog-privacy\|devlog-admin\|devlog-auth\|runDevlog\|renderDevlog" --include=*.mjs --include=*.js --include=*.njk news archive shared
```
Expected: 출력 없음.

- [ ] **Step 11: 테스트 통과 확인**

```bash
cd news && npm test && npm run build && cd ../archive && npm test
```
Expected: news 전부 PASS(새 `worker-index.test.mjs` 3개 포함), Eleventy 빌드 성공, archive 전부 PASS.

- [ ] **Step 12: Commit**

```bash
cd /c/Users/tkddl/orca/specsheet && git add -A && git commit -q -F - <<'EOF'
작업 회고 코드를 떼어 내고 뉴스·아카이브만 남긴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: specsheet 설정(D1, Worker, 내비, HPE 도구, CI, 문서)

사용자가 먼저 `! cd news && npx wrangler login`으로 로그인해야 한다(로컬 토큰 만료 상태).

**Files:**
- Modify: `news/wrangler.jsonc`, `news/worker/render.mjs`(layout 내비), `news/test/render.test.mjs`, `news/tools/push-vendor-docs.mjs`, `.github/workflows/test.yml`, `README.md`(새로 씀), `news/README.md`, `archive/README.md`, `news/src/_data/site.js`, `archive/src/_data/site.js`

**Interfaces:**
- Consumes: Task 2의 `index.mjs`.
- Produces: D1 `specsheet`의 UUID(이하 `<SPECSHEET_DB_ID>`), `siteFromEnv(env).newsUrl`(기본 `"/"`).

- [ ] **Step 1: D1 생성과 스키마 적용**

```bash
cd /c/Users/tkddl/orca/specsheet/news
node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js d1 create specsheet --location apac
```
Expected: `database_id = "<UUID>"` 출력. 이 값을 `<SPECSHEET_DB_ID>`로 기록한다.

- [ ] **Step 2: `news/wrangler.jsonc` 교체** (`<SPECSHEET_DB_ID>`는 Step 1 값으로)

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "specsheet",
  "main": "./worker/index.mjs",
  "compatibility_date": "2026-08-24",
  // 전환(Task 7) 전까지 비워 두어 옛 devlog Worker와 겹쳐 돌지 않게 한다.
  // 전환 때 ["0 22 * * *", "25 0 * * *"]로 바꾼다. Cron Trigger는 UTC 기준이다.
  "triggers": {
    "crons": []
  },
  "ai": {
    "binding": "AI"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "specsheet",
      "database_id": "<SPECSHEET_DB_ID>",
      "migrations_dir": "./migrations"
    }
  ],
  "vars": {
    "CF_AI_MODEL": "@cf/openai/gpt-oss-20b",
    "NEWS_WINDOW_HOURS": "24",
    "NEWS_PER_SOURCE": "3",
    "NEWS_MAX_ITEMS": "30",
    "HN_MIN_POINTS": "100",
    "DEVLOG_URL": "https://devlog.tkddls8848.workers.dev/devlog/",
    "ARCHIVE_URL": "https://specsheet.tkddls8848.workers.dev/archive/"
  },
  "assets": {
    "directory": "./_site",
    "binding": "ASSETS",
    // HTML과 RSS는 D1에서 동적으로 만들고 CSS·JS는 정적 자산으로 바로 보낸다.
    "run_worker_first": ["/", "/issues/*", "/archive*", "/feed.xml", "/healthz"],
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "observability": {
    "enabled": true
  }
}
```

- [ ] **Step 3: 원격 스키마 적용**

```bash
npm run db:migrate:remote
node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute specsheet --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```
Expected: `0001_initial.sql`, `0002_vendor_archive.sql` 적용. 테이블 `archive_runs, collection_runs, d1_migrations, entries, issues, metadata, sqlite_sequence, vendor_documents`.

- [ ] **Step 4: 내비의 뉴스레터 링크를 env로 — 실패하는 테스트** (`news/test/render.test.mjs` 끝에 추가)

```js
test("내비게이션은 다른 Worker로 옮긴 사이트를 절대 주소로 잇는다", () => {
  const html = renderHome([], { DEVLOG_URL: "https://devlog.example/devlog/", ARCHIVE_URL: "https://specsheet.example/archive/" }, "https://specsheet.example");
  assert.match(html, /<a href="https:\/\/devlog\.example\/devlog\/">개발 일지<\/a>/);
  assert.match(html, /<a href="https:\/\/specsheet\.example\/archive\/">아카이브<\/a>/);
  assert.match(html, /<a href="\/" aria-current="page">뉴스레터<\/a>/);
  const away = renderHome([], { NEWS_URL: "https://specsheet.example/" }, "https://devlog.example");
  assert.match(away, /<a href="https:\/\/specsheet\.example\/" aria-current="page">뉴스레터<\/a>/);
  assert.match(away, /href="https:\/\/specsheet\.example\/feed\.xml"/);
});
```

Run: `node --test test/render.test.mjs` → Expected: FAIL(`NEWS_URL` 무시).

- [ ] **Step 5: `render.mjs`의 `siteFromEnv`·내비·RSS 링크 수정**

```js
const siteFromEnv = (env) => ({
  title: "devlog news",
  tagline: "IT 업계 뉴스와 엔지니어링 블로그를 하루 한 편으로 묶는 뉴스레터",
  githubUser: "tkddls8848",
  devlogUrl: env.DEVLOG_URL || "https://devlog.tkddls8848.workers.dev/devlog/",
  archiveUrl: env.ARCHIVE_URL || "/archive/",
  newsUrl: env.NEWS_URL || "/",
});
```
`layout()` 템플릿에서:
- `<link rel="alternate" ... href="/feed.xml" />` → `href="${escapeHtml(site.newsUrl)}feed.xml"`
- `<a href="/"${current === "home" ...}>뉴스레터</a>` → `<a href="${escapeHtml(site.newsUrl)}"${current === "home" ? ' aria-current="page"' : ""}>뉴스레터</a>`
- 푸터 `<a href="/feed.xml">RSS</a>` → `<a href="${escapeHtml(site.newsUrl)}feed.xml">RSS</a>`

Run: `node --test test/render.test.mjs` → Expected: PASS.

- [ ] **Step 6: HPE 도구 대상 D1 변경** — `news/tools/push-vendor-docs.mjs` 16~17행

```js
const DATABASE_ID = "<SPECSHEET_DB_ID>";
const DATABASE_NAME = "specsheet";
```
2~5행 주석의 "운영 D1"은 그대로 둔다.

- [ ] **Step 7: Eleventy 정적 데이터의 기본 링크** — `news/src/_data/site.js`, `archive/src/_data/site.js`의 `archiveUrl` 기본값을 `"https://specsheet.tkddls8848.workers.dev/archive/"`로, `devlogUrl` 기본값이 있으면 `"https://devlog.tkddls8848.workers.dev/devlog/"`로 바꾼다.

- [ ] **Step 8: CI 매트릭스** — `.github/workflows/test.yml`

```yaml
# 두 폴더는 서로 독립된 프로젝트라 각자 의존성과 테스트를 가진다. 하나가
# 깨져도 다른 폴더 결과는 그대로 보여야 하므로 매트릭스로 나눠 돌린다.
```
(4~5행 주석의 "네 폴더"를 "두 폴더"로) 그리고 `folder: [archive, news]`.

- [ ] **Step 9: README 작성**

- `README.md`(루트, 새 파일): 제목 `# specsheet`, 한 문단 소개(뉴스 다이제스트와 벤더 문서 아카이브를 Worker `specsheet`와 D1 `specsheet`로 운영, devlog 저장소에서 2026-10 분리), 폴더 표(`news/` = 운영 Worker 전체, `archive/` = 옛 Eleventy 사이트와 수집기 테스트, `shared/` = 공통 수집기·테마), 매일 돌아가는 일 표(07:00 뉴스, 09:25 아카이브, 09:30 HPE Actions), 비밀값 표(GitHub `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), 작업 회고 링크 `https://devlog.tkddls8848.workers.dev/devlog/`. devlog 저장소 `README.md`의 같은 절 문장을 재사용한다.
- `news/README.md`: 제목을 `# news — Cloudflare Worker \`specsheet\` (뉴스 다이제스트 · 아카이브)`로, 사이트 주소를 specsheet로, "작업 회고" 문장·`devlog*.mjs` 구성 행·`devlog-journal`·`backfill-private` 행·Cron `10 0` 행·`GITHUB_TOKEN` 절·D1 데이터의 `devlog_*` 줄을 삭제하고, D1 이름 `devlog-news` → `specsheet`, `0001~0006` → `0001~0002`로 고친다. Workers Builds watch path에 `archive/src/_data/**`를 더한다.
- `archive/README.md`: 사이트 주소를 `https://specsheet.tkddls8848.workers.dev/archive/`로, "Cloudflare Worker `devlog`"를 "`specsheet`"로.

- [ ] **Step 10: 전체 테스트와 로컬 실행 확인**

```bash
cd /c/Users/tkddl/orca/specsheet/news && npm test && npm run build && npm run db:migrate:local
```
Expected: 모두 PASS, 빌드 성공.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/tkddl/orca/specsheet && git add -A && git commit -q -F - <<'EOF'
specsheet Worker와 D1을 설정하고 문서를 새 저장소 기준으로 고친다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: devlog Worker — 옛 경로 301과 작업 회고 전용 라우팅

작업 위치: `C:\Users\tkddl\orca\devlog`, 브랜치 `specsheet-split`.

**Files:**
- Create: `news/worker/redirects.mjs`, `news/test/redirects.test.mjs`, `news/test/worker-index.test.mjs`
- Modify: `news/worker/index.mjs`(전체 교체)

**Interfaces:**
- Produces: `export const SPECSHEET_ORIGIN = "https://specsheet.tkddls8848.workers.dev"`, `export function movedResponse(url: URL): Response | null` (`redirects.mjs`). `export const DEVLOG_CRON = "10 0 * * *"` (`index.mjs`).

- [ ] **Step 1: 실패하는 리다이렉트 테스트** — `news/test/redirects.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { movedResponse, SPECSHEET_ORIGIN } from "../worker/redirects.mjs";

const at = (path) => movedResponse(new URL(`https://devlog.tkddls8848.workers.dev${path}`));

test("옮긴 경로는 같은 경로·쿼리로 specsheet에 301", () => {
  for (const path of ["/feed.xml", "/feed.xml?utm=x", "/archive", "/archive/", "/archive/?q=dell", "/issues/2026-10-01-news/", "/issues/2026-10-01-news"]) {
    const response = at(path);
    assert.equal(response?.status, 301, path);
    assert.equal(response.headers.get("location"), `${SPECSHEET_ORIGIN}${path}`, path);
  }
});

test("루트는 작업 회고로 301", () => {
  for (const path of ["/", "/?ref=x"]) {
    const response = at(path);
    assert.equal(response?.status, 301);
    assert.equal(response.headers.get("location"), "/devlog/");
  }
});

test("작업 회고와 비슷하지만 옮기지 않는 경로는 그대로 둔다", () => {
  for (const path of ["/devlog/", "/devlog/posts/a/", "/archived", "/issues", "/issues/", "/feed.xml.bak", "/assets/css/main.css", "/healthz"]) {
    assert.equal(at(path), null, path);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/tkddl/orca/devlog/news && node --test test/redirects.test.mjs`
Expected: FAIL — `Cannot find module '../worker/redirects.mjs'`.

- [ ] **Step 3: `news/worker/redirects.mjs` 작성**

```js
// 뉴스와 아카이브는 2026-10에 specsheet Worker로 옮겼다. 옛 링크와 RSS 구독이
// 끊기지 않게 같은 경로·쿼리로 영구 이동시킨다.
export const SPECSHEET_ORIGIN = "https://specsheet.tkddls8848.workers.dev";

const MOVED = [/^\/feed\.xml$/, /^\/archive\/?$/, /^\/archive\/.+/, /^\/issues\/[^/]+\/?$/];

const redirect = (location) =>
  new Response(null, { status: 301, headers: { location, "cache-control": "public, max-age=86400" } });

export function movedResponse(url) {
  if (url.pathname === "/" || url.pathname === "") return redirect("/devlog/");
  if (MOVED.some((pattern) => pattern.test(url.pathname))) return redirect(`${SPECSHEET_ORIGIN}${url.pathname}${url.search}`);
  return null;
}
```

Run: `node --test test/redirects.test.mjs` → Expected: PASS.

- [ ] **Step 4: 실패하는 라우팅·Cron 테스트** — `news/test/worker-index.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import worker, { DEVLOG_CRON } from "../worker/index.mjs";

const fakeDb = () => {
  const statement = {
    bind() { return statement; },
    async first() { return null; },
    async all() { return { results: [] }; },
    async run() { return { meta: { changes: 0 } }; },
  };
  return { prepare: () => statement, batch: async () => [] };
};
const env = () => ({ DB: fakeDb(), ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
const get = (path, method = "GET") => worker.fetch(new Request(`https://devlog.tkddls8848.workers.dev${path}`, { method }), env());

test("옛 뉴스 경로는 GET과 HEAD 모두 301", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await get("/feed.xml?utm=x", method);
    assert.equal(response.status, 301, method);
    assert.equal(response.headers.get("location"), "https://specsheet.tkddls8848.workers.dev/feed.xml?utm=x");
  }
});

test("healthz는 작업 회고 실행 이력만 돌려준다", async () => {
  const health = await (await get("/healthz")).json();
  assert.deepEqual(Object.keys(health).sort(), ["latestDevlogRun", "ok"]);
});

test("작업 회고 목록은 200", async () => {
  assert.equal((await get("/devlog/")).status, 200);
});

test("작업 회고 Cron만 돌리고 옛 뉴스·아카이브 Cron은 건너뛴다", async () => {
  const ran = [];
  const ctx = { waitUntil: (promise) => ran.push(promise.catch(() => {})) };
  for (const cron of ["0 22 * * *", "25 0 * * *"]) await worker.scheduled({ cron, scheduledTime: Date.now() }, env(), ctx);
  assert.equal(ran.length, 0);
  assert.equal(DEVLOG_CRON, "10 0 * * *");
});
```

Run: `node --test test/worker-index.test.mjs` → Expected: FAIL(`DEVLOG_CRON` 없음, `/feed.xml` 200).

- [ ] **Step 5: `news/worker/index.mjs` 전체 교체**

```js
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
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `node tools/export-legacy-archive.mjs && node --test test/redirects.test.mjs test/worker-index.test.mjs`
Expected: PASS. (`export-legacy-archive`는 아직 `repository.mjs`가 legacy 파일을 import하므로 필요. Task 5에서 사라진다.)

- [ ] **Step 7: Commit**

```bash
cd /c/Users/tkddl/orca/devlog && git add news/worker/redirects.mjs news/worker/index.mjs news/test/redirects.test.mjs news/test/worker-index.test.mjs && git commit -q -F - <<'EOF'
옮긴 뉴스·아카이브 경로를 specsheet로 301 이동하고 작업 회고 Cron만 돌린다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: devlog 저장소에서 뉴스·아카이브 코드와 설정 제거

**Files:**
- Delete: `archive/`(폴더 전체), `shared/vendor-collection.mjs`, `vendor-hpe.mjs`, `vendor-netapp.mjs`, `vendor-oracle.mjs`
- Delete: `news/worker/digest.mjs`, `archive.mjs`, `archive-dell.mjs`
- Delete: `news/tools/feeds.mjs`, `rss.mjs`, `sources/`, `feed-check.mjs`, `push-vendor-docs.mjs`, `export-legacy-archive.mjs`
- Delete: `news/test/sources.test.mjs`, `worker-archive.test.mjs`, `worker-digest.test.mjs`
- Delete: `.github/workflows/hpe-archive.yml`
- Modify: `news/worker/repository.mjs`, `news/worker/render.mjs`, `news/test/render.test.mjs`, `news/wrangler.jsonc`, `news/package.json`, `news/src/_data/site.js`, `devlog/src/_data/site.js`, `news/src/404.njk`, `.github/workflows/test.yml`, `README.md`, `news/README.md`, `devlog/README.md`

**Interfaces:**
- Consumes: Task 4의 `index.mjs`(뉴스·아카이브 렌더러를 import하지 않음).
- Produces: `createStore(db)`는 devlog 메서드만. `siteFromEnv(env).newsUrl`.

- [ ] **Step 1: 파일 삭제**

```bash
cd /c/Users/tkddl/orca/devlog
git rm -rq archive shared/vendor-collection.mjs shared/vendor-hpe.mjs shared/vendor-netapp.mjs shared/vendor-oracle.mjs \
  news/worker/digest.mjs news/worker/archive.mjs news/worker/archive-dell.mjs \
  news/tools/feeds.mjs news/tools/rss.mjs news/tools/sources news/tools/feed-check.mjs news/tools/push-vendor-docs.mjs news/tools/export-legacy-archive.mjs \
  news/test/sources.test.mjs news/test/worker-archive.test.mjs news/test/worker-digest.test.mjs \
  .github/workflows/hpe-archive.yml
rm -rf news/worker/generated
```

- [ ] **Step 2: `news/worker/repository.mjs` 정리**

- 1~2행 import 삭제: `import legacyArchive from "./generated/legacy-archive.mjs";`, `import { normalizeUrl } from "../tools/rss.mjs";`
- `flattenEntries` 상수 삭제.
- `createStore` 안에서 `ensureLegacyArchive`, `publishedLinks`, `nextSlug`, `saveIssue`, `saveRun`, `listIssues`, `getIssue`, `latestRun`, `saveVendorDocuments`, `listDellDocumentUrls`, `listVendorDocuments`, `latestArchiveRun`, `saveArchiveRun` 삭제. 첫 메서드가 `listDevlogPage`가 된다.
- `chunks`가 남은 메서드에서 쓰이는지 확인하고, 안 쓰이면 삭제:

```bash
cd news && grep -n "chunks\|normalizeUrl\|legacyArchive\|vendor_documents\|issues\b" worker/repository.mjs
```
Expected: `chunks` 정의만 남으면 정의도 지운다. 그 외 출력 없음.

- [ ] **Step 3: `news/worker/render.mjs` 정리**

- `renderHome`, `sourceItem`, `issueSources`, `renderIssue`, `renderArchive`, `escapeXml`, `renderFeed` 삭제.
- `CLOCK`이 남은 코드에서 안 쓰이면 삭제(`grep -n CLOCK worker/render.mjs`).
- `siteFromEnv`를 다음으로:

```js
const siteFromEnv = (env) => ({
  title: "devlog news",
  tagline: "IT 업계 뉴스와 엔지니어링 블로그를 하루 한 편으로 묶는 뉴스레터",
  githubUser: "tkddls8848",
  devlogUrl: env.DEVLOG_URL || "/devlog/",
  archiveUrl: env.ARCHIVE_URL || "https://specsheet.tkddls8848.workers.dev/archive/",
  newsUrl: env.NEWS_URL || "https://specsheet.tkddls8848.workers.dev/",
});
```
- `layout()`의 RSS `<link rel="alternate">`, 내비 "뉴스레터", 푸터 RSS를 Task 3 Step 5와 같게 `site.newsUrl` 기준으로 바꾼다:
  - `href="${escapeHtml(site.newsUrl)}feed.xml"`(alternate 링크와 푸터)
  - `<a href="${escapeHtml(site.newsUrl)}"${current === "home" ? ' aria-current="page"' : ""}>뉴스레터</a>`
- `renderNotFound`를 작업 회고 기준으로:

```js
export function renderNotFound(env) {
  return layout({
    env,
    title: "찾을 수 없는 주소",
    current: "devlog",
    content: '<p class="page-intro">이 주소에 해당하는 글이 없습니다. <a href="/devlog/">개발 기록 목록</a>에서 찾아보세요.</p>',
  });
}
```
- `news/src/404.njk` 본문도 같은 문구로: `이 주소에 해당하는 글이 없습니다. <a href="{{ '/devlog/' | url }}">개발 기록 목록</a>에서 찾아보세요.`

- [ ] **Step 4: `news/test/render.test.mjs` 정리와 내비 테스트**

- 3행 import를 `import { markdownToHtml, renderDevlogHome, renderDevlogPost, renderNotFound } from "../worker/render.mjs";`로.
- 테스트 "동적 페이지는 외부 제목과 요약을 HTML escape한다", "이슈 페이지와 RSS가 D1 행을 렌더링한다", "아카이브는 벤더 아이콘과 선택 필터를 렌더링한다", "뉴스 본문의 [n] 출처 번호는 …" 네 개 삭제.
- 끝에 추가:

```js
test("내비게이션의 뉴스레터·아카이브·RSS는 specsheet 주소로 간다", () => {
  const html = renderNotFound({});
  assert.match(html, /<a href="https:\/\/specsheet\.tkddls8848\.workers\.dev\/">뉴스레터<\/a>/);
  assert.match(html, /<a href="https:\/\/specsheet\.tkddls8848\.workers\.dev\/archive\/">아카이브<\/a>/);
  assert.match(html, /href="https:\/\/specsheet\.tkddls8848\.workers\.dev\/feed\.xml"/);
  assert.match(html, /개발 기록 목록/);
});
```

- [ ] **Step 5: `news/wrangler.jsonc`** — 다음 키만 바꾼다

```jsonc
  // 매일 09:10 KST 작업 기록. 뉴스·아카이브 Cron은 specsheet Worker로 옮겼다. Cron Trigger는 UTC 기준이다.
  "triggers": {
    "crons": ["10 0 * * *"]
  },
```
```jsonc
  "vars": {
    "DEVLOG_URL": "https://devlog.tkddls8848.workers.dev/devlog/",
    "ARCHIVE_URL": "https://specsheet.tkddls8848.workers.dev/archive/",
    "NEWS_URL": "https://specsheet.tkddls8848.workers.dev/"
  },
```
`run_worker_first`는 그대로 둔다(옛 경로 요청이 Worker의 301 처리에 닿아야 한다). 주석 "HTML과 RSS는 D1에서 동적으로 만들고"는 "작업 회고 HTML과 옮긴 경로의 301은 Worker가 만들고"로.

- [ ] **Step 6: `news/package.json`**

- `"build": "node tools/export-legacy-archive.mjs && eleventy"` → `"build": "eleventy"`
- `"feeds:check": ...` 줄 삭제.

- [ ] **Step 7: Eleventy 데이터와 CI**

- `news/src/_data/site.js`, `devlog/src/_data/site.js`: `archiveUrl` 기본값 → `"https://specsheet.tkddls8848.workers.dev/archive/"`.
- `.github/workflows/test.yml`: `folder: [devlog, news, video]`, 주석의 "네 폴더"는 "세 폴더"로.

- [ ] **Step 8: 남은 참조 확인**

```bash
cd /c/Users/tkddl/orca/devlog && grep -rn "vendor-\|tools/rss\|tools/feeds\|runDigest\|runArchive\|renderArchive\|renderIssue\|legacy-archive\|push-vendor-docs" --include=*.mjs --include=*.js --include=*.json --include=*.yml --exclude-dir=node_modules --exclude=package-lock.json news devlog video shared .github
```
Expected: 출력 없음.

- [ ] **Step 9: README 갱신**

- 루트 `README.md`: 첫 문단을 "작업 회고와 영상 제작 도구. 뉴스 다이제스트와 벤더 문서 아카이브는 2026-10에 [specsheet](https://github.com/tkddls8848/specsheet) 저장소로 옮겼다."로. 폴더 표에서 `archive/` 행 삭제, `news/` 행 설명을 "작업 회고 Worker `devlog` 코드 전체(폴더 이름은 Workers Builds 설정 때문에 유지)"로. 매일 돌아가는 일 표는 09:10 행만. GitHub Actions 목록에서 `hpe-archive.yml` 삭제. 비밀값 표에서 `CLOUDFLARE_API_TOKEN` 행 삭제. 로컬 실행에서 `archive` 줄 삭제.
- `news/README.md`: 제목 `# news — Cloudflare Worker \`devlog\` (작업 회고)`. "뉴스 다이제스트 실행 구조", "벤더 문서 수집 진단" 절 삭제, 구성 목록에서 digest·archive·feeds·rss·hackernews·push-vendor-docs·export-legacy-archive 행 삭제, Cron은 `10 0`만, vars는 `DEVLOG_URL`, `ARCHIVE_URL`, `NEWS_URL`만, D1 데이터 절은 `devlog_*`만 남기고 "옛 경로(`/`, `/issues/*`, `/feed.xml`, `/archive*`)는 specsheet로 301" 한 줄 추가. Build watch path에서 `shared/**`는 유지.
- `devlog/README.md`: 아카이브·뉴스 링크가 있으면 specsheet 주소로.

- [ ] **Step 10: 전체 테스트**

```bash
cd /c/Users/tkddl/orca/devlog/news && npm test && npm run build
cd ../devlog && npm test
cd ../video && npm test
```
Expected: 모두 PASS(`news`는 이제 `export-legacy-archive` 없이 통과), 빌드 성공.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/tkddl/orca/devlog && git add -A && git commit -q -F - <<'EOF'
뉴스·아카이브 코드와 설정을 걷어 내고 작업 회고만 남긴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: 데이터 이관(전환 시간대 KST 10:00~06:30)

이 Task는 운영 데이터에 쓰므로 실행 직전 사용자 확인을 받는다. 작업 파일은 스크래치패드 폴더 `$SCRATCH/d1-export/`에 둔다(`$SCRATCH` = 세션 스크래치패드 경로).

**Files:** 저장소 변경 없음.

**Interfaces:**
- Consumes: Task 3의 D1 `specsheet`(스키마만 있음), Task 2·3의 specsheet 코드.
- Produces: 데이터가 채워진 D1 `specsheet`, Cron 없이 배포된 Worker `specsheet`.

- [ ] **Step 1: specsheet Worker 첫 배포(Cron 없음)**

```bash
cd /c/Users/tkddl/orca/specsheet/news && npm run deploy
curl -s https://specsheet.tkddls8848.workers.dev/healthz
```
Expected: `{"ok":true,"latestRun":null,"latestArchiveRun":null}`.

주의: 첫 요청에서 `ensureLegacyArchive`가 빈 `metadata`를 보고 legacy 문서 624건을 `vendor_documents`에 넣는다. 다음 Step 3에서 지우고 원본으로 채운다.

- [ ] **Step 2: 원본에서 테이블별 export**

```bash
mkdir -p "$SCRATCH/d1-export" && cd /c/Users/tkddl/orca/devlog/news
for t in issues entries collection_runs vendor_documents archive_runs metadata; do
  node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js d1 export devlog-news --remote --no-schema --table "$t" --output "$SCRATCH/d1-export/$t.sql" || break
done
ls -l "$SCRATCH/d1-export"
```
Expected: 6개 파일, 각각 `INSERT INTO` 문 포함.

- [ ] **Step 3: 대상 비우기와 import(외래 키 순서)**

```bash
cd /c/Users/tkddl/orca/specsheet/news
W="node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js"
$W d1 execute specsheet --remote --command "DELETE FROM entries; DELETE FROM collection_runs; DELETE FROM issues; DELETE FROM archive_runs; DELETE FROM vendor_documents; DELETE FROM metadata; DELETE FROM sqlite_sequence;"
for t in issues entries collection_runs vendor_documents archive_runs metadata; do
  $W d1 execute specsheet --remote --yes --file "$SCRATCH/d1-export/$t.sql" || break
done
```
Expected: 각 파일 실행 성공. 실패하면 멈추고 원인(대개 export 파일의 `CREATE TABLE`이나 외래 키 순서)을 확인한다. 원본은 건드리지 않았으므로 Step 3부터 다시 하면 된다.

- [ ] **Step 4: 행 수와 최신값 비교**

```bash
Q="SELECT 'issues' t, count(*) n, max(published_at) latest FROM issues UNION ALL SELECT 'entries', count(*), max(id) FROM entries UNION ALL SELECT 'collection_runs', count(*), max(started_at) FROM collection_runs UNION ALL SELECT 'vendor_documents', count(*), max(document_date) FROM vendor_documents UNION ALL SELECT 'archive_runs', count(*), max(started_at) FROM archive_runs UNION ALL SELECT 'metadata', count(*), max(key) FROM metadata"
(cd /c/Users/tkddl/orca/devlog/news && node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute devlog-news --remote --json --command "$Q") > "$SCRATCH/d1-export/source.json"
$W d1 execute specsheet --remote --json --command "$Q" > "$SCRATCH/d1-export/target.json"
node -e 'const r=f=>JSON.stringify(require(f)[0].results);const a=r(process.argv[1]),b=r(process.argv[2]);console.log(a);console.log(a===b?"MATCH":"MISMATCH");process.exit(a===b?0:1)' "$SCRATCH/d1-export/source.json" "$SCRATCH/d1-export/target.json"
```
Expected: `MATCH`(`entries.id`는 export에 그대로 들어가므로 최대값도 같아야 한다). MISMATCH면 Task 7로 가지 않는다.

- [ ] **Step 5: 화면 비교**

```bash
for p in / /archive/ /feed.xml /healthz; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://specsheet.tkddls8848.workers.dev$p"; done
SLUG=$(curl -s https://specsheet.tkddls8848.workers.dev/feed.xml | grep -o '/issues/[^/<]*/' | head -1)
curl -s -o /dev/null -w "%{http_code}\n" "https://specsheet.tkddls8848.workers.dev$SLUG"
diff <(curl -s https://devlog.tkddls8848.workers.dev/feed.xml | sed 's#https://[^/]*##g') <(curl -s https://specsheet.tkddls8848.workers.dev/feed.xml | sed 's#https://[^/]*##g') && echo FEED-SAME
```
Expected: 모두 200, `FEED-SAME`.

---

### Task 7: 동시 전환과 첫 실행 확인

**사용자가 먼저 할 일:**
1. GitHub `tkddls8848/specsheet` → Settings → Secrets → Actions에 `CLOUDFLARE_API_TOKEN`(D1 편집), `CLOUDFLARE_ACCOUNT_ID` 등록(devlog 저장소와 같은 값).
2. Cloudflare 대시보드 `specsheet → Settings → Builds`에서 저장소 `tkddls8848/specsheet` 연결: Root directory `news`, Build `npm ci && npm run build`, Deploy `npx wrangler deploy`, branch `main`, watch path `news/**`, `shared/**`, `archive/src/_data/**`.

**Files:**
- Modify: specsheet `news/wrangler.jsonc`(Cron 활성화)

- [ ] **Step 1: specsheet Cron 활성화**

`news/wrangler.jsonc`의 `triggers`를:

```jsonc
  // 매일 07:00 KST 뉴스, 09:25 KST 아카이브. Cron Trigger는 UTC 기준이다.
  "triggers": {
    "crons": ["0 22 * * *", "25 0 * * *"]
  },
```

```bash
cd /c/Users/tkddl/orca/specsheet && git add news/wrangler.jsonc && git commit -q -F - <<'EOF'
뉴스·아카이브 Cron을 켠다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 2: devlog 브랜치를 main에 병합**

사용자 확인 후:

```bash
cd /c/Users/tkddl/orca/devlog && git switch main && git merge --ff-only specsheet-split
```

- [ ] **Step 3: 두 저장소 push(같은 시간대 안에서 연속으로)**

```bash
cd /c/Users/tkddl/orca/devlog && git push origin main
cd /c/Users/tkddl/orca/specsheet && git push -u origin main
```
Expected: 두 Workers Builds가 각각 성공(대시보드 Build history 확인).

- [ ] **Step 4: 배포 확인**

```bash
for p in "/" "/feed.xml?utm=x" "/archive" "/archive/?q=dell" "/issues/x/"; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://devlog.tkddls8848.workers.dev$p"; done
curl -s -o /dev/null -w "%{http_code}\n" https://devlog.tkddls8848.workers.dev/devlog/
curl -s https://devlog.tkddls8848.workers.dev/healthz
curl -s https://specsheet.tkddls8848.workers.dev/healthz
```
Expected: `/`는 `301 .../devlog/`, 나머지 네 개는 `301 https://specsheet.tkddls8848.workers.dev<같은 경로·쿼리>`, `/devlog/` 200, devlog healthz는 `latestDevlogRun`만, specsheet healthz는 이관된 최신 실행.
Cloudflare 대시보드에서 `devlog` Worker의 Triggers가 `10 0 * * *` 하나, `specsheet`는 두 개인지 확인한다.

- [ ] **Step 5: HPE 워크플로 수동 실행**

```bash
gh workflow run hpe-archive.yml -R tkddls8848/specsheet && sleep 5 && gh run list -R tkddls8848/specsheet --workflow hpe-archive.yml -L 1
```
Expected: 실행 성공. 실패하면 secret 이름과 토큰 권한을 확인한다.

- [ ] **Step 6: 다음 날 확인(07:00, 09:10, 09:25, 09:30 이후)**

```bash
curl -s https://specsheet.tkddls8848.workers.dev/healthz
curl -s https://devlog.tkddls8848.workers.dev/healthz
gh run list -R tkddls8848/specsheet --workflow hpe-archive.yml -L 1
```
Expected: specsheet `latestRun.started_at`과 `latestArchiveRun.started_at`이 당일, devlog `latestDevlogRun`이 당일, HPE 실행 성공.

되돌리기(문제 시): devlog `git revert`로 Task 4·5 커밋을 되돌려 push, specsheet `wrangler.jsonc` Cron을 `[]`로 되돌려 push. specsheet에 새로 쌓인 행은 Task 6 Step 2~3을 방향만 바꿔 옮긴다.

---

### Task 8: 옛 테이블 정리(전환 후 7일 이상, 정상 확인 뒤)

**Files:**
- Create: devlog `news/migrations/0007_drop_news_archive.sql`

- [ ] **Step 1: 7일간 specsheet 실행 이력 확인**

```bash
cd /c/Users/tkddl/orca/specsheet/news && node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute specsheet --remote --command "SELECT substr(started_at,1,10) day, status FROM collection_runs ORDER BY started_at DESC LIMIT 7"
```
Expected: 7일치가 `success` 또는 `partial`. 아니면 중단.

- [ ] **Step 2: migration 작성** — `news/migrations/0007_drop_news_archive.sql`

```sql
-- 뉴스·아카이브는 2026-10에 specsheet 저장소의 D1 `specsheet`로 옮겼다.
-- 외래 키가 issues를 가리키므로 자식 테이블부터 지운다.
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS collection_runs;
DROP TABLE IF EXISTS issues;
DROP TABLE IF EXISTS archive_runs;
DROP TABLE IF EXISTS vendor_documents;
DROP TABLE IF EXISTS metadata;
```

- [ ] **Step 3: 로컬 적용과 테스트**

```bash
cd /c/Users/tkddl/orca/devlog/news && npm run db:migrate:local && npm test
```
Expected: 적용 성공, 테스트 PASS.

- [ ] **Step 4: 사용자 확인 후 원격 적용**

```bash
npm run db:migrate:remote
node ../shared/run-with-env.mjs node_modules/wrangler/bin/wrangler.js d1 execute devlog-news --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```
Expected: `d1_migrations`, `devlog_*`, `sqlite_sequence`만 남는다.

- [ ] **Step 5: Commit, push, secret 정리**

```bash
cd /c/Users/tkddl/orca/devlog && git add news/migrations/0007_drop_news_archive.sql && git commit -q -F - <<'EOF'
specsheet로 옮긴 뉴스·아카이브 테이블을 devlog-news에서 지운다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push origin main
gh secret delete CLOUDFLARE_API_TOKEN -R tkddls8848/devlog
gh secret delete CLOUDFLARE_ACCOUNT_ID -R tkddls8848/devlog
```
