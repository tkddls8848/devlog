# archive — 벤더 문서 아카이브

IBM·Lenovo·HPE·Dell 제품 문서에서 관측한 갱신을 쌓아 두고, 벤더와 검색어로 거를
수 있게 보여 주는 Eleventy 사이트입니다.

사이트: <https://tkddls8848.github.io/devlog/archive/>

개발 일지는 별도 사이트이며 이 폴더의 코드와 무관합니다. 내비게이션 링크로만
이어집니다.

## 구성

```text
tools/vendor-watch.mjs        벤더 문서 → 아카이브
tools/sources/                IBM·Lenovo·HPE·Dell 수집기
src/_data/vendorArchive.json  누적된 문서 목록
src/_data/site.js             사이트 제목과 개발 일지 링크
src/index.njk                 목록 표와 거르기 화면
```

## 수집 방식

IBM 공고 API, Lenovo Press RSS, HPE QuickSpecs(Coveo 검색), Dell 펌웨어 카탈로그에서
문서 목록을 받아 아카이브에 없는 것만 추가합니다. 중복은 벤더·URL·날짜로 판별합니다.
한 소스가 실패해도 나머지 소스의 결과는 저장하고, 모든 소스가 실패하면 아무것도 쓰지
않습니다. AI는 쓰지 않고 수집한 목록을 그대로 쌓습니다.

네 소스 모두 최근 문서만 남기므로 롤링 목록에서 이미 사라진 문서는 복구할 수
없습니다. HPE는 공식 API가 아니라 검색 화면이 쓰는 내부 호출이라 HPE가 구조를
바꾸면 멈출 수 있습니다.

Dell은 `delltechnologies.com/asset/.../technical-support/*.pdf`의 스펙 시트를 받아
PDF 메타데이터에서 제목과 수정일을 읽습니다. HPE QuickSpecs, Lenovo Product Guide와
같은 프리세일즈 문서입니다.

문서 목록을 주는 API가 Dell에는 없어서 후보를 만들어 두드립니다. 서버는 펌웨어
카탈로그(`downloads.dell.com/catalog/Catalog.gz`)의 지원 시스템 이름으로
`poweredge-<모델>-spec-sheet.pdf` 슬러그를 만들어 신제품까지 자동으로 따라갑니다.
스토리지와 네트워크는 파일 이름에 규칙이 없어(`dell-powerstore-gen3-spec-sheet`,
`dell_emc_networking_s4048t_on_series_spec_sheet`) 확인된 목록을 `dell.mjs`의
`CURATED`에 직접 둡니다. 새 제품은 여기에 추가하면 됩니다.

메타데이터는 평문으로 박혀 있을 때도, 압축 객체 스트림 안에 있을 때도 있습니다.
두 방식이 성공하는 파일이 서로 달라 정규식을 먼저 보고 실패하면 `pdf-lib`로
넘깁니다. 날짜를 못 읽은 문서는 버립니다.

한 번에 200개 가까이 두드리므로 8개씩 묶어 돌리고, 전체가 1분 남짓 걸립니다.
받는 양은 20MB 정도입니다.

Info Hub(`infohub.delltechnologies.com`)에도 날짜가 붙은 기술 문서가 1,700여 건
있지만 쓰지 않습니다. reCAPTCHA Enterprise 챌린지가 걸려 있어 헤드리스 브라우저는
403이고, 헤디드로 통과해도 쿠키가 3시간짜리인 데다 세션이 새것일수록 점수가
불리해 CI에서는 통과를 기대하기 어렵습니다.

## 자동 갱신

매일 09:25 KST에 `.github/workflows/archive-publish.yml`이 이 폴더만 수집하고,
새 문서가 있을 때만 `main`에 커밋한 뒤 배포를 부릅니다.

## 로컬 실행

Node 20 이상이 필요합니다. CI는 `.nvmrc`의 24를 씁니다.

```bash
npm install
npm run dev
npm run build

IBM_REGION=AP npm run watch:vendors

# 저장하지 않고 새로 잡히는 문서만 확인
npm run watch:vendors:dry
```

`IBM_REGION` 기본값은 `AP`입니다. `DEVLOG_URL`로 개발 일지 사이트 주소를 덮어쓸
수 있으며 기본값은 `src/_data/site.js`에 있습니다.
