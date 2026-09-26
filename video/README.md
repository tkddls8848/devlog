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

- Node 20 이상, `ffmpeg`와 `ffprobe`
- 한국어 글꼴. 기본은 `/usr/share/fonts/truetype/nanum/NanumGothic.ttf`이며 `VIDEO_FONT`로 바꿉니다.
- `VIDEO_MUSIC_VOLUME`(기본 0.12)으로 음악 볼륨을 조절합니다.

테스트는 네트워크, ffmpeg, 비밀값 없이 돕니다. 글 파싱, 세션 배정, 시리즈 판정, 게시 정보,
자막 시간 배분, ffmpeg 인자 구성을 검사합니다.
