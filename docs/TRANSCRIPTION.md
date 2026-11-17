# TRANSCRIPTION — 면접 transcript 지침 (Phase 3)

목표: 모의면접에서 녹음한 답변을 글로 바꿔 **세션 기록(질문 + 답변 전사)**을 얻는다. 지금은 브라우저 음성 인식(Web Speech API)이 실시간 전사를 하지만 정확도가 낮고 Firefox에서는 안 된다. 아래 두 경로를 추가한다. 이 문서는 지침이며 구현은 `BUILD_PLAN.md` P3-1 ~ P3-3에서 한다. 다만 브라우저에서 OpenAI 전사 API를 부르는 호출 자체는 기출DB 녹음본 피드백(P2-12)이 먼저 들였다(§2.1, `AIClient.transcribe`). P3-1은 그 호출을 모의면접 화면에 붙이는 일이다.

## 1. 전제

- **Claude API는 오디오 입력을 받지 않는다.** 전사는 OpenAI 전사 API 또는 로컬 모델로 하고, Claude는 전사된 텍스트의 검토·총평에만 쓴다.
- 녹음 파일: 질문별 1개, `audio/webm;codecs=opus`(Chrome) 또는 `audio/mp4`(Safari). 파일명 `<setId>_<mode>_<sessionId>_Q<nn>.<webm|m4a>`. IndexedDB `snu-interview/recordings`에 blob으로 있고, 종료 화면·보관함에서 내려받는다.
- 세션 기록 파일(P1-1): `session-<sessionId>.json`. 전사 결과는 이 파일의 `history[n].a`를 채우거나 별도 `session-<sessionId>.transcript.json`으로 둔다(§3).
- 키 보관: 브라우저 경로는 `localStorage`의 OpenAI 키, 스크립트 경로는 환경변수 `OPENAI_API_KEY`. 저장소에 키·녹음·전사 결과를 커밋하지 않는다(`.gitignore`의 `recordings/`, `transcripts/`).

## 2. 경로 A — 브라우저에서 OpenAI 전사 API (P3-1)

- 옵션 창 "전사"에 세 번째 선택지 **OpenAI 전사** 추가. 모델은 `MODEL_CATALOG.transcription`에서 고른다(기본 `gpt-transcribe`, 대안 `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`). OpenAI 키가 없으면 선택지를 비활성화한다.
- 호출: `POST https://api.openai.com/v1/audio/transcriptions`, `authorization: Bearer <key>`, `multipart/form-data`(`content-type`은 브라우저가 경계와 함께 붙이므로 직접 넣지 않는다). 필드는 모델 계열마다 다르다(OpenAI 문서 2026-11-18 확인):
  - `file`: 녹음 blob. 형식은 flac·mp3·mp4·mpeg·mpga·m4a·ogg·wav·webm, 25MB 이하. 형식 판별에 파일명의 확장자가 쓰인다.
  - `model`: 선택한 전사 모델 id
  - `gpt-transcribe`(권장 모델): `languages[]=ko`(단수 `language` 대신 쓰며 둘을 함께 보내지 않는다), `keywords[]`(낱말·구절을 하나씩. 한 줄이어야 하고 `<` `>` 줄바꿈이 있으면 요청 전체가 거절된다), `prompt`(녹음에 대한 짧은 맥락. 길이 한도를 넘으면 거절된다). 응답은 `{text, languages: [{code}]}`.
  - `gpt-4o-transcribe`·`gpt-4o-mini-transcribe`(문서상 지원 종료 예정, 2027-02-26): `language=ko`, `response_format=json`(json만 지원), `prompt`. 응답은 `{text, usage}`.
  - 힌트: 세트의 고유명사·용어("클루지, 스캐폴딩, 보노보, 흰목꼬리원숭이, …")를 `keywords[]`(또는 gpt-4o 계열의 `prompt`)에 넣어 인식률을 높인다. `set.themes`의 구절과 "제시문"에서 뽑는다.
  - 길이 한도는 문서에 없다. gpt-4o 계열은 모델 문서상 출력이 2,000토큰이어서 긴 녹음은 전사가 끝까지 나오지 않을 수 있다. 질문별 녹음처럼 짧은 단위로 보낸다.
- 흐름: [답변 완료] → 녹음 저장(기존) → 전사 요청(비동기, 질문 카드에 "전사 중…") → 응답 `text`로 `st.transcript`를 바꾸고 textarea에 표시 → 사용자가 고친 뒤 [다음 질문]. 실패하면 브라우저 음성 인식 결과(있으면)를 유지하고 한 줄 오류.
- `timed` 모드에서 전사가 늦으면 다음 질문 생성이 늦어진다. 대응: 전사가 끝나기 전에 [다음 질문]을 누르면 음성 인식 결과(또는 빈 답변)로 진행하고, 전사가 도착하면 `history`의 해당 항목만 갱신한다.
- 비용 기준(2026-11 가격표): `gpt-transcribe` $0.0045/분, `gpt-4o-mini-transcribe` $0.003/분, `gpt-4o-transcribe` $0.006/분. 15분 세션이면 10센트 미만.
- 파일 크기 제한(25MB)은 질문별 녹음에서 문제되지 않는다. 세션 전체 1파일로 바꾸는 경우(Q-5)에는 분할이 필요하다.

### 2.1 기출DB 녹음본 피드백의 전사 (P2-12, 구현됨)

기출DB 세트 상세의 [녹음본 피드백]에 올린 녹음을 글로 바꾼다(`docs/SPEC.md` §3, `docs/AI.md` §3.7). 모의면접 화면의 실시간 전사(P3-1)와는 별개다.

- `AIClient.transcribe(file, set, model)`(`assets/ai.js`)이 위 호출을 한다. 키는 설정의 OpenAI 키, 모델은 패널에서 고른 `settings.transcriptionModel`(기본 `gpt-transcribe`, 목록에 없으면 목록의 첫 모델). 응답의 `text`만 쓴다.
- 힌트: `keywords[]`는 "제시문"과 `set.themes`를 쉼표·가운뎃점·빗금·괄호로 나눈 구절(구절마다 40자, 24개까지, `<` `>` 줄바꿈 제거), `prompt`는 "{학교} 법학전문대학원 면접 문답. 주제: …"(200자 이하). gpt-4o 계열에는 `prompt`만 보낸다.
- 사용자의 파일 이름은 보내지 않는다(`recording.<확장자>`로 올린다). 녹음은 [전사]·[피드백 받기]를 눌렀을 때만 보내고 전사 뒤 메모리에서 버린다. 저장하지 않는다.
- 보내기 전에 확인: 빈 파일, 위 확장자가 아닌 형식(aac 등), 25MB 초과, OpenAI 키 없음 → 요청하지 않고 한 줄 오류.
- 오류는 원인별 한 줄: 401 키, 403 권한, 잔액·결제, 429 호출 한도, 413 크기, 400·415·422 "전사 모델과 녹음 파일(형식·길이)을 확인", 404 전사 모델, 5xx, 연결 실패, 빈 전사. 자동 재시도는 없다. 오류 원문·키·녹음 내용은 화면이나 로그에 남기지 않는다.
- 여러 녹음은 파일 이름 자연 정렬 순서로 하나씩 전사해 `[녹음 n: 파일명]` 줄과 함께 문답 칸에 붙인다. 중간에 실패하면 끝난 파일까지만 남기고 멈춘다(다시 누르면 남은 파일부터). 화자 구분은 하지 않는다(평가 프롬프트가 문맥으로 가른다). 긴 파일의 자동 분할은 하지 않는다.
- 전사본 제시: 전사 결과는 `[녹음 n: 파일명]` 줄과 함께 문답 칸(고칠 수 있는 작업본)에 들어가고, 첨부 목록에 '전사됨 · 전사 모델'이 붙는다. 문답 칸은 [복사]·[내려받기](.txt)할 수 있다. 평가 결과에는 평가한 문답 전문이 저장되어 구간마다 `Q n`·'문답 밖' 머리로 다시 볼 수 있다(`docs/SPEC.md` §3). 시간 표시는 없다: 목록의 `gpt-transcribe`·`gpt-4o-*-transcribe`는 글(`text`)만 주고, 구간 시각(`segments`·`timestamp_granularities`)은 지원 종료 예정인 `whisper-1`의 `verbose_json`에만 있다(2026-11-18 문서 확인). 녹음 길이도 보이지 않는다: 이 사이트의 MediaRecorder webm은 길이 정보가 없어 브라우저가 Infinity로 읽는다.
- 실제 OpenAI 호출은 키가 없어 검증하지 못했다. `tests/ai-client.js`가 요청 형식(주소·헤더·multipart 필드)과 오류 처리를 모의 fetch로 검사한다.

## 3. 경로 B — 배치 스크립트 `tools/transcribe.py` (P3-2)

내려받은 녹음을 한 번에 전사한다. 브라우저 밖에서 돌리므로 로컬 모델도 쓸 수 있다.

- 입력: 폴더 또는 세션 zip(P1-3). 안에 `session-<id>.json`과 녹음 파일들이 있다. `session.json`이 없으면 파일명 규칙(`…_Q<nn>.<ext>`)만으로 순서를 잡는다.
- 백엔드(옵션 `--backend`):
  - `openai`(기본): 위 §2와 같은 API. `OPENAI_API_KEY` 환경변수. 모델 `--model gpt-transcribe`.
  - `local`: `faster-whisper`(`large-v3` 또는 `turbo`), `language="ko"`, GPU 있으면 `device="cuda"`. 의존성은 `tools/requirements.txt`에 적고 기본 설치에는 포함하지 않는다.
- 출력(같은 폴더):
  - `session-<id>.transcript.json`
    ```json
    { "sessionId": "...", "setId": "snu-2023-A", "mode": "timed", "createdAt": 1762070000000,
      "backend": "openai", "model": "gpt-transcribe",
      "items": [ { "n": 1, "question": "네 제시문을 …", "file": "snu-2023-A_timed_…_Q01.webm", "duration": 83.2,
                   "text": "네 제시문은 모두 …", "segments": [ { "start": 0.0, "end": 4.1, "text": "…" } ] } ] }
    ```
    `segments`는 타임스탬프를 주는 백엔드에서만.
  - `session-<id>.transcript.md`: `## Q1 질문` 다음 줄에 전사, 질문 수만큼 반복. 사람이 읽는 용도.
- 옵션: `--prompt-terms`(용어 힌트 파일), `--overwrite`, `--dry-run`(비용 추정만: 총 녹음 길이 × 단가).
- 가져오기(P3-3): 사이트의 종료 화면/지난 세션에서 `.transcript.json`을 열면 `history[n].a`를 `items[n].text`로 바꾸고 세션 기록을 다시 저장한다. 매칭 키는 `file`(녹음 파일명).
- 동작 규칙: 네트워크 오류는 파일 단위로 3회 재시도 후 건너뛰고 끝에 목록 출력. 이미 전사된 파일은 `--overwrite` 없으면 건너뛴다. 키를 로그에 찍지 않는다.

## 4. 전사 뒤 AI 검토(선택)

전사된 세션 기록을 `docs/AI.md` §3.4 총평 호출에 넣는다. Claude로 검토하려면 텍스트만 보내면 되므로 제공사와 무관하다. 전사 텍스트에는 말버릇("어…", "그…")이 섞이므로 총평 프롬프트에 "구어 전사이며 군더더기는 무시한다"를 넣는다.

## 5. 완료 기준

- A: 텍스트 모드가 아닌 음성 세션에서 전사 방식 "OpenAI 전사"를 고르면, [답변 완료] 뒤 5초 안에 전사가 textarea에 들어오고(네트워크 정상 시), 실패 시 기존 전사가 남는다. 키 없으면 선택 불가.
- B: `python tools/transcribe.py <folder>`가 위 JSON/MD를 만든다. `--dry-run`이 길이·추정 비용을 출력한다. 로컬 백엔드는 키 없이 동작한다.
- 가져오기: `.transcript.json`을 넣으면 문답 기록의 전사가 바뀌고 새로 고침해도 유지된다.
