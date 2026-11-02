# AI — 면접관 연동 명세

구현은 `assets/ai.js` 한 파일. 모의면접(`practice.js`)과 기출DB(`db.js`)가 같은 함수를 쓴다.

## 1. 제공사·모델·키

| | Anthropic (Claude) | OpenAI (ChatGPT) |
|---|---|---|
| 엔드포인트 | `POST https://api.anthropic.com/v1/messages` | `POST https://api.openai.com/v1/chat/completions` |
| 헤더 | `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `content-type: application/json` | `authorization: Bearer <key>`, `content-type: application/json` |
| 본문 | `{model, max_tokens, system, messages, output_config:{effort, format}}` | `{model, max_completion_tokens, store:false, messages, reasoning_effort, response_format}` |
| 응답 텍스트 | `content[]`의 `type:"text"` 블록만 연결 | `choices[0].message.content`(문자열 또는 text 블록) |
| 오디오 입력 | 없음 | 전사는 별도 API(`docs/TRANSCRIPTION.md`) |

- 키는 `localStorage["snu-iv-settings-v1"].anthropicKey / openaiKey`. 브라우저에서 직접 호출하므로 CORS는 두 제공사 모두 허용되어 있다(Anthropic은 위 헤더 필요).
- 모델 목록: `data/models.js` `MODEL_CATALOG[provider] = [{id, label, note}]`. 화면에는 `label`(예: "Sonnet 5.5", "GPT-6.1 Sol")만 보이고 API에는 `id`를 보낸다. "직접 입력…"으로 임의 id 가능.
- 기본값: `settings.provider`, `settings.anthropicModel`(기본 `claude-sonnet-5-5`), `settings.openaiModel`(기본 `gpt-6.1-sol`), `settings.anthropicEffort / openaiEffort`(기본 `medium`). 기존 설정 키는 유지한다.
- 설정 서랍·모의면접 옵션·기출DB AI 바에서 단계형 슬라이더로 effort를 고른다. Claude 네 모델 및 GPT-6.1 Sol·GPT-6 Astra는 `low/medium/high/xhigh/max`, GPT-6.1 Terra·GPT-6 Luna는 `none`도 지원한다. 직접 입력한 미확인 모델은 슬라이더를 비활성화하고 API 기본 effort를 쓴다.
- 세션 재정의: 모의면접 옵션 창과 기출DB AI 바의 `{provider, model, effort}`는 그 화면에서만 유효. `AIClient.resolve(override)`가 `{provider, model, effort, key, configured, label, modelLabel}`을 돌려준다. 제공사·모델이 지원하지 않는 effort는 `medium`으로, 미확인 모델은 `null`로 정규화한다.
- 키가 없으면(`configured=false`) 호출하지 않고 대체 경로로 간다. 호출 실패(4xx/5xx/네트워크)도 같은 대체 경로 + 한 줄 오류.

### 1.1 구조화 응답·출력 한도

- 목록에 수록된 모델의 질문 생성·기출DB 검토는 JSON Schema를 요청한다. Anthropic은 `output_config.format = {type:"json_schema", schema}`, OpenAI는 `response_format = {type:"json_schema", json_schema:{name, strict:true, schema}}`. 모든 필드를 필수 문자열로 정하고 `additionalProperties:false`를 사용한다. 직접 입력한 미확인 모델에는 effort·구조화 출력 옵션을 보내지 않으며 기존 JSON 프롬프트와 응답 검증을 적용한다.
- Claude의 추론도 `max_tokens`에, OpenAI의 추론도 `max_completion_tokens`에 포함된다. 기존 500/600 토큰 제한은 추론만으로 소진되어 답변 텍스트가 비거나 잘릴 수 있었다. 표시될 답변은 기존처럼 짧게 요청하면서 총 출력 예산을 effort별로 확보한다.

| effort | 첫 호출 출력 한도(추론 포함) |
|---|---:|
| `none` 또는 미확인 모델 | 2,048 |
| `low` | 4,096 |
| `medium` | 8,192 |
| `high` | 16,384 |
| `xhigh` | 24,576 |
| `max` | 32,768 |

- `stop_reason:max_tokens` / `finish_reason:length`는 잘림으로 판단하고 한도를 두 배(최대 65,536)로 늘려 한 번 재시도한다. 빈 응답·JSON 구문 오류·필수 항목 누락도 한 번만 재시도한다. 원인들이 섞여도 한 사용자 요청에서 총 두 번을 넘지 않는다.
- 거부 응답·입력 한도 초과·HTTP 오류·연결 실패는 자동 재시도하지 않는다. 키 오류(401), 권한(403), 결제·잔액, 호출 제한(429), 서버 오류(5xx)를 구분한다. 오류 원문·추론 블록·API 키는 화면이나 로그에 남기지 않는다.
- JSON은 객체만 허용하고 코드펜스는 제거한다. 필수 값이 누락되거나 공백·다른 형식이면 실패 처리하며, 화면에 `undefined` 검토나 빈 질문을 성공으로 저장하지 않는다.
- 근거(2026-11-03 확인): [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort), [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)·[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)·[Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)·[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

## 2. 컨텍스트(모든 질문 생성·검토 호출에 포함)

`setContext(set)`:

```
[면접 세트] 2023학년도 서울대 A (오전 면접) · 복기본: 김종수 복기
[지시문] …
[문제]                          ← 문제지 문항(tasks)이 있는 세트만(고려대·연세대 등)
문제 1-1. …
[제시문 전문]
<제시문 1> (A4 용지 2/5 분량)
…전문…
<제시문 2> …
<사례 1> …                      ← label이 낱말이면 그대로 머리, 한 글자면 <제시문 n> (가)
[복기된 실제 추가질문 전체]
1. (A학생 추가질문) …
2. …
```

제시문은 `passages[].text` 원문 그대로. 질문은 `bank(set)` 순서(학생 A → B → … → 공통). 문제지 문항은 은행에 넣지 않고 `[문제]`에만 두며, 첫 질문 지시를 "문제지 문항에 대한 답변(기조 발언)"으로 바꾼다. 모의면접 '복기 질문 전부' 모드는 문항을 먼저 묻고, 기출DB는 "문제" 묶음(키 `task-<n>`)으로 답해 볼 수 있다. 화면의 "AI 입력 미리 보기/보기"는 실제 빌더(`buildNextQuestionInput`, `buildDbInput`)의 출력을 그대로 보여 준다. 빌더를 바꾸면 미리 보기도 자동으로 바뀐다.

## 3. 호출 종류

### 3.1 `nextQuestion(set, history, difficulty, variation, ai, plan)` — 모의면접 다음 질문

system:

```
당신은 {학교} 법학전문대학원 {연도}학년도 면접관이다. 교수 {교수 수} 명이 지원자 한 명을 {면접 시간}분간 면접한다. 지원자는 아래 제시문을 {준비 시간}분간 읽고 메모했다.
난이도 지침({label}): {levels.difficulty[d].desc}
변형도 지침({label}): {levels.variation[v].desc}
규칙: 한 번에 질문 하나만 낸다. 질문은 세 문장 이내의 구어체 존댓말로 쓴다("~입니까?", "~해 보십시오"). 지원자의 직전 답변을 반영해 꼬리질문을 하되, 같은 소재에 세 번 이상 머물렀으면 다른 제시문으로 옮긴다. 답변이 비어 있거나 전사가 깨졌으면 같은 질문을 더 짧게 다시 묻는다. 제시문 내용은 바꾸거나 지어내지 않는다. 지원자를 평가하는 말은 하지 않는다.
출력은 JSON 하나만: {"question": "질문", "focus": "제시문 번호 또는 '종합'", "why": "출제 의도 한 문장"}
```

교수 수는 세트 `format.ratio`의 앞 수(한양대 `2:1` → 두), 없으면 세.

user: `setContext(set)` + `[지금까지의 문답] Q1/A1 …` + `다음 질문을 JSON으로 만들어라.`
응답: JSON `{question, focus, why}`. 세 필수 문자열의 형식·공백 여부를 검증한다. 출력 한도는 §1.1.

난이도·변형도 정의(`data/questions.js levels`):

| 난이도 | 정의 |
|---|---|
| 하 | 요약과 이해 확인 위주. 반론 요구 없이 제시문 안에서 답할 수 있는 질문 |
| 중 | 입장을 요구하고 반론을 한 번 제기한다. 제시문 두 개를 연결하는 질문을 섞는다 |
| 상 | 반론과 재반론을 요구하고, 제시문 간 교차 적용과 현실 사례 전이를 요구한다 |
| 최상 | 답변의 전제를 공격하고 모순을 지적하며 연속으로 압박한다. 가상 사례를 제시해 입장의 한계를 시험한다 |

| 변형도 | 정의 |
|---|---|
| 하 | 복기된 질문을 그대로 쓴다. 순서만 상황에 맞게 조정 |
| 중 | 복기된 질문의 소재와 구조를 유지하되 표현·순서·초점을 바꾼다 |
| 상 | 복기된 질문의 구조만 참고하고 새로운 각도·사례로 다시 만든다. 제시문은 바꾸지 않는다 |

### 3.2 `classify(answer, branches, ai)` — 결정 트리 분기 (경량)

system: `지원자의 답변을 읽고 아래 분류 가운데 가장 맞는 것의 번호만 출력한다. 다른 말은 쓰지 않는다.`
user: `[답변] … [분류] 1. {when} 2. {when} …` → 숫자 하나. 출력 한도는 추론 토큰을 포함해 §1.1을 따른다. 범위 안의 정수만 허용하며 잘못된 결과는 수동 분기 선택으로 보낸다. **제시문 미포함**(Q-2에서 재검토). 경량 모델(Haiku 5.5 / GPT-6 Luna) 권장.

### 3.3 `respond(set, question, thread, ai)` — 기출DB 검토 + 꼬리질문

system: 면접관 역할, (1) 제시문을 정확히 읽었는지·논증 구조(주장–근거–반론 처리)를 두세 문장으로 검토(칭찬보다 빠진 것), (2) 꼬리질문 하나(구어체 존댓말, 세 문장 이내). JSON `{"feedback", "followup"}`.
user: `setContext(set)` + `[이번에 다루는 질문]` + `[문답 기록] 지원자: … / 면접관(검토): … / 면접관(꼬리질문): …` + 지시. 두 필수 문자열의 형식·공백 여부를 검증한다. 출력 한도는 §1.1.

### 3.4 (예정) `review(set, history, ai)` — 종료 후 총평 (P2-3)

JSON `{summary, strengths[], gaps[], next[]}`. 입력: `setContext` + 세션 문답 전체 + 메모(선택).

## 4. 대체 경로(키 없음·실패)

- 다음 질문: 문제지 문항(있으면) → 복기 질문 은행 `bank(set)` 순으로 아직 묻지 않은 첫 질문(`practice.js` `pool`). 변형 없음.
- 분기: 사용자가 `when` 목록에서 직접 고른다(질문 카드에 버튼).
- 기출DB: [AI 면접관에게 보내기] 비활성, [기록만 남기기]만.
- 오류 문구: `AI 호출 실패: {status/메시지} — 복기 질문 은행으로 대체.` 식으로 한 줄.

## 5. 결정 트리 스키마

```js
tree: {
  example: true,           // 샘플 표시용. 생성된 트리에는 넣지 않는다
  root: "n0",
  nodes: {
    n0: { q: "질문", branches: [{ when: "답변 분류 조건", next: "n1" }, { when: "…", next: "n2" }] },  // 분기
    n1: { q: "질문", next: "n2" },                                                                    // 직선
    n2: { q: "질문", next: null }                                                                     // 끝 → 실시간 생성/질문 은행
  }
}
```

P2-1에서 난이도별 `trees: { low, mid, high, max }`로 확장한다. 실행기(`practice.js nextQuestion/showTreeNode`)는 `set.trees?.[difficulty] || set.tree`를 쓴다.

## 6. 트리 생성 프롬프트 (P2-1, 추론 강도 높은 모델: Fable 5.1 / Opus 5.5 / GPT-6 Astra)

입력: `setContext(set)` + 난이도 정의 + 아래 지시.

```
위 제시문과 복기 질문으로 {난이도} 면접 결정 트리를 만든다.
- 노드 8~12개, 깊이 6~10. 분기 노드는 가지 2~3개, when은 서로 배타적이고 답변 전사만 보고 판별할 수 있는 조건이어야 한다.
- 첫 노드는 복기에서 실제로 첫 질문이었던 유형(요약·공통 주제)으로 시작한다.
- 질문은 복기 질문의 소재를 우선 쓰되 {변형도} 지침을 따른다. 제시문 내용은 바꾸지 않는다.
- 모든 경로가 제시문 네 편을 최소 한 번씩 거치게 한다.
- 출력은 JSON 하나: {"root": "...", "nodes": {...}} (위 스키마). 설명 금지.
```

검증: `tools/validate-data.js`가 트리의 `next`가 모두 존재하는 노드를 가리키는지, 순환이 없는지, root에서 모든 노드에 닿는지 확인한다.

## 7. 비용·지연 지침

- 질문 생성 1회: 입력 ≈ 제시문 4편(한글 4~6천 자) + 질문 목록 + 문답 ≈ 6~10k 토큰. 세션(질문 8~10개)당 10회 안팎. 추론 토큰과 실제 출력은 모델·effort에 따라 달라지므로 짧은 답변 길이만으로 비용을 추정하지 않는다.
- 분기 분류 1회: 입력 수백 토큰. 경량 모델로.
- 기출DB 검토 1회: 질문 생성과 비슷.
- 전사: `docs/TRANSCRIPTION.md`.

## 8. 보안

- 키는 브라우저 밖으로 나가지 않는다(제공사 API 제외). 콘솔·오류 메시지·세션 기록에 키를 찍지 않는다.
- 공용 PC 경고는 설정 서랍 한 줄로 충분. 추가 암호화는 하지 않는다(브라우저 저장소의 한계를 사용자가 안다).
