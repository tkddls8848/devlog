import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// push-digest.mjs는 export가 없는 실행 스크립트다. 임시 작업 폴더에서 하위
// 프로세스로 돌리고 fetch만 스텁해, 파일로 남는 결과까지 실제 경로로 확인한다.
const SCRIPT = fileURLToPath(new URL("../tools/push-digest.mjs", import.meta.url));
const BLOG_REPO = "tkddls8848/devlog";

const STUB = `
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(process.env.DIGEST_FIXTURE, "utf8"));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

globalThis.fetch = async (url) => {
  const target = String(url);

  if (target.includes("/events/public")) {
    const page = Number(new URL(target).searchParams.get("page"));
    return json(fixture.pages[page - 1] ?? []);
  }

  const at = target.indexOf("/compare/");
  if (at >= 0) {
    const canned = fixture.compare[target.slice(at + 9)];
    if (!canned) return json({ message: "Not Found" }, 404);
    if (canned.status) return json({ message: "비교 불가" }, canned.status);
    return json({ commits: canned });
  }

  if (target.includes("api.cloudflare.com")) {
    if (fixture.ai.status !== 200) return json({ success: false, errors: [] }, fixture.ai.status);
    return json({ success: true, result: { response: fixture.ai.text } });
  }

  throw new Error("예상치 못한 요청: " + target);
};
`;

const sha = (char) => char.repeat(40);

const pushEvent = ({
  id = "1",
  repo,
  ref = "refs/heads/main",
  before = sha("a"),
  head = sha("b"),
  commits = [],
  createdAt = "2026-08-15T02:00:00Z",
  distinctSize,
}) => ({
  id,
  type: "PushEvent",
  repo: { name: repo },
  created_at: createdAt,
  payload: {
    ref,
    before,
    head,
    commits,
    distinct_size: distinctSize ?? commits.length,
  },
});

// compare API가 돌려주는 커밋 모양. 이벤트 payload의 커밋과 형태가 달라
// 정규화 경로가 둘 다 있다.
const apiCommit = ({ sha, message, name = "사람", date = "2026-08-15T02:00:00Z", parents = 1 }) => ({
  sha,
  commit: { message, author: { name, date } },
  parents: Array.from({ length: parents }, () => ({ sha: "p" })),
});

function run({ pages = [], compare = {}, ai = { status: 200, text: "" }, posts = {}, args = [] }) {
  const dir = mkdtempSync(path.join(tmpdir(), "push-digest-"));
  const fixture = path.join(dir, "fixture.json");
  const stub = path.join(dir, "stub.mjs");

  writeFileSync(fixture, JSON.stringify({ pages, compare, ai }), "utf8");
  writeFileSync(stub, STUB, "utf8");

  if (Object.keys(posts).length) {
    mkdirSync(path.join(dir, "src/posts"), { recursive: true });
    for (const [name, body] of Object.entries(posts)) {
      writeFileSync(path.join(dir, "src/posts", name), body, "utf8");
    }
  }

  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(stub).href, SCRIPT, ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        DIGEST_FIXTURE: fixture,
        GITHUB_REPOSITORY: BLOG_REPO,
        GH_TOKEN: "test-token",
        CF_ACCOUNT_ID: "account",
        CF_API_TOKEN: "token",
      },
    }
  );

  const postsDir = path.join(dir, "src/posts");
  const written = existsSync(postsDir) ? readdirSync(postsDir).sort() : [];
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    files: written.filter((name) => !(name in posts)),
    all: written,
    read: (name) => readFileSync(path.join(postsDir, name), "utf8"),
    state: () => JSON.parse(readFileSync(path.join(dir, ".state/last-seen.json"), "utf8")),
    hasState: () => existsSync(path.join(dir, ".state/last-seen.json")),
  };
}

const draft = "TITLE: 하루 기록\nSUMMARY: 한 줄 요약\n\n본문 문단";

test("새 커밋이 없으면 아무 파일도 쓰지 않는다", () => {
  const result = run({ pages: [[]] });
  assert.equal(result.status, 0);
  assert.match(result.output, /새 커밋이 없습니다/);
  assert.deepEqual(result.files, []);
  assert.equal(result.hasState(), false, "쓸 글이 없으면 상태도 남기지 않는다");
});

test("main·master·dev 밖의 푸시와 이 저장소 자신의 푸시를 거른다", () => {
  const result = run({
    pages: [
      [
        pushEvent({ id: "1", repo: "tkddls8848/other", ref: "refs/heads/feature/x", head: sha("1") }),
        pushEvent({ id: "2", repo: BLOG_REPO, head: sha("2") }),
        // 새로 만든 브랜치는 before가 0으로 채워져 비교할 지점이 없다.
        pushEvent({ id: "3", repo: "tkddls8848/other", before: "0".repeat(40), head: sha("3") }),
        pushEvent({ id: "4", repo: "tkddls8848/keep", ref: "refs/heads/dev", head: sha("4") }),
      ],
    ],
    compare: {
      [`${sha("a")}...${sha("4")}`]: [apiCommit({ sha: sha("d"), message: "dev 브랜치 작업" })],
    },
    ai: { status: 200, text: draft },
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /대상 푸시 1건/);
  assert.equal(result.files.length, 1);
  assert.match(result.read(result.files[0]), /tkddls8848\/keep/);
});

test("병합·봇·잡음 커밋을 뺀다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [
        apiCommit({ sha: sha("1"), message: "남는 커밋" }),
        apiCommit({ sha: sha("2"), message: "Merge pull request #3 from x" }),
        apiCommit({ sha: sha("3"), message: "브랜치 합침", parents: 2 }),
        apiCommit({ sha: sha("4"), message: "chore(deps): bump lib" }),
        apiCommit({ sha: sha("5"), message: "Revert \"기능\"" }),
        apiCommit({ sha: sha("6"), message: "wip" }),
        apiCommit({ sha: sha("7"), message: "문서 갱신 [skip ci]" }),
        apiCommit({ sha: sha("8"), message: "의존성 갱신", name: "dependabot[bot]" }),
        apiCommit({ sha: sha("9"), message: "", parents: 1 }),
      ],
    },
    ai: { status: 200, text: draft },
  });

  assert.match(result.output, /새 커밋 1건/);
  const body = result.read(result.files[0]);
  assert.match(body, /남는 커밋/);
  for (const dropped of ["Merge pull", "브랜치 합침", "bump lib", "Revert", "wip", "skip ci", "의존성 갱신"]) {
    assert.ok(!body.includes(dropped), `${dropped}은 빠져야 한다`);
  }
});

test("이미 발행한 SHA는 다시 쓰지 않는다", () => {
  const published = sha("1");
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [apiCommit({ sha: published, message: "이미 쓴 커밋" })],
    },
    posts: {
      "2026-08-14-devlog.md": [
        "---",
        'title: "지난 글"',
        "date: 2026-08-14",
        "commits:",
        '  - repo: "tkddls8848/app"',
        "    items:",
        `      - sha: "${published}"`,
        '        message: "이미 쓴 커밋"',
        "---",
        "",
        "본문",
        "",
      ].join("\n"),
    },
    ai: { status: 200, text: draft },
  });

  assert.match(result.output, /기존 커밋 1건, 새 커밋 0건/);
  assert.deepEqual(result.files, []);
});

test("커밋 작성일을 KST로 묶어 날짜별로 나눈다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [
        // KST로 각각 8월 15일 23:59, 8월 16일 00:00이다.
        apiCommit({ sha: sha("1"), message: "밤늦은 커밋", date: "2026-08-15T14:59:59Z" }),
        apiCommit({ sha: sha("2"), message: "자정 넘긴 커밋", date: "2026-08-15T15:00:00Z" }),
      ],
    },
    ai: { status: 200, text: draft },
  });

  assert.deepEqual(result.files, ["2026-08-15-devlog.md", "2026-08-16-devlog.md"]);
  assert.match(result.read("2026-08-15-devlog.md"), /밤늦은 커밋/);
  assert.match(result.read("2026-08-16-devlog.md"), /자정 넘긴 커밋/);
});

test("같은 날 글이 이미 있으면 이름을 비켜 쓴다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [
        apiCommit({ sha: sha("1"), message: "새 커밋", date: "2026-08-15T02:00:00Z" }),
      ],
    },
    posts: { "2026-08-15-devlog.md": "---\ntitle: \"먼저 쓴 글\"\ndate: 2026-08-15\n---\n\n본문\n" },
    ai: { status: 200, text: draft },
  });

  assert.deepEqual(result.files, ["2026-08-15-devlog-2.md"], "기존 글을 덮어쓰면 안 된다");
  assert.match(result.read("2026-08-15-devlog.md"), /먼저 쓴 글/);
});

test("AI가 실패하면 커밋 목록으로 된 기본 본문을 남긴다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [
        apiCommit({ sha: sha("1"), message: "수집기 정리" }),
        apiCommit({ sha: sha("2"), message: "테스트 추가" }),
      ],
    },
    ai: { status: 500 },
  });

  assert.equal(result.status, 0, "AI가 죽어도 기록은 남긴다");
  assert.match(result.output, /AI 요약 실패/);
  const body = result.read(result.files[0]);
  assert.match(body, /aiGenerated: false/);
  assert.match(body, /summary: "1개 저장소의 커밋 2건을 기록했습니다\."/);
  assert.match(body, /## tkddls8848\/app/);
  assert.match(body, /- 수집기 정리/);
  assert.match(body, /- 테스트 추가/);
});

test("AI가 성공하면 초안과 함께 aiGenerated를 참으로 남긴다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [apiCommit({ sha: sha("1"), message: "기능 추가" })],
    },
    ai: { status: 200, text: draft },
  });

  const body = result.read(result.files[0]);
  assert.match(body, /title: "하루 기록"/);
  assert.match(body, /summary: "한 줄 요약"/);
  assert.match(body, /aiGenerated: true/);
  assert.match(body, /\n본문 문단\n/);
});

test("프론트매터에 들어가는 커밋 메시지를 이스케이프한다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [
        apiCommit({ sha: sha("1"), message: '"큰따옴표"와 역슬래시 \\ 를 쓴 메시지' }),
      ],
    },
    ai: { status: 200, text: draft },
  });

  assert.match(
    result.read(result.files[0]),
    /message: "\\"큰따옴표\\"와 역슬래시 \\\\ 를 쓴 메시지"/
  );
});

test("compare가 실패하면 이벤트 payload로 복구하고 경고한다", () => {
  const result = run({
    pages: [
      [
        pushEvent({
          repo: "tkddls8848/app",
          head: sha("b"),
          commits: [{ sha: sha("1"), message: "payload에만 있는 커밋" }],
        }),
      ],
    ],
    compare: { [`${sha("a")}...${sha("b")}`]: { status: 500 } },
    ai: { status: 200, text: draft },
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /비교 실패, 이벤트 내 커밋으로 복구합니다/);
  assert.match(result.read(result.files[0]), /payload에만 있는 커밋/);
});

test("드라이런은 요약만 찍고 파일을 쓰지 않는다", () => {
  const result = run({
    pages: [[pushEvent({ repo: "tkddls8848/app", head: sha("b") })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [apiCommit({ sha: sha("1"), message: "새 커밋" })],
    },
    ai: { status: 200, text: draft },
    args: ["--dry-run"],
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /드라이런이므로 파일을 저장하지 않았습니다/);
  assert.deepEqual(result.all, []);
  assert.equal(result.hasState(), false);
});

test("글을 쓴 뒤 마지막 조회 상태를 남긴다", () => {
  const result = run({
    pages: [
      [
        pushEvent({ id: "42", repo: "tkddls8848/app", head: sha("b"), createdAt: "2026-08-15T02:00:00Z" }),
      ],
    ],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [apiCommit({ sha: sha("1"), message: "새 커밋" })],
    },
    ai: { status: 200, text: draft },
  });

  const state = result.state();
  assert.equal(state.newestEventId, "42");
  assert.equal(state.newestEventAt, "2026-08-15T02:00:00Z");
  assert.equal(state.pagesScanned, 1);
  assert.match(state.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("같은 푸시가 여러 이벤트로 와도 한 번만 센다", () => {
  const duplicate = {
    repo: "tkddls8848/app",
    head: sha("b"),
    createdAt: "2026-08-15T02:00:00Z",
  };
  const result = run({
    pages: [[pushEvent({ id: "1", ...duplicate }), pushEvent({ id: "2", ...duplicate })]],
    compare: {
      [`${sha("a")}...${sha("b")}`]: [apiCommit({ sha: sha("1"), message: "한 번만 남을 커밋" })],
    },
    ai: { status: 200, text: draft },
  });

  assert.match(result.output, /대상 푸시 1건/);
  assert.equal(result.files.length, 1);
  assert.equal(result.read(result.files[0]).match(/- sha:/g).length, 1);
});
