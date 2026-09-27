# devlog

Eleventy 사이트 세 개와 영상 제작 도구를 한 저장소에 담고 있습니다.
각 폴더는 `package.json`, 빌드, 수집기를 가지며 공통 코드와 설정은 최상위에서 관리합니다.

환경변수 파일은 **저장소 최상위 `.env` 하나만** 사용합니다. 최초 설정 시 `.env.example`을
`.env`로 복사하고, 이후 모든 키와 로컬 옵션을 이 파일에 추가합니다. 하위 폴더에는
`.env`나 `.dev.vars`를 만들지 않습니다. 파일은 Git에서 제외되며 예시 파일만 커밋합니다.
Node 도구와 빌드는 실행 위치와 관계없이 `shared/env.mjs`를 통해 같은 파일을 읽습니다.
셸·CI 환경변수가 파일 값보다 우선합니다. `news`의 npm 배포·DB 명령도 같은 설정을 읽습니다.
운영 Worker의 비밀값은 Cloudflare Secrets에 저장되며, 로컬 `.env` 전체를 자동 업로드하지 않습니다.

| 폴더 | 사이트 | 하는 일 |
| --- | --- | --- |
| [`devlog/`](devlog/) | <https://devlog.tkddls8848.workers.dev/devlog/> | 그날의 커밋을 참고해 직접 쓰는 작업 회고 |
| [`archive/`](archive/) | <https://devlog.tkddls8848.workers.dev/archive/> | IBM·Lenovo·HPE·Dell·NetApp·Oracle 제품 문서 갱신을 목록으로 축적 |
| [`news/`](news/) | <https://devlog.tkddls8848.workers.dev/> | IT 업계 뉴스·블로그의 하루치 소식을 뉴스레터로 발행 |
| [`video/`](video/) | YouTube | 발행한 개발 일지를 저장소별 세션과 시리즈 회차를 가진 영상으로 만들어 올림 |

세 사이트는 서로를 내비게이션 링크로만 가리킵니다. 링크 주소는 각 폴더의
`src/_data/site.js`에 있고 환경 변수(`DEVLOG_URL`, `ARCHIVE_URL`, `NEWS_URL`)로
덮어쓸 수 있습니다.

세 서비스 모두 Cloudflare Worker `devlog`에서 제공하며 운영 데이터는 D1에 저장합니다.
`video/`는 사이트가 아니라 로컬에서 Claude Code 스킬 `/devlog-video`로 실행하는 영상 제작
워크플로입니다. Artlist MCP(Seedance 2.5, 보이스오버, 음악)와 ffmpeg, YouTube Data API를 씁니다.

## 워크플로

```text
.github/workflows/test.yml              네 폴더의 테스트를 각각 실행
news/worker/index.mjs                   Cloudflare Cron으로 news·devlog·archive 수집·발행·서비스
.claude/skills/devlog-video/SKILL.md    개발 일지 한 편을 유튜브 회차로 만드는 Claude Code 스킬
```

Cloudflare Workers Builds가 소스 변경을 배포하고, 세 Cron Trigger가 매일 수집하며,
Workers AI가 뉴스레터 본문과 개발 기록의 참고 자료를 만들고 D1이 게시물·원문·실행 이력을
저장합니다. 발행 결과는 GitHub에 커밋하지 않습니다.

테스트는 `main` 푸시와 풀 리퀘스트에서 폴더별로 돕니다. 네트워크와 비밀값 없이
돌도록 만들어져 있어 수집 워크플로와 무관하게 언제든 실행할 수 있습니다.
`deploy.yml`은 테스트와 README만 바뀐 푸시에서는 돌지 않습니다. 산출물이 그대로인
빌드를 다시 올릴 이유가 없기 때문이며, 산출물과 관련된 파일이 하나라도 섞이면
그대로 배포합니다.

## 설정

Workers AI와 D1은 Worker binding을 사용하므로 GitHub Actions secret이 필요하지 않습니다.
개발일지 수집용 `GITHUB_TOKEN`은 GitHub Actions가 아니라 Cloudflare Worker secret으로
등록합니다. 값은 공개 저장소 읽기 전용 GitHub fine-grained token입니다.

Actions variables로 `CF_AI_MODEL`(개발 일지), `IBM_REGION`(아카이브)을 바꿀 수
있습니다. 뉴스레터의 AI·D1은 Worker binding이므로 GitHub secret을 사용하지 않고,
실행 설정은 `news/wrangler.jsonc`에서 관리합니다.

`NEWS_URL` variable에는 Worker의 실제 주소를 넣습니다. `workers.dev` 하위 도메인은
계정마다 다르고 사용자 지정 도메인을 붙이면 또 바뀌므로, 비워 두면 개발 일지와
아카이브의 뉴스레터 링크가 `src/_data/site.js`의 기본값
`https://devlog.tkddls8848.workers.dev/`로 나갑니다. `DEVLOG_URL`,
`ARCHIVE_URL`은 뉴스 Worker의 Wrangler 변수로 관리합니다.

Settings → Pages의 Source는 `GitHub Actions`, Settings → Actions의 Workflow
permissions는 `Read and write permissions`로 설정합니다. 뉴스레터의 D1 생성과
Workers Builds 설정은 [`news/README.md`](news/README.md)의 최초 배포 절차를 따릅니다.

## 로컬 실행

저장소 루트에는 `package.json`이 없습니다. 작업할 폴더로 들어가서 실행합니다.

```bash
cd devlog && npm install && npm run dev
cd archive && npm install && npm run dev
cd news && npm install && npm run dev
cd video && npm install && npm test
```

자세한 내용은 각 폴더의 README를 보세요.
