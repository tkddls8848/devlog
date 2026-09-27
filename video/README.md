# video — 개발 일지를 유튜브 시리즈로

발행한 개발 일지 한 편을 유튜브 영상 한 편으로 만드는 워크플로입니다. 영상은 그날 커밋이 있던
저장소마다 하나의 세션(챕터)을 두고, 같은 저장소에서 이어지는 작업은 별개 영상이 아니라 같은
스레드의 다음 회차로 묶습니다. 예를 들어 `game` 저장소에 사운드를 넣은 영상이 있었고 이틀 뒤
인물 목소리를 구현했다면, 두 번째 영상은 `[game] 오디오 시스템 #2`가 되고 오프닝에서 지난
이야기를 짧게 되짚습니다. 커밋이 없던 저장소는 언급하지 않습니다.

Claude Code 스킬 `/devlog-video`가 절차를 이끌고, 이 폴더의 스크립트가 결정적인 부분(글 분해,
시리즈 판정, ffmpeg 조립, 업로드)을 맡습니다. 편집 판단(내레이션, 프롬프트, 스레드 이름)은
Claude가 `episode.json`의 빈칸을 채우는 방식으로 합니다. 다른 폴더의 코드를 참조하지 않으며,
입력은 `news` 폴더의 `npm run journal -- pull`이 만드는 Markdown 파일입니다.

## 도구 조합

| 단계 | 도구 | Codex 기준 대응 |
| --- | --- | --- |
| 에이전트 | Claude Code 스킬 `.claude/skills/devlog-video/SKILL.md` | Codex |
| 장면 클립 | Artlist MCP의 Seedance 2.5 | Artlist MCP + Seedance 2.5 |
| 보이스오버, 음악 | Artlist MCP (ElevenLabs 보이스오버, Artlist 음악) | Artlist MCP |
| 편집, 자막, 합성 | ffmpeg (`tools/assemble.mjs`) | 수동 편집 |
| 업로드, 재생목록 | YouTube Data API (`tools/upload.mjs`) | 수동 업로드 |

Artlist MCP는 원격 HTTP 서버라 로컬 프로세스가 필요 없습니다. 저장소 루트의 `.mcp.json`이
연결 설정이며, 처음 한 번 Artlist 계정으로 로그인합니다. 유료 플랜의 AI 크레딧을 씁니다.

```bash
claude mcp add artlist --transport http https://mcp.artlist.io/mcp   # .mcp.json이 없을 때
claude mcp list
```

예비 생성 경로는 두지 않습니다. Artlist 인증이 실패하면 계획 단계까지만 하고 멈추며, 다음
실행에서 같은 `out/<slug>/episode.json`으로 이어갑니다.

## 매일 경로: Blender 렌더 (`npm run render`)

대본·자막은 [편집 기준](EDITORIAL.md)에 따라 처음 보는 사람을 위한 쉬운 요약으로 작성합니다.
기본 화면은 미니멀 레이아웃입니다. 큰 두 줄 제목, 한 가지 강조색, 작은 설명과 자막만 사용합니다.
`scene.label`과 `scene.note`로 장 번호와 보조 설명을 지정합니다. 이전 카드형 화면은
`episode.style.layout="classic"`으로 선택할 수 있습니다.
작업 목록보다 목적·변화·의미를 중심으로 설명하고, `scene.text`와 `scene.points`에
시청자용 제목과 핵심 요약을 넣으면 화면에 우선 표시합니다.

Artlist 생성 클립은 회차마다 크레딧이 들어 매일 올리기 어렵습니다. 매일 경로는 생성형 영상을 쓰지
않습니다. 음성만 TTS로 만들고, 화면은 Blender가 글과 커밋에서 온 글자로 모션그래픽을 그립니다.

| 단계 | 도구 | 비용 |
| --- | --- | --- |
| 내레이션 | ElevenLabs API(`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`), 없으면 edge-tts `ko-KR-InJoonNeural` | ElevenLabs 글자 수 과금 / edge-tts 무료 |
| 화면, 자막 | Blender 5 헤드리스, EEVEE (`blender/episode.py`) | 로컬 CPU·GPU |
| 음성·음악 합성, 인코딩 | ffmpeg | 없음 |

- 장면 길이는 그 장면 음성 길이 + 0.4초입니다. 자막은 문장 단위로 나눠 화면에 직접 그립니다.
- 제목 장면: 시청자용 제목, 스레드 회차, 부제. 내용 장면: 제목과 핵심 요약이 하나씩 나옵니다.
  편집한 제목·요약이 없는 기존 회차는 저장소 이름과 커밋 제목을 사용합니다. 사실의 근거는 원문에 둡니다.
- 배경 음악은 `assets/music-1.mp3`나 `assets/music.mp3`가 있을 때만 낮게 깝니다.
- 클립 프롬프트(`prompt`)와 음악 설명(`thread.music`)은 이 경로에서 빈칸이어도 됩니다.
- 1280x720 24fps 기준 프레임당 약 0.2초, 2분 40초 회차가 약 12분 걸립니다.

```bash
npm run voice -- out/<slug>                  # 음성만 (있는 파일은 건너뜀, --force로 다시)
npm run render -- out/<slug> --frames=600    # 앞 25초만 preview.mp4로 미리 보기
npm run render -- out/<slug>                 # final.mp4, chapters.json, metadata.json
```

## 파이프라인

```text
devlog/journal/<slug>.md            news 폴더의 journal pull 결과 (발행한 글 + 참고 자료)
      │  npm run plan
      ▼
out/<slug>/episode.json             저장소 세션, 스레드 판정, 장면 뼈대. 편집 칸은 null
out/<slug>/script.md                사람이 읽는 대본
      │  Claude가 빈칸을 채움 → Artlist MCP로 assets/ 생성
      ▼
out/<slug>/assets/clip-*.mp4, voice-*.mp3, music-1.mp3
      │  npm run assemble
      ▼
out/<slug>/final.mp4, chapters.json, metadata.json
      │  npm run upload
      ▼
YouTube 영상 + 저장소별 재생목록,  series.json 갱신 (커밋)
```

1. **입력** `cd news && npm run journal -- pull <날짜>`로 글을 받습니다. 발행한 글만 받아들입니다.
2. **저장소 세션** 참고 자료의 커밋 근거를 저장소별로 되돌리고, 본문 `##` 소제목을 저장소 이름과
   변경 파일 이름으로 배정합니다. 배정되지 않은 소제목은 `unassigned`에 남겨 Claude가 정합니다.
3. **시리즈 판정** `series.json`의 같은 저장소 열린 스레드와 변경 경로 겹침(가중치 2), 키워드
   겹침(가중치 1)으로 점수를 매겨 2점 이상이면 다음 회차로 잇고, 아니면 새 스레드를 엽니다. 마지막
   회차 뒤 `staleDays`(기본 30일)가 지난 스레드는 후보에서 뺍니다.
4. **장면** 세션마다 제목 카드, 본문 소제목당 클립(최대 3개), diff 발췌가 있으면 코드 정지 화면을
   둡니다. 앞뒤로 오프닝과 엔딩 제목 카드가 붙습니다.
5. **생성** Claude가 Artlist MCP로 장면 클립, 장면별 보이스오버, 스레드 고정 음악을 만들어
   `assets/`에 정해진 이름으로 저장합니다. 같은 스레드는 같은 목소리, 음악, 색감을 유지합니다.
6. **조립** 장면 길이는 보이스오버 길이에 맞춥니다. 클립은 짧으면 반복하고 길면 자릅니다. 제목
   카드와 코드 화면은 ffmpeg `drawtext`로 그리고, 자막은 내레이션을 문장 단위로 나눠 굽습니다.
   음악은 낮은 볼륨으로 전체에 깝니다. 챕터 시작 시각을 기록합니다.
7. **업로드** 제목은 `[저장소] 스레드 #회차 · 부제`, 설명에는 요약, 글 링크, 이전 회차 링크, 챕터
   타임스탬프, 커밋 링크가 들어갑니다. 저장소마다 `<저장소> 개발 일지` 재생목록을 만들거나 찾아
   넣고, `series.json`에 회차를 기록합니다.

## 명령

```bash
cd video
npm test
npm run plan -- ../devlog/journal/2026-09-24-devlog.md   # out/<slug>/episode.json, script.md
npm run assemble -- out/2026-09-24-devlog --dry-run       # 빈칸 검사만
npm run assemble -- out/2026-09-24-devlog                 # final.mp4, metadata.json
npm run upload -- out/2026-09-24-devlog --dry-run         # 보낼 메타데이터 확인
npm run upload -- out/2026-09-24-devlog --privacy=private
```

`plan`은 이미 영상으로 만든 글이나 이미 있는 `episode.json`을 덮어쓰지 않습니다. 다시 만들려면
`--force`를 붙입니다. `assemble`은 `episode.json`에 빈칸이 있거나 `assets/`에 파일이 빠지면
목록을 보여 주고 멈춥니다.

## series.json

시리즈 연속성의 원본입니다. 저장소 이름을 키로 스레드 목록을 갖습니다.

```json
{
  "version": 1,
  "staleDays": 30,
  "style": { "voice": "내레이션 목소리 설명", "look": "클립 공통 색감과 공간" },
  "threads": {
    "tkddls8848/game": [
      {
        "id": "game-audio", "name": "오디오 시스템", "status": "open", "music": "Artlist 음악 자산 ID",
        "paths": ["src/audio", "src/audio/mixer.ts"], "keywords": ["mixer", "믹서"],
        "lastDate": "2026-09-24", "lastSummary": "다음 회차 오프닝에서 읽을 두 문장",
        "episodes": [{ "number": 1, "date": "2026-09-22", "slug": "2026-09-22-devlog", "videoId": "...", "subtitle": "...", "summary": "...", "start": 12, "commits": ["abc1234"] }]
      }
    ]
  }
}
```

`paths`와 `keywords`는 회차를 기록할 때마다 누적되어 다음 판정의 근거가 됩니다. 스레드를 끝내려면
`status`를 `closed`로 바꿉니다. 자동 판정이 틀렸을 때는 Claude가 `episode.json`의 `thread`를
고치는 것으로 바로잡으며, `series.json`은 업로드 뒤에만 바뀝니다.

## YouTube 설정

Google Cloud 프로젝트에서 YouTube Data API v3를 켜고 데스크톱 앱 OAuth 클라이언트를 만듭니다.
필요한 범위는 `https://www.googleapis.com/auth/youtube`(업로드와 재생목록)입니다.

```bash
cd video
cp .env.example .env      # YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
npm run auth              # 브라우저 동의 후 YOUTUBE_REFRESH_TOKEN 출력 → .env에 추가
```

`.env`는 커밋하지 않습니다. 운영 전에 알아 둘 점:

- 검수받지 않은 OAuth 앱이 올린 영상은 YouTube가 비공개로 잠급니다. 기본 공개 범위가 `private`인
  이유이며, 공개 전환은 스튜디오에서 직접 하거나 앱 검수를 먼저 받습니다.
- 업로드 한 번의 할당량 비용이 커서 기본 일일 할당량으로는 하루 몇 편만 올릴 수 있습니다.
- Artlist 크레딧은 장면 수에 비례합니다. 스킬은 생성 전에 장면 수와 생성 횟수를 보여 주고 승인을
  받습니다.

## 로컬 요구 사항

### Gemini TTS 내레이션

`video/.env`에 다음을 설정합니다. 키는 저장소에 커밋하지 않습니다.

```dotenv
TTS_PROVIDER=gemini
GEMINI_API_KEY=발급받은_키
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_TTS_VOICE=Charon
```

기본 말투는 한국어로 5년차 개발자가 동료에게 시행착오를 회고하는 차분한 대화체입니다.
`GEMINI_TTS_STYLE`로 말투를 바꿀 수 있고, AI Studio에서 설계한 `voice_...` ID를
`GEMINI_TTS_VOICE`로 지정할 수 있습니다. 말투 지시는 읽을 대본과 분리해 전송합니다.
응답 WAV는 보관하고 ffmpeg로 MP3를 만들어 기존 합성 경로에 연결합니다.

```powershell
cd video
node tools/voice.mjs out/2026-09-26-local-sample --provider=gemini --force
node tools/render.mjs out/2026-09-26-local-sample --frames=720
```

`--force`는 해당 폴더의 기존 음성을 교체합니다. 생략하면 기존 파일은 재사용합니다.
음성 길이가 바뀌므로 영상은 다시 렌더링하고, 이전 프레임을 쓰는 `--resume`은 붙이지 않습니다.
Gemini 오류가 나면 다른 서비스로 자동 전환하지 않고 중단합니다.

[공식 TTS 문서](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)를 기준으로 구현했습니다.
미공개 대본에는 활성 Cloud Billing이 연결된 프로젝트를 사용하세요. 키 문자열만으로 과금 상태를
판별할 수 없습니다. [공식 약관](https://ai.google.dev/gemini-api/terms)에 따르면 무료 서비스의
입출력은 제품 개선에 이용될 수 있으며, 유료 서비스의 입출력은 제품 개선에 사용하지 않습니다.
현재 연결은 개발 일지 영상용이며 다른 프로젝트의 게임 대본을 읽거나 전송하지 않습니다.

### 설치

- Node 20 이상, `ffmpeg`와 `ffprobe`
- 매일 경로: Blender 5(`BLENDER`로 경로 지정, 기본은 Windows 설치 위치), `pip install edge-tts`
- 한국어 글꼴. 기본은 NanumGothic(Windows는 `C:/Windows/Fonts`, Linux는 `/usr/share/fonts/truetype/nanum`)이며
  `VIDEO_FONT`, `VIDEO_FONT_BOLD`로 바꿉니다.
- `VIDEO_MUSIC_VOLUME`(기본 0.12)으로 음악 볼륨을 조절합니다.

테스트는 네트워크, ffmpeg, 비밀값 없이 돕니다. 글 파싱, 세션 배정, 시리즈 판정, 게시 정보,
자막 시간 배분, ffmpeg 인자 구성을 검사합니다.
