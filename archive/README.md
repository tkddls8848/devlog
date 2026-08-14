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

Dell만 성격이 다릅니다. `downloads.dell.com/catalog/Catalog.gz`는 롤링 목록이 아니라
PowerEdge 계열의 펌웨어·드라이버 **전체** 카탈로그(1,800건 이상)라, 날짜 내림차순
150건으로 잘라 다른 벤더와 분량을 맞춥니다. 같은 릴리스가 지원 시스템 묶음마다
반복되므로 `releaseID`로 묶고 지원 모델 목록은 합칩니다. 카탈로그 자체는 월 단위로
갱신되어 대부분의 날은 새 문서가 없고 한 번에 몰려 들어옵니다. 독립 스토리지
어레이(PowerStore·PowerScale·PowerMax)와 PowerSwitch는 이 카탈로그에 없습니다.

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
