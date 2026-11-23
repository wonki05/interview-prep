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
    if (!object(entry)) { if (!create) return null; entry = cache.entries[id] = { examples: {}, explanations: [], reviews: [], transcripts: {} }; }
    if (!object(entry.examples)) entry.examples = {};
    if (!Array.isArray(entry.explanations)) entry.explanations = [];
    if (!Array.isArray(entry.reviews)) entry.reviews = [];   // 녹음본 피드백이 생기기 전의 v2 캐시에는 없다
    if (!object(entry.transcripts)) entry.transcripts = {};
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
  const nextAt = () => (lastAt = Math.max(Date.now(), lastAt + 1));
  function record(data, ai) {
    const resolved = AI.resolve(ai);
    return { data, model: resolved.label, effort: resolved.effort, at: nextAt() };
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

  /* ---------- 녹음본 피드백 ----------
     올린 파일을 문답 글로 바꾸는 도우미(화면 없이 검사할 수 있게 여기에 둔다)와 평가 결과의 누적. */
  const TEXT_TYPES = ["txt", "md", "json"], TEXT_BYTES = 1024 * 1024;
  function fileKind(name) {
    const ext = AI.fileExtension(name);
    return TEXT_TYPES.includes(ext) ? "text" : AI.RECORDING_LIMITS.audioTypes.includes(ext) ? "audio" : "";
  }
  /* 파일 이름 자연 정렬(Q2가 Q10보다 앞). 녹음을 이 순서로 전사해 이어 붙인다. */
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), "ko", { numeric: true, sensitivity: "base" });
  /* 문답 텍스트 파일: UTF-16은 BOM으로 가리고, UTF-8로 읽히지 않으면 EUC-KR로 읽는다. 둘 다 아니면 오류. */
  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);
    try {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (_) { return new TextDecoder("euc-kr", { fatal: true }).decode(bytes); }
    } catch (_) { throw new Error("파일을 읽지 못했다."); }
  }
  /* JSON이 세션 기록(history[{q, a}])이나 전사(items[{question, text}], docs/TRANSCRIPTION.md §3) 모양이면 Q/A로 편다. 그 밖에는 원문 그대로. */
  function qaText(text) {
    let value;
    try { value = JSON.parse(text); } catch (_) { return text; }
    const rows = !object(value) ? null : Array.isArray(value.history) ? value.history.map(h => object(h) ? [h.q, h.a] : null)
      : Array.isArray(value.items) ? value.items.map(x => object(x) ? [x.question, x.text] : null) : null;
    const str = v => typeof v === "string" ? v.trim() : "";
    if (!rows || rows.some(r => !r) || !rows.some(r => str(r[0]) || str(r[1]))) return text;
    return rows.map((r, i) => `Q${i + 1}: ${str(r[0]) || "(질문 없음)"}\nA${i + 1}: ${str(r[1]) || "(답변 없음)"}`).join("\n\n");
  }
  function readTranscriptText(buffer) { return qaText(decodeText(buffer)).replace(/\r\n?/g, "\n").trim(); }
  /* 녹음 전사를 문답 글에 붙일 때의 파일 경계 줄. 평가 프롬프트가 이 표식을 안다(assets/ai.js). */
  const recordingHead = (n, name) => `[녹음 ${n}: ${String(name).replace(/[\[\]\r\n]+/g, " ").trim()}]`;
  /* 결과에는 첨부의 이름·크기·종류와, 녹음이면 길이(초. 브라우저가 읽었을 때만)·전사 모델 표시명만 남긴다(녹음 자체는 저장하지 않는다). */
  function fileList(files) {
    return (Array.isArray(files) ? files : []).filter(object).map(f => {
      const item = { name: String(f.name || ""), size: Number(f.size) || 0, kind: f.kind === "audio" ? "audio" : "text" };
      if (item.kind === "audio" && Number.isFinite(f.duration) && f.duration > 0) item.duration = Math.round(f.duration);
      if (item.kind === "audio" && typeof f.model === "string" && f.model) item.model = f.model;
      return item;
    });
  }
  /* 후속 질문 스레드 [{role: "user"|"ai", text, at, model?}]. 형식이 맞는 메시지만 보인다. */
  function threadList(thread) {
    return (Array.isArray(thread) ? thread : []).filter(m => object(m) && (m.role === "user" || m.role === "ai") && typeof m.text === "string" && m.text.trim() && Number.isFinite(m.at))
      .map(m => m.role === "ai" ? { role: "ai", text: m.text, at: m.at, model: typeof m.model === "string" ? m.model : "" } : { role: "user", text: m.text, at: m.at });
  }
  /* 문답 전문은 세트 항목의 transcripts(지문 → 전문)에 한 번만 두고 결과에는 지문(tx)만 남긴다. 같은 문답을 여러 번 평가해도 전문이 쌓이지 않는다. */
  const transcriptOf = (entry, r) => entry && object(r) && typeof r.tx === "string" && typeof entry.transcripts[r.tx] === "string" ? entry.transcripts[r.tx] : null;
  const findReview = (entry, at) => entry ? entry.reviews.find(r => object(r) && r.at === at) || null : null;
  function pruneTranscripts(entry) {
    const used = new Set(entry.reviews.filter(object).map(r => r.tx));
    Object.keys(entry.transcripts).forEach(tx => { if (!used.has(tx)) delete entry.transcripts[tx]; });
  }
  /* 원문 대조 구간 [{no, start, end}](문답 글의 글자 위치). 저장할 때 평가의 from·to로 한 번 계산해 결과에 둔다(단위 나누기가 바뀌어도 이전 결과의 구간이 그대로다). */
  function spanList(spans, length) {
    return (Array.isArray(spans) ? spans : []).filter(s => object(s) && Number.isSafeInteger(s.no) && Number.isSafeInteger(s.start) && Number.isSafeInteger(s.end) && s.start >= 0 && s.start < s.end && s.end <= length)
      .map(s => ({ no: s.no, start: s.start, end: s.end }));
  }
  /* 평가는 늘 새 결과를 목록 끝에 더한다(입력이 올린 글이라 '현재 결과' 재사용이 없다). 같은 입력·모델의 동시 요청만 하나로 합친다. */
  function reviewRecording(set, transcript, files, ai) {
    const ctx = contextId(set), choice = snapshot(ai), text = String(transcript || "").trim(), tx = digest(text);
    const key = JSON.stringify(["review", identity(set), ctx, tx, choice]);
    return once(key, async () => {
      if (!AI.resolve(choice).configured) throw new Error("API 키가 없다. 설정에서 입력한다.");
      const books = await loadBooks(), lib = digest(JSON.stringify(books));
      const data = await AI.reviewRecording(set, text, books, choice);
      AI.validateRecordingReviewResponse(data, set, books);
      const result = Object.assign(record(data, choice), { ctx, lib, tx, files: fileList(files), spans: AI.qaSpans(text, data.qa), thread: [] });
      reload();
      const entry = entryOf(set, true);
      entry.transcripts[tx] = text;
      entry.reviews.push(result);
      persist();
      return Object.assign({}, result, { transcript: text, books });
    });
  }
  /* 고민해볼 추가질문(data.probes)이 생기기 전에 저장한 결과에는 그 항목이 없다. 빈 목록으로 읽는다(저장본은 고치지 않는다). */
  const withProbes = r => object(r) && object(r.data) && !Array.isArray(r.data.probes) ? Object.assign({}, r, { data: Object.assign({}, r.data, { probes: [] }) }) : r;
  /* 목록(최신순)은 형식만 검사한다. 원문이 바뀐 결과는 stale, 전문을 잃은 결과는 뺀다. */
  function reviewHistory(set) {
    const entry = entryOf(set);
    if (!entry || !entry.reviews.length) return [];
    const ctx = contextId(set);
    return entry.reviews.map(r => ({ r: withProbes(r), transcript: transcriptOf(entry, r) }))
      .filter(x => x.transcript !== null && validRecord(x.r, data => AI.validateJson(data, AI.schemas.recordingReview)))
      .map(x => Object.assign({}, x.r, { transcript: x.transcript, files: fileList(x.r.files), spans: spanList(x.r.spans, x.transcript.length), thread: threadList(x.r.thread), stale: x.r.ctx !== ctx })).reverse();
  }
  /* 결과를 지우면 그 스레드도 사라지고, 어느 결과도 가리키지 않는 전문도 지운다. */
  function removeReview(set, at) {
    reload();
    const entry = entryOf(set);
    if (!entry || !removeAt(entry.reviews, at)) return true;
    pruneTranscripts(entry);
    return persist();
  }
  /* 후속 질문 ①: 질문을 그 결과의 스레드에 먼저 저장한다(호출이 실패해도 남는다). 반환은 질문의 at. */
  function addReviewQuestion(set, at, question) {
    const text = String(question || "").trim();
    if (!text) throw new Error("질문이 비어 있다.");
    if (text.length > AI.FOLLOWUP_LIMITS.question) throw new Error(`질문이 ${AI.FOLLOWUP_LIMITS.question.toLocaleString("ko-KR")}자를 넘는다.`);
    reload();
    const run = findReview(entryOf(set), at);
    if (!run) throw new Error("결과를 찾지 못했다.");
    if (!Array.isArray(run.thread)) run.thread = [];
    const qAt = nextAt();
    run.thread.push({ role: "user", text, at: qAt });
    persist();
    return qAt;
  }
  /* 후속 질문 ②: 스레드의 마지막 질문(답이 없는 것)에 답을 받아 그 질문 뒤에 더한다. 기다리는 동안 결과나 질문이 지워지면 답을 버리고 dropped. */
  function answerReviewQuestion(set, at, ai) {
    const choice = snapshot(ai);
    return once(JSON.stringify(["ask", identity(set), at]), async () => {
      if (!AI.resolve(choice).configured) throw new Error("API 키가 없다. 설정에서 입력한다.");
      reload();
      const entry = entryOf(set), run = findReview(entry, at), transcript = transcriptOf(entry, run);
      if (!run || transcript === null) throw new Error("결과를 찾지 못했다.");
      const thread = threadList(run.thread), last = thread[thread.length - 1];
      if (!last || last.role !== "user") throw new Error("답할 질문이 없다.");
      const books = await loadBooks();
      const reply = await AI.recordingFollowup(set, Object.assign({}, run, { transcript, thread }), books, choice);
      reload();
      const now = findReview(entryOf(set), at), list = now && Array.isArray(now.thread) ? now.thread : [];
      const i = list.findIndex(m => object(m) && m.at === last.at);
      if (i < 0) return { dropped: true };
      list.splice(i + 1, 0, { role: "ai", text: reply.reply, model: AI.resolve(choice).label, at: nextAt(), re: last.at });
      persist();
      return { reply: reply.reply };
    });
  }
  function clearReviewThread(set, at) {
    reload();
    const run = findReview(entryOf(set), at);
    if (!run || !Array.isArray(run.thread) || !run.thread.length) return true;
    run.thread = [];
    return persist();
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

  window.DBStudy = { identity, resolveAi, loadBooks, examples, explain, exampleHistory, explanationHistory, removeExample, removeExplanation, saved: () => saved,
    fileKind, byName, readTranscriptText, recordingHead, TEXT_BYTES, reviewRecording, reviewHistory, removeReview, addReviewQuestion, answerReviewQuestion, clearReviewThread };
})();
