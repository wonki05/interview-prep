# DATA — 데이터 구조와 입력 규칙

모든 데이터는 `data/*.js`에 전역 객체로 들어 있고 `<script>`로 로드된다(모듈·fetch 없음 → `file://`에서도 동작). 기출 데이터의 원본은 `data/sets/`(JSON)이고 `data/questions.js`는 그것으로 생성한다(§1.1).

## 1. `data/questions.js` — `window.INTERVIEW_DB`

```js
{
  levels: { difficulty: { low|mid|high|max: { label, desc } }, variation: { low|mid|high: { label, desc } } },
  schools: [
    { id: "snu", name: "서울대학교", short: "서울대",
      format: { year: 2025, timeline: { prep: 20, wait: 5, interview: 15 },
                basics: ["교수:학생 = 3:1", …], details: [["메모 및 휴대 여부", "…"], …] } | null,
      sets: [ SET, … ] },
    { id: "korea", name: "고려대학교", short: "고려대", format: null, sets: [] }, …
  ]
}
SET = {
  id: "snu-2023-A",            // "<schoolId>-<year>-<세션 기호>" 전 학교에서 유일. 영문·숫자·하이픈
  school: "snu", year: 2023, name: "서울대 A", session: "오전 면접", track: "일반전형",
  instruction: "제시문을 읽고, …",
  format: { ratio: "3:1", prep: 20, duration: 15, memo: true, followup: true },
  themes: ["…", "…"],          // 제시문 순서대로 한 구절씩(세트 행·칩에 표시). 모든 복기본이 공유
  tags: ["…"],                 // 주제 태그(P4-3 태그 필터용). 없으면 []
  variant: "merged",           // 기본 복기본. SNU.db가 해석한다(아래)
  variants: {                  // 복기본 변형. 셋 중 있는 것만
    merged: { label: "통합(AI)", basis: ["kim", "hwang"], passages, followups, common },
    hwang:  { label: "황변 복기", source: { book: "…", pages: "327-328" }, passages, followups, common },
    kim:    { label: "김종수 복기", source: { book: "…", pages: "259-261" }, passages, followups, common }
  },
  tree?: { basis: "kim", example?, root, nodes }   // docs/AI.md §5. basis = 트리 문구가 묶인 복기본. P2-1 뒤에는 trees: { low, mid, high, max }
}
VARIANT.passages  = [ { no: 1, label?: "가"|"A"|"사례"|"사례 1"|"에피소드", kind: "prose"|"dialog"|"case", length?: "A4 1/2 분량", text: `원문`, source: "출처" } ]
VARIANT.tasks?    = [ { label: "1-1"|"", text: "문제지 문항" } ]                     // 면접 전에 받는 문제(서울대에는 없다). 화면 표시는 BUILD_PLAN P4-2f
VARIANT.followups = [ { student: "A", label: "A학생 추가질문", items: ["…"] } ]   // 학생 구분이 없으면 { student: "공통", label: "추가질문" }
VARIANT.common    = [ { label: "공통 질문", items: ["…"] } ]                         // 없으면 []
```

- **해석**: 화면·AI는 `SNU.db.set(id, v?)`가 돌려주는 "해석된 세트"를 쓴다. 변형 하나의 `passages/followups/common`이 세트 위에 펼쳐지고 `variant`(실효 변형)·`defaultVariant`·`variantKeys`·`variantLabel`이 붙는다. 고르는 순서: 인자 → URL `?variant=` → 설정 `variant` → 세트 `variant`. 세트에 없는 변형이면 `kim`, 그것도 없으면 첫 변형. `db.schools()/school()/sets()`도 해석된 세트를 돌려준다. 모의면접은 세션 시작 때 변형을 고정한다.
- **복기본의 성격**: `hwang`·`kim`은 교재 복기 원문(규칙 1의 보호 대상). `merged`는 두 복기의 문장만으로 만든 AI 재구성본이며 화면에 "통합(AI)"로 표시한다. `basis`는 통합에 쓴 변형.
- `label`은 책이 제시문 단위로 매긴 원표기가 숫자가 아닐 때만 둔다(2019 서울대 `(가)`~`(라)`, 2020 서울대 `<사례>`, 다른 학교의 `[A]`·`[사례 1]`·`<에피소드>`). 12자 이하의 짧은 낱말이고, 한 글자 라벨은 가나다…·ABC… 순서다. 한 제시문 안의 하위 소제목(`<제시문 1>` 아래의 `(가)`·`(A)`)은 label이 아니라 본문 문단 머리에 그대로 둔다. `kind: "case"`는 사례 블록(label이 `사례`로 시작). 화면 머리는 `AIClient.passageHead(p)` = `<제시문 n> (가)` / `<사례>`.
- 학교 순서: 서울대 → 고려대 → 연세대 → 성균관대 → 한양대 → 서강대 → 중앙대 → 경희대 → 한국외대 → 이화여대. 화면의 토글 순서가 이 배열 순서다. 세트는 학교 안에서 연도 내림차순.

### 1.1 `data/sets/` — 원본 JSON과 생성

```
data/sets/_db.json              { levels, schools: [{ id, name, short, format }] }   (sets 제외)
data/sets/<set id>/meta.json    { id, school, year, name, session, track, instruction, format, themes, tags, variant, tree? }
data/sets/<set id>/kim.json     변형 파일. { label, source: { book, pages }, basis?, passages, tasks?, followups, common, notes? }
data/sets/<set id>/hwang.json
data/sets/<set id>/merged.json
```

- 변형 파일의 `followups[].items`는 `{ label: "Q2-1"|null, text, note }`(책의 질문 번호·주석을 보존), `tasks`는 `{ label: "1-1"|"", text, note }`이고, `passages[].notes`에는 복기자의 설명 문장(원문이 아닌 것)이 들어간다. `node tools/build_questions.js`가 이것을 읽어 `data/questions.js`를 쓴다. 사이트에는 질문 문장만 들어가고 `notes`·`label`·`refs`는 빠진다.
- 데이터를 고칠 때는 `data/sets/`를 고치고 다시 생성한다. `data/questions.js`를 직접 고치지 않는다(생성 파일).
- 교재에서 옮기는 절차는 `docs/INGEST.md`(추출 → OCR 정제 → 조립 → 대조 → 통합). `tools/export_sets.js`는 옛 평면 구조를 `data/sets/`로 옮긴 1회용 스크립트.

### 복기 자료를 옮기는 규칙

1. 제시문은 **원문 그대로**(OCR 오인식 교정만). 문단은 `\n`으로 나눈다(화면에서 `<p>`로 분리). 각주·출처 표시는 `source`에 그대로(둘 이상이면 `; `로 잇는다). 대화체 제시문은 `kind: "dialog"`, 발화 단위로 줄바꿈. 책에 있는 `(중략)`·`(...)` 표시는 본문에 둔다. 복기자가 원문을 설명한 문장은 본문이 아니라 `notes`. 그림·도표는 그림 안에 보이는 글자(제목·범례·축·수치)만 `[도표] …`(또는 `[그림]`·`[사진]`) 한 문단으로 둔다. 글자로 된 표는 행마다 한 문단, 칸 사이는 ` | `. 한 줄짜리 사례 목록((가)~(사))은 제시문 하나에 줄마다 한 문단.
2. 분량 표시("A4 용지 2/5 분량")가 복기에 있으면 `length`에, 없으면 생략.
3. 추가질문은 복기된 학생별로 `followups` 한 묶음씩, 순서 유지. 여러 학생이 같은 질문을 복기했어도 합치지 않는다(은행이 중복을 질문 텍스트 기준으로 걸러낸다). 학생 구분이 없는 질문은 `followups`의 `{ student: "공통", label: "추가질문" }` 묶음에 둔다(`followups`는 비어 있으면 안 된다. 단 문제지 문항(`tasks`)만 복기되고 추가질문이 없는 세트는 비워 두고, 문항을 `followups`로 복제하지 않는다). `common`은 세트 공통으로 따로 적힌 묶음에만. 예외: `merged`는 황변에만 있는 질문을 `{ student: "황변", label: "황변 복기 질문" }` 묶음으로 뒤에 붙이고 책 사이의 중복은 하나만 둔다.
4. 질문 문장은 복기 그대로(존댓말·반말 혼재 허용). 제시문 참조는 `<제시문 1>` 꼴로 통일(TTS가 "제시문 1"로 읽는다). 예외: 제시문이 `(가)`~`(라)`로 표기된 세트(2019 서울대)는 질문의 `(나)`·`<제시문 다>` 참조도 원문대로 둔다.
5. `themes`는 제시문 수와 같은 수의 짧은 구절. 사례 블록도 하나로 센다.
6. 한 세트를 넣은 뒤 `node tools/build_questions.js` → `node tools/validate-data.js`로 확인한다.
7. 학교에 진행 방식 복기가 있으면 `format`을 채운다. `timeline`은 분 단위, 대기 시간이 없으면 `wait: 0`. 옵션 창의 기준값 표시에만 쓰이고 실제 세션 시간은 설정값이다.
8. 세트 `name`은 `school.short` + 공백 + 세션 기호(교재의 A/B/C 또는 책의 표기). 교재가 학교 약칭을 줄여 적어도("서울 A", "시립 A") 사이트에서는 `school.short`를 쓴다("서울대 A", "서울시립대 A"). 화면의 세트 라벨은 `SNU.db.label(set)` = `<year>학년도 <name>`이다.
9. 세션 기호는 서울대 오전 = A, 오후 = B, 특별전형 = C. 다른 학교는 김종수 교재의 세션 기호(해마다 한 세트면 A)를 쓰고, 황변의 세션은 학교 설정(`tools/schools/<id>.json`의 `books.hwang.mode`)으로 같은 기호에 맞춘다. 세트 id는 `<schoolId>-<year>-<기호>`.
10. 문제지 문항(면접 전에 받는 문제: 황변 `문제 1>`·`문제〉`, 김종수는 추가질문 머리 앞의 `Q1.`)은 변형의 `tasks`에 순서대로 둔다(label은 번호 `1`·`1-1`, 없으면 `""`). 복기본마다 문항 표현이 달라 세트 공통이 아니라 변형에 둔다. 세트 공통 `instruction`은 김종수 지시문.
11. 인성 질문 묶음(김종수 `성균관 인성 문제`, 황변 면접장 스케치의 `주요 인성 질문`)은 세트로 만들지 않고 학교 `format.details`에 `["인성 질문(김종수 2025)", "…"]`처럼 행으로 둔다.

## 2. `data/models.js` — `window.MODEL_CATALOG`

`{ anthropic: [{id, label, note}], openai: [...], transcription: [...] }`. 첫 항목이 추천 기본값이지만 실제 기본값은 `app.js` DEFAULTS. 새 모델은 한 줄 추가. 제공사 공식 문서의 id를 쓴다.

## 3. `data/library.js` — `window.LIBRARY`

원본 "면접 도서 100선" HTML에서 추출한 데이터. 손으로 편집하지 않는다. 키: `books`(id, rank, grade S/A/B/C, title, author, cluster, pages, scope, summary, argument, counter, use, keywords, editions…), `clusters`, `edges`(책 간 관계 x/c/l), `pairs`, `stages`, `issues`(18개: facts, axis, use, questions, oral6), `meta`. 서가 화면이 쓰는 필드는 `assets/library.js` 상단 주석에 있다.

## 4. 브라우저 저장소

설정의 추가 필드(기존 저장소 키는 유지하며 누락 필드에 기본값을 합친다):

| 필드 | 값·기본값 |
|---|---|
| `anthropicEffort`, `openaiEffort` | 기본 `medium`. 모델별 `low / medium / high / xhigh / max`, GPT-6.1 Terra·GPT-6 Luna는 `none`도 지원. 지원 범위는 `SNU.models.effortOptions`로 판정. 미확인 직접 입력 모델은 API 기본값 |
| `dbHideThemes` | 불리언, 기본 `false`. 기출DB 목록·상세 주제 가림 |
| `dbSort` | `newest`(기본) / `oldest`. 학교별 세트 목록의 연도 정렬. 원본 배열은 변경하지 않음 |

effort를 화면에서 바꾸면 `{provider, model, effort}`로 해당 화면의 AI 호출에만 적용한다. 설정 서랍과 모의면접의 [기본값으로 저장]만 위 저장 필드에 반영한다. 기존 API 키·문답·복기본 데이터에는 변화가 없다. `tools/validate-data.js`가 추가 필드의 기본값과 모델 지원 범위를 검사한다.

| 키 | 내용 |
|---|---|
| `localStorage["snu-iv-settings-v1"]` | 설정. 키 이름을 바꾸면 `app.js`에서 마이그레이션(예: 이전 `lastSet: "2023-A"` → `"snu-2023-A"`, `openaiModel: "gpt-5"` → 새 기본값). `variant`(기본 복기본)는 추가된 키라 마이그레이션 없음 |
| IndexedDB `snu-interview` v1 `recordings` | 녹음. P1-2에서 `sessions` store 추가 시 DB 버전 2로 올리고 `onupgradeneeded`에서 생성 |
| `localStorage["snu-db-threads-v1"]` | 기출DB 문답. 질문 key = `task-<n>`(문제지 문항, 묶음 "문제"), `<student>-<n>` 또는 `common-<label>-<n>`. `kim` 복기본은 접두사 없음(기존 저장 데이터와 같은 질문), 그 밖의 복기본은 `<variant>/` 접두사(`hwang/A-1`, `merged/공통-3`). 세트 안에서 질문 순서를 바꾸면 key가 틀어지므로 순서 변경 금지(추가는 끝에) |
| `localStorage["snu-library-progress-v1"]` | 서가 진도 |

## 5. 검증 스크립트 `tools/validate-data.js`

`node tools/validate-data.js [--in <파일>]` — 세트 id 유일성, `school` 일치, `name` 규칙, `variants`·기본 `variant`·`merged.basis`·`tree.basis` 참조, 변형마다 제시문 번호 연속·`label`(12자 이하, 숫자 아님, 한 글자 라벨 순서)·`kind`·본문 길이(비면 오류, 50자 미만 경고)·`tasks` 문장·`followups` 비어 있지 않음(`tasks`가 있으면 비어도 됨)·`student` 중복 없음, 변형 간 제시문 수(경고), `themes` 길이, 트리 참조 무결성(모든 `next`가 존재, root 도달, 순환 없음), 모델 목록 id 중복을 검사하고 세트·변형별 제시문·질문 수를 출력한다. `--in`은 `build_questions.js --school <id> --out <파일>`로 만든 학교별 파일을 검사한다(`INGEST.md` §8). 데이터 구조를 바꾸면 이 스크립트도 같이 고친다.
