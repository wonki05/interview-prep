# INGEST — 기출 교재 → 기출DB 파이프라인 (단계 1·2 계획)

`books/`의 복기 교재 2권을 OCR·정제·통합해 `data/questions.js`에 넣고, GitHub Pages로 게시하는 작업의 계획. 단계 (1) 서울대 전체 분석·DB화, (2) 게시·개선을 다룬다. (3)~(6) 다른 학교는 같은 파이프라인에 페이지 범위만 바꿔 적용한다(§8). 실행 항목은 `BUILD_PLAN.md`에 번호로 등록되어 있다(P0-1a, P0-2, P0-2a, P4-1a~d, P4-4a~f). 열린 질문은 `DECISIONS.md` Q-9~Q-15.

초안을 4개 렌즈(데이터 충실도·코드 호환·요구 충족·배포/법적 위험)로 비평하고 반박 검증한 결과(유지 43건)를 반영한 2판이다. 3판(2026-11-02 실행 중): 세트 원본을 `data/sets/`(커밋)로, 조립을 결정적 스크립트로, 통합본(2-E)은 사용자 결정에 따라 GPT가 별도 브랜치에서 만들도록 바꿨다.

## 0. 자료 현황 (2026-11-02 조사)

| 항목 | 김종수 『로스쿨 면접 200주제』 3권 기출편(2026) | 『황변과 함께하는 로스쿨 면접 Q』 1권(2026) |
|---|---|---|
| 파일 | `books/2026학년도 김종수 로스쿨 면접 3권 (기출편).pdf` (513MB, 868쪽) | `books/2026학년도 황변 로스쿨 면접 1권.pdf` (403MB, 596쪽) |
| 형식 | 스캔 + ABBYY FineReader 텍스트층(PDF 1.4), 책갈피 없음 | 같음 |
| 텍스트층 품질 | 본문은 읽히나 오인식 잦음(서울→서물, Q1→Ql/QI, Q10→Q1O, 추가→幸가/孝가, 제시문→쩨시문, ※→宗/乂, 하이픈→~). 그림 배지(학생 라벨)·옆탭·QR 캡션이 잡문자로 섞이고 위치가 어긋남 | 같음. 띄어쓰기 소실 잦음("받을수", "진실을모르고"), 머리 번호 누락(2023 오후 [3]) |
| 서울대 구간 | PDF p259–314(인쇄 255–310). `서울대 로스쿨 (2025~2019)` → 연도별 `문제`(p259–302) → `해설`(p303–314) | PDF p326–348(인쇄 324–346). `09 서울대` 면접장 스케치(p326) → `20xx학년도 기출문제`(p327–348) |
| 세트 머리 | `2025 문제` 표(진행 방식) → `서울 A 문제 ※[가군 오전]` / `서울 B ※[가군 오후]` / `서울 C ※[특별전형]`. 지시문 형식은 연도마다 다름(태그 없음, 괄호 부기, 2019형) | `• 오전` / `• 오후` / `• 특별전형` |
| 제시문 표기 | 2020~2025 `<제시문 n>`(머리줄에 출처 병기하기도, 각주 ①②③은 쪽 아래). 2019 `（가）～（라）`. 2020 A/B는 `<제시문 4>` 뒤 `＜사례＞` 블록(과제문 포함) | `제시문 n〉`(변형 `）`, `)`, `>`, `제시 문n〉`) + `(A4 분량)` + `(출처: …)`. 2023 오전·오후는 `제시문〉` 머리 하나 아래 `[1]～[4]` |
| 질문 표기 | `A학생/B학생/C학생 추가질문` 배지(그림) 아래 `Q1, Q2-1, Q3~2…`. 배지 없는 묶음도 있음. 묶음이 다음 쪽으로 이어짐 | `질문〉` 아래 `•` 글머리, 학생 구분 없음. `참고〉` 보충, 질문 안 괄호 주석, `/`로 두 질문 병기 |
| 복기자 메타 | `•••（중략）`, `기준（표로 정리되어 있었으며…）` | `…에 대한 제시문.`, `(… 조항 일부 제시)`, `（...）`, `학자A(A는 미상)` |
| 세트 수 | 18: 2025 A/B/C · 2024 A/B/C · 2023 A/B · 2022 A/B · 2021 A/B/C · 2020 A/B · 2019 A/B/C | 13: 2025 오전/오후/특별 · 2024 오전/오후/특별 · 2023 오전/오후 · 2022 오전/오후 · 2021 오전/오후/특별 |
| 분량 | 약 80,000자(해설 포함), `Q` 줄 약 325개 | 약 42,000자, 글머리 줄 약 226개 |

- 겹치는 세트 13(2021~2025). 겹치는 세트는 두 책 모두 제시문 4개이고 순서가 같다. 2019·2020의 5세트는 김종수에만 있다.
- 두 복기의 성격이 다르다. 황변은 더 길고 매끈한 복원이 많고(2025 오전 제시문 1·3), 어떤 세트는 요약(2024 오전·오후 3~5줄)이거나 현대어 풀이(2021 오전 제시문 2)다. 김종수는 원문 문체(서유견문)를 살린 전문이 많다.
- 현재 `data/questions.js`의 5세트(2021 A/B/C, 2023 A/B)는 김종수 복기를 옮긴 것이다. 책 텍스트층과 문자 단위로 대조하니 94~100% 일치하고 차이는 따옴표 모양·OCR 잡음·`⑴→(1)` 정리뿐이다. 단, 2021-A의 `common` 두 묶음("공통" 4문, "공통 같은 선택" 1문)은 책의 서울대 구간에 없다(§2-D).
- 도구: Python 3.12 + pymupdf·pdfplumber·opencv·easyocr, Node 24, git 2.53(전역 user.name wonki05, user.email 학교 메일), winget. 없음: tesseract, `gh`, `node_modules`(puppeteer 미설치), git 저장소(초기화 전).

## 1. 모델 배정

사용자 지침: 단순 작업은 하위 모델, 고난도 사고일수록 상위 모델, 총괄은 최상위 모델. 모델이 필요 없는 작업은 스크립트로 한다(모델을 거치면 원문이 바뀔 위험만 생긴다).

| 작업 | 실행 | 비고 |
|---|---|---|
| 총괄(페이지 지도, 파일럿 판정, 단계 간 판단, 최종 검수, 코드) | Claude Fable 5.1(이 세션, Ultracode) · 대안 Opus 5.5 / GPT-6 Astra | 메인 세션 + Workflow 스크립트 |
| 추출·조립·결정적 점검·데이터 파일 생성 | 스크립트(`tools/*.py`) | 모델 없음 |
| 쪽 단위 OCR 정제(이미지 + ABBYY 텍스트 → 블록 JSON) | Claude Haiku 5.5 | Workflow `agent(model: "haiku")`. effort는 파일럿으로 정함 |
| 쪽 단위 정제 검증(이미지 대조) | Claude Sonnet 5.5 | Workflow `agent(model: "sonnet")` |
| 조립 검증에 걸린 세트 판단, 세트별 주제어 초안, 태그 | Claude Sonnet 5.5 | Workflow `agent(model: "sonnet")`, 세트당 1회 |
| 두 복기 통합(통합 제시문·통합 질문 은행) | GPT 계열(Codex 등, 사용자 결정 2026-11-02) | 브랜치·워크트리 `snu-merge`, 지시문 `docs/MERGE_PROMPT.md`. Fable 5.1은 생성하지 않는다 |
| 통합본 검증(날조·누락·일관성 3렌즈) | GPT 별도 호출(기본) · 선택적으로 Opus 5.5 | `MERGE_PROMPT.md` §5 |
| GPT-6.1 Terra 대체 정제(선택, `OPENAI_API_KEY` 있을 때만) | Haiku가 2회 실패한 쪽의 대체 정제기(`tools/ocr_refine_openai.py`, 같은 블록 스키마) | 키 없으면 Claude 계열만 |

- Workflow의 `agent()`는 모델을 지정하지 않으면 세션 모델(Fable 5.1)을 쓴다. 하위 모델은 반드시 `model`을 명시한다. 에이전트는 Read 도구로 쪽 PNG를 본다.

## 2. 단계 1 — 서울대 기출 전체 분석·DB화

중간 산출물은 `work/`(git 무시)에, 세트 원본 JSON은 `data/sets/`(커밋)에 둔다. `data/questions.js`는 `data/sets/`에서 생성한다(`DATA.md` §1.1).

```
work/
  books/kim/pages/p0259.png, p0259.txt …    쪽 이미지(150dpi 회색조) + ABBYY 텍스트
  books/hwang/pages/p0326.png, p0326.txt …
  books/kim/map.json, books/hwang/map.json   세트 ↔ 쪽 범위 지도(대조용. 경계는 set-head 블록으로 가름)
  ocr/kim/p0259.json …                        쪽 단위 정제 결과(블록 목록 + 검증 결과)
  sets/kim/snu-2025-A.json …                  OCR 조립본(변형 단위). 승격 전 중간 산출물
  sets/hwang/snu-2025-A.json …
  commentary/snu-2025-A-commentary.json …     김종수 해설(Q-11, 커밋 안 함)
  reports/…                                   파일럿·점검·조립·대조 보고서
data/sets/
  _db.json                                    levels + 학교 목록
  snu-2025-A/meta.json, kim.json, hwang.json  세트 공통 필드 + 복기본 변형(merged.json은 P4-1e에서 GPT가 추가)
```

### 2-0 준비 (P0-1a)

- `.gitignore`에 `/books/`, `/work/`, `__pycache__/`, `*.pyc` 추가(`*.pdf`는 넣지 않는다. `/books/`와 중복이고 다른 PDF까지 막는다). `tools/requirements.txt`에 pymupdf 버전 고정.
- `git init -b main` → `npm install` → `npm test` 통과 → 현재 샘플 코드 첫 커밋. 이후 2-F의 변경은 항목(P4-1b/c/d)마다 커밋한다. 원격 연결·push는 단계 2.
- 커밋 전 `git status --short`로 `books/`·`work/`가 없는지 확인.

### 2-A 추출·지도 (스크립트)

- `tools/book_extract.py <pdf> <tag> <from>-<to>`: pymupdf로 쪽 이미지(150dpi, 회색조 PNG)와 텍스트층을 `work/books/<tag>/pages/`에 저장. 김종수 p259–314, 황변 p326–348. 100dpi 표본(707×1014px)으로도 본문 글자와 줄 안 공백이 판독되므로 150dpi로 시작하고, 파일럿(2-B 0)에서 작은 글자(출처·분량 표기) 오류가 나오면 200dpi나 상·하 분할을 검토한다.
- 페이지 지도 `map.json`: `[{ set, pages: [from, to] }]`. 총괄이 머리말 패턴(`20xx 문제`, `서[울물] [ABC] 문제`, `20xx학년도 기출문제`, `• 오전/오후/특별전형`, `해설`)으로 만들고, Sonnet 에이전트 하나가 쪽 이미지로 경계를 확인한다. 세트 범위는 머리말이 있는 쪽부터 다음 세트 머리말이 있는 쪽까지이며 그 쪽은 두 세트가 공유한다. 한 쪽 안의 경계는 2-B의 `set-head` 블록으로 가른다(2-C).
- 세트 id는 `snu-<year>-<A|B|C>`(오전=A, 오후=B, 특별전형=C. 기존 5세트와 같은 규칙).
- `name`은 `school.short` + 세션 기호: 서울대 A/B/C. `DATA.md` 규칙 8.

| 세트 | 김종수(PDF p) | 황변(PDF p) |
|---|---|---|
| snu-2025-A/B/C | 259–261 / 261–263 / 263–265 | 327–328 / 328–330 / 330–331 |
| snu-2024-A/B/C | 266–268 / 269–270 / 271–272 | 332–333 / 333–334 / 334–335 |
| snu-2023-A/B | 273–275 / 275–277 | 335–337 / 337–339 |
| snu-2022-A/B | 278–279 / 280–281 | 339–341 / 341–342 |
| snu-2021-A/B/C | 282–285 / 286–288 / 289–290 | 343–345 / 345–347 / 347–348 |
| snu-2020-A/B | 291–294 / 295–296 | — |
| snu-2019-A/B/C | 297–298 / 299–300 / 301–302 | — |
| 진행 방식 | 259(2025 표) | 326(면접장 스케치) |
| 해설 | 303–314 | — |

공유 쪽: 김 261, 263, 275 · 황 328, 330, 333, 334, 335, 337, 339, 341, 345, 347. 해설 12쪽은 정제까지만 하고 `work/`에 둔다(Q-11).

### 2-B 쪽 단위 OCR 정제 (Haiku → Sonnet 검증)

**0. 파일럿**: 책마다 3쪽(김 260·261·297 — 질문 쪽·경계 쪽·(가)(나) 쪽, 황 327·337·345 — 제시문 쪽·[n] 쪽·경계 쪽)을 아래 1→2로 돌리고 총괄이 이미지와 직접 대조한다. 여기서 effort(low vs 기본)와 해상도를 정한 뒤 79쪽에 적용한다. 결과는 `work/reports/pilot.md`. 결과(2026-11-02): 6쪽 모두 검증 통과(황 327만 3회 시도), 글자·라벨·배지·대화체 정확. effort 기본값, 150dpi 유지. 에이전트당 도구 호출 약 20회(반복 Read·확대)로 1.8M 토큰이 들어, 전체 실행에는 "Read 2회 → 출력" 호출 상한을 넣었다.

**1. 정제(Haiku 5.5)**. Workflow `ingest-ocr`: 79쪽을 `pipeline()`으로(쪽마다 독립). 입력 = 쪽 PNG + ABBYY 텍스트 + 책별 표기 규칙(§0 표). 출력(JSON 스키마 강제):

```
{ page, blocks: [ { type, text, label?, marker?, cont?, note? } ] }
type: year-head | format | set-head | instruction | passage-head | para | footnote | source | length | meta | ellipsis | q-group | q | ref | skip
```

- 글자는 이미지에 있는 대로 적는다(오인식만 교정). 줄 안 띄어쓰기는 이미지 기준, 줄 끝 이음은 어절 판단, 쪽 경계에서 갈라진 문단·질문 문장은 첫 블록에 `cont: true`(조립이 직전 쪽 마지막 블록에 이어 붙이고 보고서에 이음 자리를 적는다). 쪽 머리에 `q-group` 없이 이어지는 질문은 표시 없이 `q`로 적고 조립이 직전 묶음에 넣는다. 도구 호출은 Read(이미지)·Read(텍스트층)·출력 세 번으로 제한한다.
- 텍스트층과 이미지의 블록 순서가 어긋나면 이미지 순서를 따른다(배지·QR 캡션이 텍스트층에서 엉뚱한 자리에 놓인다).
- `passage-head`: 머리 패턴 전부를 인식한다 — `<제시문 n>`, `＜제시문 n＞`, 줄 갈라진 `< / 제시문 n>`, `쩨시문 n＞`, `제시문 n〉/）/)/>`, `제시 문n〉`, `제시문〉` 단독 머리 아래의 `[n]`, `（가）～（라）`, `＜사례＞`(오인식 `시례 ＞`). `label`에 원표기("1", "가", "사례")를 적고, 머리줄에 병기된 출처는 `source` 블록으로 분리한다. 텍스트층에 머리가 없으면(황 p338 `[3]`) 이미지에서 읽는다. 번호 없는 `제시문〉` 머리는 블록으로 적지 않는다(아래 `[n]`이 제시문을 연다).
- `footnote`: 쪽 아래 원문자 각주(`① 조지프 히스…`). `marker`에 원문자 번호. 제시문 끝의 원문자 기호는 본문에서 빼고 해당 `para`에 `marker`로 남긴다. 옆탭 잡문자와 구분하는 기준: 쪽 번호 바로 위, 원문자로 시작.
- `q-group`: 학생 배지는 이미지에서 읽는다(`A학생 추가질문`, label "A"). 배지 없는 묶음은 label 없이 text만("추가질문", "질문〉").
- `q`: 라벨 정규식 `Q(\d+)([-~](\d+))?`, 치환 `I/l→1, O→0, ~→-`. 황변 `•`는 라벨 없음. 질문 안 괄호 주석·`/` 병기는 원문 그대로 두고 `note`에 "괄호 주석"/"병기"를 표시. `참고〉`는 `ref`.
- `meta`: 복기자가 원문을 설명하는 문장·괄호(`…에 대한 제시문.`, `(… 조항 일부 제시)`, `기준（표로 정리되어…）`). 다른 책에도 본문으로 있는 보충 블록(에콰도르 헌법 조문)은 `para`. `•••（중략）`, `（...）`는 `ellipsis`.
- `skip`: 머리말·꼬리말(`한 번에 합격, 해커스로스쿨…`, `황변과 함께하는 로스쿨 면접 Q`, `Eart 必대학별…`), 옆탭, 쪽 번호, `Part/port 6` 조각, 해설 안내문(`*문제에 대한 해설은 p.299…`), QR 캡션(`자연의 권리`).

**2. 검증(Sonnet 5.5)**: 같은 쪽 PNG와 정제 결과를 받아 누락 줄·바뀐 단어·블록 유형 오류·순서 오류를 찾고, `skip`된 블록 목록을 돌려준다(과잉 skip 점검). 출력 `{ok, issues:[{block, kind, expected, got}], skipped:[…]}`. `ok=false`면 이슈를 힌트로 넣어 1을 다시 돌린다(최대 2회). 끝까지 실패한 쪽은 `work/reports/ocr-failed.md`에 적고 총괄이 직접 본다(키가 있으면 Terra 대체 정제를 먼저 시도).

**3. 결정적 점검 `tools/check_ocr.py`**(워크플로 종료 후 메인 세션이 실행): 블록별로 공백·구두점·따옴표를 지운 뒤 정제문과 ABBYY 문자열을 difflib로 정렬한다. 유사도 0.9 미만, 한쪽에만 있는 연속 구간 8자 초과, 정제문에만 있는 구간이 있으면 플래그(`skip` 블록은 비교에서 뺀다). 라벨 점검은 김종수 블록에만: 묶음 안에서 주번호 1부터 연속, 부번호는 `-` 정규화 후 1부터 연속, 쪽 첫 `q`가 Q1이 아니면 `cont`여야 함. 제시문 번호는 `label` 정규화 뒤 `1..n` 또는 `가..라` 연속, `case`는 끝에 0~1개.

### 2-C 세트 조립 (스크립트 + Sonnet 예외 처리)

`tools/assemble_sets.py kim|hwang`: 쪽 블록을 쪽 순서로 이어 `year-head`·`set-head` 블록에서 세그먼트를 가르고(연도 머리 → 준비 구간, 세트 머리 → 세트, "해설" 머리 → 해설) 변형 JSON을 만든다. type·label·marker·cont·쪽 순서만 쓴다. 결과는 `work/sets/<book>/<id>.json`, 보고서는 `work/reports/assemble-<book>.md`. `map.json`은 쪽 범위 대조에만 쓴다.

```
{ id, year, name: "서울대 A", session: "오전 면접", track: "일반전형",
  instruction, passages: [{ no, label?, kind: "prose"|"dialog"|"case", length?, text, source, notes? }],
  followups: [{ student, label, items: [{ label?, text, note? }] }], common?: [...],
  refs?: [...], srcPages: [259, 260, 261], book: "kim" | "hwang" }
```

- `instruction`: `※|宗|乂 → [태그]? → 본문`으로 파싱해 본문만 넣는다(괄호 부기 포함, 원문 그대로). 태그는 session 확인용. 태그가 없으면 map의 A/B/C 순서로 session을 정한다. 황변에는 지시문이 없으므로 세트 공통 `instruction`은 김종수 것을 쓴다.
- `passages[].text`: `para`를 `\n`으로 잇고 `cont`로 쪽 경계 어절을 붙인다. `source`: 각주(`marker`로 연결, 쪽을 넘어도 같은 세트의 직전 passage 기호와 잇는다)·머리줄 병기 출처·황변 `(출처: …)`. 둘 이상이면 `; `로 잇는다. `length`: `(약 )?(A4( 용지)?)? *[0-9./~ ]+ *(쪽|페이지)? *분량` 패턴. `meta`는 `notes`로 분리(본문 제외). `ellipsis`(책에 인쇄된 생략 표시)는 본문에 둔다.
- `followups`: 김종수는 배지별 묶음(`student: "A", label: "A학생 추가질문"`), 배지 없는 묶음과 황변 전체는 `{ student: "공통", label: "추가질문" }`(기존 snu-2023-B·2021-C 관례. `validate-data.js`가 followups를 필수로 요구하므로 `common`에 두지 않는다. `DATA.md` 규칙 3을 이렇게 고친다). `cont` 질문은 직전 쪽의 마지막 묶음에 잇는다. `items[].label`·`note`는 `data/sets/` 변형 파일까지 보존하고 `data/questions.js`에는 기존 관례대로 문장만 넣는다. 질문 속 제시문 참조(`＜제시문 2＞`, `제시문 2〉`)는 `<제시문 2>`로 통일한다(`DATA.md` 규칙 4. `(나)`·`<제시문 다>`는 그대로).
- 결정적 검증(같은 스크립트): 제시문 라벨 연속, 빈 질문 없음, 두 책의 같은 세트에서 제시문 수·순서 일치. 실패한 세트만 Sonnet 에이전트에 보내 판단을 받고 결과를 보고서에 적는다.
- 주제어 `themes`(제시문 수와 같은 수의 짧은 구절)와 태그(Q-15)는 세트당 Sonnet 1회(Workflow `ingest-themes`) → `tools/apply_themes.py`가 `meta.json`에 넣는다.
- 승격: `tools/promote_sets.py kim|hwang`이 조립본을 `data/sets/<id>/<book>.json`으로 옮기고 새 세트의 `meta.json`을 만든다. 기존 5세트의 `kim.json`은 덮어쓰지 않는다(2-D).

### 2-D 기존 5세트 대조

`tools/diff_existing.py`가 `work/sets/kim/snu-2021-*.json`·`snu-2023-*.json`(OCR 조립본)을 `data/sets/<id>/kim.json`(현재 사이트 본문)과 비교해 `work/reports/existing-diff.md`를 만든다. 비교 전에 따옴표(‘’“”→'")·공백·원문자·전각 괄호를 정규화하고, 차이를 (a) OCR 오류, (b) 기존 입력 오류, (c) 기존 입력의 의도적 정리로 자동 분류한다. 묶음 수·라벨·질문 수 비교 표를 넣어 책에 없는 기존 묶음(2021-A `common`)을 표시한다. 기존 지시문(※·태그 제거, 문장 다듬음)과 책 원문의 차이도 적는다.

규칙 5에 따라 기존 텍스트 변경은 사용자 확인 뒤에만 한다(Q-13). 승인 결과는 `work/reports/existing-diff.approved.json`으로 받아 `data/sets/<id>/kim.json`에 그것만 패치한다. 기존 5세트의 kim 변형은 현재 사이트 본문이 기준이고 `common` 묶음은 보존한다.

### 2-E 통합본 생성 (GPT, 브랜치 `snu-merge`) + 검증

사용자 결정(2026-11-02): 통합본은 Fable 5.1이 만들지 않고 GPT 계열(Codex 등)이 별도 브랜치·워크트리 `snu-merge`에서 만든다. 모델에게 주는 지시문은 `docs/MERGE_PROMPT.md`(아래 규칙을 옮긴 것). 결과 `data/sets/<id>/merged.json`을 main에 병합한 뒤 `build_questions.js`로 반영한다(P4-1e). 겹치는 13세트마다:

1. **생성(GPT)**: 입력 = 두 변형 JSON 전체. 출력 = `merged` 변형 JSON + `notes`(통합 판단 기록, 문장별 출처 kim/hwang/both).
   - 제시문, 두 변형이 같은 글의 더/덜 완전한 복원일 때: 더 긴 쪽을 골자로 삼고 다른 쪽에만 있는 문장·정보를 끼워 넣는다. 두 복기 모두에 없는 내용은 쓰지 않는다. 표현만 다르고 뜻이 같으면 한쪽만 쓴다.
   - 제시문, 한쪽이 다른 쪽의 요약이거나 현대어 풀이일 때(2024 오전·오후, 2021 오전 제시문 2): 문장을 섞지 않는다. 전문 쪽을 통째로 쓰고 출처·분량만 보탠다. `notes`에 "황변=요약" 식으로 적는다.
   - `source`는 두 변형의 합집합(`; `), `length`는 둘 다 있으면 황변, 아니면 있는 쪽. `meta`·`ellipsis`는 통합 본문에서 뺀다.
   - 질문: 김종수 학생별 묶음은 문장·순서·개수 그대로 둔다. 황변 질문 가운데 김종수 묶음 어디에도 뜻이 같은 질문이 없는 것만 `{ student: "황변", label: "황변 복기 질문", items }` 묶음으로 뒤에 붙인다. 중복 판정 쌍은 `notes`에 기록한다. `/` 병기 질문은 둘로 나눈다. 재배열·표현 교체는 하지 않는다(기존 스레드 키가 같은 질문을 가리키게 하려는 것).
   - `themes`: 2-C 초안을 확정한다. 세 변형이 같은 값을 공유한다.
2. **검증(3렌즈. GPT 별도 호출, 선택적으로 Opus 5.5)**: (가) 날조 없음 — 통합 제시문의 모든 문장이 `notes`에 기록된 출처 변형에 실제로 있는가. (나) 누락 없음 — 두 변형의 합집합 내용이 빠지지 않았는가(요약·풀이로 판정한 변형은 제외), 질문이 합집합인가. (다) 일관성 — 한 편의 글로 읽히는가, 중복 문장·번호 꼬임이 없는가. **렌즈 하나라도 반려하면** 사유를 넣어 1을 다시 돌린다(최대 2회). 2회 뒤에도 반려가 남으면 `merged`를 만들지 않고 `work/reports/merge-rejected.md`에 남겨 총괄이 판단한다.
3. 두 모델이 만든 2안을 비교해 고르는 것은 선택.
4. 2019·2020의 5세트는 `merged`를 두지 않는다. 화면과 AI 입력은 `kim`으로 대체한다(§2-F 해석 규칙).

통합본은 AI가 두 복기의 문장만으로 만든 재구성본이며 복기 원문이 아니다. 화면 라벨 "통합(AI)"로 표시하고, 규칙 5의 보호 대상은 `hwang`·`kim` 변형이다. 커밋된 `merged` 질문의 순서는 `DATA.md` §4(추가는 끝에)를 따른다.

### 2-F 스키마·사이트 반영 (P4-1b 스키마 → P4-1c UI → P4-1d 데이터)

**데이터(Q-9)**:

```js
SET = {
  id, school, year, name, session, track, format, instruction, themes,
  variant: "merged",                       // 기본 변형. 없으면 variants의 첫 키
  variants: {
    merged: { label: "통합(AI)", basis: ["kim", "hwang"], passages, followups, common?, notes? },
    hwang:  { label: "황변 복기", source: { book: "황변 로스쿨 면접 1권(2026)", pages: "327-328" }, passages, followups, common?, refs? },
    kim:    { label: "김종수 복기", source: { book: "김종수 로스쿨 면접 3권 기출편(2026)", pages: "259-261" }, passages, followups, common? }
  },
  tree?: { basis: "kim", root, nodes }     // 트리 문구는 한 변형의 본문에 묶여 있다
}
PASSAGE = { no, label?, kind: "prose"|"dialog"|"case", length?, text, source, notes? }
```

- `passages/followups/common`은 변형 안으로. `instruction/themes/format`은 세트 공통. `tree`는 세트에 두되 `basis`를 적는다(기존 2023-A 예시 트리는 `basis: "kim"`).
- `label`은 원표기가 숫자가 아닐 때만("가", "사례"). 화면 제시문 머리는 `label`이 있으면 그것을 함께 보인다. 2019 세트 질문의 `（나）`·`＜제시문 다＞` 참조는 원문대로 둔다(규칙 5. `DATA.md` 규칙 4의 예외로 적는다).
- `app.js` `SNU.db`가 변형을 해석한다: `db.set(id, v?)`가 `{ ...set, ...set.variants[v], variant: v, defaultVariant: set.variant, variantKeys: [...] }`를 돌려주고, `db.schools()/sets()/school()`도 해석된 세트를 돌려준다. `v`는 인자 → URL `?variant=` → 설정 `variant` → 세트 `variant` 순이며, 세트에 없는 변형이면 `kim`으로 대체한다. `ai.js`는 `passageHead`(label 표기)와 `[면접 세트]` 줄의 복기본 라벨만 바뀐다. `practice.js`는 `startSession()`에서 `st.variant = set().variant`를 고정하고 세션 중에는 `db.set(st.setId, st.variant)`를 쓴다(세션 중 설정 변경이 제시문·은행·큐를 어긋나게 하지 않도록). `db.js`도 `st.variant`를 둔다.
- 트리: 실효 변형 ≠ `tree.basis`이면 트리를 쓰지 않고 실시간 생성/질문 은행으로 간다(옵션 창 help 한 줄). P2-1의 트리 생성 입력은 `basis` 변형의 `setContext`로 고정한다.
- 설정 `variant: "merged"`를 DEFAULTS에 추가(키 추가만. `Object.assign(DEFAULTS, stored)`로 복원되므로 마이그레이션 불필요).
- 기출DB 문답 키: `kim`은 기존 `<student>-<n>`을 영구히 쓴다(기존 저장 데이터와 같은 질문을 가리킨다). `hwang`·`merged`는 `hwang/<student>-<n>`, `merged/<student>-<n>`. 접두사 여부는 `variant !== "kim"`으로 정한다. `DATA.md` §4 표 갱신.
- `tools/validate-data.js`(같은 커밋): `variants` 키 ⊂ {merged, hwang, kim}, `variant` ∈ variants, `merged.basis` ⊂ variants 키, `tree.basis` ∈ variants; 변형마다 제시문 연속(`label` 체계별)·kind·50자·followups 비어 있지 않음·`student` 중복 없음(키 충돌 방지)·`source.pages` 형식; `themes` 수를 각 변형의 제시문 수와 비교; `set.format` 존재(`ai.js`가 `set.format.prep`을 읽는다); 요약 출력은 변형별 질문 수. 변형 구조에서 현재 스크립트는 요약 단계에서 예외로 죽으므로 먼저 고친다. 별도 JSON 검증 스크립트는 만들지 않는다(조립 스크립트의 점검 + 생성 후 validate-data.js).
- `tools/build_questions.js`(Node): `data/sets/_db.json`(levels·학교·format) + `data/sets/<id>/meta.json` + 변형 파일을 합쳐 `data/questions.js`를 생성한다(생성 파일, 직접 편집 금지. 세트는 연도 내림차순, 기본 변형은 meta의 값이 변형에 있으면 그것, 없으면 merged→hwang→kim 순). 기존 5세트는 `tools/export_sets.js`로 `data/sets/`에 옮겼다. 예상 크기 약 500KB(세트당 약 11KB × 변형 수). `index.html`·`practice.html`·`db.html`이 모두 읽는다. 학교가 늘면 학교별 파일 분리를 검토한다(BUILD_PLAN 메모).
- 서울대 `format`: 김종수 2025 복기 유지. 황변 면접장 스케치는 `format.details`에 `["합격생 현장메모(황변)", "…"]` 행으로 추가(Q-12).

**UI**: 변형 선택 seg "복기본: 통합 · 황변 · 김종수"(`.seg`, 36px). 눌림은 해석 결과 `set.variant`, 비활성은 `set.variantKeys`로 정한다(설정값이 `hwang`인데 세트에 없어 `kim`으로 대체되면 `kim`이 눌린다). 설정 서랍의 기본 복기본 seg만 설정값 기준.

- 기출DB 세트 머리(제시문 fold 위). 바꾸면 제시문·질문·스레드가 그 변형으로. 해시 `#<setId>`에 `?variant=` 병행.
- 모의면접 3단계 옵션 "답변" 그룹 옆에 "복기본" 그룹. AI 입력 미리 보기가 고른 변형의 제시문·질문을 보여 준다. `ai.js` `setContext`의 `[면접 세트]` 줄에 변형 라벨 표기(`AI.md` §2 갱신).
- 설정 서랍 "모의면접 기본값"에 기본 복기본.
- 세트 행 메타에 변형 칩("통합·황변·김종수" / "김종수"). 홈 세트 목록은 18행이 되므로 연도별 소제목(`.setrow`가 아닌 요소)으로 묶는다.
- 문구는 명사형, 설명문 없음(`DESIGN.md` §5).

### 2-G 분석 산출물 (Q-15)

기본안: 세트 메타(제시문 출처 저자·서명 → `source`, 제시문·질문 수)와 태그(`tags`, BUILD_PLAN P4-3의 태그 필터는 그대로 Phase 4)를 단계 1에 포함한다. 선택안: 질문 유형 분류(요약/비교/반론/적용/종합, Sonnet), 연도별 경향 표(`work/reports/snu-overview.md`, Fable), 출제 의도 요약(김종수 해설 근거, Q-11 연동).

### 2-H 검증·완료 기준

- `node tools/validate-data.js` 통과(세트 18, 변형 44 = kim 18 + hwang 13 + merged 13. 반려된 merged가 있으면 그만큼 적음).
- `npm run test:smoke` 통과. `tests/smoke.js` 변경: 홈 `#setList .setrow` 18(연도 소제목 제외); 기출DB 시나리오는 kim 변형으로 고정(`setSettings({variant:"kim"})`)해 기존 `A-3` 키 유지; seg 전환 뒤 `.paper` 첫 문단이 변형별로 다른지와 스레드 키 접두사 단언; `snu-2019-C`에서 통합·황변 버튼 `disabled`; 모의면접 3단계 "복기본" seg 존재.
- 직접 확인: 1280/400, 밝음/어둠, 글자 '아주 크게'. 세 변형으로 기출DB 한 세트씩, 텍스트 모드 세션 한 바퀴(`snu-2025-A` 통합, `snu-2019-C` 김종수).
- 충실도 표본: 총괄이 쪽 8장(책마다 4장)을 무작위로 골라 이미지와 변형 텍스트를 직접 대조. 불일치 0.
- `BUILD_PLAN.md` P4-1a~d `[x]`, `DECISIONS.md` 결정 기록, `README.md` 자료 출처 두 권으로, `DATA.md`(§1 스키마·규칙 3·규칙 4 예외·§4 키), `AI.md` §2 갱신.
- 실측(2026-11-02, P4-1d): validate 통과 — 세트 18, 변형 31(kim 18·hwang 13), 오류·경고 0. 정제 79쪽 중 22쪽을 다시 정제했다(본문을 "[미전사]"로 비운 쪽. 중단된 재실행에서 16쪽, 이어서 Haiku 6쪽 — 황 p342만 3회째 통과, Sonnet 대체 0). 쪽 경계 이음 2곳은 이미지 들여쓰기를 근거로 새 문단으로 고쳤다(김 p264·p283). 남은 경고: 조립 0, `check_ocr` 유사도 0.9 미만 4쪽(김 p285·300·303·314, 꼬리말·옆탭 잡문자 탓). 기존 5세트 대조 차이 6곳은 Q-13 승인 대기(`work/reports/existing-diff.md`).

### 2-I 실행 순서

```
2-0 준비(.gitignore·git init·npm test·첫 커밋) ✔
→ 2-A 추출·지도 ✔ → 2-B 0 파일럿 6쪽 ✔ → 2-B 73쪽(워크플로, 호출 상한) → ocr_collect.py → check_ocr.py
→ 2-C assemble_sets.py(+Sonnet 예외) → 2-D diff_existing.py(보고서만, 변경 없음) → promote_sets.py → ingest-themes → apply_themes.py
→ 2-F build_questions.js → validate → smoke → 2-H(P4-1d 커밋)
→ [사용자 확인: Q-13 승인 패치] · 2-E 통합 13세트는 브랜치 snu-merge에서 GPT가(P4-1e)
```

2-F의 코드(P4-1b 스키마·validate·DATA.md, P4-1c UI)는 2-B와 병행해 먼저 커밋했다(2026-11-02). Q-9·Q-12 기본안은 계획 승인으로 확정되어 `DECISIONS.md` 결정 표로 옮겼다.

## 3. 단계 2 — GitHub 게시·개선

### 3-A 자율 구간 (P0-2 준비)

- 네 HTML `<head>`에 `<meta name="robots" content="noindex">`(검색 노출만 줄인다. 저장소·Pages의 파일 노출은 그대로다). (완료 2026-11-03)
- Pages 아티팩트 범위(Q-10 하위): 기본안은 `pages.yml`에서 사이트 파일(`index/practice/db/library.html`, `assets/`, `data/`)만 모아 올리는 단계 추가. 그대로 두면 `docs/`·`tools/`·`tests/`·`CLAUDE.md`도 Pages 주소에서 열린다. (완료 2026-11-03: `_site/`에 네 HTML·`assets/`·`data/*.js`만 복사, `data/sets/` 제외)
- 커밋 전 점검: `git status --short`(`books/`·`work/` 없음), 키 문자열 검색, 저장소 로컬 `git config user.email`을 GitHub noreply 주소로(Q-10 하위. 공개 저장소면 전역 설정의 학교 메일이 모든 커밋에 노출된다). (status·키 검색 완료 2026-11-03: 모든 커밋에서 키 패턴 0건. 메일은 noreply 주소를 알아야 하므로 §3-B 1)
- 통합본 브랜치 `snu-merge`(워크트리 `../interviewprep-merge`)는 P4-1e가 끝나면 main에 병합한 뒤 push한다. (해당 없음 2026-11-03: 통합본은 main 작업 트리에서 만들어 main에 커밋했고, 쓰이지 않은 워크트리·브랜치는 정리)

### 3-B 사용자 구간 (Q-10)

1. Q-10 결정: 저장소 이름, 공개 범위, 노출 완화안, 작성자 메일, 아티팩트 범위(`pages.yml`에 기본안 반영: 사이트 파일만). 작성자 메일은 저장소에서 `git config user.email <ID>+<사용자명>@users.noreply.github.com`(GitHub Settings → Emails의 noreply 주소). 지금까지의 커밋은 작성자·커밋터 모두 전역 학교 메일이므로, 공개라면 첫 push 전에 이력의 메일도 바꿀지 함께 정한다.
2. 저장소 생성: 웹에서 만들고 URL을 주거나, `winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements` 뒤 새 셸에서 `gh auth login`(브라우저 인증) → `gh repo create <name> --<private|public> --source .`(`--push` 없이).
3. Pages 먼저 켜기: Settings → Pages → Source "GitHub Actions" 또는 `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`. `pages.yml`의 `configure-pages`는 Pages가 꺼진 저장소에서 "Get Pages site failed"로 실패하므로 push보다 먼저 한다.
4. `git remote add origin …` → `git push -u origin main`(자격 증명 창은 사용자가 처리). 이미 실패한 실행이 있으면 Pages를 켠 뒤 `gh workflow run pages.yml`(`workflow_dispatch` 있음).

에이전트는 1~3이 끝날 때까지 push를 시도하지 않는다. Q-10이 암호화(아래 (a))로 결정되면 데이터 커밋은 암호화 적용 뒤에만 push한다.

### 3-C 배포 확인 (P0-2, P0-2a)

- Actions 실행 성공 → `https://<id>.github.io/<repo>/` 네 화면 → 모의면접 텍스트 모드 한 바퀴.
- `tests/smoke.js`: `const ROOT = process.env.SMOKE_BASE_URL ? process.env.SMOKE_BASE_URL.replace(/\/?$/, "/") : pathToFileURL(...).href`. 배포본에서는 `page.goto` timeout 60초. `waitUntil`은 그대로(데이터 스크립트가 동기 `<script>`라 DOMContentLoaded 뒤에 실행된다). 로컬·배포 두 경로 모두 `npm run test:smoke`로 돈다. (완료 2026-11-03. 로컬 http는 `npx serve`의 cleanUrls가 `?set=`을 버려 `serve.json`으로 끈다. http에서 나는 favicon 404는 `<link rel="icon" href="data:,">`로 막는다)

### 3-D 개선 (P4-4a~f, 배포 후 미세 조정)

"fine-tuning"은 모델 학습이 아니라 배포본을 쓰면서 고치는 작업으로 해석한다. 항목마다 커밋 하나, push → 자동 배포.

- a. 홈 세트 목록 18행의 연도 묶음·모바일 400 줄바꿈.
- b. 변형 seg·칩의 어둠 테마·'아주 크게' 글자 크기 점검.
- c. AI 입력 길이: 통합본 질문 은행이 커지므로(세트당 25~40문) `AI.md` §7 추정치 갱신, `max_tokens` 재검토.
- d. 기출DB `?variant=` 병행·스레드 키 접두사 동작 확인.
- e. 실기기(안드로이드 Chrome) 점검 1회.
- f. 문서 갱신: `README.md` 자료 출처, `DATA.md`, `AI.md` §2, `BUILD_PLAN.md` 상태.

## 4. 열린 질문 (DECISIONS.md Q-9 ~ Q-15)

| # | 질문 | 선택지 | 기본 가정 |
|---|---|---|---|
| Q-9 | 복기본 변형 구조 | (a) 세트 안 `variants` + `label`·`case`·`tree.basis`, kim 키 무접두사(§2-F) (b) 변형마다 별도 세트 id | (a)로 결정(2026-11-02 계획 승인, 결정 표) |
| Q-10 | 저장소 이름·공개 범위·저작물 노출 완화 | (a) 공개/비공개 무관 + `data/questions.js` 암호화(WebCrypto AES-GCM, 암호구는 localStorage, 외부 라이브러리 없음. Pages 노출까지 막는 유일한 안. 생성 스크립트·검증 경로 추가 필요) (b) 비공개 저장소(Pages는 GitHub Pro. snu.ac.kr 메일이면 Student Developer Pack으로 무상) — 저장소 노출만 막고 Pages 노출은 남음 (c) 공개 + noindex — 검색 노출만 줄임. 하위: 작성자 메일 noreply, 아티팩트 범위(사이트 파일만) | 사용자 결정 필요 |
| Q-11 | 김종수 `해설`(모범답안·출제 의도) 수록 여부 | (a) 수록 안 함, `work/`에 정제본만 보관 (b) 세트 `commentary`로 수록해 AI 면접관 참고 입력에 사용 | (a) |
| Q-12 | 황변 면접장 스케치 반영 | (a) `format.details` 행 추가 (b) `format.sources[]`로 책별 분리 | (a)로 결정(2026-11-02 계획 승인) |
| Q-13 | 기존 5세트와 OCR 결과가 다를 때 | (a) 보고서 확인 뒤 항목별 승인(`existing-diff.approved.json`) (b) OCR 결과로 일괄 교체 | (a). 규칙 5 |
| Q-15 | 분석 산출물 범위 | (가) 세트 메타·태그(기본) (나) 질문 유형 분류 (다) 연도별 경향 표 (라) 출제 의도 요약(Q-11 연동) | (가) |

Q-14(GPT 계열 병행)는 사용자 지침이 이미 택일을 허용하므로 결정 표에 적었다: 키가 있으면 §1의 보조 역할로만, 없으면 Claude 계열만.

## 5. 비용·시간 추정

| 단계 | 호출 | 토큰(대략) |
|---|---|---|
| 2-B 파일럿 6쪽 | Haiku 8회, Sonnet 8회 | 실측 1.8M(에이전트당 도구 호출 약 20회, 호출마다 문맥 재전송) |
| 2-B 정제·검증 73쪽 + 재시도(호출 상한 뒤) | Haiku 약 90회, Sonnet 약 90회 | 실측은 2-H에 기록 |
| 2-C 예외 판단 + 주제어·태그 18세트 | Sonnet 약 25회 | 0.2M |
| 2-E 통합 13세트 | GPT(브랜치 작업) | 이 세션 비용 아님 |
| 2-F 코드·문서 | 메인 세션 | — |
| 합계 | | 약 3M, 벽시계 3~4시간(코드 포함) |

## 6. 위험

- 하위 모델이 오인식을 "교정"하면서 뜻을 바꾸는 것. 대응: 이미지 대조(2-B 2), difflib 정렬 점검(2-B 3), 파일럿(2-B 0), 총괄 표본 대조(2-H).
- 쪽 경계·배지·각주가 텍스트층에서 어긋나 있는 것. 대응: 이미지 순서 우선, `cont`, `marker`, set-head로 가르는 조립.
- 두 복기의 성격 차이(전문 vs 요약·풀이). 대응: 섞기 금지 규칙, 문장별 출처 기록, 날조·누락·일관성 렌즈 단독 거부권.
- 저작물 노출. 노출 경로는 (1) Pages가 서빙하는 `data/questions.js`(저장소 공개 여부와 무관), (2) 공개 저장소의 소스·이력. 통합(AI) 변형도 두 책 문장으로만 짠 것이라 같은 위험이다. 해설은 `work/`에만 있어 노출되지 않는다. 완화책은 효과 순으로 암호화(a) > 비공개 저장소(b) > noindex(c). Q-10 결정 전에는 데이터 커밋을 push하지 않는다.
- `data/questions.js` 500KB. 세 페이지가 매번 읽는다. 대응: 당장은 허용, 학교가 늘면 학교별 파일 분리.

## 7. 도구 목록 (새로 만드는 것)

| 파일 | 역할 |
|---|---|
| `tools/book_extract.py` | 쪽 이미지·텍스트층 추출 |
| `tools/check_ocr.py` | 정제 결과 결정적 점검 |
| `tools/assemble_sets.py` | 블록 → 변형 JSON 조립 + 구조 검증 |
| `tools/ocr_collect.py` | 워크플로 결과 → `work/ocr/<book>/pNNNN.json` |
| `tools/diff_existing.py` | 기존 세트 본문 ↔ OCR 조립본 대조 보고서 |
| `tools/promote_sets.py` | 조립본 → `data/sets/<id>/<book>.json` + 새 `meta.json` |
| `tools/apply_themes.py` | `ingest-themes` 결과 → `meta.json`의 themes·tags |
| `tools/export_sets.js` | 옛 평면 데이터 → `data/sets/`(1회) |
| `tools/build_questions.js` | `data/sets/` → `data/questions.js` 생성 |
| `tools/ocr_refine_openai.py` | (선택) Terra 대체 정제기 |
| `tools/requirements.txt` | pymupdf 버전 고정 |
| Workflow `ingest-ocr`, `ingest-themes` | 세션 안에서 실행하는 에이전트 파이프라인(스크립트는 세션 디렉터리에 저장됨). 통합은 워크플로가 아니라 GPT 브랜치 작업 |

## 8. 이후 단계 (3)~(6)에 재사용

- 황변 PART 04(PDF p238–596, 25개 학교)와 김종수 Part 6(기출문제&해설, 학교별 구간)은 같은 표기 규칙이다. `map.json`의 학교·쪽 범위만 바꿔 2-A~2-H를 반복한다. 학교별 `format`은 황변 면접장 스케치와 김종수 `문제` 머리 표에서 채운다.
- 학교마다 세션 이름 규칙이 다르다(시립대 "문제 1/2", 성균관대 "가군/나군"). 세트 id 규칙 `<school>-<year>-<name>`은 유지하고 `name`은 `school.short` + 책의 세션 표기(`DATA.md` 규칙 8). 제시문 표기(`(가)`, `[1]`, `문제 1〉`)는 `label`로 담는다.
