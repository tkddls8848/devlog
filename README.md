# devlog

GitHub 공개 저장소의 푸시를 모아 개발 일지 초안을 만들고, 검토를 거쳐 발행하는
정적 블로그입니다.

## 동작

```
15분마다 (또는 수동 실행)
  → GitHub Events API 로 내 공개 푸시 수집
  → 커밋 상세(변경 파일·증감 줄 수) 조회
  → 커밋을 작성한 날(KST)로 묶기
  → 날짜마다 Cloudflare Workers AI (IBM Granite) 로 한국어 초안 작성
  → src/posts/YYYY-MM-DD-devlog.md 에 draft: true 로 저장 (하루에 한 편)
  → PR 생성 (blog-draft/push-digest 브랜치)

사람이 검토 → draft: true 줄 삭제 → 병합
  → GitHub Pages 배포
```

**하루치가 글 한 편입니다.** 실행할 때마다 한 편씩 만들면 7월 3일에 한 일이
8월 2일 일지에 적히게 됩니다. 그래서 커밋을 작성일로 먼저 쪼갠 뒤 날짜마다
따로 요약하고, 각 글의 `date` 도 그날로 답니다. 밀린 며칠치를 한 번에
처리해도 날짜별로 나뉘어 나옵니다.

`draft: true` 인 글은 페이지 자체가 생성되지 않습니다. 목록에서만 빼면 주소를
아는 사람에게는 열리므로, 검토 전 글이 공개된 것과 같기 때문입니다.

## 처음 설정

1. **Secrets** — Settings → Secrets and variables → Actions
   - `CF_ACCOUNT_ID` — Cloudflare 계정 ID
   - `CF_API_TOKEN` — Workers AI 권한을 가진 API 토큰

   둘 다 Cloudflare 대시보드 → Workers AI → "Use REST API" 에서 받습니다.

2. **Pages** — Settings → Pages → Source 를 **GitHub Actions** 로 변경
   (기본값 "Deploy from a branch" 로 두면 배포 워크플로 결과가 무시됩니다.)

3. **Actions 권한** — Settings → Actions → General → Workflow permissions 에서
   "Read and write permissions" 와 "Allow GitHub Actions to create and approve
   pull requests" 를 켭니다. 이게 꺼져 있으면 PR 생성이 403 으로 실패합니다.

4. **기준점 잡기 (선택)** — 아무것도 안 하면 첫 실행이 **최근 90일치 푸시를
   전부** 글감으로 잡습니다. 무엇이 만들어질지는 먼저 볼 수 있습니다:

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

시크릿을 넣기 전에는 초안 워크플로가 조용히 건너뜁니다(15분마다 실패 메일이
오지 않도록). 배포 워크플로는 시크릿 없이도 동작합니다.

## 로컬에서

```bash
npm install
npm run dev            # http://localhost:8080

# 초안 생성을 직접 돌려 보기 (Cloudflare 자격 증명 필요)
CF_ACCOUNT_ID=... CF_API_TOKEN=... GH_TOKEN=$(gh auth token) npm run digest
```

## 무엇이 글감에서 빠지는가

- 비공개 저장소 — Events API 는 공개 활동만 줍니다
- 이 저장소(devlog) 자신 — 자동 생성 커밋이 다음 글의 소재가 되는 되먹임 방지
- `main`/`master` 가 아닌 브랜치의 푸시
- 병합 커밋, `revert`, 의존성 범프, 봇 커밋, `wip` 같은 한 단어 메시지

조정하려면 `tools/push-digest.mjs` 위쪽의 `SKIP_MESSAGE`, `SKIP_AUTHOR` 를
고치세요.

## 한 번에 만드는 글 수

기본 30편(`MAX_POSTS_PER_RUN`)까지입니다. 넘으면 **오래된 날부터** 채우고
기준점은 그대로 둡니다. PR 을 병합하면 실린 커밋이 `seenShas` 에 남아 다음
실행이 그다음 날짜부터 이어갑니다.

## 어디까지 처리했는지

`.state/last-seen.json` 에 마지막으로 본 이벤트 id 와 최근 커밋 해시가
들어 있습니다. 이 파일은 초안과 **같은 PR** 에 담깁니다 — 병합해야 지점이
넘어갑니다. PR 을 닫기만 하면 다음 실행이 같은 구간을 다시 요약합니다.

처음부터 다시 훑고 싶으면 `lastEventId` 를 `null` 로 되돌리세요.
