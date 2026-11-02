/* ============================================================
   기출DB — 제시문과 복기 질문을 훑어보고, 질문 하나씩 AI 면접관과 문답한다.
   · 학교 토글 → 세트 목록(왼쪽) → 세트 상세(제시문 전문 + 학생별 복기 질문)
   · 질문을 펼치면 문답 스레드: 내 답변 → AI 검토 + 꼬리질문 → 다시 답변 … (localStorage "snu-db-threads-v1")
   · AI 호출마다 제시문 전문과 복기 질문 전체가 입력에 들어간다(assets/ai.js setContext). '보내는 입력 보기'로 확인.
   ============================================================ */
(function () {
  "use strict";
  const { $, $$, esc, save, db, models } = window.SNU;
  const S = () => window.SNU.settings;
  const AI = window.AIClient;
  const app = $("#app");
  const TKEY = "snu-db-threads-v1";

  /* ---------- 문답 저장 ---------- */
  let threads = {};
  try { threads = JSON.parse(localStorage.getItem(TKEY) || "{}") || {}; } catch (e) { threads = {}; }
  const saveThreads = () => { try { localStorage.setItem(TKEY, JSON.stringify(threads)); } catch (e) {} };
  const thread = (setId, key) => (threads[setId] && threads[setId][key]) || [];
  function setThread(setId, key, arr) { threads[setId] = threads[setId] || {}; if (arr.length) threads[setId][key] = arr; else delete threads[setId][key]; saveThreads(); }
  const countThreads = setId => Object.keys(threads[setId] || {}).length;

  /* ---------- 상태 ---------- */
  const params = new URLSearchParams(location.search);
  const st = { schoolId: "snu", setId: "", open: {}, busy: "", err: {}, ai: { provider: S().provider, model: "" } };
  {
    const want = (location.hash || "").slice(1) || params.get("set") || S().lastSet;
    const cs = db.set(want) || db.set("snu-" + want) || db.school("snu").sets[0];
    st.setId = cs.id; st.schoolId = cs.school;
  }
  const set = () => db.set(st.setId);
  const school = () => db.school(st.schoolId);
  const sessionAi = () => ({ provider: st.ai.provider, model: st.ai.model || undefined });

  /* ---------- 화면 ---------- */
  function render() {
    const sc = school(), cs = set();
    app.innerHTML = `
      <section class="sec" style="gap:6px">
        <div class="eyebrow">기출DB</div>
        <h1 class="h1">제시문 · 복기 질문 · 질문별 문답</h1>
      </section>
      <div class="schooltabs" role="group" aria-label="학교">${db.schools().map(s => `<button type="button" data-school="${s.id}" aria-pressed="${s.id === st.schoolId}" class="${s.id === "snu" ? "main" : ""} ${s.sets.length ? "" : "empty"}">${esc(s.short)}${s.sets.length ? `<span class="n">${s.sets.length}</span>` : ""}</button>`).join("")}</div>
      <div class="dbgrid">
        <aside class="dbside">
          ${sc.sets.length ? `<div class="setrows">${sc.sets.map(x => `<button type="button" class="setrow" data-set="${x.id}" aria-pressed="${x.id === st.setId}">
              <span class="yr">${x.year}<small>${esc(x.track)}</small></span>
              <span><span class="nm">${esc(x.name)} · ${esc(x.session)}</span><br><span class="th">${esc(x.themes.join(" · "))}</span></span>
              <span class="mt"><span>제시문 ${x.passages.length}</span><span>복기 질문 ${db.count(x)}</span><span>${x.variantKeys.map(k => db.variantLabel(k)).join("·")}</span>${countThreads(x.id) ? `<span>문답 ${countThreads(x.id)}</span>` : ""}</span></button>`).join("")}</div>`
            : `<div class="empty-school"><b>${esc(sc.name)} — 복기 추가 예정</b></div>`}
          ${sc.format ? `<details class="fold"><summary>${esc(sc.short)} 면접 진행 방식 · ${sc.format.year}학년도 복기</summary><div class="fold-b"><div class="row">${sc.format.basics.map(b => `<span class="chip">${esc(b)}</span>`).join("")}</div><dl class="kv" style="grid-template-columns:minmax(0,1fr);gap:2px 0;font-size:.88rem">${sc.format.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd style="margin-bottom:10px;color:var(--ink-2)">${esc(v)}</dd>`).join("")}</dl></div></details>` : ""}
        </aside>
        <div class="dbmain" id="main">${cs && cs.school === st.schoolId ? setDetail(cs) : `<p class="callout">${esc(sc.name)} 세트 없음</p>`}</div>
      </div>`;
    models.bind(app, id => { st.ai.model = id; render(); });
  }
  function setDetail(cs) {
    const ai = AI.resolve(sessionAi());
    return `
      <div class="sethead">
        <div class="eyebrow">${esc(school().name)} · ${cs.year}학년도 · ${esc(cs.session)} · ${esc(cs.track)}</div>
        <h2 class="h1">${esc(cs.name)}</h2>
        <div class="row">${cs.themes.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        <div class="row"><span class="small" style="font-weight:600">복기본</span><div class="seg" role="group" data-vseg="variant">${db.variantButtons(cs)}</div><span class="small muted">${esc(cs.variantLabel)}${cs.source && cs.source.pages ? ` · p.${esc(cs.source.pages)}` : ""}</span></div>
        <div class="row"><a class="btn primary" href="practice.html?set=${esc(cs.id)}">이 세트로 모의면접</a><span class="small muted">제시문 ${cs.passages.length} · 복기 질문 ${db.count(cs)}${db.treeUsable(cs) ? " · 결정 트리" : ""}</span></div>
      </div>
      <div class="aibar">
        <span class="small" style="font-weight:600">AI 면접관</span>
        <div class="seg" data-aiseg="provider"><button type="button" data-v="anthropic" aria-pressed="${ai.provider === "anthropic"}">Claude</button><button type="button" data-v="openai" aria-pressed="${ai.provider === "openai"}">ChatGPT</button></div>
        ${models.select(ai.provider, ai.model, { sm: true, style: "width:190px" })}
        ${ai.configured ? `<span class="chip ok">키 있음</span>` : `<span class="chip warn">API 키 없음</span><button type="button" class="linkbtn" id="openSettingsLink">설정</button>`}
      </div>
      <details class="fold" open><summary>제시문 ${cs.passages.length}편 · 지시문</summary><div class="fold-b">${passagesHtml(cs)}</div></details>
      <section class="sec" style="gap:18px">
        <div class="sec-head"><h2 class="h2">복기 추가질문</h2></div>
        ${groups(cs).map(g => `<div class="qgroup"><h3>${esc(g.label)} · ${g.items.length}</h3>${g.items.map((q, i) => qRow(cs, g.key + "-" + (i + 1), i + 1, q)).join("")}</div>`).join("")}
      </section>`;
  }
  /* 질문 묶음과 문답 키. 키는 <student>-<n> / common-<label>-<n>, kim 외 변형은 "<variant>/" 접두사(docs/DATA.md §4). */
  function groups(cs) {
    const kp = db.keyPrefix(cs);
    return [...cs.followups.map(f => ({ label: f.label, key: kp + f.student, items: f.items })), ...(cs.common || []).map(c => ({ label: c.label, key: kp + "common-" + c.label, items: c.items }))];
  }
  function passagesHtml(cs) {
    return `<div class="papers"><div class="instr">${esc(cs.instruction)}</div>${cs.passages.map(p => `<article class="paper ${p.kind === "dialog" ? "dialog" : ""}"><div class="ptitle">${esc(AI.passageHead(p))}${p.length ? `<span>(${esc(p.length)})</span>` : ""}</div>${p.text.split(/\n{2,}|\n/).filter(x => x.trim()).map(par => `<p>${esc(par)}</p>`).join("")}${p.source ? `<div class="src">${esc(p.source)}</div>` : ""}</article>`).join("")}</div>`;
  }
  function qRow(cs, key, idx, q) {
    const msgs = thread(cs.id, key), open = !!st.open[key];
    const answered = msgs.filter(m => m.role === "user").length;
    return `<div class="qrow ${open ? "open" : ""}" id="q-${esc(key)}">
      <button type="button" class="qhead" data-toggle="${esc(key)}" aria-expanded="${open}"><span class="qidx">Q${idx}</span><span class="qtxt">${esc(q)}</span><span class="qst ${answered ? "on" : ""}">${answered ? `답변 ${answered}` : "답해 보기"}</span></button>
      ${open ? threadHtml(cs, key, q, msgs) : ""}
    </div>`;
  }
  function threadHtml(cs, key, q, msgs) {
    const ai = AI.resolve(sessionAi()), busy = st.busy === key;
    const inp = AI.buildDbInput(cs, q, [...msgs, { role: "user", text: "(지금 적는 답변이 여기에 들어간다)" }]);
    return `<div class="thread">
      ${msgs.map(m => m.role === "user"
        ? `<div class="msg user"><div class="who">나</div>${esc(m.text)}<div class="at">${new Date(m.at).toLocaleString("ko-KR")}</div></div>`
        : `<div class="msg ai"><div class="who">면접관 · ${esc(m.model || "AI")}</div>${esc(m.text)}${m.followup ? `<div class="fu">${esc(m.followup)}</div>` : ""}</div>`).join("")}
      <textarea class="input" id="ta-${esc(key)}" placeholder="${msgs.length && msgs[msgs.length - 1].role === "ai" && msgs[msgs.length - 1].followup ? "꼬리질문에 답하시오." : "답변을 작성하시오."}" ${busy ? "disabled" : ""}></textarea>
      <div class="row between">
        <div class="row">
          <button type="button" class="btn primary sm" data-send="${esc(key)}" ${busy || !ai.configured ? "disabled" : ""}>${busy ? "검토 중…" : "AI 면접관에게 보내기"}</button>
          <button type="button" class="btn sm" data-keep="${esc(key)}" ${busy ? "disabled" : ""}>기록만 남기기</button>
          ${msgs.length ? `<button type="button" class="btn ghost sm" data-clear="${esc(key)}">기록 지우기</button>` : ""}
          ${!ai.configured ? `<span class="small muted">API 키 없음</span>` : ""}
        </div>
        <details class="promptview"><summary>AI 입력 보기 — 제시문 ${cs.passages.length}편 전문 포함</summary><pre><b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}</pre></details>
      </div>
      ${st.err[key] ? `<p class="callout warn">${esc(st.err[key])}</p>` : ""}
    </div>`;
  }
  function rerenderRow(key) {
    const cs = set(), row = $("#q-" + cssEscape(key)); if (!row) { render(); return; }
    for (const g of groups(cs)) for (let i = 0; i < g.items.length; i++) if (g.key + "-" + (i + 1) === key) { row.outerHTML = qRow(cs, key, i + 1, g.items[i]); return; }
  }
  const cssEscape = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, "\\$1");

  /* ---------- 상호작용(위임) ---------- */
  app.addEventListener("click", async e => {
    const t = e.target, cs = set();
    const sch = t.closest("[data-school]"); if (sch) { st.schoolId = sch.dataset.school; const s = school(); if (s.sets.length && (!cs || cs.school !== s.id)) { st.setId = s.sets[0].id; history.replaceState(null, "", "#" + st.setId); } save({ lastSchool: st.schoolId }); return; }   // save → settings:change → render
    const sb = t.closest("[data-set]"); if (sb) { st.setId = sb.dataset.set; st.open = {}; history.replaceState(null, "", "#" + st.setId); save({ lastSet: st.setId }); return; }
    const aseg = t.closest("[data-aiseg] button"); if (aseg) { st.ai.provider = aseg.dataset.v; st.ai.model = ""; render(); return; }
    const vseg = t.closest("[data-vseg] button"); if (vseg) { st.open = {}; save({ variant: vseg.dataset.v }); return; }   // save → settings:change → render
    if (t.closest("#openSettingsLink")) { window.SNU.openSettings(); return; }
    const tg = t.closest("[data-toggle]"); if (tg) { const k = tg.dataset.toggle; st.open[k] = !st.open[k]; rerenderRow(k); if (st.open[k]) { const ta = $("#ta-" + cssEscape(k)); if (ta) ta.focus(); } return; }
    const keep = t.closest("[data-keep]"); if (keep) { const k = keep.dataset.keep, ta = $("#ta-" + cssEscape(k)); const text = (ta.value || "").trim(); if (!text) { st.err[k] = "답변이 비어 있다."; rerenderRow(k); return; } st.err[k] = ""; setThread(cs.id, k, [...thread(cs.id, k), { role: "user", text, at: Date.now() }]); rerenderRow(k); return; }
    const clear = t.closest("[data-clear]"); if (clear) { const k = clear.dataset.clear; if (confirm("이 질문의 문답 기록을 지울까?")) { setThread(cs.id, k, []); st.err[k] = ""; rerenderRow(k); } return; }
    const send = t.closest("[data-send]"); if (send) { await sendAnswer(cs, send.dataset.send); return; }
  });
  document.addEventListener("settings:change", () => { if (!st.busy) render(); });
  window.addEventListener("hashchange", () => { const cs = db.set(location.hash.slice(1)); if (cs && cs.id !== st.setId) { st.setId = cs.id; st.schoolId = cs.school; st.open = {}; render(); } });

  async function sendAnswer(cs, key) {
    const ta = $("#ta-" + cssEscape(key)); const text = (ta && ta.value || "").trim();
    if (!text) { st.err[key] = "답변이 비어 있다."; rerenderRow(key); return; }
    const q = findQuestion(cs, key); if (!q) return;
    const msgs = [...thread(cs.id, key), { role: "user", text, at: Date.now() }];
    setThread(cs.id, key, msgs); st.err[key] = ""; st.busy = key; rerenderRow(key);
    const ai = AI.resolve(sessionAi());
    try {
      const r = await AI.respond(cs, q, msgs, sessionAi());
      setThread(cs.id, key, [...msgs, { role: "ai", text: r.feedback || "", followup: r.followup || "", model: ai.label, at: Date.now() }]);
    } catch (err) { st.err[key] = "AI 호출 실패: " + err.message + " — 답변은 기록에 남았다."; }
    st.busy = ""; rerenderRow(key);
  }
  function findQuestion(cs, key) {
    for (const g of groups(cs)) for (let i = 0; i < g.items.length; i++) if (g.key + "-" + (i + 1) === key) return g.items[i];
    return null;
  }

  render();
})();
