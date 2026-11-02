/* 기출DB 학습 도우미: 해설 전용 설정, 서가 지연 로드, 검증된 AI 결과의 브라우저 캐시. */
(function () {
  "use strict";
  const AI = window.AIClient, SNU = window.SNU;
  const KEY = "snu-db-study-v1", VERSION = 1;
  const pending = new Map();
  let cache = { version: VERSION, entries: {} }, libraryPromise = null;
  const object = value => !!value && typeof value === "object" && !Array.isArray(value);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.version === VERSION && object(saved.entries)) cache = saved;
  } catch (_) { /* 저장 불가·손상된 캐시는 무시한다. */ }

  function identity(set) { return JSON.stringify([set.id, set.variant || "default"]); }
  function resolveAi() {
    const s = SNU.settings, provider = s.explanationProvider === "openai" ? "openai" : "anthropic";
    const prefix = "explanation" + provider[0].toUpperCase() + provider.slice(1);
    return AI.resolve({ provider, model: s[prefix + "Model"], effort: s[prefix + "Effort"] });
  }
  function context(set) {
    return JSON.stringify([VERSION, AI.setContext(set), set.source || null, set.passages.map(p => [p.no, p.source || ""])]);
  }
  function bucket(set) {
    const id = identity(set), text = context(set), entry = cache.entries[id];
    if (object(entry) && entry.context === text && object(entry.examples)) return entry;
    return (cache.entries[id] = { context: text, examples: {} });
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (_) { /* 용량 부족이면 현재 화면의 메모리에만 둔다. */ }
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
  function record(data, ai) {
    const resolved = AI.resolve(ai);
    return { data, model: resolved.label, effort: resolved.effort, at: Date.now() };
  }
  function once(key, generate) {
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(generate).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

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

  function examples(set, questionKey, question, ai, refresh) {
    const entry = bucket(set), cached = entry.examples[questionKey], choice = snapshot(ai);
    if (!refresh && cached && cached.question === question && validRecord(cached, AI.validateExamplesResponse)) return Promise.resolve(cached);
    const key = JSON.stringify(["examples", identity(set), entry.context, questionKey, question]);
    return once(key, async () => {
      const data = await AI.exampleAnswers(set, question, choice);
      AI.validateExamplesResponse(data);
      const result = Object.assign(record(data, choice), { question });
      entry.examples[questionKey] = result;
      persist();
      return result;
    });
  }
  function explain(set, ai, refresh) {
    const entry = bucket(set), choice = snapshot(ai);
    const key = JSON.stringify(["explanation", identity(set), entry.context]);
    return once(key, async () => {
      if (!entry.explanation && !AI.resolve(choice).configured) throw new Error("API 키가 없다. 설정에서 입력한다.");
      const books = await loadBooks(), libraryContext = JSON.stringify(books), cached = entry.explanation;
      if (!refresh && cached && cached.libraryContext === libraryContext && validRecord(cached, data => AI.validatePassageExplanationResponse(data, set, books))) {
        return Object.assign({}, cached, { books });
      }
      const data = await AI.explainPassages(set, books, choice);
      AI.validatePassageExplanationResponse(data, set, books);
      const result = Object.assign(record(data, choice), { libraryContext });
      entry.explanation = result;
      persist();
      return Object.assign({}, result, { books });
    });
  }

  window.DBStudy = { identity, resolveAi, loadBooks, examples, explain };
})();
