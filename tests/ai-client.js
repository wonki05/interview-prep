/* AI 응답 회귀: 외부 통신 없이 실제 공통 설정·모델 목록과 모의 fetch로 검증한다. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
let checks = 0;

function setup(replies, provider = "anthropic") {
  const requests = [];
  const context = vm.createContext({
    window: {},
    document: { readyState: "loading", addEventListener() {}, documentElement: { removeAttribute() {}, setAttribute() {} } },
    localStorage: { getItem() { return null; } },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      assert.ok(replies.length, "예상보다 많은 API 재시도");
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { ok: !reply.status || reply.status === 200, status: reply.status || 200, json: async () => reply.data || reply };
    }
  });
  for (const file of ["assets/app.js", "data/models.js", "assets/ai.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  const settings = context.window.SNU.settings;
  settings.provider = provider;
  /* 실제 키가 아니다. 모의 인증 값은 실행 중 메모리에만 만들고 외부로 전송하지 않는다. */
  settings.anthropicKey = settings.openaiKey = crypto.randomBytes(24).toString("hex");
  context.window.INTERVIEW_DB = {
    schools: [{ id: "snu", name: "서울대학교" }],
    levels: { difficulty: { low: { label: "하", desc: "제시문 이해 확인" }, mid: { label: "중", desc: "논증 확인" } }, variation: { low: { label: "하", desc: "원문 유지" }, mid: { label: "중", desc: "표현 변형" } } }
  };
  return { client: context.window.AIClient, settings, requests, models: context.window.SNU.models };
}
const set = { id: "snu-2023-A", school: "snu", name: "서울대 A", year: 2023, session: "오전", instruction: "답하시오.", passages: [{ no: 1, text: "검증용 제시문" }], followups: [{ student: "A", label: "추가질문", items: ["근거는 무엇입니까?"] }], format: { prep: 20, duration: 15, ratio: "3:1" } };
const feedback = { feedback: "논거를 확인했습니다.", followup: "반례는 무엇입니까?" };
const studySet = {
  ...set,
  variant: "kim",
  passages: [
    { no: 1, text: "검증용 제시문 하나: 행위의 피해와 자유를 구별한다.", source: "검증용 출전 A" },
    { no: 2, text: "검증용 제시문 둘: 선택의 조건을 검토한다.", source: "검증용 출전 B" }
  ],
  tasks: [{ label: "1", text: "검증용 문제지 문항: 개입 기준을 말하시오." }],
  followups: [{ student: "A", label: "추가질문", items: ["검증용 추가질문: 타인에게 영향이 없다면?"] }],
  common: [{ label: "공통", items: ["검증용 공통질문: 기준의 한계는?"] }]
};
const studyBooks = [{ id: 16, title: "검증용 도서", author: "검증용 저자", core: "자율성과 개입의 조건을 비교한다.", keywords: ["자유", "개입"] }];
const exampleAnswers = { examples: [
  { label: "해악 중심", answer: "타인의 구체적 피해를 기준으로 개입 범위를 정하겠습니다.", importance: "피해와 불쾌감을 구별하는 기준을 드러냅니다.", cautions: "피해의 존재와 규제 필요성을 별도로 논증합니다." },
  { label: "선택 조건 중심", answer: "선택의 자발성과 대안을 먼저 확인하겠습니다.", importance: "형식적 동의와 실질적 선택을 구별합니다.", cautions: "조건이 부족하다는 이유만으로 선택을 전면 부정하지 않습니다." }
] };
const passageExplanation = {
  overview: "두 제시문은 개입의 기준과 선택의 조건을 비교하게 합니다.",
  passages: [
    { no: 1, summary: "행위의 피해와 자유를 구별합니다.", intent: "피해 판단의 기준을 설명하는지를 묻는 것으로 해석됩니다.", keyPoints: ["피해의 범위"], notes: "피해의 존재와 규제 필요성을 구별합니다." },
    { no: 2, summary: "선택의 실질적 조건을 검토합니다.", intent: "선택이 성립하는 전제를 검토하는지 묻는 것으로 해석됩니다.", keyPoints: ["자발성과 대안"], notes: "제시문에 없는 조건은 가정으로 구별합니다." }
  ],
  questionStrategy: ["문제지 문항의 기준을 추가질문의 반례에 일관되게 적용합니다."],
  sourceNotes: "입력에는 검증용 출전 A와 검증용 출전 B가 제시되어 있습니다.",
  books: [{ id: 16, reason: "자율성과 개입 조건을 비교하는 연관 독서입니다. 실제 출전으로 확인된 것은 아닙니다." }]
};
const copy = value => JSON.parse(JSON.stringify(value));
const anth = (text, stop = "end_turn") => ({ content: [{ type: "text", text }], stop_reason: stop });
const openai = (text, finish = "stop") => ({ choices: [{ message: { content: text }, finish_reason: finish }] });
const respond = client => client.respond(set, "근거는 무엇입니까?", [{ role: "user", text: "제시문에 근거합니다." }]);
async function test(label, run) { await run(); checks++; console.log("통과: " + label); }

(async () => {
  await test("Claude 스키마·effort 전송과 추론 블록 제외", async () => {
    const reply = anth(JSON.stringify(feedback));
    reply.content.unshift({ type: "thinking", thinking: "응답으로 노출하지 않음" });
    const { client, requests, settings } = setup([reply]);
    settings.anthropicEffort = "xhigh";
    assert.equal((await respond(client)).followup, feedback.followup);
    const body = requests[0].body;
    assert.equal(body.output_config.effort, "xhigh");
    assert.equal(body.output_config.format.type, "json_schema");
    assert.deepEqual(body.output_config.format.schema.required, ["feedback", "followup"]);
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.ok(body.max_tokens >= 8192);
    assert.ok(body.messages[0].content.includes(set.passages[0].text));
    assert.ok(requests[0].url.startsWith("https://api.anthropic.com/"));
  });
  await test("OpenAI 스키마·세션 effort와 출력 예산", async () => {
    const { client, requests, settings } = setup([openai(JSON.stringify(feedback))], "openai");
    settings.openaiEffort = "low";
    await client.respond(set, "질문", [], { provider: "openai", model: "gpt-6.1-sol", effort: "high" });
    const body = requests[0].body;
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.store, false);
    assert.ok(body.max_completion_tokens >= 8192);
    assert.equal(settings.openaiEffort, "low");
    assert.ok(requests[0].url.startsWith("https://api.openai.com/"));
  });
  await test("추론만 반환하고 잘린 Claude 응답은 예산을 늘려 한 번 복구", async () => {
    const { client, requests } = setup([{ content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens" }, anth(JSON.stringify(feedback))]);
    assert.equal((await respond(client)).feedback, feedback.feedback);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.max_tokens, requests[0].body.max_tokens * 2);
  });
  await test("OpenAI length 응답은 JSON이 완성되어 보여도 재시도", async () => {
    const { client, requests } = setup([openai(JSON.stringify(feedback), "length"), openai(JSON.stringify(feedback))], "openai");
    await respond(client);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.max_completion_tokens, requests[0].body.max_completion_tokens * 2);
  });
  await test("반복 잘림은 두 번에서 멈추고 원인을 표시", async () => {
    const { client, requests } = setup([anth("", "max_tokens"), anth("", "max_tokens")]);
    await assert.rejects(respond(client), /출력 한도/);
    assert.equal(requests.length, 2);
  });
  await test("빈 응답은 JSON 오류와 구분하고 복구", async () => {
    const { client, requests } = setup([anth(""), anth(JSON.stringify(feedback))]);
    await respond(client);
    assert.equal(requests.length, 2);
    const bad = setup([openai(null), openai(null)], "openai");
    await assert.rejects(respond(bad.client), /답변이 비어/);
  });
  await test("JSON 코드펜스 허용, 필수 항목 누락 복구", async () => {
    const { client, requests } = setup([anth('{"feedback":"검토"}'), anth("```JSON\n" + JSON.stringify(feedback) + "\n```")]);
    assert.equal((await respond(client)).feedback, feedback.feedback);
    assert.equal(requests.length, 2);
  });
  await test("임의 텍스트·배열·null·공백 필드를 성공으로 취급하지 않음", async () => {
    for (const text of ["JSON 없는 답변", "[]", "null", '{"feedback":" ","followup":"질문"}', '{"feedback":2,"followup":"질문"}']) {
      const { client, requests } = setup([anth(text), anth(text)]);
      await assert.rejects(respond(client), /형식|필수 항목/);
      assert.equal(requests.length, 2);
    }
  });
  await test("거부 응답은 형식 재시도 없이 중단", async () => {
    const a = setup([anth("거부", "refusal")]);
    await assert.rejects(respond(a.client), /거절/);
    assert.equal(a.requests.length, 1);
    const b = setup([{ choices: [{ message: { content: null, refusal: "거부" }, finish_reason: "stop" }] }], "openai");
    await assert.rejects(respond(b.client), /거절/);
    assert.equal(b.requests.length, 1);
  });
  await test("인증·과금·통신 오류는 재시도하지 않음", async () => {
    for (const [reply, pattern] of [[{ status: 401, data: { error: {} } }, /API 키/], [{ status: 429, data: { error: { code: "insufficient_quota" } } }, /잔액/], [new Error("연결 중단"), /네트워크/]]) {
      const { client, requests } = setup([reply]);
      await assert.rejects(respond(client), pattern);
      assert.equal(requests.length, 1);
    }
  });
  await test("키가 없으면 외부 요청하지 않음", async () => {
    const { client, requests, settings } = setup([]);
    settings.anthropicKey = " ";
    await assert.rejects(respond(client), /API 키/);
    assert.equal(requests.length, 0);
  });
  await test("다음 질문도 구조화 응답과 원문 컨텍스트 사용", async () => {
    const question = { question: "공통점은 무엇입니까?", focus: "1", why: "독해 확인" };
    const { client, requests } = setup([anth(JSON.stringify(question))]);
    assert.equal((await client.nextQuestion(set, [], "mid", "mid")).question, question.question);
    assert.deepEqual(requests[0].body.output_config.format.schema.required, ["question", "focus", "why"]);
    assert.ok(requests[0].body.messages[0].content.includes("[복기된 실제 추가질문 전체]"));
  });
  await test("유한·무한 면접 질문의 시간 맥락과 질문 원칙 분리", async () => {
    const { client } = setup([]);
    const timed = client.buildNextQuestionInput(set, [{ q: "입장은 무엇입니까?", a: "기준을 제시합니다." }], "mid", "mid", { prep: 20, interview: 15 }, 121);
    const endless = client.buildNextQuestionInput(set, [], "mid", "mid", { prep: 20, interview: 0 }, null);
    assert.ok(timed.user.includes("남은 시간 2분 1초"));
    assert.ok(timed.system.includes("유한 시간 면접"));
    assert.ok(timed.system.includes("실제 사례"));
    assert.ok(timed.system.includes("다섯 문장"));
    assert.ok(endless.user.includes("시간 제한 없음"));
    assert.ok(endless.system.includes("무한 시간 면접"));
    assert.ok(endless.system.includes("논점을 서둘러 떠나지 않는다"));
    assert.ok(!endless.system.includes("3분 안팎"));
    assert.ok(!endless.system.includes("1분 이내"));
    assert.ok(timed.system.includes("전체 면접 시간 대비"));
    assert.ok(timed.system.includes("번호를 언급한 것만"));
    assert.ok(endless.system.includes("더는 새로운 검증이 없으면"));
    assert.ok(timed.system.includes("조건부 주장"));
    assert.ok(timed.system.includes("구조와 대응"));
    assert.ok(timed.system.includes("합리적인 수정 자체를 실패로 취급하지 않는다"));
    assert.ok(timed.system.includes("어떤 유형의 질문이든"));
    assert.ok(timed.system.includes("곧바로 회피로 판정하지 않는다"));
  });
  await test("유한 시간 음수·소수 보정, 무한 시간은 전달된 남은 초를 무시", async () => {
    const { client } = setup([]);
    assert.ok(client.buildNextQuestionInput(set, [], "mid", "mid", { interview: 15 }, -1).user.includes("남은 시간 0분 0초"));
    assert.ok(client.buildNextQuestionInput(set, [], "mid", "mid", { interview: 15 }, 59.2).user.includes("남은 시간 1분 0초"));
    assert.ok(client.buildNextQuestionInput(set, [], "mid", "mid", { interview: 7 }).user.includes("남은 시간 7분 0초"));
    assert.ok(client.buildNextQuestionInput(set, [], "mid", "mid", { interview: 0 }, 59).user.includes("시간 제한 없음"));
    assert.ok(client.buildNextQuestionInput(set, [], "mid", "mid").user.includes("남은 시간 15분 0초"));
  });
  await test("다음 질문의 실제 요청은 미리 보기와 같은 답변·시간 맥락을 전달", async () => {
    const question = { question: "그 기준을 적용할 실제 사례는 무엇입니까?", focus: "1", why: "제시한 조건의 적용 확인" };
    const { client, requests } = setup([openai(JSON.stringify(question))], "openai");
    const history = [{ q: "언제 허용됩니까?", a: "피해가 입증되는 경우에만 허용됩니다." }], plan = { prep: 20, interview: 10 };
    const preview = client.buildNextQuestionInput(set, history, "mid", "mid", plan, 82);
    await client.nextQuestion(set, history, "mid", "mid", undefined, plan, 82);
    assert.equal(requests[0].body.messages[0].content, preview.system);
    assert.equal(requests[0].body.messages[1].content, preview.user);
    assert.ok(preview.user.includes(history[0].a) && preview.user.includes("남은 시간 1분 22초"));
  });
  await test("다섯 문장 초과 질문은 자르지 않고 한 번 재생성", async () => {
    const long = { question: "조건을 가정합니다. 첫 범위를 봅니다. 다음 범위를 봅니다. 다른 조건입니다. 예외도 있습니다. 기준은 무엇입니까?", focus: "1", why: "기준 검증" };
    const short = { ...long, question: "6.5%라는 수치는 가정입니다. 이 경우에도 그 기준을 적용합니까?" };
    const { client, requests } = setup([anth(JSON.stringify(long)), anth(JSON.stringify(short))]);
    assert.equal((await client.nextQuestion(set, [], "mid", "mid")).question, short.question);
    assert.equal(requests.length, 2);
    const repeated = setup([openai(JSON.stringify(long)), openai(JSON.stringify(long))], "openai");
    await assert.rejects(repeated.client.nextQuestion(set, [], "mid", "mid"), /다섯 문장/);
    assert.equal(repeated.requests.length, 2);
    const five = { ...long, question: "조건은 하나입니다. 피해를 가정합니다. 비용도 있습니다. 대안은 없습니다. 허용합니까?" };
    assert.equal((await setup([anth(JSON.stringify(five))]).client.nextQuestion(set, [], "mid", "mid")).question, five.question);
    const joined = { ...long, question: long.question.replace(/\. /g, ".") };
    const joinedResult = setup([anth(JSON.stringify(joined)), anth(JSON.stringify(short))]);
    assert.equal((await joinedResult.client.nextQuestion(set, [], "mid", "mid")).question, short.question);
    assert.equal(joinedResult.requests.length, 2);
  });
  await test("변형도 하의 긴 복기 원문은 보존하고 생성한 장문은 거부", async () => {
    const text = "조건 하나입니다. 조건 둘입니다. 조건 셋입니다. 조건 넷입니다. 조건 다섯입니다. 어떻게 판단합니까?";
    const recalled = { ...set, followups: [{ student: "A", label: "추가질문", items: [text] }] };
    const reply = { question: text, focus: "1", why: "복기 질문" };
    const good = setup([anth(JSON.stringify(reply))]);
    assert.equal((await good.client.nextQuestion(recalled, [], "low", "low")).question, text);
    const bad = setup([anth(JSON.stringify(reply)), anth(JSON.stringify(reply))]);
    await assert.rejects(bad.client.nextQuestion(set, [], "low", "low"), /다섯 문장/);
    const prompt = good.client.buildNextQuestionInput(recalled, [], "low", "low");
    assert.ok(prompt.system.includes("난이도 지침(하): 제시문 이해 확인"));
    assert.ok(prompt.system.includes("길이 축소보다 원문 유지가 우선"));
  });
  await test("잘못된 분류를 첫 분기로 조용히 치환하지 않음", async () => {
    const branches = [{ when: "동의" }, { when: "반대" }];
    const good = setup([anth("2")]);
    assert.equal(await good.client.classify("반대", branches), 1);
    for (const value of ["분류 실패", "0", "3", "1.5"]) {
      const bad = setup([anth(value)]);
      await assert.rejects(bad.client.classify("답변", branches), /분기를 직접/);
    }
  });
  await test("모델별 지원 effort 정규화와 직접 입력 모델 기본값", async () => {
    const { client, models, settings, requests } = setup([anth(JSON.stringify(feedback))]);
    for (const provider of ["anthropic", "openai"]) for (const model of models.list(provider)) {
      assert.equal(models.normalizeEffort(provider, model.id, "ultra"), "medium");
      assert.ok(models.effortOptions(provider, model.id).includes("max"));
    }
    assert.equal(models.normalizeEffort("openai", "gpt-6.1-sol", "none"), "medium");
    assert.equal(models.normalizeEffort("openai", "gpt-6.1-terra", "none"), "none");
    settings.anthropicModel = "custom-model";
    assert.equal(client.resolve().effort, null);
    await respond(client);
    assert.equal(requests[0].body.output_config, undefined);
    const other = setup([openai(JSON.stringify(feedback))], "openai");
    other.settings.openaiModel = "custom-model";
    await respond(other.client);
    assert.equal(other.requests[0].body.reasoning_effort, undefined);
    assert.equal(other.requests[0].body.response_format, undefined);
  });
  await test("예시답변 2종과 해설을 구조화하고 전체 제시문·문제를 입력", async () => {
    const { client, requests } = setup([anth(JSON.stringify(exampleAnswers))]);
    const question = "검증용 선택 질문: 어떤 기준을 적용하겠습니까?";
    const result = await client.exampleAnswers(studySet, question, { provider: "anthropic", effort: "high" });
    assert.deepEqual(copy(result), exampleAnswers);
    const body = requests[0].body, input = body.messages[0].content;
    const schema = body.output_config.format.schema;
    assert.equal(schema.properties.examples.type, "array");
    assert.equal(schema.properties.examples.items.additionalProperties, false);
    for (const name of ["label", "answer", "importance", "cautions"]) assert.ok(schema.properties.examples.items.required.includes(name));
    for (const text of [...studySet.passages.map(p => p.text), studySet.tasks[0].text, studySet.followups[0].items[0], studySet.common[0].items[0], question]) assert.ok(input.includes(text), "학습 입력에 누락: " + text);
    assert.equal(body.output_config.effort, "high");
    const preview = client.buildExamplesInput(studySet, question);
    assert.equal(preview.system, body.system);
    assert.equal(preview.user, input);
    for (const rule of ["서로 다른 지원자의 답변", "다른 예시와 비교하지 않는다", "딜레마를 실제로 해소", "서로 다른 선택지", "서로 다른 구체적 사례", "반드시 하나를 선택", "가상 사례로 몰래 대체", "요약·이해 질문"]) assert.ok(body.system.includes(rule), rule);
    for (const rule of ["모든 질문 유형", "딜레마뿐 아니라 설명·비교·평가·사례 적용", "명시된 가정의 의미·정당성·현실 적합성", "원래 질문에 대한 결론", "비판적 재해석"]) assert.ok(body.system.includes(rule), rule);
  });
  await test("예시답변 부족·중복·중첩 형식 오류는 한 번 복구", async () => {
    const invalid = [];
    invalid.push({ examples: [exampleAnswers.examples[0]] });
    const sameLabel = copy(exampleAnswers); sameLabel.examples[1].label = sameLabel.examples[0].label; invalid.push(sameLabel);
    const sameAnswer = copy(exampleAnswers); sameAnswer.examples[1].answer = sameAnswer.examples[0].answer; invalid.push(sameAnswer);
    const blank = copy(exampleAnswers); blank.examples[1].cautions = " "; invalid.push(blank);
    const type = copy(exampleAnswers); type.examples[1].importance = []; invalid.push(type);
    const extra = copy(exampleAnswers); extra.examples[0].unknown = "추가 필드"; invalid.push(extra);
    invalid.push({ examples: [null, exampleAnswers.examples[1]] });
    for (const bad of invalid) {
      const { client, requests } = setup([anth(JSON.stringify(bad)), anth(JSON.stringify(exampleAnswers))]);
      assert.deepEqual(copy(await client.exampleAnswers(studySet, "질문")), exampleAnswers);
      assert.equal(requests.length, 2);
    }
  });
  await test("예시답변의 반복 의미 오류도 총 두 번에서 중단", async () => {
    const bad = JSON.stringify({ examples: [exampleAnswers.examples[0]] });
    const { client, requests } = setup([openai(bad), openai(bad)], "openai");
    await assert.rejects(client.exampleAnswers(studySet, "질문"));
    assert.equal(requests.length, 2);
  });
  await test("제시문 해설에 출전·추가질문·서가 후보를 전달하고 번호별로 반환", async () => {
    const { client, requests } = setup([openai(JSON.stringify(passageExplanation))], "openai");
    assert.deepEqual(copy(await client.explainPassages(studySet, studyBooks)), passageExplanation);
    const body = requests[0].body, input = body.messages[1].content;
    const schema = body.response_format.json_schema.schema;
    assert.equal(schema.properties.passages.type, "array");
    assert.equal(schema.properties.passages.items.properties.no.type, "integer");
    assert.equal(schema.properties.books.items.properties.id.type, "integer");
    assert.equal(schema.properties.passages.items.additionalProperties, false);
    assert.equal(body.response_format.json_schema.strict, true);
    for (const text of [...studySet.passages.flatMap(p => [p.text, p.source]), studySet.tasks[0].text, studySet.followups[0].items[0], studySet.common[0].items[0], studyBooks[0].title, studyBooks[0].author, studyBooks[0].core]) assert.ok(input.includes(text), "해설 입력에 누락: " + text);
    const preview = client.buildPassageExplanationInput(studySet, studyBooks);
    assert.equal(preview.system, body.messages[0].content);
    assert.equal(preview.user, input);
  });
  await test("제시문 누락·중복·없는 번호를 해설 성공으로 저장하지 않음", async () => {
    const missing = copy(passageExplanation); missing.passages.pop();
    const duplicate = copy(passageExplanation); duplicate.passages[1].no = 1;
    const unknown = copy(passageExplanation); unknown.passages[1].no = 3;
    const wrongType = copy(passageExplanation); wrongType.passages[1].no = "2";
    const noninteger = copy(passageExplanation); noninteger.passages[1].no = 2.5;
    for (const bad of [missing, duplicate, unknown, wrongType, noninteger]) {
      const reply = JSON.stringify(bad), { client, requests } = setup([anth(reply), anth(reply)]);
      await assert.rejects(client.explainPassages(studySet, studyBooks));
      assert.equal(requests.length, 2);
    }
  });
  await test("서가에 없는 도서·중복 도서·빈 핵심요소를 거부", async () => {
    const unknownBook = copy(passageExplanation); unknownBook.books[0].id = 999;
    const duplicateBook = copy(passageExplanation); duplicateBook.books.push(copy(duplicateBook.books[0]));
    const emptyPoints = copy(passageExplanation); emptyPoints.passages[0].keyPoints = [];
    const emptyStrategy = copy(passageExplanation); emptyStrategy.questionStrategy = [];
    const wrongPoint = copy(passageExplanation); wrongPoint.passages[0].keyPoints = [1];
    const extra = copy(passageExplanation); extra.passages[0].url = "추가 필드";
    const missingSource = copy(passageExplanation); delete missingSource.sourceNotes;
    for (const bad of [unknownBook, duplicateBook, emptyPoints, emptyStrategy, wrongPoint, extra, missingSource]) {
      const reply = JSON.stringify(bad), { client, requests } = setup([openai(reply), openai(reply)], "openai");
      await assert.rejects(client.explainPassages(studySet, studyBooks));
      assert.equal(requests.length, 2);
    }
  });
  await test("연관 도서가 없으면 빈 목록 허용, 해설 의미 오류는 한 번 복구", async () => {
    const expected = copy(passageExplanation); expected.books = [];
    const invalid = copy(expected); invalid.passages.pop();
    const { client, requests } = setup([anth(JSON.stringify(invalid)), anth(JSON.stringify(expected))]);
    assert.deepEqual(copy(await client.explainPassages(studySet, [])), expected);
    assert.equal(requests.length, 2);
  });
  const reviewSession = {
    modeLabel: "1-A 면접시간 AI 면접관", answerMode: "text", plan: { prep: 20, wait: 5, interview: 15 }, options: { difficulty: "mid", variation: "mid", flow: "live" },
    history: [{ q: "검증용 질문 하나: 제시문 1을 요약해 보십시오.", a: "검증용 답변: 피해와 자유를 구별합니다.", group: "AI 면접관" }, { q: "검증용 질문 둘: 반례는 무엇입니까?", a: "  ", group: "AI 면접관" }],
    memo: "검증용 메모: 피해 기준"
  };
  const reviewReply = {
    summary: "검증용 총평입니다.", strengths: ["제시문을 정확히 요약했습니다."], gaps: ["반례에 답하지 않았습니다."],
    items: [{ no: 1, comment: "요약이 정확합니다.", better: "판단 기준을 먼저 말합니다." }, { no: 2, comment: "답변이 없습니다.", better: "반례를 들어 기준을 검증합니다." }],
    next: ["반례에 답하는 연습"]
  };
  await test("면접 피드백은 제시문·문답 전체·메모를 입력하고 총평·질문별 구조로 반환", async () => {
    const { client, requests, settings } = setup([anth(JSON.stringify(reviewReply))]);
    settings.anthropicEffort = "low";
    assert.deepEqual(copy(await client.review(studySet, reviewSession, { provider: "anthropic", model: "claude-opus-5-5", effort: "high" })), reviewReply);
    const body = requests[0].body, user = body.messages[0].content;
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.output_config.effort, "high");
    assert.deepEqual(body.output_config.format.schema.required, ["summary", "strengths", "gaps", "items", "next"]);
    assert.deepEqual(body.output_config.format.schema.properties.items.items.required, ["no", "comment", "better"]);
    assert.ok(body.max_tokens >= 16384);
    for (const text of [studySet.passages[0].text, studySet.passages[1].text, studySet.tasks[0].text, studySet.followups[0].items[0], reviewSession.history[0].q, reviewSession.history[0].a, reviewSession.memo, "A2: (답변 없음)", "난이도 중", "1-A 면접시간 AI 면접관"]) assert.ok(user.includes(text), text);
    assert.ok(!body.system.includes("음성 인식"));
    const voice = client.buildReviewInput(studySet, Object.assign({}, reviewSession, { answerMode: "voice", options: null, memo: "" }));
    assert.ok(voice.system.includes("음성 인식") && voice.user.includes("답변 음성") && !voice.user.includes("난이도") && !voice.user.includes("[메모]"));
  });
  await test("피드백 질문 번호 누락·중복·범위 밖·빈 보완점은 한 번 복구 후 중단", async () => {
    const missing = copy(reviewReply); missing.items.pop();
    const duplicate = copy(reviewReply); duplicate.items[1].no = 1;
    const outside = copy(reviewReply); outside.items[1].no = 3;
    const noGaps = copy(reviewReply); noGaps.gaps = [];
    const noNext = copy(reviewReply); noNext.next = [];
    const blank = copy(reviewReply); blank.items[0].better = " ";
    for (const bad of [missing, duplicate, outside, noGaps, noNext, blank]) {
      const reply = JSON.stringify(bad), { client, requests } = setup([openai(reply), openai(reply)], "openai");
      await assert.rejects(client.review(studySet, reviewSession));
      assert.equal(requests.length, 2);
    }
    const { client, requests } = setup([anth(JSON.stringify(missing)), anth(JSON.stringify(reviewReply))]);
    assert.deepEqual(copy(await client.review(studySet, reviewSession)), reviewReply);
    assert.equal(requests.length, 2);
  });
  await test("피드백 강점 빈 목록·질문 번호 순서 바뀜은 허용, 저장본도 같은 검증기", async () => {
    const reordered = copy(reviewReply); reordered.strengths = []; reordered.items.reverse();
    const { client, requests } = setup([anth(JSON.stringify(reordered))]);
    assert.deepEqual(copy(await client.review(studySet, reviewSession)), reordered);
    assert.equal(requests.length, 1);
    assert.equal(client.validateReviewResponse(copy(reviewReply), reviewSession).summary, reviewReply.summary);
    assert.throws(() => client.validateReviewResponse(Object.assign(copy(reviewReply), { extra: "추가 필드" }), reviewSession));
    assert.throws(() => client.validateReviewResponse(copy(reviewReply), { history: [reviewSession.history[0]] }));
    assert.doesNotThrow(() => client.validateJson(copy(reviewReply), client.schemas.review));
  });
  await test("제시문 없이 문항만 있는 세트(DATA.md 규칙 12)도 입력을 만들고 해설·피드백을 검증", async () => {
    const tasksOnly = Object.assign(copy(studySet), { passages: [], followups: [], common: [] });
    const explanation = Object.assign(copy(passageExplanation), { passages: [], books: [] });
    const { client, requests } = setup([anth(JSON.stringify(explanation)), anth(JSON.stringify(reviewReply))]);
    for (const inp of [client.buildExamplesInput(tasksOnly, "문제 1. 검증용 문제지 문항"), client.buildPassageExplanationInput(tasksOnly, []), client.buildReviewInput(tasksOnly, reviewSession)]) {
      assert.ok(inp.user.includes(tasksOnly.tasks[0].text) && !inp.user.includes("undefined"));
      assert.ok(inp.user.includes("[제시문 전문]\n(제시문 없음 — 문제지 문항만 출제)"));
    }
    assert.ok(!client.setContext(studySet).includes("제시문 없음"));
    assert.deepEqual(copy(await client.explainPassages(tasksOnly, [])), explanation);
    assert.equal((await client.review(tasksOnly, reviewSession)).items.length, 2);
    assert.equal(requests.length, 2);
  });
  console.log(`AI 회귀 ${checks}개 통과 (실제 API 호출 없음)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
