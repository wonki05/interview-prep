# DATA — 데이터 구조와 입력 규칙

모든 데이터는 `data/*.js`에 전역 객체로 들어 있고 `<script>`로 로드된다(모듈·fetch 없음 → `file://`에서도 동작).

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
  id: "snu-2023-A",            // "<schoolId>-<year>-<name>" 전 학교에서 유일. 영문·숫자·하이픈
  school: "snu", year: 2023, name: "서울대 A", session: "오전 면접", track: "일반전형",
  instruction: "제시문을 읽고, …",
  format: { ratio: "3:1", prep: 20, duration: 15, memo: true, followup: true },
  themes: ["…", "…"],          // 제시문 순서대로 한 구절씩(세트 행·칩에 표시)
  passages: [ { no: 1, kind: "prose"|"dialog", length?: "A4 용지 2/5 분량", text: `원문`, source: "출처" } ],
  followups: [ { student: "A", label: "A학생 추가질문", items: ["…"] } ],
  common: [ { label: "공통 질문", items: ["…"] } ],     // 없으면 []
  tree?: { example?, root, nodes }                         // docs/AI.md §5. P2-1 뒤에는 trees: { low, mid, high, max }
}
```

학교 순서: 서울대 → 고려대 → 연세대 → 성균관대 → 한양대 → 서강대 → 중앙대 → 경희대 → 한국외대 → 이화여대. 화면의 토글 순서가 이 배열 순서다.

### 복기 자료를 옮기는 규칙

1. 제시문은 **원문 그대로**. 문단은 `\n`으로 나눈다(화면에서 `<p>`로 분리). 각주·출처 표시는 `source`에 그대로. 대화체 제시문은 `kind: "dialog"`, 발화 단위로 줄바꿈.
2. 분량 표시("A4 용지 2/5 분량")가 복기에 있으면 `length`에, 없으면 생략.
3. 추가질문은 복기된 학생별로 `followups` 한 묶음씩, 순서 유지. 여러 학생이 같은 질문을 복기했어도 합치지 않는다(은행이 중복을 질문 텍스트 기준으로 걸러낸다). 학생 구분이 없는 질문은 `common`.
4. 질문 문장은 복기 그대로(존댓말·반말 혼재 허용). 제시문 참조는 `<제시문 1>` 꼴로 통일(TTS가 "제시문 1"로 읽는다).
5. `themes`는 제시문 수와 같은 수의 짧은 구절.
6. 한 세트를 넣은 뒤 `node tools/validate-data.js`로 확인한다.
7. 학교에 진행 방식 복기가 있으면 `format`을 채운다. `timeline`은 분 단위, 대기 시간이 없으면 `wait: 0`. 옵션 창의 기준값 표시에만 쓰이고 실제 세션 시간은 설정값이다.
8. 세트 `name`은 `school.short` + 공백 + 세션 기호(교재의 A/B/C 또는 책의 표기). 교재가 학교 약칭을 줄여 적어도("서울 A", "시립 A") 사이트에서는 `school.short`를 쓴다("서울대 A", "서울시립대 A"). 화면의 세트 라벨은 `SNU.db.label(set)` = `<year>학년도 <name>`이다.

## 2. `data/models.js` — `window.MODEL_CATALOG`

`{ anthropic: [{id, label, note}], openai: [...], transcription: [...] }`. 첫 항목이 추천 기본값이지만 실제 기본값은 `app.js` DEFAULTS. 새 모델은 한 줄 추가. 제공사 공식 문서의 id를 쓴다.

## 3. `data/library.js` — `window.LIBRARY`

원본 "면접 도서 100선" HTML에서 추출한 데이터. 손으로 편집하지 않는다. 키: `books`(id, rank, grade S/A/B/C, title, author, cluster, pages, scope, summary, argument, counter, use, keywords, editions…), `clusters`, `edges`(책 간 관계 x/c/l), `pairs`, `stages`, `issues`(18개: facts, axis, use, questions, oral6), `meta`. 서가 화면이 쓰는 필드는 `assets/library.js` 상단 주석에 있다.

## 4. 브라우저 저장소

| 키 | 내용 |
|---|---|
| `localStorage["snu-iv-settings-v1"]` | 설정. 키 이름을 바꾸면 `app.js`에서 마이그레이션(예: 이전 `lastSet: "2023-A"` → `"snu-2023-A"`, `openaiModel: "gpt-5"` → 새 기본값) |
| IndexedDB `snu-interview` v1 `recordings` | 녹음. P1-2에서 `sessions` store 추가 시 DB 버전 2로 올리고 `onupgradeneeded`에서 생성 |
| `localStorage["snu-db-threads-v1"]` | 기출DB 문답. 질문 key = `<student>-<n>` 또는 `common-<label>-<n>`. 세트 안에서 질문 순서를 바꾸면 key가 틀어지므로 순서 변경 금지(추가는 끝에) |
| `localStorage["snu-library-progress-v1"]` | 서가 진도 |

## 5. 검증 스크립트 `tools/validate-data.js`

`node tools/validate-data.js` — 세트 id 유일성, `school` 일치, 제시문 번호 연속, 빈 질문, 트리 참조 무결성(모든 `next`가 존재, root 도달, 순환 없음), `themes` 길이, 모델 목록 id 중복을 검사하고 세트별 제시문·질문 수를 출력한다. 데이터 구조를 바꾸면 이 스크립트도 같이 고친다.
