# video — 개발 일지를 유튜브 영상으로

발행한 개발 일지 한 편을 가로 유튜브 영상 한 편으로 만듭니다. 그날 커밋이 있던 저장소마다 하나의
세션(챕터)을 두고, 같은 저장소에서 이어지는 작업은 같은 스레드의 다음 회차로 묶습니다. 커밋이
없던 저장소는 언급하지 않습니다.

제작 방식은 stock_chatbot/shorts의 방식을 가로 영상에 옮긴 것입니다. **생성형 영상 클립과 Artlist를
쓰지 않습니다.** 배경은 Cloudflare Workers AI로 그린 이미지이고, 음성은 edge-tts, 합성은 로컬
Blender입니다. 대본과 자막 기준은 [EDITORIAL.md](EDITORIAL.md)에 있습니다.

## 쓰는 도구와 비용

| 단계 | 도구 | 비용 |
| --- | --- | --- |
| 대본(`episode.json` 편집 칸) | Claude Code가 글과 커밋 근거로 채움 | — |
| 음성 | edge-tts `ko-KR-InJoonNeural` (`tools/speech.py`) | 무료, API 키 없음(비공식 서비스) |
| 배경 묘사 | Workers AI `@cf/openai/gpt-oss-20b` | Workers AI 사용량 |
| 배경 이미지 | Workers AI `@cf/black-forest-labs/flux-2-klein-4b` (느리면 `flux-2-klein-9b`) | 한 장 약 210~310 neurons(9b는 약 1,560) |
| 글자·사람 검사 | Workers AI `@cf/meta/llama-3.2-11b-vision-instruct` | 검사 한 번 약 7 neurons |
| 자막 시각, 카드 그림 | 이 폴더의 코드 (`tools/timeline.mjs`, `tools/engine/`) | 없음 |
| 합성, 인코딩 | Blender 5.2 VSE (`blender/vse.py`) | 로컬, 무료 |
| 쉼 편집, 길이 측정, 축소 | ffmpeg, ffprobe | 로컬, 무료 |
| 업로드, 재생목록 | YouTube Data API (`tools/upload.mjs`) | 무료(일일 할당량) |

Workers AI 무료 한도는 하루 10,000 neurons입니다. 장면 6개 회차의 배경은 4b 기준 약 1,300~1,900
neurons입니다. 개발 일지 자동 작성(gpt-oss-120b)도 같은 한도를 씁니다.

## 흐름

```text
devlog/journal/<slug>.md       news 폴더의 journal pull 결과 (발행한 글 + 커밋 근거)
      │  npm run plan
      ▼
out/<slug>/episode.json        저장소 세션, 스레드 판정, 장면 뼈대. 편집 칸은 null
      │  Claude가 대본·화면 문구를 채움 (EDITORIAL.md)
      ▼
      │  npm run compose
      │    1. 배경이 없는 장면은 Workers AI로 그림            → assets/bg-<장면>.jpg
      │    2. 원고 전체를 edge-tts로 한 번에 합성, 쉼 조정      → work/narration.mp3, words.json
      │    3. 단어 시각으로 자막 구절과 장면 전환 시각 결정
      │    4. 장면별 투명 카드 PNG                            → work/card-*.png
      │    5. Blender VSE 합성·인코딩
      ▼
out/<slug>/final.mp4, chapters.json, metadata.json
      │  npm run upload
      ▼
YouTube 영상 + 저장소별 재생목록, series.json 갱신 (커밋)
```

## 명령

```bash
cd video
npm test
npm run plan -- ../devlog/journal/2026-09-26-devlog.md   # out/<slug>/episode.json, script.md
npm run backgrounds -- out/<slug>                        # 배경만 (없는 장면만, --force로 전부 다시)
npm run compose -- out/<slug> --scene=release            # 장면 하나만 preview-release.mp4
npm run compose -- out/<slug> --seconds=15               # 앞 15초만 preview.mp4
npm run compose -- out/<slug>                            # final.mp4, chapters.json, metadata.json
npm run upload -- out/<slug> --dry-run                   # 보낼 메타데이터 확인
npm run upload -- out/<slug> --privacy=private
```

`compose` 옵션: `--force-voice`(음성 다시 합성), `--no-generate`(배경을 그리지 않고 없으면 단색).

## 단계별 세부

### 1. 배경 (`tools/backgrounds.mjs`)

- 장면의 `background`(회차 폴더 기준 경로)나 `assets/bg-<장면 id>.mp4|png|jpg`가 있으면 그대로 씁니다.
  이미 만든 영상 클립도 배경이 될 수 있습니다.
- 없으면 무엇을 그릴지 정합니다. 장면의 `visual`(영문 한 문장)이 있으면 그대로, 없으면 `gpt-oss-20b`가
  회차의 모든 장면 묘사를 한 번에 씁니다. 장면마다 다른 장소와 비유를 쓰고, 책상·램프·머그 같은
  상투적 소품은 금지합니다(한 장면씩 물으면 여섯 중 넷이 책상 위 머그였습니다).
- `flux-2-klein-4b`로 1920x1088을 그립니다. 주제는 오른쪽 3분의 1, 왼쪽은 같은 장면의 그늘로 두어
  제목이 앉을 자리를 만듭니다. 4b가 90초 안에 답하지 않으면 그 장만 `flux-2-klein-9b`로 그립니다
  (2026-09-28에 4b가 4분 넘게 멈춘 적이 있습니다). `VIDEO_IMAGE_MODEL`로 기본 모델을 바꿉니다.
- `llama-3.2-11b-vision-instruct`가 글자나 사람을 찾으면 다시 그립니다(최대 3번). 끝까지 걸리거나
  그리기에 실패하면 그 장면만 짙은 단색으로 두고 영상은 계속 만듭니다. 이 모델은 계정에서 Meta
  라이선스 동의가 한 번 필요합니다(2026-09-28 동의함). stock_chatbot이 쓰는 llava-1.5는 그날 503만
  돌려줬습니다. `VIDEO_BACKGROUND_CHECK=false`면 검사를 건너뜁니다.
- 인증: 최상위 `.env`의 `CLOUDFLARE_API_TOKEN`(Workers AI 권한)과 `CLOUDFLARE_ACCOUNT_ID`. 없으면
  `news` 폴더의 wrangler 로그인 토큰을 씁니다(로컬 전용).
- 기록: `assets/backgrounds.json`에 장면별 묘사, 프롬프트, 실제로 쓴 모델, 시도 횟수가 남습니다.

### 2. 음성 (`tools/speech.py`)

- 원고 전체를 edge-tts로 **한 번에** 합성하고 단어별 발화 시각(WordBoundary)을 받습니다. 장면마다
  따로 합성하면 경계마다 음색과 호흡이 다시 시작됩니다.
- edge-tts는 문장 사이와 장면 사이를 똑같이 쉬므로, 합성 뒤 PCM에서 쉼 한가운데만 늘리거나 줄입니다.
  도입→첫 장면 0.9초, 장면 사이 1.1초, 마무리 앞 1.3초, 문장 끝 0.65초.
- 말 속도 `EDGE_TTS_RATE`(기본 +12%), 목소리 `EDGE_TTS_VOICE`. +30%는 급하게 들렸습니다.
- 영어 약어는 `pronunciation.json`의 읽는 법으로 바꿔 보냅니다(RAG → 래그). 자막은 원래 표기를 씁니다.
- 원고·목소리·속도·쉼 설정이 같으면 다시 합성하지 않습니다. 쉼 값을 바꾸면 `compose.mjs`의
  `PACING`도 바꿉니다.

### 3. 자막과 장면 시각 (`tools/timeline.mjs`)

- 문장으로 끊고, 30자를 넘는 문장만 쉼표·연결어미 자리에서 균등하게 나눕니다. "…와·과·의" 뒤와 한
  어절 안에서는 끊지 않습니다.
- 구절은 첫 단어보다 0.05초 먼저 뜨고(장면 첫 구절은 0.55초) 다음 구절이 뜰 때까지 남습니다.
- 장면은 첫 구절이 뜨는 순간 바뀝니다. 화면이 먼저 자리를 잡고 말이 시작됩니다.

### 4. 카드 (`tools/engine/cards.mjs`)

배경 위에 얹는 1920x1080 투명 PNG입니다. 글꼴(TrueType)을 직접 읽어 그립니다(`engine/font.mjs`,
`engine/raster.mjs`, `engine/png.mjs`).

- 왼쪽과 아래에 어둠(스크림)을 깔아 어떤 배경에서도 글자가 읽히게 합니다.
- 위에서부터: DEVLOG 칩과 날짜, 장 표시(`scene.label` · 저장소), 큰 두 줄 제목(`scene.text`, 둘째 줄
  강조색), 쪽 번호와 장면 수만큼의 칸 진행바, 설명(`scene.note`)과 요약(`scene.points`, 최대 3개).
- 긴 장면은 제목만 먼저 세우고(최대 2.2초) 설명을 얹습니다.
- 강조색: 처음·끝은 금색, 저장소 세션은 파랑·빨강·초록·보라 순서.

### 5. 합성 (`blender/vse.py`)

- 채널 1·2: 배경. 장면 강조색으로 색조를 입히고, 장면 사이에서 0.5초 겹쳐 서서히 넘깁니다.
  사진 배경은 장면 동안 1.02배에서 1.50배로 확대되며 옆으로 약 22px 흐릅니다(카드·자막은 고정).
  값은 `DRIFT_SCALE`, `DRIFT_PX`입니다. 영상 배경은 장면보다 짧으면 반복합니다.
- 채널 3: 카드 PNG. 채널 4: 자막(굵게, 외곽선·그림자, 하단 중앙). 채널 5: 내레이션.
- 1920x1080 30fps, H.264/AAC. 2분 30초 회차가 약 2분 반, 장면 하나(`--scene`)는 약 30초에 끝납니다.

## episode.json에서 compose가 읽는 칸

| 칸 | 쓰임 |
| --- | --- |
| `opening`, `sessions[].scenes[]`, `ending` | 장면 순서 |
| `scene.narration` | 음성과 자막. 합니다체로, 세션당 네다섯 문장(EDITORIAL.md) |
| `scene.text` | 화면 큰 제목. `\n`으로 두 줄 |
| `scene.label` | 장 표시(예: `01 / 공개`) |
| `scene.note`, `scene.points` | 제목 아래 설명 한 줄, 요약 1~3개 |
| `scene.visual` | 배경으로 그릴 장면(영문 한 문장). 없으면 자동 |
| `scene.background` | 쓸 배경 파일(회차 폴더 기준). 있으면 그리지 않음 |
| `sessions[].repo`, `thread`, `commits` | 장 표시, 챕터, 게시 정보 |

`plan`이 만드는 `prompt`(예전 Artlist 클립 프롬프트)와 `thread.music`은 compose에서 비어 있어도 됩니다.
배경 음악은 `assets/music-1.mp3`나 `music.mp3`가 있을 때만 씁니다(현재 compose는 내레이션만 넣습니다).

## series.json

시리즈 연속성의 원본입니다. 저장소 이름을 키로 스레드 목록을 갖습니다.

```json
{
  "version": 1,
  "staleDays": 30,
  "threads": {
    "tkddls8848/game": [
      {
        "id": "game-audio", "name": "오디오 시스템", "status": "open",
        "paths": ["src/audio"], "keywords": ["mixer", "믹서"],
        "lastDate": "2026-09-24", "lastSummary": "다음 회차 오프닝에서 읽을 두 문장",
        "episodes": [{ "number": 1, "date": "2026-09-22", "slug": "2026-09-22-devlog", "videoId": "...", "subtitle": "...", "summary": "...", "start": 12, "commits": ["abc1234"] }]
      }
    ]
  }
}
```

`plan`은 같은 저장소의 열린 스레드와 변경 경로 겹침(가중치 2), 키워드 겹침(가중치 1)으로 점수를
매겨 2점 이상이면 다음 회차로 잇고, 아니면 새 스레드를 엽니다. 마지막 회차 뒤 `staleDays`가 지난
스레드는 후보에서 뺍니다. `series.json`은 업로드 뒤에만 바뀝니다.

## YouTube 설정

Google Cloud 프로젝트에서 YouTube Data API v3를 켜고 데스크톱 앱 OAuth 클라이언트를 만듭니다.
범위는 `https://www.googleapis.com/auth/youtube`입니다.

```bash
cd video
npm run auth    # 브라우저 동의 후 YOUTUBE_REFRESH_TOKEN 출력 → 최상위 .env에 추가
```

- 비밀값은 저장소 최상위 `.env`에만 둡니다(`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
  `YOUTUBE_REFRESH_TOKEN`). 커밋하지 않습니다.
- 검수받지 않은 OAuth 앱이 올린 영상은 YouTube가 비공개로 잠급니다. 기본 공개 범위가 `private`인
  이유이며, 공개 전환은 스튜디오에서 합니다.

## 설치

- Node 20 이상, Python 3.11 이상과 `pip install edge-tts`
- `ffmpeg`, `ffprobe`
- Blender 5.2 (`BLENDER`로 경로 지정, 기본은 `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`)
- 한국어 글꼴 NanumGothic, NanumGothicBold (`VIDEO_FONT`, `VIDEO_FONT_BOLD`로 변경)
- Workers AI: `news` 폴더에서 `npx wrangler login`, 또는 최상위 `.env`에 `CLOUDFLARE_API_TOKEN`과
  `CLOUDFLARE_ACCOUNT_ID`

테스트(`npm test`)는 네트워크, Blender, 비밀값 없이 돕니다. 글 파싱, 세션 배정, 시리즈 판정, 자막
구절 분할, 발음 사전 매핑, 카드·PNG, 배경 프롬프트, 게시 정보를 검사합니다.

## 이전 경로 (지금은 쓰지 않음)

코드는 남아 있지만 매일 제작에는 쓰지 않습니다.

- `npm run assemble`: Artlist MCP로 만든 영상 클립·보이스오버·음악을 ffmpeg로 조립. 회차마다 Artlist
  크레딧(10초 클립 한 개 약 1,000)이 들어 중단했습니다.
- `npm run render`: 미니멀 레이아웃(흰 배경, 두 줄 제목)을 자체 렌더러나 Blender(`blender/episode.py`)로
  그림. 장면별 음성 파일(`npm run voice`, ElevenLabs·Gemini TTS·edge-tts)을 씁니다.
