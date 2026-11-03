/* ============================================================
   기출DB — 제시문과 복기 질문을 훑어보고, 질문 하나씩 AI 면접관과 문답한다.
   · 학교 토글 → 세트 목록(왼쪽) → 세트 상세(제시문 전문 + 학생별 복기 질문)
   · 질문을 펼치면 문답 스레드: 내 답변 → AI 검토 + 꼬리질문 → 다시 답변 … (localStorage "snu-db-threads-v1")
   · AI 호출마다 제시문 전문과 복기 질문 전체가 입력에 들어간다(assets/ai.js setContext). '보내는 입력 보기'로 확인.
   · 예시답변·제시문 해설은 [다시 생성]마다 결과가 쌓인다(n차, 결과마다 접기·삭제). 저장은 assets/db-study.js.
   ============================================================ */
(function () {
  "use strict";
  const { $, $$, esc, save, db, models } = window.SNU;
  const S = () => window.SNU.settings;
  const AI = window.AIClient;
  const Study = window.DBStudy;
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
  const st = { schoolId: "snu", setId: "", open: {}, ai: { provider: S().provider, model: "" }, explanationAi: {} };
  {
    const want = (location.hash || "").slice(1) || params.get("set") || S().lastSet;
    const cs = db.set(want) || db.set("snu-" + want) || db.school("snu").sets[0];
    st.setId = cs.id; st.schoolId = cs.school;
  }
  const set = () => db.set(st.setId);
  const school = () => db.school(st.schoolId);
  const sessionAi = () => ({ provider: st.ai.provider, model: st.ai.model || undefined, effort: st.ai.effort });
  const sortedSets = sc => [...sc.sets].sort((a, b) => (S().dbSort === "oldest" ? a.year - b.year : b.year - a.year) || a.id.localeCompare(b.id));
  /* 면접관 응답의 진행·오류도 세트·복기본·질문별로 분리한다. */
  const answerStates = new Map();
  function answerState(cs, key) {
    const id = JSON.stringify([Study.identity(cs), key]);
    if (!answerStates.has(id)) answerStates.set(id, { busy: false, error: "" });
    return answerStates.get(id);
  }
  /* 학습 결과는 문답 기록과 분리하고 세트·복기본별로 보관한다. runs = 펼친 결과의 at 집합(null이면 최신만 펼침). */
  const studyStates = new Map();
  const SAVE_WARN = "저장 공간 부족: 새로 고침하면 사라진다.";
  function studyState(cs) {
    const id = Study.identity(cs);
    if (!studyStates.has(id)) studyStates.set(id, { examples: new Map(), explanation: { open: false, busy: false, error: "", needsKey: false, warn: "", runs: null, books: null } });
    return studyStates.get(id);
  }
  function exampleState(cs, key) {
    const states = studyState(cs).examples;
    if (!states.has(key)) states.set(key, { open: false, busy: false, error: "", needsKey: false, warn: "", runs: null });
    return states.get(key);
  }
  const studyIsCurrent = cs => st.schoolId === cs.school && Study.identity(set()) === Study.identity(cs);

  /* ---------- 화면 ---------- */
  let renderedSetKey = "";
  function render() {
    const sc = school(), cs = set();
    const setKey = cs && cs.school === st.schoolId ? cs.id + "/" + cs.variant : "";
    const drafts = setKey && setKey === renderedSetKey ? $$(".thread textarea", app).map(ta => [ta.id, ta.value]) : [];
    app.innerHTML = `
      <section class="sec" style="gap:6px">
        <div class="eyebrow">기출DB</div>
        <h1 class="h1">제시문 · 복기 질문 · 질문별 문답</h1>
      </section>
      <div class="schooltabs" role="group" aria-label="학교">${db.schools().map(s => `<button type="button" data-school="${s.id}" aria-pressed="${s.id === st.schoolId}" class="${s.id === "snu" ? "main" : ""} ${s.sets.length ? "" : "empty"}">${esc(s.short)}${s.sets.length ? `<span class="n">${s.sets.length}</span>` : ""}</button>`).join("")}</div>
      <div class="dbgrid ${S().dbHideThemes ? "themes-hidden" : ""}">
        <aside class="dbside">
          <div class="dbtools" role="group" aria-label="기출 표시">
            <button type="button" class="btn sm ${S().dbHideThemes ? "primary" : ""}" id="toggleThemes" aria-pressed="${!!S().dbHideThemes}">${S().dbHideThemes ? "주제 보이기" : "주제 가리기"}</button>
            <button type="button" class="btn sm" id="sortSets" aria-label="${S().dbSort === "oldest" ? "과거순, 최신순으로 변경" : "최신순, 과거순으로 변경"}">${S().dbSort === "oldest" ? "과거순 ↑" : "최신순 ↓"}</button>
          </div>
          ${sc.sets.length ? `<div class="setrows">${sortedSets(sc).map(x => `<button type="button" class="setrow" data-set="${x.id}" aria-pressed="${x.id === st.setId}">
              <span class="yr">${x.year}<small>${esc(x.track)}</small></span>
              <span><span class="nm">${esc(x.name)} · ${esc(x.session)}</span><br><span class="th dbtheme" aria-hidden="${!!S().dbHideThemes}">${esc(x.themes.join(" · "))}</span></span>
              <span class="mt"><span>제시문 ${x.passages.length}</span><span>복기 질문 ${db.count(x)}</span><span>${x.variantKeys.map(k => db.variantLabel(k)).join("·")}</span>${countThreads(x.id) ? `<span>문답 ${countThreads(x.id)}</span>` : ""}</span></button>`).join("")}</div>`
            : `<div class="empty-school"><b>${esc(sc.name)} — 복기 추가 예정</b></div>`}
          ${sc.format ? `<details class="fold"><summary>${esc(sc.short)} 면접 진행 방식 · ${sc.format.year}학년도 복기</summary><div class="fold-b"><div class="row">${sc.format.basics.map(b => `<span class="chip">${esc(b)}</span>`).join("")}</div><dl class="kv" style="grid-template-columns:minmax(0,1fr);gap:2px 0;font-size:.88rem">${sc.format.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd style="margin-bottom:10px;color:var(--ink-2)">${esc(v)}</dd>`).join("")}</dl></div></details>` : ""}
        </aside>
        <div class="dbmain" id="main">${cs && cs.school === st.schoolId ? setDetail(cs) : `<p class="callout">${esc(sc.name)} 세트 없음</p>`}</div>
      </div>`;
    renderedSetKey = setKey;
    drafts.forEach(([id, value]) => { const ta = document.getElementById(id); if (ta) ta.value = value; });
    if (cs && cs.school === st.schoolId && studyState(cs).explanation.open) loadStudyBooks(cs);
    const interviewerBar = $("#dbInterviewerAi", app), explanationBar = $("#dbExplanationAi", app);
    if (interviewerBar) {
      models.bind(interviewerBar, id => { st.ai.model = id; st.ai.effort = models.normalizeEffort(st.ai.provider, id, st.ai.effort || S()[st.ai.provider + "Effort"]); render(); });
      models.bindEffort(interviewerBar, value => { st.ai.effort = value; });
    }
    if (explanationBar) {
      models.bind(explanationBar, id => {
        const ai = Study.resolveAi(st.explanationAi);
        st.explanationAi = { provider: ai.provider, model: id, effort: models.normalizeEffort(ai.provider, id, ai.effort) };
        render();
      });
      models.bindEffort(explanationBar, value => {
        const ai = Study.resolveAi(st.explanationAi);
        st.explanationAi = { provider: ai.provider, model: ai.model, effort: value };
      });
    }
  }
  function setDetail(cs) {
    const ai = AI.resolve(sessionAi()), explanationAi = Study.resolveAi(st.explanationAi);
    return `
      <div class="sethead">
        <div class="eyebrow">${esc(school().name)} · ${cs.year}학년도 · ${esc(cs.session)} · ${esc(cs.track)}</div>
        <h2 class="h1">${esc(cs.name)}</h2>
        <div class="row dbtheme" aria-hidden="${!!S().dbHideThemes}">${cs.themes.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        <div class="row"><span class="small" style="font-weight:600">복기본</span><div class="seg" role="group" data-vseg="variant">${db.variantButtons(cs)}</div><span class="small muted">${esc(cs.variantLabel)}${cs.source && cs.source.pages ? ` · p.${esc(cs.source.pages)}` : ""}</span></div>
        <div class="row"><a class="btn primary" href="practice.html?set=${esc(cs.id)}">이 세트로 모의면접</a><span class="small muted">제시문 ${cs.passages.length} · 복기 질문 ${db.count(cs)}${db.treeUsable(cs) ? " · 결정 트리" : ""}</span></div>
      </div>
      <div class="aibar" id="dbInterviewerAi" role="group" aria-label="AI 면접관">
        <span class="small" style="font-weight:600">AI 면접관</span>
        <div class="seg" data-aiseg="provider"><button type="button" data-v="anthropic" aria-pressed="${ai.provider === "anthropic"}">Claude</button><button type="button" data-v="openai" aria-pressed="${ai.provider === "openai"}">ChatGPT</button></div>
        ${models.select(ai.provider, ai.model, { sm: true, style: "width:190px" })}
        ${models.effortControl("db-effort", ai.provider, ai.model, ai.effort)}
        ${ai.configured ? `<span class="chip ok">키 있음</span>` : `<span class="chip warn">API 키 없음</span><button type="button" class="linkbtn" id="openSettingsLink">설정</button>`}
      </div>
      <div class="aibar" id="dbExplanationAi" role="group" aria-label="AI 면접해설">
        <span class="small" style="font-weight:600">AI 면접해설</span>
        <div class="seg" data-explanationseg="provider"><button type="button" data-v="anthropic" aria-pressed="${explanationAi.provider === "anthropic"}">Claude</button><button type="button" data-v="openai" aria-pressed="${explanationAi.provider === "openai"}">ChatGPT</button></div>
        ${models.select(explanationAi.provider, explanationAi.model, { sm: true, style: "width:190px" })}
        ${models.effortControl("db-explanation-effort", explanationAi.provider, explanationAi.model, explanationAi.effort)}
        ${explanationAi.configured ? `<span class="chip ok">키 있음</span>` : `<span class="chip warn">API 키 없음</span><button type="button" class="linkbtn" data-study-settings>설정</button>`}
      </div>
      <details class="fold" open><summary>제시문 ${cs.passages.length}편 · 지시문</summary><div class="fold-b">${passagesHtml(cs)}</div></details>
      ${explanationHtml(cs)}
      <section class="sec" style="gap:18px">
        <div class="sec-head"><h2 class="h2">복기 추가질문</h2></div>
        ${groups(cs).map(g => `<div class="qgroup"><h3>${esc(g.label)} · ${g.items.length}</h3>${g.items.map((q, i) => qRow(cs, g.key + "-" + (i + 1), i + 1, q)).join("")}</div>`).join("")}
      </section>`;
  }
  /* 질문 묶음과 문답 키. 키는 task-<n>(문제지 문항) / <student>-<n> / common-<label>-<n>, kim 외 변형은 "<variant>/" 접두사(docs/DATA.md §4). */
  function groups(cs) {
    const kp = db.keyPrefix(cs);
    const tasks = (cs.tasks || []).length ? [{ label: "문제", key: kp + "task", items: cs.tasks.map(t => `${AI.taskHead(t)}. ${t.text}`) }] : [];
    return [...tasks, ...cs.followups.map(f => ({ label: f.label, key: kp + f.student, items: f.items })), ...(cs.common || []).map(c => ({ label: c.label, key: kp + "common-" + c.label, items: c.items }))];
  }
  function passagesHtml(cs) {
    return `<div class="papers"><div class="instr">${esc(cs.instruction)}${(cs.tasks || []).length ? `<ol class="tasks">${cs.tasks.map(t => `<li><b>${esc(AI.taskHead(t))}.</b> ${esc(t.text)}</li>`).join("")}</ol>` : ""}</div>${cs.passages.map(p => `<article class="paper ${p.kind === "dialog" ? "dialog" : ""}"><div class="ptitle">${esc(AI.passageHead(p))}${p.length ? `<span>(${esc(p.length)})</span>` : ""}</div>${p.text.split(/\n{2,}|\n/).filter(x => x.trim()).map(par => `<p>${esc(par)}</p>`).join("")}${p.source ? `<div class="src">${esc(p.source)}</div>` : ""}</article>`).join("")}</div>`;
  }
  function qRow(cs, key, idx, q) {
    const msgs = thread(cs.id, key), open = !!st.open[key];
    const example = exampleState(cs, key);
    return `<div class="qrow ${open ? "open" : ""}" id="q-${esc(key)}">
      <div class="qhead"><button type="button" class="qtoggle" data-toggle="${esc(key)}" aria-expanded="${open}"><span class="qidx">Q${idx}</span><span class="qtxt">${esc(q)}</span></button><button type="button" class="btn sm" data-example="${esc(key)}" aria-controls="examples-${esc(key)}" aria-expanded="${example.open}" ${example.busy ? "disabled" : ""}>예시답변</button></div>
      <div class="study-panel question-study" id="examples-${esc(key)}" ${example.open ? "" : "hidden"} aria-live="polite" aria-busy="${example.busy}">${examplesBody(cs, key, q)}</div>
      ${open ? threadHtml(cs, key, q, msgs) : ""}
    </div>`;
  }
  function studyStatus(state) {
    const warn = state.warn ? `<p class="callout warn">${esc(state.warn)}</p>` : "";
    if (state.busy) return '<p class="study-status small muted" role="status">생성 중…</p>' + warn;
    if (!state.error) return warn;
    return `<div class="row"><p class="callout warn">${esc(state.error)}</p>${state.needsKey ? '<button type="button" class="btn sm" data-study-settings>설정</button>' : ""}</div>${warn}`;
  }
  /* 결과 목록: 처음 열 때는 최신만 펼치고, 그 뒤로는 사용자가 펼친 상태를 유지한다. */
  function studyRuns(state, list, attrs, body) {
    if (!state.runs) state.runs = new Set([list[0].at]);
    return window.SNU.runs(list, { open: state.runs, attrs, body });
  }
  function examplesBody(cs, key, q) {
    const state = exampleState(cs, key), list = Study.exampleHistory(cs, key, q);
    return `${studyStatus(state)}${list.length ? `<div class="study-result"><div class="row between"><span class="chip accent">AI 예시답변</span><button type="button" class="btn sm ghost" data-example-refresh="${esc(key)}" ${state.busy ? "disabled" : ""}>다시 생성</button></div>${studyRuns(state, list, `data-kind="example" data-key="${esc(key)}"`, run => run.data.examples.map((item, i) => `<article class="study-example"><h4>예시 ${i + 1} · ${esc(item.label)}</h4><p class="study-text study-answer">${esc(item.answer)}</p><dl class="study-notes"><dt>답변의 의의</dt><dd class="study-text study-importance">${esc(item.importance)}</dd><dt>유의점</dt><dd class="study-text study-cautions">${esc(item.cautions)}</dd></dl></article>`).join(""))}</div>` : ""}`;
  }
  function explanationHtml(cs) {
    const state = studyState(cs).explanation;
    return `<section class="study-explanation"><div class="row"><button type="button" class="btn sm" id="explainPassages" aria-controls="passageExplanation" aria-expanded="${state.open}" ${state.busy ? "disabled" : ""}>제시문 해설</button></div><div class="study-panel" id="passageExplanation" ${state.open ? "" : "hidden"} aria-live="polite" aria-busy="${state.busy}">${explanationBody(cs)}</div></section>`;
  }
  function studyList(items) { return `<ul class="study-list">${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`; }
  function explanationBody(cs) {
    const state = studyState(cs).explanation, list = Study.explanationHistory(cs);
    if (!list.length) return studyStatus(state);
    return `${studyStatus(state)}<div class="study-result"><div class="row between"><span class="chip accent">AI 제시문 해설</span><button type="button" class="btn sm ghost" id="refreshPassages" ${state.busy ? "disabled" : ""}>다시 생성</button></div>${studyRuns(state, list, 'data-kind="explanation"', run => explanationRun(cs, run.data, state.books || []))}</div>`;
  }
  /* 연관 독서의 표시명·링크는 AI 문자열이 아니라 실제 서가 데이터에서 가져온다(서가를 읽기 전에는 생략). */
  function explanationRun(cs, data, shelf) {
    const books = data.books.map(item => {
      const book = shelf.find(candidate => candidate.id === item.id);
      return book && Number.isInteger(book.id) ? `<li><a href="library.html#b${book.id}">${esc(book.title)}</a>${book.author ? ` · ${esc(book.author)}` : ""}<p class="study-text">${esc(item.reason)}</p></li>` : "";
    }).filter(Boolean);
    return `<p class="study-text">${esc(data.overview)}</p>${data.passages.map(item => {
      const passage = cs.passages.find(p => p.no === item.no);
      return `<article class="study-passage"><h4>${esc(passage ? AI.passageHead(passage) : "제시문 " + item.no)}</h4><dl class="study-notes"><dt>요약</dt><dd class="study-text">${esc(item.summary)}</dd><dt>출제의도</dt><dd class="study-text">${esc(item.intent)}</dd><dt>핵심요소</dt><dd>${studyList(item.keyPoints)}</dd><dt>참고</dt><dd class="study-text">${esc(item.notes)}</dd></dl></article>`;
    }).join("")}<section class="study-section"><h4>질문별 접근</h4>${studyList(data.questionStrategy)}</section><section class="study-section"><h4>출전 검토</h4><p class="study-text">${esc(data.sourceNotes)}</p></section>${books.length ? `<section class="study-section"><h4>연관 독서</h4><ul class="study-list study-books">${books.join("")}</ul></section>` : ""}`;
  }
  /* 생성 응답은 해당 학습 영역만 갱신해 작성 중인 답변·초점을 건드리지 않는다. */
  function updateExamples(cs, key) {
    if (!studyIsCurrent(cs)) return;
    const state = exampleState(cs, key), panel = document.getElementById("examples-" + key), button = $(`[data-example="${cssEscape(key)}"]`, app);
    if (panel) { panel.innerHTML = examplesBody(cs, key, findQuestion(cs, key)); panel.hidden = !state.open; panel.setAttribute("aria-busy", state.busy); }
    if (button) { button.disabled = state.busy; button.setAttribute("aria-expanded", state.open); }
  }
  function updateExplanation(cs) {
    if (!studyIsCurrent(cs)) return;
    const state = studyState(cs).explanation, panel = $("#passageExplanation"), button = $("#explainPassages");
    if (panel) { panel.innerHTML = explanationBody(cs); panel.hidden = !state.open; panel.setAttribute("aria-busy", state.busy); }
    if (button) { button.disabled = state.busy; button.setAttribute("aria-expanded", state.open); }
  }
  /* 새 결과는 펼치고 직전 최신은 접는다. 그 밖의 결과는 펼친 상태 그대로. */
  function openNewRun(state, before, at) {
    if (!state.runs) state.runs = new Set();
    if (before.length) state.runs.delete(before[0].at);
    state.runs.add(at);
  }
  /* 저장된 결과가 있으면 버튼은 열고 닫기만 한다. 새로 생성은 결과가 없을 때와 [다시 생성]뿐이다. */
  async function requestExamples(cs, key, refresh) {
    const question = findQuestion(cs, key); if (!question) return;
    const state = exampleState(cs, key); if (state.busy) return;
    const before = Study.exampleHistory(cs, key, question);
    if (before.length && !refresh) { state.open = !state.open; updateExamples(cs, key); return; }
    const resolved = Study.resolveAi(st.explanationAi), ai = { provider: resolved.provider, model: resolved.model, effort: resolved.effort };
    state.open = true; state.busy = true; state.error = ""; state.needsKey = false; updateExamples(cs, key);
    try { const result = await Study.examples(cs, key, question, ai, !!refresh); openNewRun(state, before, result.at); state.warn = Study.saved() ? "" : SAVE_WARN; }
    catch (error) { state.needsKey = !resolved.configured; state.error = state.needsKey ? "API 키 없음" : "예시답변 생성 실패: " + error.message; }
    finally { state.busy = false; updateExamples(cs, key); }
  }
  async function requestExplanation(cs, refresh) {
    const state = studyState(cs).explanation; if (state.busy) return;
    const before = Study.explanationHistory(cs);
    if (before.length && !refresh) { state.open = !state.open; updateExplanation(cs); if (state.open) loadStudyBooks(cs); return; }
    const resolved = Study.resolveAi(st.explanationAi), ai = { provider: resolved.provider, model: resolved.model, effort: resolved.effort };
    state.open = true; state.busy = true; state.error = ""; state.needsKey = false; updateExplanation(cs);
    try { const result = await Study.explain(cs, ai, !!refresh); state.books = result.books; openNewRun(state, before, result.at); state.warn = Study.saved() ? "" : SAVE_WARN; }
    catch (error) { state.needsKey = !resolved.configured; state.error = state.needsKey ? "API 키 없음" : "제시문 해설 생성 실패: " + error.message; }
    finally { state.busy = false; updateExplanation(cs); }
  }
  /* 저장된 해설을 다시 열 때 연관 독서 링크용 서가 목록만 읽는다(AI 호출 없음). */
  function loadStudyBooks(cs) {
    const state = studyState(cs).explanation;
    if (state.books || state.booksLoading) return;
    state.booksLoading = true;
    Study.loadBooks().then(books => { state.books = books; updateExplanation(cs); }).catch(() => {}).finally(() => { state.booksLoading = false; });
  }
  function removeRun(cs, button) {
    if (!confirm("이 결과를 지울까?")) return;
    const at = Number(button.dataset.runDel);
    if (button.dataset.kind === "example") {
      const key = button.dataset.key, state = exampleState(cs, key);
      state.warn = Study.removeExample(cs, key, at) ? "" : SAVE_WARN;
      if (state.runs) state.runs.delete(at);
      if (!state.busy && !Study.exampleHistory(cs, key, findQuestion(cs, key)).length) state.open = false;
      updateExamples(cs, key);
    } else {
      const state = studyState(cs).explanation;
      state.warn = Study.removeExplanation(cs, at) ? "" : SAVE_WARN;
      if (state.runs) state.runs.delete(at);
      if (!state.busy && !Study.explanationHistory(cs).length) state.open = false;
      updateExplanation(cs);
    }
  }
  function threadHtml(cs, key, q, msgs) {
    const ai = AI.resolve(sessionAi()), state = answerState(cs, key), busy = state.busy;
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
          ${msgs.length ? `<button type="button" class="btn ghost sm" data-clear="${esc(key)}" ${busy ? "disabled" : ""}>기록 지우기</button>` : ""}
          ${!ai.configured ? `<span class="small muted">API 키 없음</span>` : ""}
        </div>
        <details class="promptview"><summary>AI 입력 보기 — 제시문 ${cs.passages.length}편 전문 포함</summary><pre><b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}</pre></details>
      </div>
      ${state.error ? `<p class="callout warn">${esc(state.error)}</p>` : ""}
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
    if (t.closest("[data-study-settings]")) { window.SNU.openSettings(); return; }
    const exampleButton = t.closest("[data-example]"); if (exampleButton) { await requestExamples(cs, exampleButton.dataset.example, false); return; }
    const exampleRefresh = t.closest("[data-example-refresh]"); if (exampleRefresh) { await requestExamples(cs, exampleRefresh.dataset.exampleRefresh, true); return; }
    if (t.closest("#explainPassages")) { await requestExplanation(cs, false); return; }
    if (t.closest("#refreshPassages")) { await requestExplanation(cs, true); return; }
    const runDel = t.closest("[data-run-del]"); if (runDel) { removeRun(cs, runDel); return; }
    const themeToggle = t.closest("#toggleThemes"); if (themeToggle) { saveView({ dbHideThemes: !S().dbHideThemes }, "toggleThemes"); return; }
    const sortToggle = t.closest("#sortSets"); if (sortToggle) { saveView({ dbSort: S().dbSort === "oldest" ? "newest" : "oldest" }, "sortSets"); return; }
    const sch = t.closest("[data-school]"); if (sch) { st.schoolId = sch.dataset.school; const s = school(); if (s.sets.length && (!cs || cs.school !== s.id)) { st.setId = s.sets[0].id; history.replaceState(null, "", "#" + st.setId); } save({ lastSchool: st.schoolId }); return; }   // save → settings:change → render
    const sb = t.closest("[data-set]"); if (sb) { st.setId = sb.dataset.set; st.open = {}; history.replaceState(null, "", "#" + st.setId); save({ lastSet: st.setId }); return; }
    const aseg = t.closest("[data-aiseg] button"); if (aseg) { st.ai.provider = aseg.dataset.v; st.ai.model = ""; st.ai.effort = undefined; render(); return; }
    const explanationSeg = t.closest("[data-explanationseg] button"); if (explanationSeg) { st.explanationAi = { provider: explanationSeg.dataset.v }; render(); return; }
    const vseg = t.closest("[data-vseg] button"); if (vseg) { st.open = {}; save({ variant: vseg.dataset.v }); return; }   // save → settings:change → render
    if (t.closest("#openSettingsLink")) { window.SNU.openSettings(); return; }
    const tg = t.closest("[data-toggle]"); if (tg) { const k = tg.dataset.toggle; st.open[k] = !st.open[k]; rerenderRow(k); if (st.open[k]) { const ta = $("#ta-" + cssEscape(k)); if (ta) ta.focus(); } return; }
    const keep = t.closest("[data-keep]"); if (keep) { const k = keep.dataset.keep, state = answerState(cs, k); if (state.busy) return; const ta = $("#ta-" + cssEscape(k)), text = (ta && ta.value || "").trim(); if (!text) { state.error = "답변이 비어 있다."; rerenderRow(k); return; } state.error = ""; setThread(cs.id, k, [...thread(cs.id, k), { role: "user", text, at: Date.now() }]); rerenderRow(k); return; }
    const clear = t.closest("[data-clear]"); if (clear) { const k = clear.dataset.clear, state = answerState(cs, k); if (state.busy) return; if (confirm("이 질문의 문답 기록을 지울까?")) { setThread(cs.id, k, []); state.error = ""; rerenderRow(k); } return; }
    const send = t.closest("[data-send]"); if (send) { await sendAnswer(cs, send.dataset.send); return; }
  });
  /* 결과 블록을 펼치고 접은 상태를 기억해 다시 그려도 유지한다(toggle은 버블링하지 않아 capture로 받는다). */
  app.addEventListener("toggle", e => {
    const run = e.target;
    if (!run.matches || !run.matches("details[data-run]")) return;
    const cs = set(), state = run.dataset.kind === "example" ? exampleState(cs, run.dataset.key) : studyState(cs).explanation;
    if (!state.runs) state.runs = new Set();
    if (run.open) state.runs.add(Number(run.dataset.run)); else state.runs.delete(Number(run.dataset.run));
  }, true);
  document.addEventListener("settings:change", render);
  window.addEventListener("hashchange", () => { const cs = db.set(location.hash.slice(1)); if (cs && cs.id !== st.setId) { st.setId = cs.id; st.schoolId = cs.school; st.open = {}; render(); } });

  /* 표시 설정만 바꿀 때는 작성 중인 답변과 키보드 초점을 유지한다. */
  function saveView(patch, focusId) {
    const drafts = $$(".thread textarea", app).map(ta => [ta.id, ta.value]);
    save(patch);
    drafts.forEach(([id, value]) => { const ta = document.getElementById(id); if (ta) ta.value = value; });
    const control = document.getElementById(focusId); if (control) control.focus({ preventScroll: true });
  }

  async function sendAnswer(cs, key) {
    const state = answerState(cs, key); if (state.busy) return;
    const ta = $("#ta-" + cssEscape(key)); const text = (ta && ta.value || "").trim();
    if (!text) { state.error = "답변이 비어 있다."; rerenderRow(key); return; }
    const q = findQuestion(cs, key); if (!q) return;
    const msgs = [...thread(cs.id, key), { role: "user", text, at: Date.now() }];
    setThread(cs.id, key, msgs); state.error = ""; state.busy = true; rerenderRow(key);
    const ai = AI.resolve(sessionAi());
    try {
      const r = await AI.respond(cs, q, msgs, sessionAi());
      setThread(cs.id, key, [...msgs, { role: "ai", text: r.feedback || "", followup: r.followup || "", model: ai.label, at: Date.now() }]);
    } catch (err) { state.error = "AI 호출 실패: " + err.message + " — 답변은 기록에 남았다."; }
    state.busy = false;
    if (studyIsCurrent(cs)) rerenderRow(key);
  }
  function findQuestion(cs, key) {
    for (const g of groups(cs)) for (let i = 0; i < g.items.length; i++) if (g.key + "-" + (i + 1) === key) return g.items[i];
    return null;
  }

  render();
})();
