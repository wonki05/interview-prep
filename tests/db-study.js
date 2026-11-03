/* 기출DB 학습 도우미 회귀: 브라우저·외부 API 없이 실제 설정·검증기·캐시 서비스를 실행한다. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const SETTINGS = "snu-iv-settings-v1", CACHE = "snu-db-study-v1";
const copy = value => JSON.parse(JSON.stringify(value));
const librarySource = fs.readFileSync(path.join(root, "data/library.js"), "utf8");
const scripts = Object.fromEntries(["assets/app.js", "data/models.js", "assets/ai.js", "assets/db-study.js"].map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
let checks = 0;

function fixtureSet() {
  return {
    id: "snu-2023-A", school: "snu", name: "서울대 A", year: 2023, session: "오전", variant: "kim", variantLabel: "김종수 복기",
    instruction: "논거를 답하시오.", source: { book: "검증용 복기 자료", pages: "1-2" },
    passages: [
      { no: 1, text: "검증용 제시문: 타인의 피해와 자유를 구별한다.", source: "검증용 출전 하나" },
      { no: 2, text: "검증용 제시문: 선택의 실질적 조건을 검토한다.", source: "검증용 출전 둘" }
    ],
    tasks: [{ label: "1", text: "개입의 기준을 말하시오." }],
    followups: [{ student: "A", label: "추가질문", items: ["타인에게 영향이 없다면?"] }],
    common: [], format: { prep: 20, duration: 15, ratio: "3:1" }
  };
}
function fixtureExamples(suffix = "") {
  return { examples: [
    { label: "피해 중심", answer: "타인의 구체적인 피해를 개입의 기준으로 삼겠습니다." + suffix, importance: "피해와 불쾌감의 차이를 드러냅니다.", cautions: "규제의 필요성을 별도로 논증합니다." },
    { label: "선택 조건 중심", answer: "자발성과 실질적 대안을 먼저 확인하겠습니다." + suffix, importance: "동의와 실질적 선택을 구별합니다.", cautions: "선택을 전면 부정하는 결론을 피합니다." }
  ] };
}
function fixtureExplanation(set, books, suffix = "") {
  return {
    overview: "제시문들은 개입 기준과 선택의 조건을 비교합니다." + suffix,
    passages: set.passages.map(p => ({ no: p.no, summary: "해당 제시문의 주장과 근거를 정리합니다.", intent: "복기 질문에 비추어 판단 기준을 확인하려는 것으로 해석됩니다.", keyPoints: ["판단 기준의 적용 범위"], notes: "원문에 없는 전제는 별도 가정으로 구별합니다." })),
    questionStrategy: ["기준을 반례에 일관되게 적용합니다."], sourceNotes: "기록된 출전 외에 외부 원전 대조를 수행하지 않았습니다.",
    books: books.length ? [{ id: books[0].id, reason: "제시문의 판단 기준과 연결되는 연관 독서입니다. 실제 출전으로 확인된 것은 아닙니다." }] : []
  };
}
function setup(options = {}) {
  const storage = options.storage || new Map(), calls = { examples: [], explain: [] }, inserted = [], events = [];
  const hooks = {}, failures = { read: false, write: false };
  let context;
  const document = {
    readyState: "loading", addEventListener() {}, dispatchEvent(event) { events.push(event); },
    documentElement: { removeAttribute() {}, setAttribute() {} },
    createElement(tag) { assert.equal(tag, "script"); return { remove() { this.removed = true; } }; },
    head: { append(script) {
      inserted.push(script);
      if (options.autoLibrary !== false) queueMicrotask(() => { vm.runInContext(librarySource, context, { filename: "data/library.js" }); script.onload(); });
    } }
  };
  context = vm.createContext({
    window: {}, document,
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail; } },
    localStorage: {
      getItem(key) { if (failures.read) throw new Error("저장소 읽기 불가"); return storage.get(key) || null; },
      setItem(key, value) { if (failures.write) throw new Error("저장 용량 초과"); storage.set(key, String(value)); }
    },
    fetch() { throw new Error("외부 요청 금지: 모의 AI 메서드를 사용해야 한다."); }
  });
  for (const file of ["assets/app.js", "data/models.js", "assets/ai.js"]) vm.runInContext(scripts[file], context, { filename: file });
  const window = context.window, settings = window.SNU.settings, client = window.AIClient;
  /* 모의 인증 값은 실행 중 메모리에서만 생성한다. 실제 키·예시 키를 파일에 저장하지 않는다. */
  if (options.key !== false) settings.anthropicKey = settings.openaiKey = crypto.randomBytes(24).toString("hex");
  window.INTERVIEW_DB = { schools: [{ id: "snu", name: "서울대학교" }], levels: {} };
  if (options.books) window.LIBRARY_DATA = { books: copy(options.books) };
  client.exampleAnswers = async (set, question, ai) => {
    calls.examples.push({ set: copy(set), question, ai: copy(ai) });
    if (!client.resolve(ai).configured) throw new Error("API 키가 없다.");
    return hooks.examples ? hooks.examples(set, question, ai) : fixtureExamples();
  };
  client.explainPassages = async (set, books, ai) => {
    calls.explain.push({ set: copy(set), books: copy(books), ai: copy(ai) });
    if (!client.resolve(ai).configured) throw new Error("API 키가 없다.");
    return hooks.explain ? hooks.explain(set, books, ai) : fixtureExplanation(set, books);
  };
  vm.runInContext(scripts["assets/db-study.js"], context, { filename: "assets/db-study.js" });
  return { study: window.DBStudy, snu: window.SNU, client, window, context, storage, settings, calls, hooks, inserted, failures, events,
    completeLibrary(index = inserted.length - 1) { vm.runInContext(librarySource, context, { filename: "data/library.js" }); inserted[index].onload(); }
  };
}
function gate() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function test(label, run) { await run(); checks++; console.log("통과: " + label); }
const examples = (h, set = fixtureSet(), refresh = false, question = "개입의 기준은 무엇입니까?") => h.study.examples(set, "A-1", question, undefined, refresh);
const explain = (h, set = fixtureSet(), refresh = false) => h.study.explain(set, undefined, refresh);
const entryOf = (h, set = fixtureSet()) => JSON.parse(h.storage.get(CACHE)).entries[h.study.identity(set)];

(async () => {
  await test("기존 면접관 설정을 해설 기본값으로 이어받고 저장·재열기 후 독립 유지", async () => {
    const storage = new Map([[SETTINGS, JSON.stringify({ provider: "openai", openaiModel: "gpt-6-luna", openaiEffort: "high", anthropicModel: "claude-opus-5-5", anthropicEffort: "low" })]]);
    const h = setup({ storage });
    assert.equal(h.study.resolveAi().provider, "openai");
    assert.equal(h.study.resolveAi().model, "gpt-6-luna");
    assert.equal(h.study.resolveAi().effort, "high");
    assert.equal(h.settings.explanationAnthropicModel, "claude-opus-5-5");
    h.snu.save({ explanationProvider: "anthropic", explanationAnthropicEffort: "max" });
    assert.equal(h.settings.provider, "openai");
    assert.equal(h.settings.anthropicEffort, "low");
    h.snu.save({ provider: "anthropic", anthropicModel: "claude-haiku-5-5", anthropicEffort: "medium" });
    const reload = setup({ storage });
    assert.equal(reload.study.resolveAi().model, "claude-opus-5-5");
    assert.equal(reload.study.resolveAi().effort, "max");
    assert.equal(reload.settings.anthropicModel, "claude-haiku-5-5");
    assert.equal(reload.settings.explanationOpenaiEffort, "high");
  });
  await test("저장된 해설 설정은 면접관 설정보다 우선하고 누락 필드만 보충", async () => {
    const h = setup({ storage: new Map([[SETTINGS, JSON.stringify({ provider: "openai", anthropicEffort: "high", explanationProvider: "anthropic", explanationAnthropicModel: "claude-fable-5-1", explanationAnthropicEffort: "low" })]]) });
    const ai = h.study.resolveAi();
    assert.equal(ai.provider, "anthropic");
    assert.equal(ai.model, "claude-fable-5-1");
    assert.equal(ai.effort, "low");
  });
  await test("화면 해설 모델 선택은 제공사별 해설 기본값을 쓰고 설정과 독립", async () => {
    const h = setup();
    h.snu.save({ explanationProvider: "openai", explanationOpenaiModel: "gpt-6.1-terra", explanationOpenaiEffort: "max", explanationAnthropicModel: "claude-opus-5-5", explanationAnthropicEffort: "high", anthropicModel: "claude-haiku-5-5" });
    const before = JSON.stringify(h.settings);
    const ai = h.study.resolveAi({ provider: "anthropic" });
    assert.equal(ai.model, "claude-opus-5-5");
    assert.equal(ai.effort, "high");
    const override = h.study.resolveAi({ provider: "openai", model: "gpt-6-astra", effort: "low" });
    await h.study.examples(fixtureSet(), "A-1", "개입의 기준은 무엇입니까?", override);
    await h.study.explain(fixtureSet(), override);
    for (const call of [h.calls.examples[0], h.calls.explain[0]]) assert.deepEqual(call.ai, { provider: "openai", model: "gpt-6-astra", effort: "low" });
    assert.equal(JSON.stringify(h.settings), before);
    assert.equal(h.study.resolveAi().model, "gpt-6.1-terra");
    assert.equal(h.study.resolveAi({ model: "custom-model" }).effort, null);
  });
  await test("예시답변 동시 요청은 한 번 생성하고 설정 스냅샷 사용", async () => {
    const h = setup(), waiting = gate();
    h.settings.explanationAnthropicModel = "claude-opus-5-5";
    h.settings.explanationAnthropicEffort = "high";
    h.hooks.examples = () => waiting.promise;
    const a = examples(h), b = examples(h);
    assert.equal(a, b);
    h.settings.explanationAnthropicModel = "claude-haiku-5-5";
    await Promise.resolve();
    assert.equal(h.calls.examples.length, 1);
    assert.equal(h.calls.examples[0].ai.model, "claude-opus-5-5");
    waiting.resolve(fixtureExamples());
    const [left, right] = await Promise.all([a, b]);
    assert.equal(left, right);
    assert.equal(left.effort, "high");
    assert.ok(left.model.includes("Opus"));
    assert.ok(Number.isFinite(left.at));
    assert.equal(h.inserted.length, 0);
  });
  await test("제시문 해설 동시 요청은 서가·생성 각각 한 번", async () => {
    const h = setup({ autoLibrary: false });
    const a = explain(h), b = explain(h);
    assert.equal(a, b);
    await Promise.resolve();
    assert.equal(h.inserted.length, 1);
    h.completeLibrary();
    const [left, right] = await Promise.all([a, b]);
    assert.equal(h.calls.explain.length, 1);
    assert.equal(left, right);
    assert.ok(left.books.length);
    assert.equal(entryOf(h).explanations[0].books, undefined);
  });
  await test("캐시 저장 구조(v2 결과 목록·입력 지문)와 키 없는 재열기", async () => {
    const h = setup();
    const originalExamples = await examples(h), originalExplanation = await explain(h);
    const saved = JSON.parse(h.storage.get(CACHE));
    assert.equal(saved.version, 2);
    assert.deepEqual(Object.keys(saved.entries), [JSON.stringify([fixtureSet().id, "kim"])]);
    const entry = entryOf(h);
    assert.equal(entry.examples["A-1"].length, 1);
    assert.equal(entry.examples["A-1"][0].question, "개입의 기준은 무엇입니까?");
    assert.match(entry.examples["A-1"][0].ctx, /^[0-9a-z]{1,12}$/);
    assert.equal(entry.context, undefined);
    assert.equal(entry.explanations.length, 1);
    assert.match(entry.explanations[0].lib, /^[0-9a-z]{1,12}$/);
    assert.equal(entry.explanations[0].libraryContext, undefined);
    assert.ok(h.storage.get(CACHE).length < JSON.stringify(await h.study.loadBooks()).length, "서가 후보 목록을 결과마다 저장하지 않는다");
    const reload = setup({ storage: new Map([[CACHE, h.storage.get(CACHE)]]), key: false });
    assert.deepEqual(copy(await examples(reload)), copy(originalExamples));
    assert.deepEqual(copy((await explain(reload)).data), copy(originalExplanation.data));
    assert.equal(reload.calls.examples.length + reload.calls.explain.length, 0);
  });
  await test("v1 캐시를 v2로 옮기고 기존 결과를 현재 결과로 재사용", async () => {
    const seed = setup(), set = fixtureSet(), books = await seed.study.loadBooks(), question = "개입의 기준은 무엇입니까?";
    const v1 = { version: 1, entries: { [JSON.stringify([set.id, "kim"])]: {
      context: JSON.stringify([1, seed.client.setContext(set), set.source || null, set.passages.map(p => [p.no, p.source || ""])]),
      examples: { "A-1": { question, data: fixtureExamples(" v1"), model: "Claude Sonnet 5.5", effort: "medium", at: 1000 } },
      explanation: { libraryContext: JSON.stringify(books), data: fixtureExplanation(set, books, " v1"), model: "Claude Sonnet 5.5", effort: null, at: 2000 }
    } } };
    const h = setup({ storage: new Map([[CACHE, JSON.stringify(v1)]]), key: false });
    assert.equal((await examples(h)).at, 1000);
    assert.equal((await explain(h)).at, 2000);
    assert.equal(h.calls.examples.length + h.calls.explain.length, 0);
    const exampleList = h.study.exampleHistory(set, "A-1", question), explanationList = h.study.explanationHistory(set);
    assert.deepEqual(copy(exampleList.map(r => [r.at, r.stale])), [[1000, false]]);
    assert.deepEqual(copy(explanationList.map(r => [r.at, r.stale])), [[2000, false]]);
    assert.ok(exampleList[0].data.examples[0].answer.endsWith(" v1"));
  });
  await test("새로 생성 요청은 결과를 쌓되 중복 요청은 합침", async () => {
    const h = setup(), question = "개입의 기준은 무엇입니까?";
    const first = await examples(h), firstExplanation = await explain(h);
    h.hooks.examples = () => fixtureExamples(" 새 답변");
    h.hooks.explain = (set, books) => fixtureExplanation(set, books, " 새 해설");
    const [a, b] = await Promise.all([examples(h, fixtureSet(), true), examples(h, fixtureSet(), true)]);
    assert.equal(a, b);
    assert.ok(a.data.examples[0].answer.endsWith(" 새 답변"));
    const [c, d] = await Promise.all([explain(h, fixtureSet(), true), explain(h, fixtureSet(), true)]);
    assert.equal(c, d);
    assert.ok(c.data.overview.endsWith(" 새 해설"));
    assert.equal(h.calls.examples.length, 2);
    assert.equal(h.calls.explain.length, 2);
    assert.deepEqual(copy(h.study.exampleHistory(fixtureSet(), "A-1", question).map(r => r.at)), [a.at, first.at]);
    assert.deepEqual(copy(h.study.explanationHistory(fixtureSet()).map(r => r.at)), [c.at, firstExplanation.at]);
    assert.ok(a.at > first.at && c.at > firstExplanation.at);
    assert.deepEqual(copy(await examples(h)), copy(a));
    assert.equal(h.calls.examples.length, 2);
  });
  await test("원문이 바뀐 뒤 이전 결과는 지우지 않고 stale로 남김", async () => {
    const h = setup(), set = fixtureSet(), question = "개입의 기준은 무엇입니까?";
    await examples(h, set); await explain(h, set);
    set.passages[0].text += " 새로운 판단 조건";
    assert.deepEqual(copy(h.study.exampleHistory(set, "A-1", question).map(r => r.stale)), [true]);
    assert.deepEqual(copy(h.study.explanationHistory(set).map(r => r.stale)), [true]);
    h.hooks.examples = () => fixtureExamples(" 새 원문");
    await examples(h, set); await explain(h, set);
    assert.equal(h.calls.examples.length, 2);
    assert.equal(h.calls.explain.length, 2);
    const list = h.study.exampleHistory(set, "A-1", question);
    assert.deepEqual(copy(list.map(r => r.stale)), [false, true]);
    assert.ok(list[0].data.examples[0].answer.endsWith(" 새 원문"));
    assert.deepEqual(copy(h.study.explanationHistory(set).map(r => r.stale)), [false, true]);
    assert.equal(entryOf(h, set).examples["A-1"].length, 2);
  });
  await test("결과 하나 지우기는 저장소에 반영하고 나머지는 유지", async () => {
    const h = setup(), set = fixtureSet();
    const first = await examples(h); h.hooks.examples = () => fixtureExamples(" 2차");
    const second = await examples(h, set, true);
    assert.equal(h.study.removeExample(set, "A-1", first.at), true);
    assert.deepEqual(entryOf(h).examples["A-1"].map(r => r.at), [second.at]);
    assert.equal(h.study.removeExample(set, "A-1", 123), true);
    assert.equal(h.study.removeExample(set, "A-1", second.at), true);
    assert.equal(entryOf(h).examples["A-1"], undefined);
    const explanation = await explain(h);
    assert.equal(h.study.removeExplanation(set, explanation.at), true);
    assert.deepEqual(entryOf(h).explanations, []);
    assert.deepEqual(copy(h.study.explanationHistory(set)), []);
    h.failures.write = true;
    const third = await examples(h, set);
    assert.equal(h.study.saved(), false);
    assert.equal(h.study.removeExample(set, "A-1", third.at), false);
  });
  await test("다른 탭이 쌓은 결과를 덮지 않고 지운 결과를 되살리지 않음", async () => {
    const storage = new Map(), a = setup({ storage }), b = setup({ storage }), set = fixtureSet(), other = fixtureSet();
    other.id = "snu-2024-A"; other.year = 2024;
    const first = await examples(a, set);
    await examples(b, other);
    let entries = JSON.parse(storage.get(CACHE)).entries;
    assert.ok(entries[a.study.identity(set)] && entries[b.study.identity(other)]);
    assert.equal(a.study.removeExample(set, "A-1", first.at), true);
    await explain(b, other);
    entries = JSON.parse(storage.get(CACHE)).entries;
    assert.equal(entries[a.study.identity(set)].examples["A-1"], undefined);
    assert.equal(entries[b.study.identity(other)].explanations.length, 1);
    assert.deepEqual(copy(b.study.exampleHistory(set, "A-1", "개입의 기준은 무엇입니까?")), []);
  });
  await test("목록 읽기만으로는 캐시에 빈 자리를 만들지 않음", async () => {
    const h = setup(), other = fixtureSet(); other.id = "snu-2024-A";
    assert.deepEqual(copy(h.study.exampleHistory(other, "A-1", "질문")), []);
    assert.deepEqual(copy(h.study.explanationHistory(other)), []);
    await examples(h);
    assert.deepEqual(Object.keys(JSON.parse(h.storage.get(CACHE)).entries), [h.study.identity(fixtureSet())]);
  });
  await test("재생성 실패 뒤 이전 성공 결과 유지, 다음 재시도 허용", async () => {
    const h = setup();
    const beforeExamples = await examples(h), beforeExplanation = await explain(h), saved = h.storage.get(CACHE);
    h.hooks.examples = h.hooks.explain = () => { throw new Error("모의 서버 오류"); };
    await assert.rejects(examples(h, fixtureSet(), true), /모의 서버 오류/);
    await assert.rejects(explain(h, fixtureSet(), true), /모의 서버 오류/);
    assert.equal(h.storage.get(CACHE), saved);
    assert.deepEqual(copy(await examples(h)), copy(beforeExamples));
    assert.deepEqual(copy((await explain(h)).data), copy(beforeExplanation.data));
    h.hooks.examples = () => fixtureExamples(" 복구");
    h.hooks.explain = (set, books) => fixtureExplanation(set, books, " 복구");
    assert.ok((await examples(h, fixtureSet(), true)).data.examples[0].answer.endsWith(" 복구"));
    assert.ok((await explain(h, fixtureSet(), true)).data.overview.endsWith(" 복구"));
  });
  await test("세트·복기본은 별도 캐시로 보존", async () => {
    const h = setup(), first = fixtureSet(), variant = copy(first), other = copy(first);
    variant.variant = "hwang"; variant.variantLabel = "황변 복기";
    other.id = "snu-2024-A"; other.year = 2024;
    for (const set of [first, variant, other, first]) { await examples(h, set); await explain(h, set); }
    assert.equal(h.calls.examples.length, 3);
    assert.equal(h.calls.explain.length, 3);
    assert.equal(Object.keys(JSON.parse(h.storage.get(CACHE)).entries).length, 3);
  });
  await test("같은 질문 키의 질문 문자열 변경은 예시답변 재생성", async () => {
    const h = setup();
    await examples(h);
    await examples(h, fixtureSet(), false, "개입하지 않을 기준은 무엇입니까?");
    assert.equal(h.calls.examples.length, 2);
    assert.deepEqual(entryOf(h).examples["A-1"].map(r => r.question), ["개입의 기준은 무엇입니까?", "개입하지 않을 기준은 무엇입니까?"]);
  });
  await test("제시문 본문·출전·문제·복기 질문 변경은 캐시 무효화", async () => {
    for (const change of [
      set => { set.passages[0].text += " 새로운 판단 조건"; },
      set => { set.passages[0].source = "변경된 원출전"; },
      set => { set.source.pages = "3-4"; },
      set => { set.tasks[0].text += " 반론도 말하시오."; },
      set => { set.followups[0].items[0] += " 다른 기준은?"; }
    ]) {
      const h = setup(), set = fixtureSet();
      await examples(h, set); await explain(h, set);
      change(set);
      await examples(h, set); await explain(h, set);
      assert.equal(h.calls.examples.length, 2);
      assert.equal(h.calls.explain.length, 2);
    }
  });
  await test("실제 서가 데이터의 id·제목·저자·핵심·키워드를 정확히 압축", async () => {
    const h = setup();
    const compact = await h.study.loadBooks(), original = h.window.LIBRARY_DATA.books;
    assert.equal(compact.length, original.length);
    for (let i = 0; i < original.length; i++) {
      const book = original[i];
      assert.deepEqual(copy(compact[i]), { id: book.id, title: book.t, author: book.a, core: book.sh || "", keywords: copy(book.kw || []) });
      assert.deepEqual(Object.keys(compact[i]), ["id", "title", "author", "core", "keywords"]);
    }
    assert.equal(h.inserted[0].src, "data/library.js");
    assert.equal(h.calls.examples.length + h.calls.explain.length, 0);
  });
  await test("서가 동시 로드·기존 데이터 재사용, 상대 경로 1회 로드", async () => {
    const h = setup({ autoLibrary: false });
    const a = h.study.loadBooks(), b = h.study.loadBooks();
    assert.equal(a, b);
    assert.equal(h.inserted.length, 1);
    assert.equal(h.inserted[0].src, "data/library.js");
    h.completeLibrary();
    const first = await a; await b;
    assert.deepEqual(copy(await h.study.loadBooks()), copy(first));
    assert.equal(h.inserted.length, 1);
  });
  await test("서가 로드 오류 뒤 다시 요청하면 새 스크립트로 복구", async () => {
    const h = setup({ autoLibrary: false });
    const failed = h.study.loadBooks();
    h.inserted[0].onerror();
    await assert.rejects(failed, /서가 자료/);
    assert.equal(h.inserted[0].removed, true);
    const retry = h.study.loadBooks();
    assert.equal(h.inserted.length, 2);
    h.completeLibrary(1);
    assert.ok((await retry).length);
  });
  await test("서가 후보 내용 변경은 해설만 재생성", async () => {
    const h = setup();
    await examples(h); await explain(h);
    h.window.LIBRARY_DATA.books[0].sh += " 검증용 변경";
    await examples(h); await explain(h);
    assert.equal(h.calls.examples.length, 1);
    assert.equal(h.calls.explain.length, 2);
  });
  await test("손상·다른 버전·잘못된 최상위 캐시는 무시", async () => {
    for (const value of ["{", "null", '{"version":3,"entries":{}}', '{"version":2,"entries":[]}', '{"version":1,"entries":[]}', '{"version":1,"entries":null}', '{"version":2,"entries":{"x":{"examples":[],"explanations":{}}}}']) {
      const h = setup({ storage: new Map([[CACHE, value]]) });
      await examples(h); await explain(h);
      assert.equal(h.calls.examples.length, 1);
      assert.equal(h.calls.explain.length, 1);
      assert.equal(JSON.parse(h.storage.get(CACHE)).version, 2);
    }
  });
  await test("손상된 캐시 레코드·필수값·서가 ID는 실제 검증기로 거부 후 재생성", async () => {
    const seed = setup(); await examples(seed); await explain(seed);
    for (const mutate of [
      entry => { entry.examples["A-1"][0].data.examples = []; entry.explanations[0].data.passages = []; },
      entry => { entry.examples["A-1"][0].model = ""; entry.explanations[0].model = ""; },
      entry => { entry.examples["A-1"][0].at = "어제"; entry.explanations[0].at = "어제"; },
      entry => { entry.examples["A-1"][0].effort = "unknown"; entry.explanations[0].effort = "unknown"; },
      entry => { entry.examples["A-1"][0].data.examples[0].importance = ""; entry.explanations[0].data.books[0].id = 999999; },
      entry => { entry.examples["A-1"] = { question: "v1 형식" }; entry.explanations = null; }
    ]) {
      const saved = JSON.parse(seed.storage.get(CACHE));
      mutate(saved.entries[seed.study.identity(fixtureSet())]);
      const h = setup({ storage: new Map([[CACHE, JSON.stringify(saved)]]) });
      await examples(h); await explain(h);
      assert.equal(h.calls.examples.length, 1);
      assert.equal(h.calls.explain.length, 1);
    }
  });
  await test("생성 결과도 실제 검증기를 거쳐야 저장", async () => {
    const h = setup();
    h.hooks.examples = () => ({ examples: [] });
    h.hooks.explain = (set, books) => { const data = fixtureExplanation(set, books); data.books[0].id = 999999; return data; };
    await assert.rejects(examples(h), /예시답변/);
    await assert.rejects(explain(h), /서가 연계/);
    assert.equal(h.storage.has(CACHE), false);
    delete h.hooks.examples; delete h.hooks.explain;
    await examples(h); await explain(h);
    assert.equal(h.calls.examples.length, 2);
    assert.equal(h.calls.explain.length, 2);
  });
  await test("저장 용량 초과 시 현재 화면 메모리에 성공 결과 유지", async () => {
    const h = setup(); h.failures.write = true;
    const first = await examples(h), second = await explain(h);
    assert.equal(h.storage.has(CACHE), false);
    assert.equal(await examples(h), first);
    assert.deepEqual(copy((await explain(h)).data), copy(second.data));
    assert.equal(h.calls.examples.length, 1);
    assert.equal(h.calls.explain.length, 1);
    h.failures.write = false;
    await examples(h, fixtureSet(), true);
    assert.ok(h.storage.has(CACHE));
  });
  await test("키 없는 새 요청은 생성 실패, 해설은 서가도 로드하지 않음", async () => {
    const h = setup({ key: false });
    await assert.rejects(examples(h), /API 키/);
    await assert.rejects(explain(h), /API 키/);
    assert.equal(h.calls.explain.length, 0);
    assert.equal(h.inserted.length, 0);
    assert.equal(h.storage.has(CACHE), false);
  });
  console.log(`기출DB 학습 도우미 회귀 ${checks}개 통과 (브라우저·실제 API 호출 없음)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
