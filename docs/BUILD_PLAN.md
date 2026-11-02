# BUILD_PLAN — 작업 순서와 완료 기준

번호를 커밋·PR에 쓴다. 한 항목이 끝나면 `[ ]`를 `[x]`로. 순서는 위에서 아래가 기본이지만 같은 Phase 안에서는 바꿔도 된다. 모든 항목의 공통 완료 기준: `npm run test:smoke` 통과, 데스크톱 1280/모바일 400, 밝음/어둠, 글자 '아주 크게'에서 깨지지 않음, 콘솔 오류 없음, 키 없는 경로 동작.

## Phase 0 — 워크스페이스 점검

- [x] **P0-1 실행 확인**: `npm install` → `npm run test:smoke` 통과. `index.html`을 `file://`로 열어 네 화면 확인.
- [x] **P0-1a 저장소 초기화**: `.gitignore`에 `/books/`, `/work/`, `__pycache__/`, `*.pyc` 추가, `tools/requirements.txt`(pymupdf 고정), `git init -b main`, 현재 샘플 코드 첫 커밋. 원격 연결은 P0-2.
- [ ] **P0-2 배포 확인**: Q-10 결정 → 저장소 생성 → Pages 먼저 켜기(Settings → Pages → Source "GitHub Actions") → `main` push(`docs/INGEST.md` §3-B 순서. Pages를 켜기 전에 push하면 첫 실행이 실패한다) → 배포된 주소에서 모의면접 텍스트 모드 한 바퀴와 `SMOKE_BASE_URL` 스모크. 준비(네 HTML `noindex` meta, `pages.yml` 아티팩트는 사이트 파일만)는 완료(2026-11-03).
- [x] **P0-2a 배포본 스모크**: `tests/smoke.js`에 `SMOKE_BASE_URL`(후행 슬래시 정규화, `goto` timeout 60초). 로컬 file://·http(`npx serve`, `serve.json`) 통과(2026-11-03). 배포 주소 실행은 P0-2에서.
- [x] **P0-3 데이터 검증**: `node tools/validate-data.js` 통과(세트 id 유일, 제시문·질문 수 출력).

## Phase 1 — 모의면접·기출DB 마무리

- [ ] **P1-1 세션 기록 내보내기**: 종료 화면에 [기록 내려받기] → `session-<sessionId>.json`(세트·모드·옵션·plan·history[{q,a,recFilename,duration}]·memo·createdAt)과 같은 내용의 `.md`. 형식은 `docs/TRANSCRIPTION.md` §3과 같아야 한다(전사 스크립트가 읽는다).
- [ ] **P1-2 세션 기록 보관**: IndexedDB에 store `sessions` 추가(keyPath `id`), 종료 시 저장. 설정 화면 하단 "녹음 보관함"을 "지난 세션"으로 바꿔 세션별로 묶어 보여 준다(펼치면 녹음 목록). 녹음 레코드의 `sessionId`로 연결.
- [ ] **P1-3 녹음 zip 일괄 내려받기**: 세션 단위 zip(녹음 파일 + `session.json`). 외부 라이브러리 금지 → store-only(무압축) zip을 직접 만든다(로컬 파일 헤더 + 중앙 디렉터리, CRC32 구현 필요). 파일명 규칙은 유지(`<setId>_<mode>_<sessionId>_Qnn.<ext>`).
- [ ] **P1-4 기출DB 스레드 내보내기**: 세트 단위로 `db-<setId>.md`/`.json`. 전체 내보내기/가져오기(병합, 같은 키는 최신 `at` 우선).
- [ ] **P1-5 설정 내보내기/가져오기**: API 키 제외한 설정 JSON. 가져오기 시 키 유지.
- [ ] **P1-6 오류 경로 정리**: 마이크 거부(텍스트 모드 전환 안내 한 줄), IndexedDB 불가(메모리만), 음성 인식 중단(재시작 실패 시 직접 입력 textarea 노출), AI 4xx/5xx(키 오류와 과금 오류 구분해 한 줄 표시). 모든 오류는 `.callout`으로 질문 카드 안에.
- [ ] **P1-7 키보드**: 면접 화면에서 `Space` 답변 시작/완료(텍스트 입력 중에는 제외), `Enter`+`Ctrl` 제출/다음, `Esc` 질문 다시 듣기 취소. 설정 화면 단계 이동은 기존 클릭 유지.
- [ ] **P1-8 접근성 점검**: 포커스 순서, `aria-pressed`/`aria-current` 일관, 진행 바 시계 `aria-live="off"`(초 단위 낭독 금지), 노크 표시는 `role="status"`.
- [ ] **P1-9 기출DB 표시 개선**: 주제 가림(목록·상세 공통, 저장), 최신순·과거순 정렬, 질문 번호 왼쪽 여백. 작성 중 답변·선택 세트 보존, 모바일·어둠·큰 글자 검증.
  - 2026-11-03 구현·문법 검사 완료. 화면 회귀 추가. Windows 격리 환경에서 Chrome 시작 오류로 스모크·시각 검증 대기.

## Phase 2 — AI 면접관 고도화

- [ ] **P2-1 결정 트리 생성 파이프라인**: `tools/gen_tree.py` 또는 브라우저 안 "트리 생성"(둘 중 하나, `docs/DECISIONS.md` Q-3). 입력: 세트(제시문 전문 + 복기 질문 전체) + 난이도 정의. 출력: `tree` 객체(깊이 6~10, 분기 2~3, `when`은 상호배타적 분류 조건). 프롬프트는 `docs/AI.md` §6. 생성 결과는 `data/questions.js`의 해당 세트 `trees: { low, mid, high, max }`로 넣고(기존 `tree`는 `trees.mid`로 이동), 실행기는 난이도에 맞는 트리를 고른다.
- [ ] **P2-2 분류 호출 개선**: `classify`에 직전 질문과 (옵션) 제시문 요약을 넣을지 실험. 결과를 `docs/DECISIONS.md` Q-2에 기록.
- [ ] **P2-3 종료 후 총평**: 종료 화면 [AI 총평] → 세션 history 전체 + 제시문 전문 → `{summary, strengths[], gaps[], next[]}`. 모델은 세션 AI 설정. 결과를 세션 기록에 저장.
- [ ] **P2-4 모델 목록 자동 조회**: 설정 서랍 [목록 갱신] → Anthropic `GET /v1/models`, OpenAI `GET /v1/models`로 `data/models.js` 목록을 보강(브라우저 localStorage `snu-model-cache-v1`). 실패해도 정적 목록은 유지.
- [ ] **P2-5 키 유효성 검사**: 설정 서랍 [저장] 뒤 가벼운 호출(모델 목록 조회)로 확인, 결과를 상태 줄에 표시.
- [ ] **P2-6 비용·호출 로그**: 세션당 호출 수·추정 토큰을 종료 화면에 한 줄. 저장은 세션 기록 안에.
- [ ] **P2-7 effort·JSON 응답 안정화**: 설정·모의면접·기출DB 공통 effort 슬라이더, 모델별 지원 값 전송, 구조화 출력·필수 필드 검증, 추론 예산 및 출력 잘림 재시도, 빈 응답·거부 구분. 모의 API 회귀·스모크 검증.
  - 2026-11-03 구현, `npm run test:ai` 모의 API 14개·데이터 검증 통과. 실제 API 키 환경변수 없음으로 실호출 생략. 위 Chrome 시작 오류로 스모크 대기, 완료 표시는 보류.
- [ ] **P2-8 AI 예시답변·제시문 해설**: 질문별 예시 두 가지 이상·의의·유의점, 추가질문 전체를 고려한 제시문 해설·출전 검토·실제 서가 연결. API 키 / AI 면접관 / AI 면접해설 설정 분리, 브라우저 캐시·재생성·중복 호출 방지. 질문 행 여백은 이전의 75%(PC 13.5px·모바일 12px)로 조정하고 문답·예시답변을 정렬한다. 기출 원문 및 학교별 DB 수록과 분리.
  - 구현·문법 검사, 데이터 검증(55세트·102변형), `test:ai` 21개·`test:study` 19개 통과. 화면 회귀 추가. `test:smoke`는 브라우저 시작 오류(Code 3221225506)로 실행 전 중단. 실제 API 호출·시각 검증은 미실시, 완료 표시는 보류.

## Phase 3 — 전사(transcript)

지침: `docs/TRANSCRIPTION.md`. 구현 전 Q-4 결정.

- [ ] **P3-1 브라우저 전사(OpenAI)**: 전사 방식에 "OpenAI 전사" 추가. [답변 완료] 뒤 녹음 blob을 `POST /v1/audio/transcriptions`(모델은 `MODEL_CATALOG.transcription`에서 선택)로 보내고 결과로 전사를 대체. 실패 시 브라우저 음성 인식 결과 유지. 진행 중 표시, 취소 가능.
- [ ] **P3-2 배치 전사 스크립트**: `tools/transcribe.py` — 내려받은 세션 zip/폴더 → 전사 → `session-<id>.transcript.json` + `.md`. OpenAI 또는 로컬 faster-whisper 선택. 키는 환경변수.
- [ ] **P3-3 전사 가져오기**: 종료 화면/지난 세션에서 `.transcript.json`을 가져와 문답 기록의 전사를 갱신.

## Phase 4 — 데이터 확장

- [ ] **P4-1 서울대 세트 전체(2019~2025, 18세트, 복기본 3종)**: 계획 `docs/INGEST.md` §2. 교재 2권(`books/`)에서 옮긴다. 제시문은 원문 그대로(OCR 오인식 교정만), 각주는 `source`에. 하위 항목 순서대로.
  - [x] **P4-1a 교재 추출·정제·조립·대조**: `tools/book_extract.py` → 파일럿 6쪽 → Workflow `ingest-ocr`(Haiku 정제. Sonnet 이미지 검증은 파일럿 6쪽만, 이후 생략) → `tools/check_ocr.py` → `tools/assemble_sets.py` → 기존 5세트 대조 보고(`work/reports/existing-diff.md`, Q-13 승인 대기) → Workflow `ingest-themes`(Sonnet, 주제어·태그). 통합은 P4-1e. 산출물은 `work/`(커밋 안 함).
  - [x] **P4-1b 변형 스키마**: `variants`/`variant`/제시문 `label`·`kind: case`/`tree.basis`, `SNU.db` 해석(`db.set(id, v)`, `schools()/sets()`도 해석본), 설정 `variant`, 기출DB 키(kim 무접두사, 그 밖 `<variant>/`), `tools/validate-data.js`와 `docs/DATA.md` 같은 커밋. 원본은 `data/sets/`(JSON), `tools/build_questions.js`가 `data/questions.js`를 생성.
  - [x] **P4-1c 변형 UI**: 기출DB 세트 머리·모의면접 3단계·설정 서랍 "복기본" seg(눌림은 실효 변형, 비활성은 세트에 없는 변형), 세트 행 칩, 홈 연도별 묶음, `practice.js` 세션 변형 고정, 트리 `basis` 불일치 시 은행/실시간, `AI.md` §2 라벨 표기.
  - [x] **P4-1d 데이터 생성**: 조립된 kim 18·hwang 13 변형을 `data/sets/`에 넣고 `tools/build_questions.js` → `data/questions.js`(세트 18, 변형 31), validate 통과, 스모크(세트 18, 기출DB는 kim 고정, seg 전환, `snu-2019-C` 비활성) 통과, 표본 8쪽 이미지 대조(사용자 결정으로 생략), `README.md` 자료 출처 두 권.
  - [x] **P4-1e 통합본(merged)**: 2021~2025 겹치는 13세트 중 9세트(2021-B·C, 2022-A·B, 2023-B, 2024-A·B, 2025-A·C)의 `data/sets/<id>/merged.json`. GPT(Codex)가 `docs/MERGE_PROMPT.md`대로 main 작업 트리에서 만들고 독립 검토(`work/reports/merge-summary.md`), `tools/check_merged.py`로 점검(`work/reports/merged-check.md`), `meta.json`의 `variant`를 `merged`로, 생성(세트 18, 변형 40)·validate·스모크 통과.
    - [ ] 날조 의심 4문장 확인: 2021-B 제시문 4의 2문장·2025-C 제시문 3의 1문장(두 원문 구절 결합), 2021-C 제시문 4의 1문장(황변 복기자 주석 「(A는 미상)」 제거). 고칠지는 사용자 결정.
    - [ ] 보류 4세트: 2021-A·2023-A·2024-C·2025-B는 두 복기의 사실 서술이 충돌해 통합하지 않고 `variant: "kim"` 유지(Q-16, `work/reports/merge-rejected.md`).
- [ ] **P4-2 다른 학교 세트**: 고려대·연세대·성균관대·한양대·서강대·중앙대·경희대·한국외대·이화여대. 학교별 `format`(진행 방식·시간표)도 채운다. 시간표가 다르면 옵션 창 기준값 표시가 그 학교 값을 쓴다(이미 그렇게 되어 있다). 같은 파이프라인(`docs/INGEST.md` §8), 학교별 설정만 바꾼다.
  - [x] **P4-2a 학교별 수록 도구**: `tools/schools/<id>.json`(쪽 범위·세트 머리·세션 기호·OCR 학교 주석·조립 선택지)과 선택 hook, `assemble_sets`·`check_ocr`·`promote_sets` 학교 인자, `build_questions.js --school/--out`·`validate-data.js --in`, `tools/workflows/`(ingest-ocr·ingest-typo·ingest-themes), `ocr_args.py`·`apply_fixes.py`, 변형 `tasks`·`figure`·라벨 완화(`DATA.md` 규칙 1·9~11). 서울대 재조립 회귀 0건.
  - [x] **P4-2b 고려대**(김 p136–158 · 황 p287–295), **P4-2c 연세대**(김 p421–448 · 황 p389–401), **P4-2d 성균관대**(김 p332–359 · 황 p354–363), **P4-2e 한양대**(김 p846–864 · 황 p585–593): 학교 세션이 `INGEST.md` §8-4대로 OCR·오탈자 검수·조립·승격·주제어·format 제안, 메인 세션이 §8-5대로 통합·검증·학교마다 커밋. 완료 기준: validate·스모크 통과, `work/reports/<id>-summary.md`, 새 학교 세트가 홈·기출DB·모의면접에서 열린다. 결과: 고려대 7·연세대 9·성균관대 14·한양대 7세트(변형 김종수 35·황변 27), 홈 학교 토글.
  - [x] **P4-2f 문제지 문항 표시**: 변형 `tasks`를 지시문 상자(`.instr`)와 AI 입력(`setContext`의 `[문제]`)에. `[사례 1]`류 라벨의 제시문 머리 표기. Q-17. 세트 행 '복기 질문' 수에 문항 포함, 스모크 단언(문항만 있는 세트).
  - [ ] **P4-2g 통합본(merged) — 4개 학교**: GPT-6 Astra급 모델. `docs/MERGE_PROMPT.md`를 학교 공통으로 고치고(문항 `tasks` 통합 규칙 포함) 두 책에 모두 있는 세트만.
  - [ ] **P4-2h 서강대**(김 p234–258 · 황 p317–325)·**중앙대**(김 p703–739 · 황 p520–540): P4-2b~e와 같은 절차(학교 세션 `INGEST.md` §8-4, 메인 세션 §8-5). 통합본은 P4-2g와 함께 나중에.
  - [ ] **P4-2i 나머지 학교**: 경희대·한국외대·이화여대(`INGEST.md` §8-1 정찰값).
- [ ] **P4-3 세트 메타**: `themes`에 더해 `tags`(법철학·정치·과학기술·…)를 넣고 기출DB에 태그 필터. 서울대 태그 값은 P4-1a에서 만든다.
- [ ] **P4-4 서울대 반영 후 개선**(배포 뒤, 항목마다 커밋): **a** 홈 18행 연도 묶음·모바일 400 줄바꿈, **b** 변형 seg·칩의 어둠 테마·'아주 크게', **c** AI 입력 길이(`AI.md` §7 추정·`max_tokens`), **d** 기출DB `?variant=` 병행·키 접두사 확인, **e** 안드로이드 Chrome 실기기 1회, **f** 문서(`README`·`DATA`·`AI`·`BUILD_PLAN` 상태).

## Phase 5 — 서가 보류 기능

- [ ] **P5-1 연결 지도**(SVG 보드, `edges` 데이터), **P5-2 효용–비용 산점도**(`s` 점수), **P5-3 읽는 범위–쟁점 그래프**, **P5-4 쟁점×분야 매트릭스**, **P5-5 진도 내보내기/가져오기**. 원본 HTML의 구현을 참고하되 토큰·컴포넌트는 이 사이트 것으로.
- [ ] **P5-6 `data/library.js` 지연 로드**: 720KB. 서가 페이지에서만 로드되는지 확인하고, 홈에서 서가 데이터를 쓰지 않도록 유지.

## Phase 6 — 품질

- [ ] **P6-1 PWA**: `manifest.webmanifest` + 서비스 워커(정적 파일 캐시, 네트워크 우선). 설치 아이콘. AI 호출은 캐시 제외.
- [ ] **P6-2 실기기 점검**: 안드로이드 Chrome, iOS Safari(녹음 mp4, 음성 인식, wakeLock 미지원 대응).
- [ ] **P6-3 테스트 확대**: `tests/smoke.js`에 기출DB 스레드·설정 서랍·다크 모드 스크린샷 비교(픽셀 비교는 하지 않고 DOM 상태 단언).
- [ ] **P6-4 README 정리**: 사용자용 README(실행·배포·백업 방법) 분리.
