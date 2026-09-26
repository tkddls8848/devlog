---
name: devlog-video
description: 발행한 개발 일지 한 편을 저장소별 세션과 시리즈 연속성을 가진 유튜브 영상으로 만든다. Artlist MCP(Seedance 2.5, 보이스오버, 음악)로 자산을 만들고 ffmpeg로 조립해 YouTube에 올린다. /devlog-video <YYYY-MM-DD 또는 slug>
---

# devlog-video

발행한 개발 일지(`devlog_posts.status = 'published'`) 한 편을 유튜브 회차 하나로 만든다.
설계와 운영 절차는 `video/README.md`에 있다. 이 문서는 실행 순서와 멈춤 지점만 적는다.

원칙:
- 커밋이 있는 저장소만 세션으로 만든다. 그날 작업이 없던 저장소는 한 마디도 언급하지 않는다.
- 같은 저장소의 이어지는 작업은 별개 영상이 아니라 같은 스레드의 다음 회차다. `video/series.json`이 원본이다.
- 내레이션은 글과 커밋 근거에서 확인되는 사실만 말한다. 성과, 감상, 시행착오를 지어내지 않는다. `shared/devlog-writing.mjs`의 편집 정책을 그대로 따른다.
- 크레딧이 나가는 생성(2단계)과 업로드(5단계) 앞에서는 반드시 사용자에게 확인을 받는다.

## 0. 준비 확인

```bash
claude mcp list                      # artlist가 연결돼 있어야 한다. 없으면 README의 연결 절차
cd news && npm run journal -- pull <날짜 또는 slug>   # devlog/journal/<slug>.md
cd video && npm test
```

Artlist MCP가 연결되지 않거나 인증에 실패하면 1단계까지만 하고 멈춘다. 예비 생성 경로는 두지 않는다.
처음 연결했다면 MCP가 노출하는 도구 이름과 인자를 확인해 아래 '도구 대응' 표를 고쳐 둔다.

## 1. 계획 만들기와 빈칸 채우기

```bash
cd video && npm run plan -- ../devlog/journal/<slug>.md
```

`out/<slug>/episode.json`이 생긴다. 스크립트는 저장소 세션, 스레드 판정, 장면 뼈대만 만들고
편집 판단이 필요한 칸은 `null`로 둔다. 아래 칸을 직접 채운다.

| 칸 | 채우는 기준 |
| --- | --- |
| `unassigned` | 저장소에 배정되지 않은 본문 소제목. 알맞은 `sessions[].sections`로 옮기고 배열을 비운다. 도입부처럼 특정 저장소 이야기가 아니면 오프닝 내레이션 재료로 쓰고 버린다. |
| `sessions[].thread.name`, `thread.id` | 새 스레드(`isNew: true`)일 때만. 이름은 작업 흐름을 드러내는 명사구(예: 오디오 시스템), id는 `<저장소>-<영문 slug>`. 판정이 틀렸으면 `series.json`의 기존 스레드 id로 바꾸고 `episode`, `previousSummary`, `previousVideoId`, `music`을 그 스레드 값으로 맞춘다. |
| `sessions[].thread.music` | 스레드마다 고정. 새 스레드면 Artlist에서 고른 음악 자산 ID나 생성 프롬프트를 적는다. 이어지는 스레드는 이미 채워져 있다. |
| `sessions[].subtitle` | 회차 부제. 커밋의 핵심 변경을 한 구절로. |
| `sessions[].summary` | 다음 회차 오프닝의 '지난 이야기'가 될 두 문장. 확인된 변경만. |
| `opening.narration` | 이어지는 스레드가 있으면 `previousSummary`로 지난 이야기를 먼저 말하고, 오늘 다룰 저장소를 순서대로 예고한다. 20초 이내. |
| `sessions[].scenes[].narration` | `title`은 저장소와 스레드 회차 소개 한 문장. `clip`은 문제 또는 관찰, 실제 변경, 설계상 의미 순서로 세 문장 안팎. `diff`는 발췌한 코드가 무엇을 하는지 한두 문장. |
| `sessions[].scenes[].prompt` | `clip` 장면의 Seedance 2.5 프롬프트. `style.look`을 앞에 두고 장면의 은유를 붙인다(예: 믹서 채널이 하나 늘어나는 오디오 콘솔). 텍스트나 로고를 화면에 넣지 않는다. 같은 스레드는 색감과 공간을 유지한다. |
| `ending.narration` | 각 스레드의 남은 질문을 다음 회차 예고로. 확정되지 않은 계획은 '확인할 예정'으로만. |

`script.md`는 사람이 읽는 대본이다. `episode.json`을 채운 뒤 다시 만들 필요는 없다.
채운 뒤 `node -e` 대신 `npm run assemble -- out/<slug> --dry-run`으로 빈칸 검사를 돌린다. 문제가 0이어야 한다.

**멈춤 지점 A**: 장면 수, 클립 생성 횟수, 보이스오버 횟수, 이어지는 스레드와 새 스레드를 사용자에게 보여 주고 생성 승인을 받는다.

## 2. Artlist MCP로 자산 생성

`out/<slug>/assets/`에 아래 이름으로 저장한다. MCP가 돌려주는 다운로드 URL을 `curl -L -o`로 받는다.

| 자산 | 파일 이름 | 생성 방법 |
| --- | --- | --- |
| 장면 클립 | `clip-<장면 id>.mp4` | Seedance 2.5, 16:9, 1080p, 10초 안팎, 오디오 없음. `scenes[].prompt` 사용 |
| 보이스오버 | `voice-<장면 id>.mp3` | `style.voice`와 같은 목소리로 장면마다 하나. 본문은 `narration` 그대로 |
| 배경 음악 | `music-1.mp3` | 첫 세션 스레드의 `thread.music`. 영상 전체에 낮게 깐다. 없으면 음악 없이 조립 |

도구 대응(최초 연결 때 `claude mcp list`와 도구 설명을 보고 채운다):

| 용도 | Artlist MCP 도구 | 비고 |
| --- | --- | --- |
| 영상 생성 | `generate_video` | Seedance 2.5 T2V 1080p `modelId 3106`(그룹 515, 720p는 2625). 설정은 `get_model_config`로 확인. 오디오 없는 설정 |
| 보이스오버 | `list_voices` → `generate_voiceover` | ElevenLabs Multilingual v2 `modelId 2061`. 한국어 목소리를 골라 이름을 `series.json` `style.voice`에 기록 |
| 음악 | `generate_music` | Lyria 3 Pro Instrumental `modelId 2285`. `search_music`은 카탈로그 곡을 내려받을 수 없으므로 쓰지 않는다. 스레드별로 같은 생성 결과를 재사용 |
| 자산 다운로드 | `get_generation_status` | 완료 결과의 파일 URL을 `curl -L -o`로 받는다 |
| 비용 확인 | `get_generation_cost`, `get_balance` | 멈춤 지점 A에서 실제 크레딧 비용을 보여 준다. `confirmation_required`가 오면 사용자 승인 뒤에만 `confirmCost: true` |

2026-09-26 확인: 계정이 AI 크레딧 없는 무료 체험이면 Seedance 2.5는 생성할 수 없다. 이 경우 1단계까지만 하고 멈춘다.

생성이 하나라도 실패하면 그 장면만 다시 시도하고, 세 번 실패하면 멈춰서 사용자에게 알린다.
클립은 오디오를 끄고 만든다. 음성은 보이스오버 트랙이 담당한다.

## 3. 조립

```bash
cd video && npm run assemble -- out/<slug>
```

`final.mp4`, `chapters.json`, `metadata.json`이 생긴다. 한국어 자막과 제목 카드에 쓸 글꼴은
`VIDEO_FONT` 환경 변수로 지정한다(기본 NanumGothic). 결과를 `SendUserFile`이나 경로로 알려 주고,
챕터 시작 시각과 제목을 함께 보여 준다.

## 4. 확인

- 챕터 수가 저장소 세션 수와 같은지, 커밋이 없는 저장소 이름이 제목이나 설명에 들어가지 않았는지 본다.
- 이어지는 스레드의 회차 번호와 이전 회차 링크가 `series.json`과 맞는지 본다.

**멈춤 지점 B**: 제목, 설명, 재생목록, 공개 범위를 보여 주고 업로드 승인을 받는다.

## 5. 업로드와 기록

```bash
cd video && npm run upload -- out/<slug> --dry-run      # 보낼 메타데이터 확인
cd video && npm run upload -- out/<slug> --privacy=private
```

검수받지 않은 OAuth 앱이 올린 영상은 YouTube가 비공개로 잠근다. 기본값은 `private`이고 공개 전환은
사용자가 스튜디오에서 한다. 업로드가 끝나면 `series.json`이 갱신되므로 커밋한다.

```bash
git add video/series.json && git commit -m "<slug> 회차를 시리즈 상태에 기록한다"
```

`out/`은 커밋하지 않는다. 대본을 남기고 싶으면 `out/<slug>/episode.json`을 사용자가 정한 곳에 복사한다.
