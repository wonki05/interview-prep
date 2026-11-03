/* 기출DB 학습 도우미: 해설 전용 설정, 서가 지연 로드, 검증된 AI 결과의 브라우저 보관(생성할 때마다 쌓는다). */
(function () {
  "use strict";
  const AI = window.AIClient, SNU = window.SNU;
  /* VERSION은 저장 형식, CONTEXT_VERSION은 입력 지문. 형식만 바뀌어도 기존 결과는 최신으로 남는다. */
  const KEY = "snu-db-study-v1", VERSION = 2, CONTEXT_VERSION = 1;
  const pending = new Map();
  let cache = { version: VERSION, entries: {} }, libraryPromise = null, saved = true;
  const object = value => !!value && typeof value === "object" && !Array.isArray(value);
  /* 입력 전문 대신 짧은 지문(cyrb53)만 결과마다 남긴다. */
  function digest(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  /* v1(세트마다 질문별 결과 하나·해설 하나, 입력 전문 보관) → v2(결과 목록, 지문 보관). */
  function migrate(old) {
    const entries = {};
    Object.keys(old.entries).forEach(id => {
      const entry = old.entries[id];
      if (!object(entry) || typeof entry.context !== "string") return;
      const ctx = digest(entry.context), next = { examples: {}, explanations: [] };
      if (object(entry.examples)) Object.keys(entry.examples).forEach(key => {
        const r = entry.examples[key];
        if (object(r)) next.examples[key] = [{ question: r.question, data: r.data, model: r.model, effort: r.effort, at: r.at, ctx }];
      });
      const e = entry.explanation;
      if (object(e)) next.explanations.push({ data: e.data, model: e.model, effort: e.effort, at: e.at, ctx, lib: typeof e.libraryContext === "string" ? digest(e.libraryContext) : "" });
      entries[id] = next;
    });
    return { version: VERSION, entries };
  }
  /* 결과를 더하거나 지우기 직전에 다시 읽는다(읽기-고치기-쓰기). 다른 탭이 쌓은 결과를 덮거나 지운 결과를 되살리지 않는다.
     저장에 실패한 뒤에는 이 화면의 사본에만 있는 결과가 있으므로 다시 읽지 않는다. */
  function reload() {
    if (!saved) return;
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "null");
      if (stored && stored.version === VERSION && object(stored.entries)) cache = stored;
      else if (stored && stored.version === 1 && object(stored.entries)) cache = migrate(stored);
    } catch (_) { /* 저장 불가·손상된 캐시는 무시한다. */ }
  }
  reload();
  if (window.addEventListener) window.addEventListener("storage", e => { if (e.key === KEY) reload(); });

  function identity(set) { return JSON.stringify([set.id, set.variant || "default"]); }
  function resolveAi(override) {
    const s = SNU.settings, choice = override || {};
    const provider = choice.provider || (s.explanationProvider === "openai" ? "openai" : "anthropic");
    const prefix = "explanation" + provider[0].toUpperCase() + provider.slice(1);
    return AI.resolve({ provider, model: choice.model || s[prefix + "Model"], effort: choice.effort === undefined ? s[prefix + "Effort"] : choice.effort });
  }
  function context(set) {
    return JSON.stringify([CONTEXT_VERSION, AI.setContext(set), set.source || null, set.passages.map(p => [p.no, p.source || ""])]);
  }
  const contextId = set => digest(context(set));
  /* 읽기는 빈 자리를 만들지 않고, 쓰기만 세트·복기본 자리를 만든다. */
  function entryOf(set, create) {
    const id = identity(set);
    let entry = cache.entries[id];
    if (!object(entry)) { if (!create) return null; entry = cache.entries[id] = { examples: {}, explanations: [] }; }
    if (!object(entry.examples)) entry.examples = {};
    if (!Array.isArray(entry.explanations)) entry.explanations = [];
    return entry;
  }
  const examplesOf = (entry, key) => entry && Array.isArray(entry.examples[key]) ? entry.examples[key] : [];
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); saved = true; } catch (_) { saved = false; /* 용량 부족이면 현재 화면의 메모리에만 둔다. */ }
    return saved;
  }
  function validRecord(record, validate) {
    if (!object(record) || typeof record.model !== "string" || !record.model || !Number.isFinite(record.at)) return false;
    if (!(record.effort === null || ["none", "low", "medium", "high", "xhigh", "max"].includes(record.effort))) return false;
    try { validate(record.data); return true; } catch (_) { return false; }
  }
  function snapshot(ai) {
    const resolved = AI.resolve(ai || resolveAi());
    return { provider: resolved.provider, model: resolved.model, effort: resolved.effort };
  }
  /* at은 결과의 식별자이기도 하다(펼침·삭제). 같은 밀리초에 생겨도 겹치지 않게 늘린다. */
  let lastAt = 0;
  function record(data, ai) {
    const resolved = AI.resolve(ai);
    lastAt = Math.max(Date.now(), lastAt + 1);
    return { data, model: resolved.label, effort: resolved.effort, at: lastAt };
  }
  function once(key, generate) {
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(generate).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  function newest(list, test) { for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i]; return null; }

  /* 서가 전체를 첫 화면에서 읽지 않는다. 해설을 요청할 때 상대 경로의 데이터 스크립트만 불러온다. */
  function compactBooks() {
    const books = window.LIBRARY_DATA && window.LIBRARY_DATA.books;
    if (!Array.isArray(books) || !books.length) throw new Error("서가 자료를 읽지 못했다. 다시 시도한다.");
    return books.filter(b => Number.isInteger(b.id) && typeof b.t === "string" && typeof b.a === "string").map(b => ({
      id: b.id, title: b.t, author: b.a, core: typeof b.sh === "string" ? b.sh : "",
      keywords: Array.isArray(b.kw) ? b.kw.filter(k => typeof k === "string") : []
    }));
  }
  function loadBooks() {
    if (window.LIBRARY_DATA) return Promise.resolve().then(compactBooks);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "data/library.js";
      script.onload = () => { try { resolve(compactBooks()); } catch (error) { reject(error); } };
      script.onerror = () => { script.remove(); reject(new Error("서가 자료를 읽지 못했다. 다시 시도한다.")); };
      document.head.append(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
  }

  /* examples·explain은 현재 입력과 맞는 최신 결과를 돌려주고, 없거나 refresh면 새로 생성해 목록 끝에 더한다. */
  function examples(set, questionKey, question, ai, refresh) {
    const ctx = contextId(set), choice = snapshot(ai);
    const cached = newest(examplesOf(entryOf(set), questionKey), r => object(r) && r.ctx === ctx && r.question === question && validRecord(r, AI.validateExamplesResponse));
    if (!refresh && cached) return Promise.resolve(cached);
    const key = JSON.stringify(["examples", identity(set), ctx, questionKey, question]);
    return once(key, async () => {
      const data = await AI.exampleAnswers(set, question, choice);
      AI.validateExamplesResponse(data);
      const result = Object.assign(record(data, choice), { question, ctx });
      reload();
      const entry = entryOf(set, true);
      if (!Array.isArray(entry.examples[questionKey])) entry.examples[questionKey] = [];
      entry.examples[questionKey].push(result);
      persist();
      return result;
    });
  }
  function explain(set, ai, refresh) {
    const ctx = contextId(set), choice = snapshot(ai);
    const key = JSON.stringify(["explanation", identity(set), ctx]);
    return once(key, async () => {
      const entry = entryOf(set);
      if (!(entry && entry.explanations.length) && !AI.resolve(choice).configured) throw new Error("API 키가 없다. 설정에서 입력한다.");
      const books = await loadBooks(), lib = digest(JSON.stringify(books));
      const cached = refresh || !entry ? null : newest(entry.explanations, r => object(r) && r.ctx === ctx && r.lib === lib && validRecord(r, data => AI.validatePassageExplanationResponse(data, set, books)));
      if (cached) return Object.assign({}, cached, { books });
      const data = await AI.explainPassages(set, books, choice);
      AI.validatePassageExplanationResponse(data, set, books);
      const result = Object.assign(record(data, choice), { ctx, lib });
      reload();
      entryOf(set, true).explanations.push(result);
      persist();
      return Object.assign({}, result, { books });
    });
  }

  /* 화면에 보일 결과 목록(최신순). 형식만 검사하므로 원문이 바뀐 이전 결과도 stale 표시와 함께 남는다. */
  function exampleHistory(set, questionKey, question) {
    const list = examplesOf(entryOf(set), questionKey);
    if (!list.length) return [];
    const ctx = contextId(set);
    return list.filter(r => validRecord(r, AI.validateExamplesResponse)).map(r => Object.assign({}, r, { stale: r.ctx !== ctx || r.question !== question })).reverse();
  }
  function explanationHistory(set) {
    const entry = entryOf(set);
    if (!entry || !entry.explanations.length) return [];
    const ctx = contextId(set);
    return entry.explanations.filter(r => validRecord(r, data => AI.validateJson(data, AI.schemas.explanation))).map(r => Object.assign({}, r, { stale: r.ctx !== ctx })).reverse();
  }
  /* 지우기: at(생성 시각)으로 결과 하나를 지운다. 저장에 실패하면 false. */
  function removeAt(list, at) { const i = list.findIndex(r => object(r) && r.at === at); if (i >= 0) list.splice(i, 1); return i >= 0; }
  function removeExample(set, questionKey, at) {
    reload();
    const entry = entryOf(set), list = examplesOf(entry, questionKey);
    if (!removeAt(list, at)) return true;
    if (!list.length) delete entry.examples[questionKey];
    return persist();
  }
  function removeExplanation(set, at) {
    reload();
    const entry = entryOf(set);
    return entry && removeAt(entry.explanations, at) ? persist() : true;
  }

  window.DBStudy = { identity, resolveAi, loadBooks, examples, explain, exampleHistory, explanationHistory, removeExample, removeExplanation, saved: () => saved };
})();
