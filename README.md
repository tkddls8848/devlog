# devlog

서로 독립된 Eleventy 사이트 세 개를 한 저장소에 담고 있습니다. 각 폴더는 자기
`package.json`, 빌드, 수집기, 문서를 따로 가지며 다른 폴더의 코드를 참조하지
않습니다. 나중에 저장소째 떼어내도 폴더를 그대로 옮기면 됩니다.

| 폴더 | 사이트 | 하는 일 |
| --- | --- | --- |
| [`devlog/`](devlog/) | <https://tkddls8848.github.io/devlog/> | GitHub 공개 커밋을 날짜별 개발 일지로 발행 |
| [`archive/`](archive/) | <https://tkddls8848.github.io/devlog/archive/> | IBM·Lenovo·HPE·Dell 제품 문서 갱신을 목록으로 축적 |
| [`news/`](news/) | <https://devlog-news.tkddls8848.workers.dev/> | IT 업계 뉴스·블로그의 하루치 소식을 뉴스레터로 발행 |

세 사이트는 서로를 내비게이션 링크로만 가리킵니다. 링크 주소는 각 폴더의
`src/_data/site.js`에 있고 환경 변수(`DEVLOG_URL`, `ARCHIVE_URL`, `NEWS_URL`)로
덮어쓸 수 있습니다.

개발 일지와 아카이브는 GitHub Pages에, 뉴스레터는 Cloudflare Workers에 올라갑니다.
뉴스레터는 오리진이 달라 이웃 사이트를 상대 경로가 아닌 절대 주소로 가리킵니다.

## 워크플로

```text
.github/workflows/devlog-publish.yml    09:10 KST, devlog/ 만 수집·커밋
.github/workflows/archive-publish.yml   09:25 KST, archive/ 만 수집·커밋
.github/workflows/test.yml              세 폴더의 테스트를 각각 실행
.github/workflows/deploy.yml            devlog·archive 빌드를 합쳐 GitHub Pages로 배포
news/worker/index.mjs                   Cloudflare Cron으로 news 수집·발행·서비스
```

`deploy.yml`은 GitHub Pages에 남은 개발 일지와 아카이브만 배포합니다. 뉴스레터는
Cloudflare Workers Builds가 소스 변경을 배포하고, Cron Trigger가 매일 수집하며,
Workers AI가 본문을 만들고 D1이 이슈·원문 링크·실행 이력을 저장합니다. 뉴스레터
발행 결과는 GitHub에 커밋하지 않습니다.

테스트는 `main` 푸시와 풀 리퀘스트에서 폴더별로 돕니다. 네트워크와 비밀값 없이
돌도록 만들어져 있어 수집 워크플로와 무관하게 언제든 실행할 수 있습니다.
`deploy.yml`은 테스트와 README만 바뀐 푸시에서는 돌지 않습니다. 산출물이 그대로인
빌드를 다시 올릴 이유가 없기 때문이며, 산출물과 관련된 파일이 하나라도 섞이면
그대로 배포합니다.

## 설정

Actions secrets에는 개발 일지 생성이 사용하는 다음 값만 등록합니다.

- `CF_ACCOUNT_ID`: Cloudflare 계정 ID
- `CF_API_TOKEN`: Workers AI 권한이 있는 API 토큰

Actions variables로 `CF_AI_MODEL`(개발 일지), `IBM_REGION`(아카이브)을 바꿀 수
있습니다. 뉴스레터의 AI·D1은 Worker binding이므로 GitHub secret을 사용하지 않고,
실행 설정은 `news/wrangler.jsonc`에서 관리합니다.

`NEWS_URL` variable에는 Worker의 실제 주소를 넣습니다. `workers.dev` 하위 도메인은
계정마다 다르고 사용자 지정 도메인을 붙이면 또 바뀌므로, 비워 두면 개발 일지와
아카이브의 뉴스레터 링크가 `src/_data/site.js`의 기본값
`https://devlog-news.tkddls8848.workers.dev/`로 나갑니다. `DEVLOG_URL`,
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
```

자세한 내용은 각 폴더의 README를 보세요.
