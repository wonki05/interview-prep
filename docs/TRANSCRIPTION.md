# TRANSCRIPTION — 면접 transcript 지침 (Phase 3)

목표: 모의면접에서 녹음한 답변을 글로 바꿔 **세션 기록(질문 + 답변 전사)**을 얻는다. 지금은 브라우저 음성 인식(Web Speech API)이 실시간 전사를 하지만 정확도가 낮고 Firefox에서는 안 된다. 아래 두 경로를 추가한다. 이 문서는 지침이며 구현은 `BUILD_PLAN.md` P3-1 ~ P3-3에서 한다.

## 1. 전제

- **Claude API는 오디오 입력을 받지 않는다.** 전사는 OpenAI 전사 API 또는 로컬 모델로 하고, Claude는 전사된 텍스트의 검토·총평에만 쓴다.
- 녹음 파일: 질문별 1개, `audio/webm;codecs=opus`(Chrome) 또는 `audio/mp4`(Safari). 파일명 `<setId>_<mode>_<sessionId>_Q<nn>.<webm|m4a>`. IndexedDB `snu-interview/recordings`에 blob으로 있고, 종료 화면·보관함에서 내려받는다.
- 세션 기록 파일(P1-1): `session-<sessionId>.json`. 전사 결과는 이 파일의 `history[n].a`를 채우거나 별도 `session-<sessionId>.transcript.json`으로 둔다(§3).
- 키 보관: 브라우저 경로는 `localStorage`의 OpenAI 키, 스크립트 경로는 환경변수 `OPENAI_API_KEY`. 저장소에 키·녹음·전사 결과를 커밋하지 않는다(`.gitignore`의 `recordings/`, `transcripts/`).

## 2. 경로 A — 브라우저에서 OpenAI 전사 API (P3-1)

- 옵션 창 "전사"에 세 번째 선택지 **OpenAI 전사** 추가. 모델은 `MODEL_CATALOG.transcription`에서 고른다(기본 `gpt-transcribe`, 대안 `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`). OpenAI 키가 없으면 선택지를 비활성화한다.
- 호출: `POST https://api.openai.com/v1/audio/transcriptions`, `authorization: Bearer <key>`, `multipart/form-data`:
  - `file`: 녹음 blob (파일명은 녹음 파일명 그대로; 확장자가 mime과 맞아야 한다)
  - `model`: 선택한 전사 모델 id
  - `language`: `ko`
  - `response_format`: `json` (텍스트만) — 타임스탬프가 필요하면 `verbose_json`(모델이 지원할 때만)
  - `prompt`(선택): 세트의 고유명사·용어("클루지, 스캐폴딩, 보노보, 흰목꼬리원숭이, …")를 쉼표로 이어 넣어 인식률을 높인다. `set.themes`와 제시문의 `<제시문 n>` 제목에서 뽑는다.
- 흐름: [답변 완료] → 녹음 저장(기존) → 전사 요청(비동기, 질문 카드에 "전사 중…") → 응답 `text`로 `st.transcript`를 바꾸고 textarea에 표시 → 사용자가 고친 뒤 [다음 질문]. 실패하면 브라우저 음성 인식 결과(있으면)를 유지하고 한 줄 오류.
- `timed` 모드에서 전사가 늦으면 다음 질문 생성이 늦어진다. 대응: 전사가 끝나기 전에 [다음 질문]을 누르면 음성 인식 결과(또는 빈 답변)로 진행하고, 전사가 도착하면 `history`의 해당 항목만 갱신한다.
- 비용 기준(2026-11 가격표): `gpt-transcribe` $0.0045/분, `gpt-4o-mini-transcribe` $0.003/분, `gpt-4o-transcribe` $0.006/분. 15분 세션이면 10센트 미만.
- 파일 크기 제한(25MB)은 질문별 녹음에서 문제되지 않는다. 세션 전체 1파일로 바꾸는 경우(Q-5)에는 분할이 필요하다.

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
