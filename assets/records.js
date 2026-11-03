/* ============================================================
   면접 기록 — 모의면접 세션 기록 저장소, 기록 서랍(앱바 버튼, 모든 화면), 종료 후 AI 피드백.
   · IndexedDB "snu-interview" v2: recordings(녹음, 기존) + sessions(세션 기록, id = 녹음의 sessionId)
   · 서랍: 목록(최신순) → 상세(문답·메모·녹음·AI 피드백). 기출DB·서가가 해시를 쓰므로 해시는 쓰지 않는다.
   · 피드백: AIClient.review(제시문 전문 + 복기 질문 전체 + 문답 전체 + 메모) → {summary, strengths, gaps, items, next}.
     기본 모델은 설정의 AI 면접해설, 그 자리에서 바꾼 값은 그 요청에만 쓴다. 결과는 세션 기록의 feedbacks에 쌓인다.
   · 세트 데이터·AI 클라이언트가 없는 화면(홈·서가)은 상세를 열 때 상대 경로 스크립트로 불러온다.
   · IndexedDB를 쓸 수 없으면 이 화면 메모리에만 둔다(새로 고침하면 사라진다).
   ============================================================ */
(function () {
  "use strict";
  const SNU = window.SNU, { $, esc, models, fmtClock } = SNU;
  const S = () => SNU.settings;
  const DBN = "snu-interview", DBV = 2;
  const SAVE_WARN = "저장 실패: 새로 고침하면 사라진다.";

  /* ---------------- 저장소 ---------------- */
  let dbp = null, blocked = null, lastAt = 0;
  const overlay = new Map();   // IndexedDB에 쓰지 못한 세션 기록(이 화면 메모리)
  /* 이전 버전 탭이 v1 연결을 쥐고 있으면 업그레이드 요청이 막힌다(blocked). 막힌 요청은 대기열 앞에 남아
     뒤따르는 open도 끝나지 않으므로, 막힌 동안에는 새로 열지 않고 곧바로 실패시켜 메모리로 대체한다. */
  function openDb() {
    if (dbp) return dbp;
    if (blocked) return Promise.reject(blocked);
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("IndexedDB 없음")); return; }
      let request;
      try { request = indexedDB.open(DBN, DBV); } catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {   // v1(recordings만) → v2(sessions 추가). 기존 녹음은 그대로 둔다
        const d = request.result;
        ["recordings", "sessions"].forEach(name => { if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: "id" }); });
      };
      request.onsuccess = () => {   // 다른 탭이 버전을 올리거나 브라우저가 연결을 닫으면 다음 호출에서 다시 연다
        const d = request.result;
        d.onversionchange = () => { d.close(); dbp = null; };
        d.onclose = () => { dbp = null; };
        if (!blocked) { resolve(d); return; }
        blocked = null; dbp = Promise.resolve(d); flush();   // 막혔던 요청이 늦게 열렸다
      };
      request.onerror = () => { blocked = null; reject(request.error || new Error("IndexedDB 열기 실패")); };
      request.onblocked = () => { blocked = new Error("다른 탭이 이전 버전 저장소를 쓰고 있다. 그 탭을 닫는다."); reject(blocked); changed(null); };
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  /* 늦게 열린 IndexedDB로, 그동안 메모리에만 둔 기록을 옮긴다(옮기는 중에 고친 기록은 다음 차례에). */
  async function flush() {
    for (let pass = 0; pass < 3 && overlay.size; pass++) {
      for (const [id, s] of [...overlay]) {
        try { await run(["sessions"], "readwrite", tx => { tx.objectStore("sessions").put(s); }); } catch (_) { return; }
        if (overlay.get(id) === s) overlay.delete(id);
      }
    }
    changed(null);
  }
  const warnHtml = () => blocked ? `<p class="callout warn">${esc(blocked.message)}</p>` : overlay.size ? `<p class="callout warn">${SAVE_WARN}</p>` : "";
  /* fn(tx)가 돌려준 값(IDBRequest면 그 result)을 트랜잭션이 끝난 뒤 돌려준다. */
  function run(names, mode, fn) {
    return openDb().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(names, mode), out = fn(tx);
      tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      tx.onerror = () => reject(tx.error || new Error("저장소 오류"));
      tx.onabort = () => reject(tx.error || new Error("저장이 취소됐다."));
    }));
  }
  const allOf = name => run([name], "readonly", tx => tx.objectStore(name).getAll()).then(list => list || []).catch(() => []);
  /* 읽고 고쳐 쓰기는 한 트랜잭션에서 한다(종료 저장과 피드백 저장이 서로 덮어쓰지 않게). change가 null을 돌려주면 쓰지 않는다. */
  function update(id, change) {
    return run(["sessions"], "readwrite", tx => {
      const store = tx.objectStore("sessions"), box = { value: null }, request = store.get(id);
      request.onsuccess = () => { const next = change(request.result || null); if (next) { store.put(next); box.value = next; } };
      return box;
    }).then(box => box.value);
  }
  /* 이미 메모리에만 있는 기록이나 IndexedDB에 쓰지 못한 기록은 메모리에서 고친다. saved = IndexedDB에 썼는지. */
  async function write(id, change) {
    if (!overlay.has(id)) {
      try { return { value: await update(id, change), saved: true }; } catch (_) { /* 아래에서 메모리로 */ }
    }
    let prev = overlay.get(id) || null;
    if (!prev) { try { prev = (await run(["sessions"], "readonly", tx => tx.objectStore("sessions").get(id))) || null; } catch (_) { prev = null; } }
    const value = change(prev);
    if (value) overlay.set(id, value);
    return { value, saved: false };
  }
  async function getSession(id) {
    if (overlay.has(id)) return overlay.get(id);
    try { return (await run(["sessions"], "readonly", tx => tx.objectStore("sessions").get(id))) || null; } catch (_) { return null; }
  }
  /* 모의면접이 쓰는 필드만 덮어쓰고 feedbacks는 저장된 값을 지킨다. */
  async function saveSession(core) {
    const result = await write(core.id, prev => Object.assign({}, prev || {}, core, { feedbacks: prev && Array.isArray(prev.feedbacks) ? prev.feedbacks : [] }));
    changed(core.id);
    return result.saved;
  }
  async function deleteSession(id) {
    overlay.delete(id);
    try {
      await run(["sessions", "recordings"], "readwrite", tx => {
        tx.objectStore("sessions").delete(id);
        const recs = tx.objectStore("recordings"), request = recs.getAll();
        request.onsuccess = () => (request.result || []).forEach(r => { if (r && r.sessionId === id) recs.delete(r.id); });
      });
    } catch (_) { /* 저장소가 없으면 메모리에서만 지운다 */ }
    fbStates.delete(id);
    changed(id);
  }
  async function putRecording(rec) {
    await run(["recordings"], "readwrite", tx => { tx.objectStore("recordings").put(rec); });
    changed(rec.sessionId);
  }
  async function deleteRecording(id, sessionId) {
    await run(["recordings"], "readwrite", tx => { tx.objectStore("recordings").delete(id); });
    changed(sessionId);
  }
  async function recordingsOf(id) {
    return (await allOf("recordings")).filter(r => r && r.sessionId === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  /* 목록 요약(최신순). 세션 기록 없이 남은 녹음(이전 버전에서 저장)은 sessionId로 묶어 '녹음만' 기록으로 보인다. */
  async function listSessions() {
    const [stored, recs] = await Promise.all([allOf("sessions"), allOf("recordings")]);
    const sessions = new Map(), out = new Map();
    stored.forEach(s => { if (s && s.id) sessions.set(s.id, s); });
    overlay.forEach((s, id) => sessions.set(id, s));
    sessions.forEach((s, id) => {
      const history = Array.isArray(s.history) ? s.history : [];
      out.set(id, { id, orphan: false, createdAt: s.createdAt || 0, setLabel: s.setLabel || s.setId || "", variantLabel: s.variantLabel || "", modeLabel: s.modeLabel || "", answerMode: s.answerMode, questions: history.length, feedbacks: Array.isArray(s.feedbacks) ? s.feedbacks.length : 0, recordings: 0, ended: !!s.endedAt });
    });
    recs.forEach(r => {
      if (!r || !r.sessionId) return;
      let x = out.get(r.sessionId);
      if (!x) out.set(r.sessionId, x = { id: r.sessionId, orphan: true, createdAt: r.createdAt || 0, setLabel: r.setLabel || r.setId || "", variantLabel: "", modeLabel: r.modeLabel || "", questions: 0, feedbacks: 0, recordings: 0, ended: true });
      x.recordings++;
      if (x.orphan) { x.questions++; x.createdAt = Math.min(x.createdAt, r.createdAt || x.createdAt); }
    });
    return [...out.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------------- 다른 화면 갱신 ---------------- */
  const fbStates = new Map(), mounts = new Set(), lists = new Set();
  function changed(id) {
    mounts.forEach(m => { if (!m.el.isConnected) mounts.delete(m); else if (m.id === id) renderMount(m); });
    lists.forEach(m => { if (!m.el.isConnected) lists.delete(m); else paintList(m); });
    if (drawer && !viewId) paint(false);
  }
  document.addEventListener("settings:change", () => mounts.forEach(m => { if (!m.el.isConnected) mounts.delete(m); else renderMount(m); }));

  /* ---------------- 목록 ---------------- */
  const two = n => String(n).padStart(2, "0");
  function rowHtml(x) {
    const d = new Date(x.createdAt);
    const meta = [x.orphan ? "녹음만" : `질문 ${x.questions}`, x.orphan ? "" : x.answerMode === "voice" ? "음성" : "텍스트", x.recordings ? `녹음 ${x.recordings}` : "", x.feedbacks ? `피드백 ${x.feedbacks}` : "", !x.orphan && !x.ended ? "중단" : ""].filter(Boolean);
    return `<button type="button" class="setrow" data-rec="${esc(x.id)}"><span class="yr"><span style="white-space:nowrap">${d.getMonth() + 1}. ${d.getDate()}.</span><small>${two(d.getHours())}:${two(d.getMinutes())}</small></span><span><span class="nm">${esc(x.setLabel)}</span><br><span class="th">${esc([x.variantLabel, x.modeLabel].filter(Boolean).join(" · "))}</span></span><span class="mt">${meta.map(m => `<span>${esc(m)}</span>`).join("")}</span></button>`;
  }
  function listBody(list, limit) {
    const shown = limit ? list.slice(0, limit) : list;
    return shown.length ? `<div class="setrows">${shown.map(rowHtml).join("")}</div>` : '<p class="small muted">기록 없음</p>';
  }
  /* 다른 화면(모의면접 설정 화면 아래)에 최근 기록을 그린다. 행을 누르면 서랍에서 그 기록을 연다. */
  function mountList(el, limit) {
    const m = { el, limit };
    lists.add(m);
    el.addEventListener("click", e => { const row = e.target.closest("[data-rec]"); if (row) open(row.dataset.rec); });
    return paintList(m);
  }
  async function paintList(m) { const list = await listSessions(); if (m.el.isConnected) m.el.innerHTML = warnHtml() + listBody(list, m.limit); }

  /* ---------------- 서랍 ---------------- */
  let drawer = null, shade = null, lastFocus = null, openedId = null, viewId = null, paintSeq = 0, urls = [];
  const revoke = list => list.forEach(url => { try { URL.revokeObjectURL(url); } catch (_) { /* 이미 해제됨 */ } });
  function open(id) {
    if (!drawer) {
      lastFocus = document.activeElement; openedId = id || null;
      shade = document.createElement("div"); shade.className = "shade"; shade.addEventListener("click", close);
      drawer = document.createElement("aside"); drawer.className = "drawer wide"; drawer.id = "recordsDrawer";
      drawer.setAttribute("role", "dialog"); drawer.setAttribute("aria-modal", "true"); drawer.setAttribute("aria-labelledby", "rTitle");
      drawer.addEventListener("click", onDrawerClick);
      document.body.append(shade, drawer); document.body.style.overflow = "hidden";
    }
    viewId = id || null;
    return paint(true);
  }
  function close() {
    if (!drawer) return;
    paintSeq++; revoke(urls); urls = [];
    drawer.remove(); shade.remove(); drawer = shade = null; viewId = null;
    document.body.style.overflow = document.querySelector(".drawer, .bdrawer") ? "hidden" : "";
    /* 연 버튼이 그 사이 다시 그려졌으면(지난 면접 목록 등) 같은 행이나 여는 버튼으로 초점을 돌린다. */
    const row = openedId && document.querySelector(`[data-rec="${window.CSS && CSS.escape ? CSS.escape(openedId) : openedId}"]`);
    const back = lastFocus && lastFocus.isConnected ? lastFocus : row || document.getElementById("openRecordsList") || document.getElementById("openRecords");
    if (back && back.focus) back.focus({ preventScroll: true });
  }
  /* Esc는 맨 위 서랍만 닫는다. 기록 서랍이 맨 위면 닫고 아래 서랍(설정·책 상세)의 처리기로 넘기지 않는다. */
  document.addEventListener("keydown", e => { if (e.key !== "Escape" || !drawer || SNU.topDrawer() !== drawer) return; close(); e.stopPropagation(); }, true);
  async function paint(focus) {
    const seq = ++paintSeq, id = viewId;
    const view = id ? await detailView(id) : { html: await listView(), urls: [] };
    if (!drawer || seq !== paintSeq) { revoke(view.urls); return; }   // 그 사이 닫혔거나 다른 기록으로 옮겼다
    revoke(urls); urls = view.urls;
    drawer.innerHTML = view.html;
    const mount = $("[data-fb-mount]", drawer); if (mount) mountFeedback(mount, id);
    if (focus) { const button = $("#rClose", drawer); if (button) button.focus(); }
  }
  async function listView() {
    const list = await listSessions();
    return `<div class="d-top"><h2 class="d-title" id="rTitle">면접 기록</h2><button type="button" class="btn ghost sm" id="rClose">닫기</button></div>${warnHtml()}${listBody(list)}`;
  }
  function recItem(r, url) {
    return `<div class="recitem"><div style="min-width:0"><div class="q">${esc(r.question)}</div><div class="m">${esc(new Date(r.createdAt).toLocaleString("ko-KR"))} · ${fmtClock(r.duration)}</div>${url ? `<audio controls preload="none" src="${url}"></audio>` : ""}</div>
      <div class="stack">${url ? `<a class="btn sm" download="${esc(r.filename)}" href="${url}">내려받기</a>` : ""}<button type="button" class="btn sm ghost" data-rec-del="${esc(r.id)}">삭제</button></div></div>`;
  }
  async function detailView(id) {
    await ensureDeps().catch(() => null);
    const [s, recs] = await Promise.all([getSession(id), recordingsOf(id)]);
    const top = '<div class="d-top"><button type="button" class="btn ghost sm" id="rBack">목록</button><button type="button" class="btn ghost sm" id="rClose">닫기</button></div>';
    if (!s && !recs.length) return { html: `${top}<p class="small muted" id="rTitle">기록 없음</p>`, urls: [] };
    const first = recs[0] || {}, info = s || { setId: first.setId, setLabel: first.setLabel || first.setId || "", modeLabel: first.modeLabel || "", answerMode: "voice", createdAt: first.createdAt || 0 };
    const history = s && Array.isArray(s.history) ? s.history : [], memo = String((s && s.memo) || "");
    const answers = history.filter(h => String(h.a || "").trim()).length, total = recs.reduce((n, r) => n + (r.duration || 0), 0);
    const created = [], recHtml = recs.map(r => { let url = ""; try { if (r.blob) { url = URL.createObjectURL(r.blob); created.push(url); } } catch (_) { url = ""; } return recItem(r, url); }).join("");
    const chips = [
      info.variantLabel ? `<span class="chip">${esc(info.variantLabel)}</span>` : "",
      s ? `<span class="chip">질문 ${history.length}</span><span class="chip">답변 ${answers}</span>` : "",
      recs.length ? `<span class="chip">녹음 ${recs.length} · ${fmtClock(total)}</span>` : "",
      memo ? `<span class="chip">메모 ${memo.length}자</span>` : "",
      !s ? '<span class="chip line">녹음만</span>' : !s.endedAt ? '<span class="chip warn">중단</span>' : ""
    ].join("");
    const links = info.setId ? `<a class="btn sm" href="practice.html?set=${esc(info.setId)}">같은 세트로 모의면접</a><a class="btn sm" href="db.html#${esc(info.setId)}">기출DB에서 보기</a>` : "";
    const qa = history.map((h, i) => `<li class="done"><span class="idx">Q${i + 1}</span><span><b>${esc(h.q)}</b><br><span class="small muted" style="white-space:pre-line">${esc(String(h.a || "").trim() || "(답변 없음)")}</span></span><span class="small muted">${h.duration ? fmtClock(h.duration) : String(h.a || "").trim() ? String(h.a).trim().length + "자" : "—"}</span></li>`).join("");
    return { urls: created, html: `${top}
      <div class="sethead">
        <div class="eyebrow">${esc(new Date(info.createdAt).toLocaleString("ko-KR"))}${info.modeLabel ? " · " + esc(info.modeLabel) : ""}${s ? " · " + (s.answerMode === "voice" ? "음성" : "텍스트") : ""}</div>
        <h2 class="d-title" id="rTitle">${esc(info.setLabel)}</h2>
        <div class="row">${chips}</div>
        <div class="row">${links}<button type="button" class="btn sm danger" id="rDelete">기록 삭제</button></div>
      </div>
      ${s && history.length ? '<section class="d-sec"><h3>AI 피드백</h3><div class="stack" data-fb-mount></div></section>' : ""}
      ${s ? `<section class="d-sec"><h3>문답 기록</h3><ol class="qlist">${qa || '<li><span></span><span class="muted">기록 없음</span><span></span></li>'}</ol></section>` : ""}
      ${memo ? `<section class="d-sec"><h3>메모</h3><pre class="panel" style="white-space:pre-wrap;font:inherit">${esc(memo)}</pre></section>` : ""}
      ${recs.length ? `<section class="d-sec"><h3>녹음</h3><div class="reclist">${recHtml}</div></section>` : ""}` };
  }
  async function onDrawerClick(e) {
    const t = e.target;
    if (t.closest("#rClose")) { close(); return; }
    if (t.closest("#rBack")) { viewId = null; paint(true); return; }
    const row = t.closest("[data-rec]"); if (row) { viewId = row.dataset.rec; paint(true); return; }
    if (t.closest("#rDelete")) { const id = viewId; if (id && confirm("이 면접 기록과 녹음을 지울까?")) { await deleteSession(id); if (viewId === id) { viewId = null; paint(true); } } return; }
    const del = t.closest("[data-rec-del]"); if (del) { const id = viewId; if (confirm("이 녹음을 지울까?")) { try { await deleteRecording(del.dataset.recDel, id); } catch (_) { /* 이미 지워졌다 */ } if (viewId === id) paint(false); } return; }
    if (t.closest("a[href]:not([download])")) close();   // 다른 화면·세트로 옮길 때 서랍을 닫는다
  }

  /* ---------------- AI 피드백(종료 화면·서랍 상세 공통) ---------------- */
  /* 기록별 상태: 진행·오류, 펼친 결과(runs), 고른 모델(choice)·입력 보기(promptOpen). 다시 그리거나 다시 붙여도 유지한다. */
  function fbState(id) {
    if (!fbStates.has(id)) fbStates.set(id, { busy: false, error: "", needsKey: false, warn: "", runs: null, choice: null, promptOpen: false });
    return fbStates.get(id);
  }
  /* 기본값은 설정의 AI 면접해설. 제공사를 바꾸면 그 제공사의 해설 모델·effort로 시작한다. */
  function explanationChoice(provider) {
    const s = S(); provider = provider || (s.explanationProvider === "openai" ? "openai" : "anthropic");
    const prefix = "explanation" + provider[0].toUpperCase() + provider.slice(1);
    return { provider, model: s[prefix + "Model"], effort: s[prefix + "Effort"] };
  }
  /* 기록한 복기본 그대로의 세트. 그 복기본이 없어졌으면 피드백을 만들지 않는다. */
  function setOf(s) {
    if (!s || !s.setId || !window.INTERVIEW_DB) return null;
    const cs = SNU.db.set(s.setId, s.variant || undefined);
    return cs && (!s.variant || cs.variant === s.variant) ? cs : null;
  }
  function validRuns(s) {
    const A = window.AIClient;
    return (Array.isArray(s.feedbacks) ? s.feedbacks : []).filter(r => {
      if (!r || typeof r.model !== "string" || !r.model || !Number.isFinite(r.at)) return false;
      try { A.validateJson(r.data, A.schemas.review); return true; } catch (_) { return false; }
    }).reverse();
  }
  let mountSeq = 0, depsPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error("자료를 읽지 못했다.")); };
      document.head.append(script);
    });
  }
  /* 홈·서가는 세트 데이터나 AI 클라이언트를 읽지 않는다. 기록 상세를 열 때 상대 경로로 한 번만 불러온다. */
  function ensureDeps() {
    if (window.INTERVIEW_DB && window.AIClient) return Promise.resolve();
    if (!depsPromise) depsPromise = (window.INTERVIEW_DB ? Promise.resolve() : loadScript("data/questions.js"))
      .then(() => window.AIClient ? null : loadScript("assets/ai.js"))
      .catch(error => { depsPromise = null; throw error; });
    return depsPromise;
  }
  function mountFeedback(el, id) {
    mounts.forEach(m => { if (!m.el.isConnected) mounts.delete(m); });
    const m = { el, id, uid: ++mountSeq, seq: 0, ready: false };
    mounts.add(m);
    el.setAttribute("aria-live", "polite");   // 생성 중·완료·실패를 보조기술에 알린다(db.js 패널과 같은 방식)
    el.innerHTML = '<p class="small muted">불러오는 중…</p>';
    el.addEventListener("click", e => onFeedbackClick(m, e));
    el.addEventListener("toggle", e => onFeedbackToggle(m, e), true);
    ensureDeps().then(() => { const state = fbState(id); if (!state.choice) state.choice = explanationChoice(); m.ready = true; renderMount(m); }).catch(() => { if (el.isConnected) el.innerHTML = '<p class="callout warn">세트 자료를 읽지 못했다.</p>'; });
    return m;
  }
  async function renderMount(m) {
    if (!m.ready) return;
    const seq = ++m.seq, s = await getSession(m.id), state = fbState(m.id);
    if (!m.el.isConnected || seq !== m.seq) return;
    m.el.setAttribute("aria-busy", String(state.busy));
    m.el.innerHTML = feedbackHtml(m, s);
    models.bind(m.el, model => { const c = state.choice; c.model = model; c.effort = models.normalizeEffort(c.provider, model, c.effort); renderMount(m); });
    models.bindEffort(m.el, value => { state.choice.effort = value; });
  }
  function feedbackHtml(m, s) {
    if (!s) return '<p class="small muted">기록 없음</p>';
    const A = window.AIClient, state = fbState(m.id), cs = setOf(s), ai = A.resolve(state.choice);
    const history = Array.isArray(s.history) ? s.history : [], list = validRuns(s);
    const reason = !cs ? "세트 없음" : !history.some(h => String(h.a || "").trim()) ? "답변 텍스트 없음" : "";
    const inp = cs && history.length ? A.buildReviewInput(cs, s) : null;
    if (list.length && !state.runs) state.runs = new Set([list[0].at]);
    return `<div class="aibar">
        <span class="small" style="font-weight:600">피드백 모델</span>
        <div class="seg" data-fbseg="provider"><button type="button" data-v="anthropic" aria-pressed="${ai.provider === "anthropic"}">Claude</button><button type="button" data-v="openai" aria-pressed="${ai.provider === "openai"}">ChatGPT</button></div>
        ${models.select(ai.provider, ai.model, { sm: true, style: "width:190px" })}
        ${models.effortControl("fb-effort-" + m.uid, ai.provider, ai.model, ai.effort)}
        ${ai.configured ? '<span class="chip ok">키 있음</span>' : '<span class="chip warn">API 키 없음</span><button type="button" class="linkbtn" data-fb-settings>설정</button>'}
      </div>
      <div class="row"><button type="button" class="btn primary sm" data-fb-run ${!reason && ai.configured && !state.busy ? "" : "disabled"}>피드백 받기</button>${state.busy ? '<span class="small muted" role="status">생성 중…</span>' : reason ? `<span class="small muted">${reason}</span>` : ""}</div>
      ${inp ? `<details class="promptview" data-fb-prompt ${state.promptOpen ? "open" : ""}><summary>AI 입력 보기 — ${cs.passages.length ? `제시문 ${cs.passages.length}편 전문 + ` : ""}문답 ${history.length}개</summary><pre><b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}</pre></details>` : ""}
      ${state.error ? `<div class="row"><p class="callout warn">${esc(state.error)}</p></div>` : ""}${state.warn ? `<p class="callout warn">${esc(state.warn)}</p>` : ""}
      ${list.length ? `<div class="study-result">${SNU.runs(list, { open: state.runs, attrs: 'data-kind="feedback"', body: r => feedbackRun(history, r.data) })}</div>` : ""}`;
  }
  function feedbackRun(history, d) {
    const list = items => items.length ? `<ul class="study-list">${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="small muted">없음</p>';
    return `<p class="study-text">${esc(d.summary)}</p>
      <dl class="study-notes"><dt>잘한 점</dt><dd>${list(d.strengths)}</dd><dt>보완할 점</dt><dd>${list(d.gaps)}</dd><dt>다음 연습</dt><dd>${list(d.next)}</dd></dl>
      <section class="study-section"><h4>질문별</h4>${d.items.slice().sort((a, b) => a.no - b.no).map(item => `<article class="study-passage"><h4>Q${item.no}. ${esc((history[item.no - 1] || {}).q || "")}</h4><dl class="study-notes"><dt>검토</dt><dd class="study-text">${esc(item.comment)}</dd><dt>보완 방향</dt><dd class="study-text">${esc(item.better)}</dd></dl></article>`).join("")}</section>`;
  }
  async function onFeedbackClick(m, e) {
    const t = e.target;
    const seg = t.closest("[data-fbseg] button"); if (seg) { fbState(m.id).choice = explanationChoice(seg.dataset.v); changed(m.id); return; }
    if (t.closest("[data-fb-settings]")) { SNU.openSettings(); return; }
    if (t.closest("[data-fb-run]")) { await runFeedback(m); return; }
    const del = t.closest('[data-run-del][data-kind="feedback"]'); if (del && confirm("이 피드백을 지울까?")) await removeFeedback(m.id, Number(del.dataset.runDel));
  }
  /* 결과 블록·입력 보기의 펼침 상태를 기억해 다시 그려도 유지한다. */
  function onFeedbackToggle(m, e) {
    const d = e.target;
    if (!d.matches) return;
    if (d.matches("[data-fb-prompt]")) { fbState(m.id).promptOpen = d.open; return; }
    if (!d.matches('details[data-run][data-kind="feedback"]')) return;
    const state = fbState(m.id);
    if (!state.runs) state.runs = new Set();
    if (d.open) state.runs.add(Number(d.dataset.run)); else state.runs.delete(Number(d.dataset.run));
  }
  /* 요청 중 다른 기록으로 옮기거나 서랍을 닫아도 결과는 요청한 기록에만 저장한다. */
  async function runFeedback(m) {
    const state = fbState(m.id); if (state.busy) return;
    state.busy = true; state.error = ""; state.needsKey = false;   // 기록을 읽는 동안의 두 번째 클릭도 막는다
    const A = window.AIClient, id = m.id, choice = Object.assign({}, state.choice), ai = A.resolve(choice);
    try {
      const s = await getSession(id), cs = setOf(s);
      if (!s || !cs) return;
      const before = validRuns(s);
      changed(id);
      const data = await A.review(cs, s, choice);
      A.validateReviewResponse(data, s);
      lastAt = Math.max(Date.now(), lastAt + 1);
      const result = { data, model: ai.label, effort: ai.effort, at: lastAt };
      const saved = await write(id, prev => prev && Object.assign({}, prev, { feedbacks: (Array.isArray(prev.feedbacks) ? prev.feedbacks : []).concat([result]) }));
      state.warn = saved.saved ? "" : SAVE_WARN;
      if (!state.runs) state.runs = new Set();
      if (before.length) state.runs.delete(before[0].at);
      state.runs.add(result.at);
    } catch (error) {
      state.needsKey = !ai.configured;
      state.error = state.needsKey ? "API 키 없음" : "피드백 생성 실패: " + error.message;
    } finally { state.busy = false; changed(id); }
  }
  async function removeFeedback(id, at) {
    const state = fbState(id);
    const result = await write(id, prev => prev && Object.assign({}, prev, { feedbacks: (Array.isArray(prev.feedbacks) ? prev.feedbacks : []).filter(r => !r || r.at !== at) }));
    state.warn = result.saved ? "" : SAVE_WARN;
    if (state.runs) state.runs.delete(at);
    changed(id);
  }

  window.Records = { open, close, saveSession, getSession, listSessions, deleteSession, putRecording, deleteRecording, recordingsOf, mountFeedback, mountList };
})();
