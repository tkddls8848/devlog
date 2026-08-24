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
.github/workflows/news-publish.yml      09:40 KST, news/ 만 수집·커밋
.github/workflows/test.yml              세 폴더의 테스트를 각각 실행
.github/workflows/deploy.yml            devlog·archive 빌드를 합쳐 GitHub Pages로 배포
.github/workflows/news-deploy.yml       news 빌드를 Cloudflare Workers로 배포
```

수집 워크플로는 폴더별로 완전히 분리되어 있고, 하나가 실패해도 나머지는 그대로
돕니다. `deploy.yml`만 두 폴더를 함께 봅니다. GitHub Pages가 저장소당 사이트
하나만 배포하기 때문이며, 두 서비스를 저장소로 나누면 각자 자기 배포를 가집니다.
뉴스레터는 이미 그 제약 밖에 있습니다. `news/wrangler.jsonc`에 적힌 대로 빌드
산출물을 정적 자산 Worker로 올리므로 `news-deploy.yml`이 혼자 돕니다.
`GITHUB_TOKEN`으로 민 커밋은 `push` 워크플로를 깨우지 않으므로, 각 수집
워크플로가 새 기록을 커밋한 뒤 자기 배포 워크플로를 직접 호출합니다.

테스트는 `main` 푸시와 풀 리퀘스트에서 폴더별로 돕니다. 네트워크와 비밀값 없이
돌도록 만들어져 있어 수집 워크플로와 무관하게 언제든 실행할 수 있습니다.
`deploy.yml`은 테스트와 README만 바뀐 푸시에서는 돌지 않습니다. 산출물이 그대로인
빌드를 다시 올릴 이유가 없기 때문이며, 산출물과 관련된 파일이 하나라도 섞이면
그대로 배포합니다.

## 설정

Actions secrets에 다음 값을 등록합니다. 개발 일지와 뉴스레터 수집, 그리고
뉴스레터 배포가 사용합니다.

- `CF_ACCOUNT_ID`: Cloudflare 계정 ID
- `CF_API_TOKEN`: Workers AI 권한이 있는 API 토큰
- `CF_WORKERS_API_TOKEN`: Workers Scripts 편집 권한이 있는 API 토큰 (선택)

수집이 쓰는 `CF_API_TOKEN`은 Workers AI만 부르면 되지만, 뉴스레터 배포는 Worker를
덮어쓰므로 권한이 더 필요합니다. 배포는 `CF_WORKERS_API_TOKEN`을 먼저 보고 없으면
`CF_API_TOKEN`을 씁니다. 하나로 합치려면 `CF_API_TOKEN`에 Workers Scripts 편집
권한을 더하고 `CF_WORKERS_API_TOKEN`은 두지 않으면 됩니다.

Actions variables로 `CF_AI_MODEL`(개발 일지·뉴스레터), `IBM_REGION`(아카이브),
`NEWS_WINDOW_HOURS`(뉴스레터)를 바꿀 수 있습니다. 기본값은 각각
`@cf/meta/llama-3.1-8b-instruct-fast`, `AP`, 24입니다. GitHub API는 워크플로가
자동으로 받는 `GITHUB_TOKEN`을 씁니다.

`NEWS_URL` variable에는 Worker의 실제 주소를 넣습니다. `workers.dev` 하위 도메인은
계정마다 다르고 사용자 지정 도메인을 붙이면 또 바뀌므로, 비워 두면 개발 일지와
아카이브의 뉴스레터 링크가 `src/_data/site.js`의 기본값
`https://devlog-news.tkddls8848.workers.dev/`로 나갑니다. `DEVLOG_URL`,
`ARCHIVE_URL` variable도 같은 방식으로 뉴스레터 쪽 링크를 덮어씁니다.

Settings → Pages의 Source는 `GitHub Actions`, Settings → Actions의 Workflow
permissions는 `Read and write permissions`로 설정합니다. Cloudflare 쪽은 첫 배포가
`devlog-news` Worker를 스스로 만들므로 미리 만들어 둘 것이 없습니다.

## 로컬 실행

저장소 루트에는 `package.json`이 없습니다. 작업할 폴더로 들어가서 실행합니다.

```bash
cd devlog && npm install && npm run dev
cd archive && npm install && npm run dev
cd news && npm install && npm run dev
```

자세한 내용은 각 폴더의 README를 보세요.
