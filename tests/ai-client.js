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
    levels: { difficulty: { mid: { label: "중", desc: "논증 확인" } }, variation: { mid: { label: "중", desc: "표현 변형" } } }
  };
  return { client: context.window.AIClient, settings, requests, models: context.window.SNU.models };
}
const set = { id: "snu-2023-A", school: "snu", name: "서울대 A", year: 2023, session: "오전", instruction: "답하시오.", passages: [{ no: 1, text: "검증용 제시문" }], followups: [{ student: "A", label: "추가질문", items: ["근거는 무엇입니까?"] }], format: { prep: 20, duration: 15, ratio: "3:1" } };
const feedback = { feedback: "논거를 확인했습니다.", followup: "반례는 무엇입니까?" };
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
  console.log(`AI 회귀 ${checks}개 통과 (실제 API 호출 없음)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
