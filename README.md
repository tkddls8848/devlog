# devlog

[**https://tkddls8848.github.io/devlog/**](https://tkddls8848.github.io/devlog/)

기록을 자동으로 모아 발행하는 정적 사이트입니다. 두 가지를 추적합니다.


| 무엇          | 어디서                | 만들어지는 것                             |
| ----------- | ------------------ | ----------------------------------- |
| 내 커밋        | GitHub Events API  | `/` 개발 일지                           |
| 벤더 제품 문서 갱신 | IBM · Lenovo · HPE | `/updates/` 갱신 일지, `/archive/` 아카이브 |


앞쪽은 아래에서, 뒤쪽은 [벤더 문서 갱신 수집](#벤더-문서-갱신-수집)에서 설명합니다.

## 무엇이 어디에 있는가

```
tools/push-digest.mjs         커밋 → 개발 일지
tools/vendor-watch.mjs        벤더 문서 → 갱신 일지 · 아카이브
tools/sources/*.mjs           벤더별 수집 어댑터 (ibm · lenovo · hpe)

src/posts/                    발행된 개발 일지     (자동 생성)
src/updates/                  발행된 갱신 일지     (자동 생성)
src/_data/vendorArchive.json  누적 아카이브        (자동 생성)
.state/                       어디까지 처리했는지  (자동 갱신)
```

워크플로는 셋입니다.


| 워크플로               | 언제             | 하는 일               |
| ------------------ | -------------- | ------------------ |
| `push-digest.yml`  | 15분마다          | 개발 일지 생성 → 커밋 → 배포 |
| `vendor-watch.yml` | 매일 09:10 KST   | 벤더 문서 수집 → 커밋 → 배포 |
| `deploy.yml`       | `main` 에 푸시될 때 | 빌드해서 Pages 로 배포    |


앞의 둘은 글을 만든 뒤 스스로 빌드·배포까지 합니다. `deploy.yml` 은 사람이  
직접 고친 것(템플릿, CSS, 설정)을 올릴 때 도는 쪽입니다.

## 개발 일지 동작

```
15분마다 (또는 수동 실행)
  → GitHub Events API 로 내 공개 푸시 수집
  → 커밋 상세(변경 파일·증감 줄 수) 조회
  → 커밋을 작성한 날(KST)로 묶기
  → 날짜마다 Cloudflare Workers AI (Llama 3.1 8B) 로 한국어 글 작성
  → src/posts/YYYY-MM-DD-devlog.md 에 저장 (하루에 한 편)
  → main 에 자동 커밋
  → GitHub Pages 자동 배포
```

**하루치가 글 한 편입니다.** 실행할 때마다 한 편씩 만들면 7월 3일에 한 일이  
8월 2일 일지에 적히게 됩니다. 그래서 커밋을 작성일로 먼저 쪼갠 뒤 날짜마다  
따로 요약하고, 각 글의 `date` 도 그날로 답니다. 밀린 며칠치를 한 번에  
처리해도 날짜별로 나뉘어 나옵니다.

## 처음 설정

1. **Secrets** — Settings → Secrets and variables → Actions → **Repository secrets**
  - `CF_ACCOUNT_ID` — Cloudflare 계정 ID
  - `CF_API_TOKEN` — Workers AI 권한을 가진 API 토큰

   둘 다 Cloudflare 대시보드 → Workers AI → "Use REST API" 에서 받습니다.
  > 같은 화면 아래쪽의 **Environment secrets** 가 아니라 위쪽의 **Repository**  
  > **secrets** 에 넣어야 합니다. Environment 시크릿은 `environment:` 를 선언한  
  > 잡에서만 보여서, 자동 발행 워크플로가 값을 읽지 못하고 조용히 건너뜁니다.
2. **Pages** — Settings → Pages → Source 를 **GitHub Actions** 로 변경  
 (기본값 "Deploy from a branch" 로 두면 배포 워크플로 결과가 무시됩니다.)
3. **Actions 권한** — Settings → Actions → General → Workflow permissions 에서  
 "Read and write permissions" 를 켭니다. 이게 꺼져 있으면 자동 커밋이  
 403으로 실패합니다.
4. **기준점 잡기 (선택)** — 아무것도 안 하면 첫 실행이 **최근 90일치 푸시를**  
 **전부** 글감으로 잡습니다. 무엇이 만들어질지는 먼저 볼 수 있습니다:
  ```bash
   GH_TOKEN=$(gh auth token) npm run digest -- --dry-run
  ```

   날짜별로 나뉘므로 하루에 한 편씩, 활동한 날 수만큼 글이 나옵니다.  
   그대로 두면 과거가 전부 날짜별 일지로 채워집니다. 지난 것은 넘기고  
   앞으로의 푸시만 쓰고 싶으면:
  ```bash
   GH_TOKEN=$(gh auth token) npm run digest -- --seed
   git add .state && git commit -m "기준점 초기화" && git push
  ```

시크릿을 넣기 전에는 자동 발행 워크플로가 조용히 건너뜁니다(15분마다 실패 메일이  
오지 않도록). 배포 워크플로는 시크릿 없이도 동작합니다.

## 로컬에서

Node 20 이상이 필요합니다. CI 는 `.nvmrc` 의 24 를 씁니다.

```bash
npm install
npm run dev            # http://localhost:8080
npm run build          # _site/ 에 정적 파일 생성
npm run clean          # _site/ 삭제

# 글 생성을 직접 돌려 보기 (Cloudflare 자격 증명 필요)
CF_ACCOUNT_ID=... CF_API_TOKEN=... GH_TOKEN=$(gh auth token) npm run digest
```

## 무엇이 글감에서 빠지는가

- 비공개 저장소 — Events API 는 공개 활동만 줍니다
- 이 저장소(devlog) 자신 — 자동 생성 커밋이 다음 글의 소재가 되는 되먹임 방지
- `main`/`master` 가 아닌 브랜치의 푸시
- 병합 커밋, `revert`, 의존성 범프, 봇 커밋, `wip` 같은 한 단어 메시지

조정하려면 `tools/push-digest.mjs` 위쪽의 `SKIP_MESSAGE`, `SKIP_AUTHOR` 를  
고치세요.

## 모델 바꾸기

기본값은 `tools/push-digest.mjs` 의 `DEFAULT_MODEL`  
(`@cf/meta/llama-3.1-8b-instruct-fast`) 입니다. 코드를 고치지 않고 바꾸려면  
Settings → Secrets and variables → Actions → **Variables** 에 `CF_AI_MODEL` 을  
만들고 모델 ID 를 넣으세요. 로컬에서는 환경 변수로 넘깁니다:

```bash
CF_AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast npm run digest
```

### 8B 의 한계

커밋이 열 건 넘는 날에는 글이 무너집니다 — 커밋 메시지를 그대로 이어붙이고  
같은 마무리 문장을 반복합니다. 커밋이 두세 건인 보통 날에는 읽을 만합니다.  
글은 검토 없이 자동 발행되므로 모델 출력 품질을 주기적으로 확인하는 편이 좋습니다.

### 비용은 걸림돌이 아닙니다

글 한 편이 대략 입력 2,500 / 출력 900 토큰입니다. 무료 한도는 하루  
10,000 Neurons 이라, 하루 한 편이면 아래 어느 모델을 써도 한참 남습니다.


| 모델                                             | 편당 Neurons | 하루 한 편 기준 |
| ---------------------------------------------- | ---------- | --------- |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 약 125      | 1.3%      |
| `@cf/qwen/qwen3-30b-a3b-fp8`                   | 약 230      | 2.3%      |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast`     | 약 251      | 2.5%      |


갱신 일지도 같은 계정의 같은 한도를 씁니다. 평상시 호출은 하루 두 번  
(개발 일지 한 편 + 갱신 일지 한 편)이라 표의 두 배로 보면 됩니다.

한도에 걸리는 경우는 과거를 한꺼번에 훑는 첫 실행뿐입니다(21편이면 약 5,300).

### 고를 때 볼 것

- **추론형 모델은** `<think>` **블록을 뱉습니다** (qwen3-30b-a3b, qwq-32b,  
deepseek-r1 계열). `savePost` 가 걷어내지만 그만큼 출력 토큰을 더 씁니다.
- **coder 모델은 피하세요** (qwen2.5-coder 등). 코드에 특화된 만큼 한국어  
산문은 일반 instruct 모델보다 못합니다.
- 같은 크기라도 한국어 편차가 큽니다. 바꾼 뒤 발행된 글을 확인하세요.

## 한 번에 만드는 글 수

기본 30편(`MAX_POSTS_PER_RUN`)까지입니다. 넘으면 **오래된 날부터** 채우고  
기준점은 그대로 둡니다. 자동 커밋된 글의 커밋이 `seenShas` 에 남아 다음 실행이  
그다음 날짜부터 이어갑니다.

## 어디까지 처리했는지

`.state/last-seen.json` 에 마지막으로 본 이벤트 id 와 최근 커밋 해시가  
(최대 1,000개) 들어 있습니다. 이 파일은 생성된 글과 같은 자동 커밋에 담기므로  
다음 실행은 그 이후의 푸시부터 처리합니다.

처음부터 다시 훑고 싶으면 `lastEventId` 를 `null` 로 되돌리세요.

---

# 벤더 문서 갱신 수집

서버·스토리지 벤더가 제품 문서를 새로 내거나 고칠 때마다 그것을 기록합니다.  
커밋 로그를 쌓듯이 쌓아 두고, 하루치를 글 한 편으로 정리합니다.

```
매일 09:10 KST (또는 수동 실행)
  → IBM · Lenovo · HPE 에서 최근 문서 목록 수집
  → 지난번에 본 것과 대조해 새로 올라온 것만 추림
  → src/_data/vendorArchive.json 에 누적 (아카이브)
  → Cloudflare Workers AI 로 한국어 요약 작성
  → src/updates/YYYY-MM-DD-updates.md 에 저장
  → main 에 자동 커밋 → GitHub Pages 배포
```

## 어디서 가져오는가


| 벤더     | 대상                 | 경로                              | 성격          |
| ------ | ------------------ | ------------------------------- | ----------- |
| IBM    | 발표 공고 · 세일즈 매뉴얼    | `/docs/api/v1/announcement/all` | 공개 JSON API |
| Lenovo | Lenovo Press 기술 문서 | `/rss`                          | 공개 RSS      |
| HPE    | QuickSpecs 제품 사양   | Coveo 검색 API                    | 화면 내부 호출    |


**IBM** 공고 페이지는 SPA 라 HTML 을 긁을 수 없지만, 그 화면이 부르는  
엔드포인트가 인증 없이 JSON 을 줍니다. `region` 으로 지역을 고릅니다(기본 `AP`).  
지역마다 발표 날짜와 목록이 조금씩 다릅니다. 바꾸려면 Settings → Secrets and  
variables → Actions → **Variables** 에 `IBM_REGION` 을 만드세요. 로컬에서는  
환경 변수로 넘깁니다(`IBM_REGION=US npm run watch:vendors`).

**Lenovo** 는 셋 중 유일하게 공개 RSS 가 있고, 그 안에 `Change History` 가  
들어 있습니다. "갱신됨" 이 아니라 "무엇이 바뀌었는지" 까지 벤더가 직접 적어  
두는 유일한 소스라 요약할 거리가 가장 많습니다.

**HPE** 가 가장 손이 많이 갑니다. 검색 화면이 Salesforce 커뮤니티 위에 Coveo  
검색을 얹은 구조라 두 단계를 거칩니다.

1. 검색 페이지에서 Aura 컨텍스트(`fwuid`, 앱 빌드 id)를 긁는다
2. Apex 액션 `DCEHPESearchController.getToken` 으로 익명 Coveo 토큰을 받는다
3. 그 토큰으로 Coveo 검색 API 를 친다

토큰은 HPE 가 로그인하지 않은 방문자에게 자기 엔드포인트로 발급하는 게스트  
토큰입니다. 검색 화면을 여는 사람 누구나 같은 것을 받습니다.

거르는 조건은 `@kmdoctypedetails==cv66000043`(QuickSpecs)와  
`@kmdoclanguagecode==cv1871440`(영어)입니다. 이 `cv…` 코드가 무엇인지는 HPE 가  
공개 API 로 풀어 줍니다:

```bash
curl -s "https://support.hpe.com/hpesc/public/km/api/coveo_cv/en_US" | jq '.cv66000043'
# "QuickSpecs"
```

> ⚠️ HPE 경로는 공식 API 가 아니라 화면이 쓰는 내부 호출입니다. HPE 가 구조를  
> 바꾸면 멈춥니다. `fwuid` 는 Salesforce 를 배포할 때마다 바뀌므로 저장해 두지  
> 않고 매번 페이지에서 다시 긁습니다. 한 소스가 실패해도 나머지는 그대로  
> 수집되고, 실패 사실은 그날 글에 남습니다.

## Dell InfoHub 은 왜 없는가

`infohub.delltechnologies.com` 은 **reCAPTCHA Enterprise 로 이미지 선택**  
**챌린지를 겁니다.** 서버에서 부르는 모든 요청이 "Checking your browser" 화면을  
받습니다. 헤드리스 브라우저, 실제 Chrome 창, 외부 리더 서비스(Jina) 를 모두  
확인했고 전부 같은 화면이 나왔습니다. 특정 IP 문제가 아니라 호스트 전역  
설정입니다.

CAPTCHA 자체를 푸는 우회는 넣지 않았습니다. 접근 통제를 정면으로 뚫는 일이라  
자동화에 넣을 성격이 아니고, 안정적이지도 않습니다. 공개 RSS 도 찾지  
못했습니다. Wayback Machine 색인에는 InfoHub 문서가 남아 있지만 2024–25년에  
머물러 실시간 추적에는 쓸 수 없습니다.

Dell 을 넣으려면 사람이 직접 접근할 수 있는 다른 경로 — 예를 들어 Dell 이  
제공하는 이메일 구독이나 파트너 포털 피드 — 를 찾아 `tools/sources/` 에  
어댑터를 하나 더 붙이는 편이 낫습니다.

## 왜 글은 "관측한 날" 로 묶는가

개발 일지는 커밋을 *작성한 날* 로 묶습니다. 커밋에는 믿을 만한 작성 시각이  
있기 때문입니다. 벤더 문서는 사정이 다릅니다.

- 세 곳 모두 최근 몇십 건만 담는 **롤링 창** 이라 전체 이력을 주지 않습니다.
- HPE 는 2025년 12월자 문서가 오늘 새로 색인돼 올라오기도 합니다.

문서 날짜로 글을 묶으면 오늘 관측한 변경이 반년 전 날짜의 글에 적히고, 이미  
발행한 글을 계속 고쳐 써야 합니다. 그래서 **글은 관측한 날로 묶고**, 각 항목이  
들고 있는 벤더 날짜는 항목마다 따로 보여 줍니다.

문서 날짜로 훑어보는 건 아카이브 페이지가 맡습니다.  
**글은 흐름(무엇이 새로 나왔나), 아카이브는 자료(무엇이 있나)** 입니다.

아카이브는 계속 쌓이기만 하므로 화면에는 최근 1,500건만 렌더합니다  
(`eleventy.config.js` 의 `limitArchive`). 전부 그리면 언젠가 한 페이지가 수 MB  
가 되어 열리지 않습니다. 잘린 건 화면에서만이고 원본은  
`src/_data/vendorArchive.json` 에 그대로 남습니다.

## 롤링 창 주의

세 소스 모두 최근 것만 줍니다 — IBM 약 2주치(70건 안팎), Lenovo 48건,  
HPE 150건. **수집이 며칠 멈추면 그사이 갱신은 창 밖으로 밀려 영영 놓칩니다.**  
워크플로가 실패하고 있지 않은지 가끔 확인하세요.

하루 한 번만 도는 이유도 이것과 균형입니다. 더 자주 돌리면 그날 갱신이 여러  
편으로 쪼개져(`…-updates-2.md`) 기록이 지저분해집니다.

## 로컬에서

```bash
# 무엇이 새로 잡히는지만 보기 (아무것도 저장하지 않음)
npm run watch:vendors -- --dry-run

# 요약 없이 아카이브만 갱신 (Cloudflare 자격 증명 불필요)
npm run watch:vendors -- --no-ai

# 지금 보이는 것은 본 것으로 치고 기준점만 잡기
npm run watch:vendors -- --seed

# 전체 (요약 포함)
CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run watch:vendors
```

시크릿이 없으면 워크플로는 `--no-ai` 로 돕니다. 요약은 못 만들어도 그날 갱신을  
놓치면 복구할 수 없기 때문에, 목록만이라도 남기는 쪽을 택했습니다.

따로 넣을 시크릿은 없습니다. 개발 일지와 같은 `CF_ACCOUNT_ID`·`CF_API_TOKEN`·  
`CF_AI_MODEL` 을 그대로 씁니다.

## 어디까지 처리했는지

`.state/vendor-seen.json` 에 이미 본 문서의 지문이 최근 20,000개까지 들어  
있습니다. 지문은 `문서id:날짜` 라서, 같은 문서라도 벤더가 날짜를 새로 찍으면  
갱신으로 잡힙니다.

전체를 다시 훑고 싶으면 이 파일을 지우세요. 누적된 아카이브  
(`src/_data/vendorArchive.json`)는 지문으로 중복을 막으므로 그대로 두어도 됩니다.

## 소스 추가하기

`tools/sources/` 에 모듈을 하나 만들고 `tools/vendor-watch.mjs` 의 `SOURCES`  
에 넣으면 됩니다. 모듈은 `vendor` 문자열과 `collect()` 를 내보내고,  
`collect()` 는 이런 모양의 배열을 돌려주면 됩니다.

```js
{
  vendor: "IBM",
  id: "82860",                  // 벤더 안에서 문서를 지목하는 값
  title: "…",
  url: "https://…",
  date: "2026-08-03",           // 벤더가 밝힌 발표일 또는 갱신일
  kind: "공고",                  // 문서 종류
  tag: "하드웨어",                // (선택) 세부 분류
  ref: "AD26-0841",             // (선택) 사람이 알아보는 문서 번호
  note: "무엇이 바뀌었는지",       // (선택) 변경 내역
  fingerprint: "82860:2026-08-03", // 이 값이 같으면 이미 본 것으로 봅니다
}
```

