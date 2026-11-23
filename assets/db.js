/* ============================================================
   기출DB — 제시문과 복기 질문을 훑어보고, 질문 하나씩 AI 면접관과 문답한다.
   · 학교 토글 → 세트 목록(왼쪽) → 세트 상세(제시문 전문 + 학생별 복기 질문)
   · 질문을 펼치면 문답 스레드: 내 답변 → AI 검토 + 꼬리질문 → 다시 답변 … (localStorage "snu-db-threads-v1")
   · AI 호출마다 제시문 전문과 복기 질문 전체가 입력에 들어간다(assets/ai.js setContext). '보내는 입력 보기'로 확인.
   · 예시답변·제시문 해설은 [다시 생성]마다 결과가 쌓인다(n차, 결과마다 접기·삭제). 저장은 assets/db-study.js.
   · 녹음본 피드백: 녹음(OpenAI 전사)·문답 텍스트를 올리면 AI 면접관 바의 모델이 제시문에 비추어 평가한다(문제 분석·답변 평가·개선 방안·추천 도서, 결과 누적).
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
    if (!studyStates.has(id)) studyStates.set(id, {
      examples: new Map(), explanation: { open: false, busy: false, error: "", needsKey: false, warn: "", runs: null, books: null },
      /* 녹음본 피드백: files = 첨부 [{name, size, kind: "audio"|"text", file(전사 뒤 null), done, model}], text = 문답 칸, count = 전사한 녹음 수,
         qaOpen = 펼친 문답("at:no"), fullOpen = '평가한 문답'을 펼친 결과, asks = 결과(at)별 후속 질문 {busy, error, warn, draft, promptOpen} */
      recording: { open: false, busy: false, progress: "", error: "", needsKey: false, warn: "", runs: null, books: null, files: [], text: "", count: 0, promptOpen: false, qaOpen: new Set(), fullOpen: new Set(), asks: new Map() }
    });
    return studyStates.get(id);
  }
  const recState = cs => studyState(cs).recording;
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
    if (cs && cs.school === st.schoolId && recState(cs).open) { loadRecordingBooks(cs); syncRunDeletes(cs); }
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
      ${recordingHtml(cs)}
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
    } else if (button.dataset.kind === "recording") {
      const state = recState(cs);
      if (state.asks.has(at) && state.asks.get(at).busy) return;   // 후속 질문의 답을 기다리는 결과는 지우지 않는다
      state.warn = Study.removeReview(cs, at) ? "" : SAVE_WARN;
      if (state.runs) state.runs.delete(at);
      state.asks.delete(at); state.fullOpen.delete(at);
      [...state.qaOpen].forEach(key => { if (key.startsWith(at + ":")) state.qaOpen.delete(key); });
      setRecordingStatus(cs);
      updateRecordingResults(cs);
    } else {
      const state = studyState(cs).explanation;
      state.warn = Study.removeExplanation(cs, at) ? "" : SAVE_WARN;
      if (state.runs) state.runs.delete(at);
      if (!state.busy && !Study.explanationHistory(cs).length) state.open = false;
      updateExplanation(cs);
    }
  }

  /* ---------- 녹음본 피드백 ----------
     첨부한 문답 텍스트와 녹음 전사가 문답 칸에 글로 모이고, 평가는 늘 그 칸의 글로 한다(평가에 들어가는 글을 그대로 본다).
     첨부·문답 칸은 세트·복기본별 상태에 두어 다시 그려도 남는다. 녹음은 [전사]·[피드백 받기]를 눌렀을 때만 OpenAI로 보내고 전사 뒤 버린다.
     평가 모델은 AI 면접관 바의 선택(sessionAi)이고 결과는 예시답변·해설처럼 쌓인다(assets/db-study.js).
     결과마다 문답별 평가(원문 구간·답변 요지·평가·개선), 평가한 문답 전문, 후속 질문 스레드를 둔다.
     다시 그리기는 나눠 한다: 폼(updateRecordingForm), 진행 줄(setRecordingStatus), 결과 목록(updateRecordingResults), 결과 하나의 후속 질문(updateRecordingThread).
     문답별 본문·전문·입력 보기는 펼칠 때만 채운다. 복사·내려받기 글은 결과의 필드로만 만든다(설정·키는 들어가지 않는다). */
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB";
  const pendingAudio = state => state.files.filter(f => f.kind === "audio" && !f.done);
  const openaiReady = () => AI.resolve({ provider: "openai" }).configured;
  const transcriptionLabel = id => (models.list("transcription").find(m => m.id === id) || { label: id }).label;
  const HEAD_LINE = /^\[녹음 \d+: [^\]\n]*\]$/;
  function canReview(cs) {
    const state = recState(cs), pending = pendingAudio(state).length;
    return !state.busy && AI.resolve(sessionAi()).configured && (pending > 0 || !!state.text.trim()) && (!pending || openaiReady());
  }
  function askState(cs, at) {
    const asks = recState(cs).asks;
    if (!asks.has(at)) asks.set(at, { busy: false, error: "", warn: "", draft: "", promptOpen: false });
    return asks.get(at);
  }
  const findRun = (cs, at) => Study.reviewHistory(cs).find(r => r.at === at) || null;
  function recordingHtml(cs) {
    const state = recState(cs);
    return `<section class="study-explanation"><div class="row"><button type="button" class="btn sm" id="recordingFeedback" aria-controls="recordingPanel" aria-expanded="${state.open}">녹음본 피드백</button></div><div class="study-panel" id="recordingPanel" ${state.open ? "" : "hidden"}>${recordingBody(cs)}</div><p class="sr" id="recLive" aria-live="polite"></p></section>`;
  }
  function recordingBody(cs) {
    const state = recState(cs), results = recordingResults(cs);
    return `<div class="study-result rec-form" id="recForm" aria-busy="${state.busy}">${recordingForm(cs)}</div><div class="study-result" id="recResults" ${results ? "" : "hidden"}>${results}</div>`;
  }
  function recordingForm(cs) {
    const state = recState(cs), ai = AI.resolve(sessionAi()), dis = state.busy ? "disabled" : "", text = state.text.trim() ? "" : "disabled";
    const audio = state.files.some(f => f.kind === "audio"), model = AI.transcriptionModel(), ready = openaiReady(), status = recordingStatus(state);
    return `<div class="row between">
        <div class="row"><button type="button" class="btn sm" id="recPick" ${dis}>파일 선택</button><span class="small muted">녹음 · 문답 텍스트</span></div>
        <button type="button" class="btn sm ghost" id="recClear" ${dis} ${state.files.length || state.text ? "" : "hidden"}>비우기</button>
        <input type="file" id="recFiles" multiple hidden accept="audio/*,${AI.RECORDING_LIMITS.audioTypes.map(x => "." + x).join(",")},.txt,.md,.json">
      </div>
      ${state.files.length ? `<ul class="study-list" id="recList">${state.files.map((f, i) => `<li>${esc(f.name)} <span class="small muted">${fmtSize(f.size)} · ${f.kind === "text" ? "문답" : f.done ? "전사됨" + (f.model ? " · " + esc(f.model) : "") : "녹음"}</span>${f.kind === "audio" && !f.done ? ` <button type="button" class="linkbtn" data-rec-remove="${i}" ${dis}>빼기</button>` : ""}</li>`).join("")}</ul>` : ""}
      ${audio ? `<div class="row" id="recStt"><span class="small" style="font-weight:600">전사(OpenAI)</span><select class="input sm" id="recModel" aria-label="전사 모델" style="width:auto;max-width:100%" ${dis}>${models.list("transcription").map(m => `<option value="${esc(m.id)}" ${m.id === model ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select><button type="button" class="btn sm" id="recTranscribe" ${state.busy || !pendingAudio(state).length || !ready ? "disabled" : ""}>전사</button>${ready ? "" : '<span class="small muted">OpenAI API 키 없음</span><button type="button" class="linkbtn" data-study-settings>설정</button>'}</div>` : ""}
      <textarea class="input" id="recText" aria-label="문답" placeholder="문답을 붙여 넣으시오." ${dis}>${esc(state.text)}</textarea>
      <div class="row between">
        <div class="row"><button type="button" class="btn primary sm" id="recReview" ${canReview(cs) ? "" : "disabled"}>피드백 받기</button><span class="small muted">AI 면접관 · ${esc(ai.label)}</span>${ai.configured ? "" : '<span class="small muted">API 키 없음</span><button type="button" class="linkbtn" data-study-settings>설정</button>'}</div>
        <div class="row"><span class="small muted" data-copy-status="text"></span><button type="button" class="btn sm ghost" data-rec-copy="text" ${text}>복사</button><button type="button" class="btn sm ghost" data-rec-save="text" ${text}>내려받기</button></div>
      </div>
      <details class="promptview" id="recPrompt" ${state.promptOpen ? "open" : ""}><summary>AI 입력 보기 — ${cs.passages.length ? `제시문 ${cs.passages.length}편 전문 + 문답` : "문제 + 문답"}</summary><pre>${state.promptOpen ? recordingPrompt(cs) : ""}</pre></details>
      <div class="stack" id="recStatus" ${status ? "" : "hidden"}>${status}</div>`;
  }
  function recordingStatus(state) {
    return `${state.busy ? `<p class="study-status small muted">${esc(state.progress || "평가 중…")}</p>` : ""}${state.error ? `<div class="row"><p class="callout warn">${esc(state.error)}</p>${state.needsKey ? '<button type="button" class="btn sm" data-study-settings>설정</button>' : ""}</div>` : ""}${state.warn ? `<p class="callout warn">${esc(state.warn)}</p>` : ""}`;
  }
  /* 실제로 보낼 system/user. 서가 후보가 입력에 들어가므로 서가를 읽은 뒤에 보인다. */
  function recordingPrompt(cs) {
    const state = recState(cs);
    if (!state.books) return state.booksFailed ? "서가 자료를 읽지 못했다." : "서가 읽는 중…";
    const inp = AI.buildRecordingReviewInput(cs, state.text, state.books);
    return `<b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}`;
  }
  function recordingResults(cs) {
    const state = recState(cs), list = Study.reviewHistory(cs);
    if (!list.length) return "";
    return `<div class="row between"><span class="chip accent">AI 녹음본 피드백</span></div>${studyRuns(state, list, 'data-kind="recording"', run => recordingRun(cs, run, state))}`;
  }
  /* (i) 문제 분석 → (ii) 답변 평가(종합 → 문답별) → (iii) 개선 방안 → 고민해볼 추가질문(답변을 듣고 더 물을 수 있었던 질문) → (iv) 추천 도서 → 평가한 문답(전문) → 후속 질문. 도서 표시명·링크는 실제 서가 데이터에서. */
  function recordingRun(cs, run, state) {
    const d = run.data, shelf = state.books || [], byNo = (a, b) => a.no - b.no;
    const listOrNone = items => items.length ? studyList(items) : '<p class="small muted">없음</p>';
    const books = d.books.map(item => {
      const book = shelf.find(candidate => candidate.id === item.id);
      return book && Number.isInteger(book.id) ? `<li><a href="library.html#b${book.id}">${esc(book.title)}</a>${book.author ? ` · ${esc(book.author)}` : ""}<p class="study-text">${esc(item.reason)}</p></li>` : "";
    }).filter(Boolean);
    const located = new Set(run.spans.map(s => s.no)), missing = d.qa.filter(q => !located.has(q.no)).length;
    return `<section class="study-section"><h3 class="h3">문제 분석</h3><p class="study-text">${esc(d.analysis.overview)}</p>${d.analysis.passages.slice().sort(byNo).map(item => {
        const passage = cs.passages.find(p => p.no === item.no);
        return `<article class="study-passage"><h4>${esc(passage ? AI.passageHead(passage) : "제시문 " + item.no)}</h4><dl class="study-notes"><dt>요약</dt><dd class="study-text">${esc(item.summary)}</dd><dt>짚을 논점</dt><dd>${studyList(item.keyPoints)}</dd></dl></article>`;
      }).join("")}<article class="study-passage"><h4>문제의 요구</h4>${studyList(d.analysis.demands)}</article></section>
      <section class="study-section"><h3 class="h3">답변 평가</h3><p class="study-text">${esc(d.evaluation.summary)}</p><dl class="study-notes"><dt>잘한 점</dt><dd>${listOrNone(d.evaluation.strengths)}</dd><dt>부족한 점</dt><dd>${listOrNone(d.evaluation.gaps)}</dd></dl>
        <h4>문답별 평가${missing ? ` <span class="small muted">· 원문 위치 없음 ${missing}</span>` : ""}</h4><div class="folds">${d.qa.slice().sort(byNo).map(item => {
          const key = run.at + ":" + item.no, open = state.qaOpen.has(key);
          return `<details class="fold" data-rec-qa="${key}" ${open ? "open" : ""}><summary><span>Q${item.no}. ${esc(item.question)}</span></summary><div class="fold-b">${open ? qaBody(run, item) : ""}</div></details>`;
        }).join("")}</div></section>
      <section class="study-section"><h3 class="h3">개선 방안</h3><ol class="study-list">${d.improvements.map(item => `<li>${esc(item)}</li>`).join("")}</ol></section>
      ${d.probes.length ? `<section class="study-section"><h3 class="h3">고민해볼 추가질문</h3><ol class="study-list" data-rec-probes>${d.probes.map(item => `<li>${esc(item.question)}<p class="small muted">${esc(item.basis)}</p></li>`).join("")}</ol></section>` : ""}
      ${books.length ? `<section class="study-section"><h3 class="h3">추천 도서</h3><ul class="study-list study-books">${books.join("")}</ul></section>` : ""}
      <details class="fold" data-rec-full="${run.at}" ${state.fullOpen.has(run.at) ? "open" : ""}><summary>평가한 문답</summary><div class="fold-b">${state.fullOpen.has(run.at) ? fullBody(run) : ""}</div></details>
      <section class="study-section rec-ask"><h3 class="h3">후속 질문</h3><div class="stack" data-rec-thread="${run.at}">${askBody(cs, run)}</div></section>`;
  }
  /* 문답 하나: 원문 구간(평가의 from·to를 저장할 때 글자 위치로 바꾼 것) → AI가 정리한 답변 요지 → 평가 → 개선. */
  function qaBody(run, item) {
    const span = run.spans.find(s => s.no === item.no);
    return `<dl class="study-notes"><dt>원문</dt><dd>${span ? `<p class="study-text study-transcript">${esc(run.transcript.slice(span.start, span.end))}</p>` : '<p class="small muted">위치 없음</p>'}</dd><dt>답변 요지</dt><dd class="study-text">${esc(item.answer)}</dd><dt>평가</dt><dd class="study-text">${esc(item.evaluation)}</dd><dt>개선</dt><dd class="study-text">${esc(item.improvement)}</dd></dl>`;
  }
  /* 평가한 문답 전문을 구간으로 나눈다: 문답 구간은 Q 번호, 어느 문답에도 들지 않은 곳은 '문답 밖'(녹음 머리 줄만 있으면 머리 없이). */
  function transcriptParts(run) {
    const parts = [], text = run.transcript;
    let pos = 0;
    run.spans.slice().sort((a, b) => a.start - b.start).forEach(s => {
      if (s.start < pos) return;
      if (s.start > pos) parts.push({ label: null, text: text.slice(pos, s.start) });
      parts.push({ label: "Q" + s.no, text: text.slice(s.start, s.end) });
      pos = s.end;
    });
    if (pos < text.length) parts.push({ label: null, text: text.slice(pos) });
    const located = run.spans.length > 0;
    return parts.filter(p => p.text.trim()).map(p => ({ label: p.label || (located && p.text.trim().split("\n").some(line => line.trim() && !HEAD_LINE.test(line.trim())) ? "문답 밖" : ""), text: p.text.trim() }));
  }
  const fileText = f => `${f.name} · ${fmtSize(f.size)} · ${f.kind === "text" ? "문답" : "녹음" + (f.model ? " · " + f.model : "")}`;
  function fullBody(run) {
    return `${run.files.length ? `<p class="small muted">${esc(run.files.map(fileText).join(" / "))}</p>` : ""}<div class="study-transcript">${transcriptParts(run).map(p => `${p.label ? `<p class="small muted">${esc(p.label)}</p>` : ""}<p class="study-text">${esc(p.text)}</p>`).join("")}</div>
      <div class="row"><button type="button" class="btn sm ghost" data-rec-copy="${run.at}">복사</button><button type="button" class="btn sm ghost" data-rec-save="${run.at}">내려받기</button><span class="small muted" data-copy-status="${run.at}"></span></div>`;
  }
  /* 후속 질문 스레드. 답이 없는 질문이 끝에 남아 있고 새로 적은 질문이 없으면 버튼이 [다시 묻기]가 된다. 원문이 바뀐 결과에는 묻지 않는다. */
  function askBody(cs, run) {
    const ask = askState(cs, run.at), ai = AI.resolve(sessionAi()), last = run.thread[run.thread.length - 1], pending = !!last && last.role === "user";
    const msgs = run.thread.map(m => m.role === "user"
      ? `<div class="msg user"><div class="who">나</div><div class="study-text">${esc(m.text)}</div></div>`
      : `<div class="msg ai"><div class="who">면접관 · ${esc(m.model || "AI")}</div><div class="study-text">${esc(m.text)}</div></div>`).join("");
    if (run.stale) return `${msgs}<p class="small muted">이전 원문: 후속 질문 없음</p>`;
    const dis = ask.busy ? "disabled" : "";
    return `${msgs}
      <textarea class="input" id="rq-${run.at}" aria-label="후속 질문" placeholder="피드백에 대해 묻거나 반박하시오." ${dis}>${esc(ask.draft)}</textarea>
      <div class="row between">
        <div class="row"><button type="button" class="btn primary sm" data-rec-ask="${run.at}" data-pending="${pending}" ${ask.busy || !ai.configured ? "disabled" : ""}>${pending && !ask.draft.trim() ? "다시 묻기" : "질문하기"}</button>${run.thread.length ? `<button type="button" class="btn sm ghost" data-rec-ask-clear="${run.at}" ${dis}>후속 질문 지우기</button>` : ""}${ai.configured ? "" : '<span class="small muted">API 키 없음</span><button type="button" class="linkbtn" data-study-settings>설정</button>'}</div>
        <details class="promptview" data-rec-ask-prompt="${run.at}" ${ask.promptOpen ? "open" : ""}><summary>AI 입력 보기</summary><pre>${ask.promptOpen ? askPrompt(cs, run) : ""}</pre></details>
      </div>
      ${ask.busy ? '<p class="study-status small muted">답변 중…</p>' : ""}${ask.error ? `<p class="callout warn">${esc(ask.error)}</p>` : ""}${ask.warn ? `<p class="callout warn">${esc(ask.warn)}</p>` : ""}`;
  }
  function askPrompt(cs, run) {
    const state = recState(cs), ask = askState(cs, run.at), last = run.thread[run.thread.length - 1];
    if (!state.books) return state.booksFailed ? "서가 자료를 읽지 못했다." : "서가 읽는 중…";
    const draft = ask.draft.trim(), thread = draft ? run.thread.concat([{ role: "user", text: draft, at: 0 }]) : last && last.role === "user" ? run.thread : run.thread.concat([{ role: "user", text: "(지금 적는 질문이 여기에 들어간다)", at: 0 }]);
    const inp = AI.buildRecordingFollowupInput(cs, Object.assign({}, run, { thread }), state.books);
    return `<b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}`;
  }
  /* ---- 다시 그리기 ---- */
  /* 다시 그리기 전후로 초점(입력 칸은 커서까지)을 지킨다. 원래 요소가 숨거나 비활성이면 대신할 요소로 옮긴다. */
  function focusKeep(container) {
    const active = document.activeElement;
    if (active && container.contains(active)) return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
    return active === document.body ? { id: "" } : null;
  }
  function focusBack(keep, fallbacks) {
    if (!keep) return;
    const usable = el => !!el && !el.disabled && !el.hidden && el.offsetParent !== null;
    let target = keep.id ? document.getElementById(keep.id) : null;
    if (!usable(target)) target = fallbacks.map(id => document.getElementById(id)).find(usable) || null;
    if (!target) return;
    target.focus({ preventScroll: true });
    if (target.id === keep.id && target.tagName === "TEXTAREA" && Number.isInteger(keep.start)) target.setSelectionRange(keep.start, keep.end);
  }
  /* 화면 낭독기에는 진행·오류 한 줄만 알린다(패널 전체를 읽지 않게). */
  function announce(text) { const live = $("#recLive"); if (live && text && live.textContent !== text) live.textContent = text; }
  function updateRecordingForm(cs, focusId) {
    if (!studyIsCurrent(cs)) return;
    const state = recState(cs), panel = $("#recordingPanel"), button = $("#recordingFeedback"), form = $("#recForm");
    if (button) button.setAttribute("aria-expanded", state.open);
    if (panel) panel.hidden = !state.open;
    if (!form) return;
    const keep = focusKeep(form);
    form.innerHTML = recordingForm(cs); form.setAttribute("aria-busy", state.busy);
    if (state.open) focusBack(keep, focusId ? [focusId, "recReview", "recText", "recPick"] : []);
    announce(state.busy ? state.progress || "평가 중…" : state.error);
  }
  function setRecordingStatus(cs) {
    if (!studyIsCurrent(cs)) return;
    const state = recState(cs), box = $("#recStatus"), html = recordingStatus(state);
    if (box) { box.innerHTML = html; box.hidden = !html; }
    announce(state.busy ? state.progress || "평가 중…" : state.error);
  }
  function updateRecordingResults(cs) {
    if (!studyIsCurrent(cs)) return;
    const box = $("#recResults"), html = recordingResults(cs);
    if (!box) return;
    const keep = focusKeep(box);
    box.innerHTML = html; box.hidden = !html;
    focusBack(keep, []);
    syncRunDeletes(cs);
    fillRecordingPrompt(cs);
  }
  function updateRecordingThread(cs, at) {
    if (!studyIsCurrent(cs)) return;
    const box = app.querySelector(`[data-rec-thread="${at}"]`), run = findRun(cs, at);
    if (!box || !run) { updateRecordingResults(cs); return; }
    const keep = focusKeep(box), ask = askState(cs, at);
    box.innerHTML = askBody(cs, run);
    focusBack(keep, ["rq-" + at]);
    syncRunDeletes(cs);
    announce(ask.busy ? "답변 중…" : ask.error);
  }
  /* 답을 기다리는 결과는 지우지 못하게 한다(SNU.runs가 그린 [삭제]를 끈다). */
  function syncRunDeletes(cs) {
    $$('#recResults [data-run-del][data-kind="recording"]', app).forEach(button => { const ask = recState(cs).asks.get(Number(button.dataset.runDel)); button.disabled = !!(ask && ask.busy); });
  }
  function fillRecordingPrompt(cs) {
    if (!studyIsCurrent(cs) || !recState(cs).promptOpen) return;
    const pre = $("#recPrompt pre");
    if (pre) pre.innerHTML = recordingPrompt(cs);
  }
  /* 펼칠 때만 채우는 블록: 문답별 본문, 평가한 문답 전문, 후속 질문의 입력 보기. */
  function fillLazy(cs, details) {
    if (!details.open) return;
    const body = details.querySelector(":scope > .fold-b, :scope > pre");
    if (details.matches("[data-rec-qa]")) {
      const [at, no] = details.dataset.recQa.split(":").map(Number), run = findRun(cs, at), item = run && run.data.qa.find(q => q.no === no);
      if (body && item) body.innerHTML = qaBody(run, item);
    } else if (details.matches("[data-rec-full]")) {
      const run = findRun(cs, Number(details.dataset.recFull));
      if (body && run) body.innerHTML = fullBody(run);
    } else if (details.matches("[data-rec-ask-prompt]")) {
      const run = findRun(cs, Number(details.dataset.recAskPrompt));
      if (body && run) body.innerHTML = askPrompt(cs, run);
    }
  }
  /* 문답 칸을 고칠 때: 칸은 그대로 두고 버튼 상태와 열린 입력 보기만 맞춘다. */
  let recPromptTimer = 0;
  function syncRecording(cs) {
    const state = recState(cs), review = $("#recReview"), clear = $("#recClear");
    if (review) review.disabled = !canReview(cs);
    if (clear) clear.hidden = !(state.files.length || state.text);
    $$('[data-rec-copy="text"], [data-rec-save="text"]', app).forEach(button => { button.disabled = !state.text.trim(); });
    clearTimeout(recPromptTimer);
    if (state.promptOpen) recPromptTimer = setTimeout(() => fillRecordingPrompt(cs), 200);
  }
  let askPromptTimer = 0;
  function syncAsk(cs, at) {
    const ask = askState(cs, at), button = app.querySelector(`[data-rec-ask="${at}"]`);
    if (button) button.textContent = button.dataset.pending === "true" && !ask.draft.trim() ? "다시 묻기" : "질문하기";
    clearTimeout(askPromptTimer);
    if (ask.promptOpen) askPromptTimer = setTimeout(() => { const d = app.querySelector(`[data-rec-ask-prompt="${at}"]`); if (d && studyIsCurrent(cs)) fillLazy(cs, d); }, 200);
  }
  function loadRecordingBooks(cs) {
    const state = recState(cs);
    if (state.books || state.booksLoading) return;
    state.booksLoading = true; state.booksFailed = false;
    Study.loadBooks().then(books => { state.books = books; }).catch(() => { state.booksFailed = true; }).finally(() => { state.booksLoading = false; updateRecordingResults(cs); });
  }
  /* ---- 첨부·전사 ---- */
  function appendRecordingText(state, text) { state.text = state.text.trim() ? state.text.replace(/\s+$/, "") + "\n\n" + text : text; }
  function readRecordingText(cs) { const ta = $("#recText"); if (ta && studyIsCurrent(cs) && !ta.disabled) recState(cs).text = ta.value; }
  /* 문답 텍스트는 바로 읽어 문답 칸에 붙이고, 녹음은 목록에만 올린다(보내지 않는다). 읽는 동안은 폼을 잠근다. 형식·크기가 맞지 않는 파일은 한 줄 오류. */
  async function attachFiles(cs, picked) {
    const state = recState(cs);
    if (state.busy || !picked.length) return;
    readRecordingText(cs);
    const problems = [], limit = AI.RECORDING_LIMITS, reading = picked.some(file => Study.fileKind(file.name) === "text");
    if (reading) { state.busy = true; state.progress = "읽는 중…"; updateRecordingForm(cs); }
    try {
      for (const file of picked.slice().sort(Study.byName)) {
        const kind = Study.fileKind(file.name);
        if (!kind) { problems.push("지원하지 않는 형식: " + file.name); continue; }
        if (!(file.size > 0)) { problems.push("빈 파일: " + file.name); continue; }
        if (file.size > (kind === "audio" ? limit.audioBytes : Study.TEXT_BYTES)) { problems.push(`${kind === "audio" ? limit.audioBytes / 1048576 : Study.TEXT_BYTES / 1048576}MB 초과: ${file.name}`); continue; }
        const same = state.files.find(f => f.kind === kind && f.name === file.name && f.size === file.size);
        if (kind === "audio") {   // 같은 녹음을 다시 고르면 새 파일로 바꾸고 전사할 대상으로 되돌린다
          if (same) Object.assign(same, { file, done: false, model: "" });
          else state.files.push({ name: file.name, size: file.size, kind, file, done: false, model: "" });
          continue;
        }
        try {
          const text = Study.readTranscriptText(await file.arrayBuffer());
          if (!text) { problems.push("빈 파일: " + file.name); continue; }
          appendRecordingText(state, text);
          if (!same) state.files.push({ name: file.name, size: file.size, kind, file: null, done: true });
        } catch (_) { problems.push("읽지 못한 파일: " + file.name); }
      }
    } finally {
      state.busy = false; state.progress = ""; state.error = problems.join(" · "); state.needsKey = false;
      updateRecordingForm(cs, "recPick");
    }
  }
  function removeAttachment(cs, index) {
    const state = recState(cs), item = state.files[index];
    if (state.busy || !item || item.kind !== "audio" || item.done) return;
    readRecordingText(cs);
    state.files.splice(index, 1);
    updateRecordingForm(cs, "recPick");
  }
  function clearRecording(cs) {
    const state = recState(cs);
    if (state.busy) return;
    readRecordingText(cs);
    if (state.text.trim() && !confirm("첨부와 문답을 비울까?")) return;
    state.files = []; state.text = ""; state.count = 0; state.error = ""; state.needsKey = false;
    updateRecordingForm(cs, "recPick");
  }
  /* 전사하지 않은 녹음을 파일 이름 자연 정렬 순서로 전사해 문답 칸에 붙인다. 중간에 실패하면 끝난 것까지는 남기고 멈춘다(다시 누르면 남은 것부터). */
  async function transcribePending(cs, state) {
    const pending = pendingAudio(state).sort(Study.byName), model = AI.transcriptionModel();
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      state.progress = `전사 중… ${i + 1}/${pending.length}`; setRecordingStatus(cs);
      let text;
      try { text = await AI.transcribe(item.file, cs, model); }
      catch (error) { throw Object.assign(new Error(`전사 실패(${item.name}): ${error.message}`), { needsKey: !openaiReady() }); }
      appendRecordingText(state, Study.recordingHead(++state.count, item.name) + "\n" + text);
      Object.assign(item, { done: true, file: null, model: transcriptionLabel(model) });   // 녹음은 전사 뒤 버린다
    }
  }
  async function transcribeRecording(cs) {
    const state = recState(cs);
    if (state.busy || !pendingAudio(state).length) return;
    readRecordingText(cs);
    state.busy = true; state.error = ""; state.needsKey = false; state.progress = "";
    updateRecordingForm(cs);
    try { await transcribePending(cs, state); }
    catch (error) { state.error = error.message; state.needsKey = !!error.needsKey; }
    finally { state.busy = false; state.progress = ""; updateRecordingForm(cs, pendingAudio(state).length && openaiReady() ? "recTranscribe" : canReview(cs) ? "recReview" : "recText"); }
  }
  /* 요청 중 다른 세트로 옮겨도 전사·결과는 요청한 세트·복기본에만 남는다. 실패해도 문답 칸과 첨부는 그대로다.
     이미 한도를 넘은 문답은 녹음을 보내기 전에 멈춘다(전사를 붙여도 줄지 않는다). */
  async function requestRecordingReview(cs) {
    const state = recState(cs);
    if (state.busy) return;
    readRecordingText(cs);
    if (!canReview(cs)) return;
    if (state.text.trim().length > AI.RECORDING_LIMITS.transcript) { state.error = `문답이 ${AI.RECORDING_LIMITS.transcript / 10000}만 자를 넘는다.`; state.needsKey = false; updateRecordingForm(cs, "recReview"); return; }
    const resolved = AI.resolve(sessionAi()), ai = { provider: resolved.provider, model: resolved.model, effort: resolved.effort };
    const before = Study.reviewHistory(cs);
    state.busy = true; state.error = ""; state.needsKey = false; state.progress = "";
    updateRecordingForm(cs);
    let done = false;
    try {
      if (pendingAudio(state).length) await transcribePending(cs, state);
      state.progress = "평가 중…"; setRecordingStatus(cs);
      const result = await Study.reviewRecording(cs, state.text, state.files, ai);
      state.books = result.books; openNewRun(state, before, result.at); state.warn = Study.saved() ? "" : SAVE_WARN; done = true;
    } catch (error) {
      if (error.needsKey !== undefined) { state.error = error.message; state.needsKey = error.needsKey; }   // 전사 단계의 오류
      else { state.needsKey = !resolved.configured; state.error = state.needsKey ? "API 키 없음" : "피드백 생성 실패: " + error.message; }
    } finally {
      state.busy = false; state.progress = "";
      updateRecordingForm(cs, "recReview");
      if (done) { updateRecordingResults(cs); announce("피드백 받음"); }
    }
  }
  /* ---- 후속 질문 ---- */
  /* 질문을 먼저 저장하고(실패해도 남는다) 답을 기다린다. 기다리는 동안 다른 세트로 옮겨도 답은 그 결과에만 붙는다. */
  async function askRecording(cs, at) {
    const ask = askState(cs, at);
    if (ask.busy) return;
    const run = findRun(cs, at);
    if (!run || run.stale) return;
    const ta = document.getElementById("rq-" + at), draft = (ta ? ta.value : ask.draft).trim(), last = run.thread[run.thread.length - 1];
    const resolved = AI.resolve(sessionAi()), ai = { provider: resolved.provider, model: resolved.model, effort: resolved.effort };
    ask.error = "";
    if (draft) {
      try { Study.addReviewQuestion(cs, at, draft); ask.draft = ""; }
      catch (error) { ask.draft = draft; ask.error = error.message; updateRecordingThread(cs, at); return; }
    } else if (!(last && last.role === "user")) { ask.error = "질문이 비어 있다."; updateRecordingThread(cs, at); return; }
    ask.busy = true; ask.warn = Study.saved() ? "" : SAVE_WARN;
    updateRecordingThread(cs, at);
    try { const result = await Study.answerReviewQuestion(cs, at, ai); if (result && result.dropped) ask.error = "질문이 지워져 답을 버렸다."; ask.warn = Study.saved() ? "" : SAVE_WARN; }
    catch (error) { ask.error = resolved.configured ? "AI 호출 실패: " + error.message : "API 키 없음"; }
    finally { ask.busy = false; updateRecordingThread(cs, at); }
  }
  function clearAsk(cs, at) {
    const ask = askState(cs, at);
    if (ask.busy || !confirm("후속 질문을 지울까?")) return;
    ask.warn = Study.clearReviewThread(cs, at) ? "" : SAVE_WARN; ask.error = "";
    updateRecordingThread(cs, at);
  }
  /* ---- 복사·내려받기(브라우저 안에서만) ---- */
  const stamp = t => { const d = new Date(t), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const fileBase = cs => `${cs.id}_${cs.variant || "default"}`;
  function runMarkdown(cs, run) {
    const d = run.data, byNo = (a, b) => a.no - b.no, shelf = recState(cs).books || [], quote = text => text.split("\n").map(line => "> " + line).join("\n");
    const bullets = items => items.length ? items.map(x => "- " + x).join("\n") : "- 없음";
    const out = [`# ${db.label(cs)} 녹음본 피드백`, "", `- 복기본: ${cs.variantLabel}`, `- 평가: ${run.model} · ${models.effortLabel(run.effort)} · ${new Date(run.at).toLocaleString("ko-KR")}`];
    if (run.files.length) out.push(`- 파일: ${run.files.map(fileText).join(" / ")}`);
    out.push("", "## 문제 분석", "", d.analysis.overview, "", ...d.analysis.passages.slice().sort(byNo).flatMap(p => { const passage = cs.passages.find(x => x.no === p.no); return [`### ${passage ? AI.passageHead(passage) : "제시문 " + p.no}`, "", p.summary, "", bullets(p.keyPoints), ""]; }), "### 문제의 요구", "", bullets(d.analysis.demands));
    out.push("", "## 답변 평가", "", d.evaluation.summary, "", "### 잘한 점", "", bullets(d.evaluation.strengths), "", "### 부족한 점", "", bullets(d.evaluation.gaps));
    d.qa.slice().sort(byNo).forEach(q => { const span = run.spans.find(s => s.no === q.no); out.push("", `### Q${q.no}. ${q.question}`, "", span ? quote(run.transcript.slice(span.start, span.end)) : "> (원문 위치 없음)", "", `- 답변 요지: ${q.answer}`, `- 평가: ${q.evaluation}`, `- 개선: ${q.improvement}`); });
    out.push("", "## 개선 방안", "", d.improvements.map((x, i) => `${i + 1}. ${x}`).join("\n"));
    if (d.probes.length) out.push("", "## 고민해볼 추가질문", "", d.probes.map((p, i) => `${i + 1}. ${p.question}\n   - ${p.basis}`).join("\n"));
    if (d.books.length) out.push("", "## 추천 도서", "", d.books.map(b => { const book = shelf.find(x => x.id === b.id); return `- ${book ? `${book.title} · ${book.author}` : "서가 " + b.id}: ${b.reason}`; }).join("\n"));
    out.push("", "## 평가한 문답", "", run.transcript);
    if (run.thread.length) out.push("", "## 후속 질문", "", run.thread.map(m => `${m.role === "user" ? "나" : "면접관 · " + (m.model || "AI")}: ${m.text}`).join("\n\n"));
    return out.join("\n") + "\n";
  }
  async function copyText(text) {
    try { if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* 아래 방식으로 */ }
    const active = document.activeElement, ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "0";
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
    ta.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    return ok;
  }
  function downloadText(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement("a");
    a.href = url; a.download = name; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function copyStatus(key, text) {
    const el = app.querySelector(`[data-copy-status="${key}"]`);
    if (!el) return;
    el.textContent = text; announce(text);
    clearTimeout(el.timer); el.timer = setTimeout(() => { el.textContent = ""; }, 2000);
  }
  async function copyRecording(cs, key) {
    if (key === "text") readRecordingText(cs);
    const run = key === "text" ? null : findRun(cs, Number(key)), text = key === "text" ? recState(cs).text : run && run.transcript;
    if (!text) return;
    copyStatus(key, await copyText(text) ? "복사함" : "복사 실패");
  }
  function saveRecording(cs, key) {
    if (key === "text") { readRecordingText(cs); const text = recState(cs).text; if (text.trim()) downloadText(`${fileBase(cs)}_transcript_${stamp(Date.now())}.txt`, text, "text/plain;charset=utf-8"); return; }
    const run = findRun(cs, Number(key));
    if (run) downloadText(`${fileBase(cs)}_feedback_${stamp(run.at)}.md`, runMarkdown(cs, run), "text/markdown;charset=utf-8");
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
    if (t.closest("#recordingFeedback")) { const state = recState(cs); state.open = !state.open; updateRecordingForm(cs); if (state.open) loadRecordingBooks(cs); return; }
    if (t.closest("#recPick")) { const input = $("#recFiles", app); if (input) input.click(); return; }
    if (t.closest("#recClear")) { clearRecording(cs); return; }
    if (t.closest("#recTranscribe")) { await transcribeRecording(cs); return; }
    if (t.closest("#recReview")) { await requestRecordingReview(cs); return; }
    const recRemove = t.closest("[data-rec-remove]"); if (recRemove) { removeAttachment(cs, Number(recRemove.dataset.recRemove)); return; }
    const recCopy = t.closest("[data-rec-copy]"); if (recCopy) { await copyRecording(cs, recCopy.dataset.recCopy); return; }
    const recSave = t.closest("[data-rec-save]"); if (recSave) { saveRecording(cs, recSave.dataset.recSave); return; }
    const recAsk = t.closest("[data-rec-ask]"); if (recAsk) { await askRecording(cs, Number(recAsk.dataset.recAsk)); return; }
    const recAskClear = t.closest("[data-rec-ask-clear]"); if (recAskClear) { clearAsk(cs, Number(recAskClear.dataset.recAskClear)); return; }
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
    if (!run.matches) return;
    const cs = set();
    /* 녹음본 피드백의 안쪽 접힘(입력 보기·문답별·전문·후속 질문 입력 보기)을 결과 블록보다 먼저 가린다. 펼칠 때 내용을 채운다. */
    if (run.matches("#recPrompt")) { recState(cs).promptOpen = run.open; fillRecordingPrompt(cs); return; }
    if (run.matches("details[data-rec-qa]")) { const open = recState(cs).qaOpen; if (run.open) open.add(run.dataset.recQa); else open.delete(run.dataset.recQa); fillLazy(cs, run); return; }
    if (run.matches("details[data-rec-full]")) { const open = recState(cs).fullOpen, at = Number(run.dataset.recFull); if (run.open) open.add(at); else open.delete(at); fillLazy(cs, run); return; }
    if (run.matches("details[data-rec-ask-prompt]")) { askState(cs, Number(run.dataset.recAskPrompt)).promptOpen = run.open; fillLazy(cs, run); return; }
    if (!run.matches("details[data-run]")) return;
    const state = run.dataset.kind === "example" ? exampleState(cs, run.dataset.key) : run.dataset.kind === "recording" ? recState(cs) : studyState(cs).explanation;
    if (!state.runs) state.runs = new Set();
    if (run.open) state.runs.add(Number(run.dataset.run)); else state.runs.delete(Number(run.dataset.run));
  }, true);
  /* 녹음본 피드백: 파일 선택·전사 모델(change), 문답 칸(input). 문답 칸의 글은 상태에 두어 다시 그려도 남는다. */
  app.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "recFiles") { const picked = Array.from(t.files || []); t.value = ""; attachFiles(set(), picked); }
    else if (t.id === "recModel") saveView({ transcriptionModel: t.value }, "recModel");
  });
  app.addEventListener("input", e => {
    const t = e.target, cs = set();
    if (t.id === "recText") { recState(cs).text = t.value; syncRecording(cs); return; }
    if (/^rq-\d+$/.test(t.id)) { const at = Number(t.id.slice(3)); askState(cs, at).draft = t.value; syncAsk(cs, at); }
  });
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
