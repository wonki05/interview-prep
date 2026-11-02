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
VARIANT.passages  = [ { no: 1, label?: "가"|"사례", kind: "prose"|"dialog"|"case", length?: "A4 1/2 분량", text: `원문`, source: "출처" } ]
VARIANT.followups = [ { student: "A", label: "A학생 추가질문", items: ["…"] } ]   // 학생 구분이 없으면 { student: "공통", label: "추가질문" }
VARIANT.common    = [ { label: "공통 질문", items: ["…"] } ]                         // 없으면 []
```

- **해석**: 화면·AI는 `SNU.db.set(id, v?)`가 돌려주는 "해석된 세트"를 쓴다. 변형 하나의 `passages/followups/common`이 세트 위에 펼쳐지고 `variant`(실효 변형)·`defaultVariant`·`variantKeys`·`variantLabel`이 붙는다. 고르는 순서: 인자 → URL `?variant=` → 설정 `variant` → 세트 `variant`. 세트에 없는 변형이면 `kim`, 그것도 없으면 첫 변형. `db.schools()/school()/sets()`도 해석된 세트를 돌려준다. 모의면접은 세션 시작 때 변형을 고정한다.
- **복기본의 성격**: `hwang`·`kim`은 교재 복기 원문(규칙 1의 보호 대상). `merged`는 두 복기의 문장만으로 만든 AI 재구성본이며 화면에 "통합(AI)"로 표시한다. `basis`는 통합에 쓴 변형.
- `label`은 책의 원표기가 숫자가 아닐 때만 둔다(2019 서울대 `(가)`~`(라)`, 2020 서울대 `<사례>`). `kind: "case"`는 사례 블록이며 마지막 제시문이어야 한다. 화면 머리는 `AIClient.passageHead(p)` = `<제시문 n> (가)` / `<사례>`.
- 학교 순서: 서울대 → 고려대 → 연세대 → 성균관대 → 한양대 → 서강대 → 중앙대 → 경희대 → 한국외대 → 이화여대. 화면의 토글 순서가 이 배열 순서다. 세트는 학교 안에서 연도 내림차순.

### 1.1 `data/sets/` — 원본 JSON과 생성

```
data/sets/_db.json              { levels, schools: [{ id, name, short, format }] }   (sets 제외)
data/sets/<set id>/meta.json    { id, school, year, name, session, track, instruction, format, themes, tags, variant, tree? }
data/sets/<set id>/kim.json     변형 파일. { label, source: { book, pages }, basis?, passages, followups, common, notes? }
data/sets/<set id>/hwang.json
data/sets/<set id>/merged.json
```

- 변형 파일의 `followups[].items`는 `{ label: "Q2-1"|null, text, note }`(책의 질문 번호·주석을 보존)이고, `passages[].notes`에는 복기자의 설명 문장(원문이 아닌 것)이 들어간다. `node tools/build_questions.js`가 이것을 읽어 `data/questions.js`를 쓴다. 사이트에는 질문 문장만 들어가고 `notes`·`label`·`refs`는 빠진다.
- 데이터를 고칠 때는 `data/sets/`를 고치고 다시 생성한다. `data/questions.js`를 직접 고치지 않는다(생성 파일).
- 교재에서 옮기는 절차는 `docs/INGEST.md`(추출 → OCR 정제 → 조립 → 대조 → 통합). `tools/export_sets.js`는 옛 평면 구조를 `data/sets/`로 옮긴 1회용 스크립트.

### 복기 자료를 옮기는 규칙

1. 제시문은 **원문 그대로**(OCR 오인식 교정만). 문단은 `\n`으로 나눈다(화면에서 `<p>`로 분리). 각주·출처 표시는 `source`에 그대로(둘 이상이면 `; `로 잇는다). 대화체 제시문은 `kind: "dialog"`, 발화 단위로 줄바꿈. 책에 있는 `(중략)`·`(...)` 표시는 본문에 둔다. 복기자가 원문을 설명한 문장은 본문이 아니라 `notes`.
2. 분량 표시("A4 용지 2/5 분량")가 복기에 있으면 `length`에, 없으면 생략.
3. 추가질문은 복기된 학생별로 `followups` 한 묶음씩, 순서 유지. 여러 학생이 같은 질문을 복기했어도 합치지 않는다(은행이 중복을 질문 텍스트 기준으로 걸러낸다). 학생 구분이 없는 질문은 `followups`의 `{ student: "공통", label: "추가질문" }` 묶음에 둔다(`followups`는 비어 있으면 안 된다). `common`은 세트 공통으로 따로 적힌 묶음에만. 예외: `merged`는 황변에만 있는 질문을 `{ student: "황변", label: "황변 복기 질문" }` 묶음으로 뒤에 붙이고 책 사이의 중복은 하나만 둔다.
4. 질문 문장은 복기 그대로(존댓말·반말 혼재 허용). 제시문 참조는 `<제시문 1>` 꼴로 통일(TTS가 "제시문 1"로 읽는다). 예외: 제시문이 `(가)`~`(라)`로 표기된 세트(2019 서울대)는 질문의 `(나)`·`<제시문 다>` 참조도 원문대로 둔다.
5. `themes`는 제시문 수와 같은 수의 짧은 구절. 사례 블록도 하나로 센다.
6. 한 세트를 넣은 뒤 `node tools/build_questions.js` → `node tools/validate-data.js`로 확인한다.
7. 학교에 진행 방식 복기가 있으면 `format`을 채운다. `timeline`은 분 단위, 대기 시간이 없으면 `wait: 0`. 옵션 창의 기준값 표시에만 쓰이고 실제 세션 시간은 설정값이다.
8. 세트 `name`은 `school.short` + 공백 + 세션 기호(교재의 A/B/C 또는 책의 표기). 교재가 학교 약칭을 줄여 적어도("서울 A", "시립 A") 사이트에서는 `school.short`를 쓴다("서울대 A", "서울시립대 A"). 화면의 세트 라벨은 `SNU.db.label(set)` = `<year>학년도 <name>`이다.
9. 세션 기호는 오전 = A, 오후 = B, 특별전형 = C. 세트 id는 `<schoolId>-<year>-<기호>`.

## 2. `data/models.js` — `window.MODEL_CATALOG`

`{ anthropic: [{id, label, note}], openai: [...], transcription: [...] }`. 첫 항목이 추천 기본값이지만 실제 기본값은 `app.js` DEFAULTS. 새 모델은 한 줄 추가. 제공사 공식 문서의 id를 쓴다.

## 3. `data/library.js` — `window.LIBRARY`

원본 "면접 도서 100선" HTML에서 추출한 데이터. 손으로 편집하지 않는다. 키: `books`(id, rank, grade S/A/B/C, title, author, cluster, pages, scope, summary, argument, counter, use, keywords, editions…), `clusters`, `edges`(책 간 관계 x/c/l), `pairs`, `stages`, `issues`(18개: facts, axis, use, questions, oral6), `meta`. 서가 화면이 쓰는 필드는 `assets/library.js` 상단 주석에 있다.

## 4. 브라우저 저장소

| 키 | 내용 |
|---|---|
| `localStorage["snu-iv-settings-v1"]` | 설정. 키 이름을 바꾸면 `app.js`에서 마이그레이션(예: 이전 `lastSet: "2023-A"` → `"snu-2023-A"`, `openaiModel: "gpt-5"` → 새 기본값). `variant`(기본 복기본)는 추가된 키라 마이그레이션 없음 |
| IndexedDB `snu-interview` v1 `recordings` | 녹음. P1-2에서 `sessions` store 추가 시 DB 버전 2로 올리고 `onupgradeneeded`에서 생성 |
| `localStorage["snu-db-threads-v1"]` | 기출DB 문답. 질문 key = `<student>-<n>` 또는 `common-<label>-<n>`. `kim` 복기본은 접두사 없음(기존 저장 데이터와 같은 질문), 그 밖의 복기본은 `<variant>/` 접두사(`hwang/A-1`, `merged/공통-3`). 세트 안에서 질문 순서를 바꾸면 key가 틀어지므로 순서 변경 금지(추가는 끝에) |
| `localStorage["snu-library-progress-v1"]` | 서가 진도 |

## 5. 검증 스크립트 `tools/validate-data.js`

`node tools/validate-data.js` — 세트 id 유일성, `school` 일치, `name` 규칙, `variants`·기본 `variant`·`merged.basis`·`tree.basis` 참조, 변형마다 제시문 번호 연속·`label`·`kind`·본문 길이·`followups` 비어 있지 않음·`student` 중복 없음, 변형 간 제시문 수, `themes` 길이, 트리 참조 무결성(모든 `next`가 존재, root 도달, 순환 없음), 모델 목록 id 중복을 검사하고 세트·변형별 제시문·질문 수를 출력한다. 데이터 구조를 바꾸면 이 스크립트도 같이 고친다.
