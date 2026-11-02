/* ============================================================
   모의면접 — 세션 실행기
   설정 단계: ① 세트(학교 토글 → 세트) → ② 모드 → ③ 옵션 + 시작
   진행 단계: 준비(prep: 제시문 공개·메모) → 대기(wait, 선택: 제시문 없이 메모만) → 면접(interview) → 종료(done)
   모드: timed 1-A 면접시간 AI 면접관 / endless 1-B 무한시간 AI 면접관 / all 2 무한시간 모든 질문 답변
   답변: 음성(MediaRecorder 녹음 → IndexedDB, 전사는 브라우저 음성 인식 또는 직접 입력) 또는 텍스트 입력.
   AI: assets/ai.js. 제공사·모델은 옵션 창에서 고르고(기본값은 설정), 키가 없으면 복기 질문 은행(변형 없음)으로 대체한다.
   ============================================================ */
(function () {
  "use strict";
  const { $, $$, esc, save, fmtClock, timeline, db, models } = window.SNU;
  const S = () => window.SNU.settings;
  const D = window.INTERVIEW_DB;
  const AI = window.AIClient;
  const app = $("#app");

  const MODES = {
    timed:   { code: "1-A", label: "면접시간 AI 면접관", desc: "면접 시간 안에서 AI 면접관이 답변을 듣고 꼬리질문을 낸다. 종료 1분 전 노크.", feats: ["시간 제한", "AI 꼬리질문", "난이도·변형도"], ai: true, timed: true },
    endless: { code: "1-B", label: "무한시간 AI 면접관", desc: "시간 제한 없이 AI 면접관과 이어 간다.", feats: ["제한 없음", "AI 꼬리질문", "난이도·변형도"], ai: true, timed: false },
    all:     { code: "2",   label: "무한시간 모든 질문 답변", desc: "복기된 추가질문을 학생별 순서로 전부 답한다.", feats: ["제한 없음", "복기 질문 전체", "AI 없음"], ai: false, timed: false }
  };

  /* ---------------- IndexedDB: 녹음 보관 ---------------- */
  const DBN = "snu-interview", STORE = "recordings";
  function openDb() {
    return new Promise((res, rej) => {
      if (!("indexedDB" in window)) return rej(new Error("IndexedDB 없음"));
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error);
    });
  }
  async function dbTx(mode, fn) { const d = await openDb(); return new Promise((res, rej) => { const tx = d.transaction(STORE, mode); const o = tx.objectStore(STORE); const out = fn(o); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out); tx.onerror = () => rej(tx.error); }); }
  const dbPut = rec => dbTx("readwrite", o => o.put(rec));
  const dbDel = id => dbTx("readwrite", o => o.delete(id));
  async function dbAll() { try { const d = await openDb(); return await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); } catch (e) { return []; } }

  /* ---------------- 녹음기 ---------------- */
  const recorder = {
    stream: null, mr: null, chunks: [], ctx: null, analyser: null, mime: "", startedAt: 0, raf: 0,
    async init() {
      if (this.stream) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("이 브라우저에서는 마이크를 쓸 수 없다(https 또는 로컬 파일로 연 Chrome·Safari 필요).");
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { this.ctx = new AC(); const src = this.ctx.createMediaStreamSource(this.stream); this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; src.connect(this.analyser); }
      this.mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    },
    start(onLevel) {
      this.chunks = [];
      this.mr = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
      this.mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.mr.start(250); this.startedAt = Date.now();
      if (this.analyser && onLevel) {
        const buf = new Uint8Array(this.analyser.frequencyBinCount);
        const loop = () => { this.analyser.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; } onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4)); this.raf = requestAnimationFrame(loop); };
        this.raf = requestAnimationFrame(loop);
      }
    },
    stop() {
      return new Promise(res => {
        cancelAnimationFrame(this.raf);
        if (!this.mr || this.mr.state === "inactive") return res(null);
        const mime = this.mr.mimeType || this.mime || "audio/webm";
        this.mr.onstop = () => res({ blob: new Blob(this.chunks, { type: mime }), mime, duration: (Date.now() - this.startedAt) / 1000 });
        this.mr.stop();
      });
    },
    release() { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); this.stream = null; if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; } }
  };
  const extOf = mime => mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";

  /* ---------------- 전사(STT): 브라우저 음성 인식 ---------------- */
  const stt = {
    rec: null, final: "", interim: "", active: false,
    get available() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    start(onUpdate) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return false;
      this.final = ""; this.interim = ""; this.active = true;
      const r = new SR(); r.lang = "ko-KR"; r.continuous = true; r.interimResults = true;
      r.onresult = e => { let fin = "", int = ""; for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + " "; else int += t; } this.final = fin; this.interim = int; onUpdate(this.final, this.interim); };
      r.onend = () => { if (this.active) { try { r.start(); } catch (e) {} } };
      r.onerror = () => {};
      try { r.start(); } catch (e) { return false; }
      this.rec = r; return true;
    },
    stop() { this.active = false; if (this.rec) { try { this.rec.stop(); } catch (e) {} } this.rec = null; return (this.final + " " + this.interim).trim(); }
  };
  function speak(text) {
    if (!S().tts || !("speechSynthesis" in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/<제시문 (\d)>/g, "제시문 $1")); u.lang = "ko-KR"; u.rate = 0.95; speechSynthesis.speak(u); } catch (e) {}
  }

  /* ---------------- 효과음: 노크·신호음 ---------------- */
  let actx = null;
  function audioCtx() { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; if (!actx) actx = new AC(); if (actx.state === "suspended") actx.resume(); return actx; }
  function knockSound() {
    const c = audioCtx(); if (!c) return;
    [0, 0.22].forEach(t => { const o = c.createOscillator(), g = c.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(180, c.currentTime + t); o.frequency.exponentialRampToValueAtTime(70, c.currentTime + t + 0.12); g.gain.setValueAtTime(0.0001, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.5, c.currentTime + t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t + 0.16); o.connect(g).connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.2); });
  }
  function beep(n) {
    const c = audioCtx(); if (!c) return;
    for (let i = 0; i < (n || 1); i++) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.3); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + i * 0.3 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.3 + 0.22); o.connect(g).connect(c.destination); o.start(c.currentTime + i * 0.3); o.stop(c.currentTime + i * 0.3 + 0.25); }
  }

  /* ---------------- 상태 ---------------- */
  const params = new URLSearchParams(location.search);
  const st = {
    step: 1, schoolId: "snu", setId: "", mode: S().lastMode || "timed",
    ai: { provider: S().provider, model: "" },        // 이번 세션의 AI(빈 모델 = 설정 기본값)
    variant: "",                                      // 세션 중 고정되는 복기본. 설정 단계에서는 빈 값(설정·URL을 따른다)
    promptOpen: false,
    phase: "setup", plan: { prep: 20, wait: 5, interview: 15 }, answerMode: "voice",
    sessionId: "", phaseEnd: 0, phaseStart: 0, tick: 0,
    queue: [], qi: 0, cur: null, history: [], recordings: [],
    recording: false, answered: false, transcript: "", interim: "", thinking: false, aiNote: "",
    memo: "", tab: "interview", knocked: false, treeNode: null, pendingBranches: null, err: "", lastAnswer: null
  };
  {
    const want = params.get("set") || S().lastSet;
    const found = db.set(want) || db.set("snu-" + want);
    const cs = found || db.school("snu").sets[0];
    st.setId = cs.id; st.schoolId = cs.school;
    if (params.get("school") && db.school(params.get("school"))) st.schoolId = params.get("school");
    if (params.get("set") && found) st.step = 2;
    if (!MODES[st.mode]) st.mode = "timed";
  }
  const set = () => db.set(st.setId, st.variant || undefined);
  const mode = () => MODES[st.mode];
  const school = () => db.school(st.schoolId);
  let wakeLock = null;
  async function keepAwake() { try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {} }
  window.addEventListener("beforeunload", e => { if (st.phase !== "setup" && st.phase !== "done") { e.preventDefault(); e.returnValue = ""; } });

  /* ---------------- 화면: 설정(세 단계) ---------------- */
  function stepCls(n) { return st.step === n ? "active" : st.step > n ? "done" : "todo"; }
  function stepHead(n, title, summary) {
    const done = st.step > n;
    return `<div class="step-n" aria-hidden="true">${n}</div><div class="step-h"><h2>${title}</h2>${done ? `<span class="sum">${summary}</span><button type="button" class="btn ghost sm chg" data-goto="${n}">바꾸기</button>` : ""}</div>`;
  }
  function renderSetup() {
    const cs = set(), m = mode(), sc = school();
    app.innerHTML = `
      <section class="sec" style="gap:6px">
        <div class="eyebrow">모의면접</div>
        <h1 class="h1">세트 → 모드 → 옵션 → 시작</h1>
      </section>

      <div class="stepper">
        <section class="step ${stepCls(1)}" id="step1">
          ${stepHead(1, "세트", cs ? `${esc(db.label(cs))} · ${esc(cs.session)}` : "")}
          ${st.step === 1 ? `<div class="step-b">${schoolTabs()}${setList()}</div>` : ""}
        </section>
        <section class="step ${stepCls(2)}" id="step2">
          ${stepHead(2, "모드", `${m.code} ${esc(m.label)}`)}
          ${st.step === 2 ? `<div class="step-b"><div class="modes" id="modePick">${Object.entries(MODES).map(([k, v]) => `<button type="button" class="mode" data-mode="${k}" aria-pressed="${k === st.mode}"><span class="code">${v.code}</span><span class="t">${esc(v.label)}</span><span class="d">${esc(v.desc)}</span><span class="f">${v.feats.map(f => `<span>${esc(f)}</span>`).join("")}</span></button>`).join("")}</div></div>` : ""}
        </section>
        <section class="step ${stepCls(3)}" id="step3">
          ${stepHead(3, "옵션과 시작", "")}
          ${st.step === 3 ? `<div class="step-b">${optionsPanel()}</div>` : ""}
        </section>
      </div>

      <section class="sec">
        <div class="sec-head"><h2 class="h2">녹음 보관함</h2></div>
        <div class="reclist" id="vault"><p class="small muted">불러오는 중…</p></div>
      </section>`;
    bindOptions();
    renderVault($("#vault"));
  }
  function schoolTabs() {
    return `<div class="schooltabs" role="group" aria-label="학교" id="schoolTabs">${db.schools().map(s => `<button type="button" data-school="${s.id}" aria-pressed="${s.id === st.schoolId}" class="${s.id === "snu" ? "main" : ""} ${s.sets.length ? "" : "empty"}">${esc(s.short)}${s.sets.length ? `<span class="n">${s.sets.length}</span>` : ""}</button>`).join("")}</div>`;
  }
  function setList() {
    const sc = school();
    if (!sc.sets.length) return `<div class="empty-school"><b>${esc(sc.name)} — 복기 추가 예정</b><span>data/questions.js의 schools[].sets에 같은 구조로 추가한다.</span></div>`;
    return `<div class="setrows" id="setPick">${sc.sets.map(x => `<button type="button" class="setrow" data-set="${x.id}" aria-pressed="${x.id === st.setId}">
        <span class="yr">${x.year}<small>${esc(x.track)}</small></span>
        <span><span class="nm">${esc(x.name)} · ${esc(x.session)}</span><br><span class="th">${esc(x.themes.join(" · "))}</span></span>
        <span class="mt"><span>제시문 ${x.passages.length}</span><span>복기 질문 ${db.count(x)}</span><span>${x.variantKeys.map(k => db.variantLabel(k)).join("·")}</span>${db.treeUsable(x) ? "<span>결정 트리</span>" : ""}</span></button>`).join("")}</div>`;
  }
  function levelSeg(key) {
    const s = S(), lv = D.levels[key];
    return `<div class="seg" data-seg="${key}">${Object.entries(lv).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${s[key] === k}" title="${esc(v.desc)}">${v.label}</button>`).join("")}</div><span class="help">${esc(lv[s[key]].desc)}</span>`;
  }
  function optionsPanel() {
    const s = S(), m = mode(), cs = set(), sc = school();
    const ai = AI.resolve(sessionAi());
    const plan = planFromSettings();
    const voice = s.answerMode === "voice";
    const preview = /claude\.ai$/.test(location.hostname);
    return `
      <div class="opts">
        <div class="opt-group">
          <div class="opt-title">답변</div>
          <div class="field"><span class="lab">답변 방식</span><div class="seg" data-seg="answerMode"><button type="button" data-v="voice" aria-pressed="${voice}">음성</button><button type="button" data-v="text" aria-pressed="${!voice}">텍스트</button></div></div>
          ${voice ? `<div class="field"><span class="lab">전사</span><div class="seg" data-seg="stt"><button type="button" data-v="webspeech" aria-pressed="${s.stt === "webspeech"}">브라우저 음성 인식</button><button type="button" data-v="manual" aria-pressed="${s.stt === "manual"}">직접 입력</button></div>${s.stt === "webspeech" && !stt.available ? `<span class="help">이 브라우저는 음성 인식을 지원하지 않아 직접 입력으로 진행된다.</span>` : ""}</div>` : ""}
          <label class="switch"><input type="checkbox" data-bool="tts" ${s.tts ? "checked" : ""}><span>질문 음성 읽기</span></label>
        </div>

        <div class="opt-group">
          <div class="opt-title">복기본</div>
          <div class="field"><span class="lab">제시문·질문</span><div class="seg" data-seg="variant">${db.variantButtons(cs)}</div>${s.variant !== cs.variant ? `<span class="help">${esc(db.variantLabel(s.variant))} 없음 — ${esc(cs.variantLabel)}로 진행된다.</span>` : ""}</div>
          <div class="row"><span class="chip line">제시문 ${cs.passages.length}</span><span class="chip line">복기 질문 ${db.count(cs)}</span>${cs.source && cs.source.pages ? `<span class="chip line">p.${esc(cs.source.pages)}</span>` : ""}</div>
        </div>

        <div class="opt-group">
          <div class="opt-title">시간표</div>
          <div class="row" style="gap:18px">
            <label class="minutes"><span class="small">준비</span><input class="input sm num" type="number" min="1" max="60" data-num="prepMinutes" value="${s.prepMinutes}"><span class="small muted">분</span></label>
            <label class="minutes"><span class="small">대기</span><input class="input sm num" type="number" min="1" max="60" data-num="waitMinutes" value="${s.waitMinutes || 5}" ${s.waitEnabled ? "" : "disabled"}><span class="small muted">분</span></label>
            ${m.timed ? `<label class="minutes"><span class="small">면접</span><input class="input sm num" type="number" min="1" max="60" data-num="interviewMinutes" value="${s.interviewMinutes}"><span class="small muted">분</span></label>` : `<span class="chip line">면접 시간 제한 없음</span>`}
          </div>
          <label class="switch"><input type="checkbox" data-bool="waitEnabled" ${s.waitEnabled ? "checked" : ""}><span>대기 시간(준비와 면접 사이)</span></label>
          ${m.timed ? `<label class="switch"><input type="checkbox" data-bool="knock" ${s.knock ? "checked" : ""}><span>종료 1분 전 노크</span></label>` : ""}
          <div>${timeline(plan, { phase: null })}<div class="tl-cap"><span>준비 ${plan.prep}분${plan.wait ? ` → 대기 ${plan.wait}분` : ""} → 면접 ${plan.interview ? plan.interview + "분" : "무제한"}</span><span>${sc.format ? `${esc(sc.short)} ${sc.format.year} 기준 ${sc.format.timeline.prep}·${sc.format.timeline.wait}·${sc.format.timeline.interview}` : ""}</span></div></div>
        </div>

        ${m.ai ? `
        <div class="opt-group">
          <div class="opt-title">AI 면접관</div>
          <div class="field"><span class="lab">난이도</span>${levelSeg("difficulty")}</div>
          <div class="field"><span class="lab">변형도</span>${levelSeg("variation")}</div>
          <div class="field"><span class="lab">흐름</span><div class="seg" data-seg="flow"><button type="button" data-v="tree" aria-pressed="${s.flow === "tree"}">사전 결정 트리</button><button type="button" data-v="live" aria-pressed="${s.flow === "live"}">실시간 생성</button></div>${s.flow === "tree" && !db.treeUsable(cs) ? `<span class="help">${cs.tree ? `트리가 ${esc(db.variantLabel(cs.tree.basis))} 복기 기준이라 실시간 생성으로 진행된다.` : "이 세트에는 트리가 없어 실시간 생성으로 진행된다."}</span>` : ""}</div>
        </div>
        <div class="opt-group">
          <div class="opt-title">AI 모델</div>
          <div class="field"><span class="lab">제공사</span><div class="seg" data-aiseg="provider"><button type="button" data-v="anthropic" aria-pressed="${ai.provider === "anthropic"}">Claude</button><button type="button" data-v="openai" aria-pressed="${ai.provider === "openai"}">ChatGPT</button></div></div>
          <div class="field"><span class="lab">모델</span><div class="row">${models.select(ai.provider, ai.model, { sm: true, style: "max-width:220px" })}<button type="button" class="btn sm ghost" id="aiSaveDefault">기본값으로 저장</button></div></div>
          ${models.effortControl("practice-effort", ai.provider, ai.model, ai.effort)}
          <div class="row">${ai.configured ? `<span class="chip ok">${esc(ai.label)} · 키 있음</span>` : `<span class="chip warn">API 키 없음 — 복기 질문 은행으로 진행</span><button type="button" class="linkbtn" id="optOpenSettings">설정</button>`}</div>
        </div>
        <div class="span2">${promptPreview(cs, plan)}</div>` : `
        <div class="span2 row"><span class="chip">복기 질문 ${db.count(cs)}개</span><span class="chip">AI 없음</span></div>`}
      </div>
      <div class="startrow">
        <button type="button" class="btn primary big" id="startBtn">시작 — ${esc(db.label(cs))}</button>
        ${voice ? '<span class="small muted">마이크 권한 필요</span>' : ""}
      </div>
      <p class="callout rec" id="setupErr" hidden></p>
      ${preview ? '<p class="callout warn">claude.ai 미리보기: 마이크·내려받기 불가. 텍스트 답변은 끝까지 진행된다.</p>' : ""}`;
  }
  function promptPreview(cs, plan) {
    const s = S();
    const inp = AI.buildNextQuestionInput(cs, [], s.difficulty, s.variation, plan);
    return `<details class="promptview" id="pv" ${st.promptOpen ? "open" : ""}><summary>AI 입력 미리 보기 — 제시문 ${cs.passages.length}편 전문 + 복기 질문 ${db.count(cs)}개 포함</summary>
      <p class="small muted" style="margin-top:8px">첫 질문 생성 시 실제 입력. 이후 호출에는 '지금까지의 문답'이 덧붙는다. 결정 트리의 분기 분류 호출만 답변·분기 조건을 보내는 경량 호출.</p>
      <pre><b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}</pre></details>`;
  }
  function sessionAi() { return { provider: st.ai.provider, model: st.ai.model || undefined, effort: st.ai.effort }; }
  function planFromSettings() { const s = S(), m = mode(); return { prep: Math.max(1, +s.prepMinutes || 20), wait: s.waitEnabled ? Math.max(1, +s.waitMinutes || 5) : 0, interview: m.timed ? Math.max(1, +s.interviewMinutes || 15) : 0 }; }

  /* 설정 화면의 상호작용은 #app에 한 번 위임한다(단계가 바뀔 때마다 innerHTML을 다시 그리므로). */
  app.addEventListener("click", e => {
    if (st.phase !== "setup") return;
    const t = e.target;
    const go = t.closest("[data-goto]"); if (go) { st.step = +go.dataset.goto; renderSetup(); return; }
    const sch = t.closest("[data-school]"); if (sch) { st.schoolId = sch.dataset.school; save({ lastSchool: st.schoolId }); renderSetup(); return; }
    const sb = t.closest("[data-set]"); if (sb) { st.setId = sb.dataset.set; st.schoolId = set().school; save({ lastSet: st.setId, lastSchool: st.schoolId }); st.step = 2; renderSetup(); scrollToStep(2); return; }
    const mb = t.closest("[data-mode]"); if (mb) { st.mode = mb.dataset.mode; save({ lastMode: st.mode }); st.step = 3; renderSetup(); scrollToStep(3); return; }
    const seg = t.closest("[data-seg] button"); if (seg) { save({ [seg.closest("[data-seg]").dataset.seg]: seg.dataset.v }); return; }   // save → settings:change → refreshOptions
    const aseg = t.closest("[data-aiseg] button"); if (aseg) { st.ai.provider = aseg.dataset.v; st.ai.model = ""; st.ai.effort = undefined; refreshOptions(); return; }
    if (t.closest("#aiSaveDefault")) { const ai = AI.resolve(sessionAi()); st.ai.model = ""; st.ai.effort = undefined; save({ provider: ai.provider, [ai.provider + "Model"]: ai.model, [ai.provider + "Effort"]: ai.effort || "medium" }); return; }
    if (t.closest("#optOpenSettings")) { window.SNU.openSettings(); return; }
    if (t.closest("#startBtn")) { startSession(); return; }
  });
  app.addEventListener("change", e => {
    if (st.phase !== "setup") return;
    const t = e.target;
    if (t.matches("[data-bool]")) save({ [t.dataset.bool]: t.checked });
    else if (t.matches("[data-num]")) { const v = Math.max(+t.min || 0, Math.min(+t.max || 999, +t.value || 0)); save({ [t.dataset.num]: v }); }
  });
  app.addEventListener("toggle", e => { if (e.target.id === "pv") st.promptOpen = e.target.open; }, true);
  function bindOptions() {
    const b = $("#step3 .step-b");
    if (!b) return;
    models.bind(b, id => { st.ai.model = id; st.ai.effort = models.normalizeEffort(st.ai.provider, id, st.ai.effort || S()[st.ai.provider + "Effort"]); refreshOptions(); });
    models.bindEffort(b, value => { st.ai.effort = value; });
  }
  function refreshOptions() { const b = $("#step3 .step-b"); if (b) { b.innerHTML = optionsPanel(); bindOptions(); } }
  function scrollToStep(n) { const el = $("#step" + n); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  document.addEventListener("settings:change", () => { if (st.phase === "setup" && st.step === 3) refreshOptions(); });

  async function renderVault(el, sessionOnly) {
    const all = (await dbAll()).filter(r => !sessionOnly || r.sessionId === st.sessionId).sort((a, b) => b.createdAt - a.createdAt);
    if (!el.isConnected) return;
    if (!all.length) { el.innerHTML = `<p class="small muted">녹음 없음</p>`; return; }
    el.innerHTML = all.map(r => recItem(r)).join("");
    $$("[data-del]", el).forEach(b => b.addEventListener("click", async () => { await dbDel(b.dataset.del); renderVault(el, sessionOnly); }));
  }
  function recItem(r) {
    const url = URL.createObjectURL(r.blob);
    return `<div class="recitem"><div style="min-width:0"><div class="q">${esc(r.question)}</div><div class="m">${esc(r.setLabel)} · ${esc(r.modeLabel)} · ${new Date(r.createdAt).toLocaleString("ko-KR")} · ${fmtClock(r.duration)}</div><audio controls preload="none" src="${url}"></audio></div>
      <div class="stack"><a class="btn sm" download="${esc(r.filename)}" href="${url}">내려받기</a><button type="button" class="btn sm ghost" data-del="${r.id}">삭제</button></div></div>`;
  }

  /* ---------------- 세션 시작·단계 전환 ---------------- */
  async function startSession() {
    const err = $("#setupErr"); if (err) err.hidden = true;
    const s = S();
    st.plan = planFromSettings(); st.answerMode = s.answerMode;
    st.variant = set().variant;                       // 세션 동안 복기본 고정(설정을 바꿔도 제시문·질문 은행이 바뀌지 않는다)
    if (st.answerMode === "voice") { try { await recorder.init(); } catch (e) { if (err) { err.textContent = "마이크를 열 수 없다: " + e.message + " — 답변 방식을 텍스트로 바꾸면 마이크 없이 진행된다."; err.hidden = false; } return; } }
    audioCtx(); keepAwake();
    st.sessionId = Date.now().toString(36); st.history = []; st.recordings = []; st.qi = 0; st.cur = null; st.knocked = false; st.memo = ""; st.err = ""; st.treeNode = null; st.pendingBranches = null; st.tab = "passage";
    st.queue = st.mode === "all" ? pool(set()) : [];
    enterPhase("prep", st.plan.prep * 60);
  }
  function afterPrep() { if (st.plan.wait > 0) enterPhase("wait", st.plan.wait * 60); else enterPhase("interview", st.plan.interview * 60); }
  function enterPhase(p, seconds) {
    st.phase = p; st.phaseStart = Date.now(); st.phaseEnd = seconds ? Date.now() + seconds * 1000 : 0; st.knocked = false;
    clearInterval(st.tick); app.classList.toggle("in-session", p !== "done");
    if (p === "prep") renderPrep();
    if (p === "wait") renderWait();
    if (p === "interview") { renderInterview(); nextQuestion(); }
    if (p === "done") { finishSession(); return; }
    st.tick = setInterval(onTick, 250); onTick();
  }
  function onTick() {
    const now = Date.now();
    const remain = st.phaseEnd ? (st.phaseEnd - now) / 1000 : 0, total = st.phaseEnd ? (st.phaseEnd - st.phaseStart) / 1000 : 0, elapsed = (now - st.phaseStart) / 1000;
    const crit = !!st.phaseEnd && remain <= 60, warn = !!st.phaseEnd && remain > 60 && remain <= 180;
    const text = st.phaseEnd ? fmtClock(remain) : fmtClock(elapsed);
    $$("#clock, #clockBig").forEach(c => { c.textContent = text; c.classList.toggle("crit", crit); c.classList.toggle("warn", warn); });
    const cur = $("#tlCur"); if (cur) { cur.querySelector("i").style.width = (st.phaseEnd ? Math.min(100, 100 * (1 - remain / total)) : 0) + "%"; cur.classList.toggle("crit", crit); }
    if (st.phase === "interview" && st.phaseEnd && remain <= 60 && !st.knocked && S().knock) { st.knocked = true; knockSound(); const k = $("#knockMsg"); if (k) k.hidden = false; }
    if (st.phaseEnd && remain <= 0) {
      if (st.phase === "prep") { beep(1); afterPrep(); }
      else if (st.phase === "wait") { beep(2); enterPhase("interview", st.plan.interview * 60); }
      else if (st.phase === "interview") { beep(3); endInterview(); }
    }
    const rt = $("#recTime"); if (rt && st.recording) rt.textContent = fmtClock((now - recorder.startedAt) / 1000);
  }
  function abort() { clearInterval(st.tick); recorder.release(); stt.stop(); try { speechSynthesis.cancel(); } catch (e) {} st.phase = "setup"; st.step = 3; st.variant = ""; app.classList.remove("in-session"); renderSetup(); }

  /* ---------------- 공통 조각 ---------------- */
  const PHASE_LABEL = { prep: "준비", wait: "대기", interview: "면접" };
  function timerbar(actionsHtml) {
    const label = st.phase === "interview" && !st.plan.interview ? "면접 (제한 없음)" : PHASE_LABEL[st.phase];
    return `<div class="timerbar" id="timerbar"><div class="tb-left"><span class="phase">${label}</span><span class="clock num" id="clock">--:--</span></div>${timeline(st.plan, { phase: st.phase })}<div class="actions">${actionsHtml || ""}</div></div>`;
  }
  function passagesHtml(cs) {
    return `<div class="papers"><div class="instr">${esc(cs.instruction)}${(cs.tasks || []).length ? `<ol class="tasks">${cs.tasks.map(t => `<li><b>${esc(AI.taskHead(t))}.</b> ${esc(t.text)}</li>`).join("")}</ol>` : ""}</div>${cs.passages.map(p => `<article class="paper ${p.kind === "dialog" ? "dialog" : ""}"><div class="ptitle">${esc(AI.passageHead(p))}${p.length ? `<span>(${esc(p.length)})</span>` : ""}</div>${p.text.split(/\n{2,}|\n/).filter(x => x.trim()).map(par => `<p>${esc(par)}</p>`).join("")}${p.source ? `<div class="src">${esc(p.source)}</div>` : ""}</article>`).join("")}</div>`;
  }
  function memoHtml() {
    return `<div class="panel memo-pane"><div class="row between"><h3 class="h3">메모</h3><span class="small muted">A5 2장 · 3면</span></div>
      <textarea class="input" id="memo" placeholder="메모">${esc(st.memo)}</textarea>
      <div class="memo-meta"><span id="memoCount">0자</span><span>자동 저장</span></div></div>`;
  }
  function mobileTabs() {
    return `<div class="seg fill mobile-tabs" id="mtabs"><button type="button" data-tab="passage" aria-pressed="${st.tab === "passage"}">제시문</button><button type="button" data-tab="interview" aria-pressed="${st.tab === "interview"}">${st.phase === "prep" ? "진행" : "면접"}</button><button type="button" data-tab="memo" aria-pressed="${st.tab === "memo"}">메모</button></div>`;
  }
  let tbObs = null;
  function bindCommon() {
    const mt = $("#mtabs"); if (mt) mt.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; st.tab = b.dataset.tab; $("#session").dataset.tab = st.tab; $$("button", mt).forEach(x => x.setAttribute("aria-pressed", x === b)); });
    const memo = $("#memo"); if (memo) { const cnt = () => { $("#memoCount").textContent = memo.value.length + "자"; }; cnt(); memo.addEventListener("input", () => { st.memo = memo.value; cnt(); }); }
    const ab = $("#abort"); if (ab) ab.addEventListener("click", abort);
    /* 오른쪽 열(질문·메모)이 진행 바 아래에 붙도록 진행 바 높이를 CSS 변수로 전달한다 */
    const tb = $("#timerbar"); if (tb) { const setH = () => app.style.setProperty("--tb-h", tb.offsetHeight + "px"); setH(); if (tbObs) tbObs.disconnect(); if ("ResizeObserver" in window) { tbObs = new ResizeObserver(setH); tbObs.observe(tb); } }
  }

  /* ---------------- 화면: 준비 ---------------- */
  function renderPrep() {
    const cs = set();
    if (st.tab === "interview") st.tab = "passage";
    app.innerHTML = `${timerbar(`<button type="button" class="btn primary sm" id="toNext">${st.plan.wait ? "준비 마침 → 대기" : "준비 마침 → 면접"}</button><button type="button" class="btn ghost sm" id="abort">그만두기</button>`)}
      ${mobileTabs()}
      <div class="session" id="session" data-tab="${st.tab}">
        <div class="coll">${passagesHtml(cs)}</div>
        <div class="colr">
          <div class="qcard"><div class="qmeta"><span>${esc(db.label(cs))} · ${esc(cs.session)} · ${esc(cs.variantLabel)}</span><span>${mode().code} ${esc(mode().label)}</span></div>
            <p class="qtext waiting">질문은 면접 시간에 나온다. 제시문을 읽고 메모한다.</p></div>
          ${memoHtml()}
        </div>
      </div>`;
    $("#toNext").addEventListener("click", afterPrep);
    bindCommon();
  }

  /* ---------------- 화면: 대기 ---------------- */
  function renderWait() {
    const cs = set();
    app.innerHTML = `${timerbar(`<button type="button" class="btn primary sm" id="toInterview">입실 → 면접</button><button type="button" class="btn ghost sm" id="abort">그만두기</button>`)}
      <div class="wait-wrap">
        <div class="panel wait-screen">
          <div class="eyebrow">${esc(db.label(cs))} · ${mode().code} ${esc(mode().label)}</div>
          <h1 class="h2">면접실 앞 대기</h1>
          <div class="big num" id="clockBig">--:--</div>
          <p class="sub" style="text-align:center">제시문은 걷혔다. 메모만 들고 들어간다.</p>
        </div>
        ${memoHtml()}
      </div>`;
    $("#toInterview").addEventListener("click", () => enterPhase("interview", st.plan.interview * 60));
    bindCommon();
  }

  /* ---------------- 화면: 면접 ---------------- */
  function renderInterview() {
    const cs = set();
    st.tab = "interview";
    app.innerHTML = `${timerbar(`<button type="button" class="btn sm" id="endBtn">면접 종료</button>`)}
      <p class="knock" id="knockMsg" hidden>똑똑 — 종료 1분 전</p>
      ${mobileTabs()}
      <div class="session" id="session" data-tab="${st.tab}">
        <div class="coll">${passagesHtml(cs)}</div>
        <div class="colr">
          <div class="qcard" id="qcard"></div>
          <div class="panel tight"><div class="row between"><h3 class="h3">진행</h3><span class="small muted" id="progressLabel"></span></div><ol class="qlist" id="qlog"></ol></div>
          ${memoHtml()}
        </div>
      </div>`;
    $("#endBtn").addEventListener("click", endInterview);
    bindCommon();
    renderQcard();
  }
  function renderQcard() {
    const q = $("#qcard"); if (!q) return;
    const s = S(), ai = AI.resolve(sessionAi());
    const textMode = st.answerMode === "text";
    const manual = !textMode && (s.stt !== "webspeech" || !stt.available);
    let body = "";
    if (st.thinking) body = `<div class="qmeta"><span>질문 ${st.history.length + 1}</span><span>${esc(st.aiNote)}</span></div><p class="qtext waiting">면접관이 다음 질문을 고르는 중…</p>`;
    else if (st.pendingBranches) body = `<div class="qmeta"><span>면접관 판단</span></div><p class="qtext waiting">방금 답변에 가장 가까운 것은?</p><div class="stack">${st.pendingBranches.map((b, i) => `<button type="button" class="btn" data-branch="${i}">${esc(b.when)}</button>`).join("")}</div>${st.err ? `<p class="callout warn">${esc(st.err)}</p>` : ""}`;
    else if (!st.cur) body = `<p class="qtext waiting">질문 없음</p>`;
    else {
      const head = `<div class="qmeta"><span>질문 ${st.history.length + 1}${st.cur.group ? " · " + esc(st.cur.group) + (st.cur.idx ? " Q" + st.cur.idx : "") : ""}</span><span>${st.cur.focus ? "초점: " + esc(st.cur.focus) : ""}</span></div><p class="qtext">${esc(st.cur.q)}</p>`;
      const foot = `<span class="small muted">${st.mode === "all" ? `${st.qi} / ${st.queue.length}` : (ai.configured ? esc(ai.label) : "오프라인 · 복기 질문 은행")}</span>`;
      if (textMode) {
        body = `${head}
          <textarea class="input" id="answerText" placeholder="답변을 작성하시오." style="min-height:150px">${esc(st.transcript)}</textarea>
          ${foot}
          <div class="qactions"><button type="button" class="btn" id="readQ">질문 듣기</button><button type="button" class="btn" id="skipBtn">넘기기</button><button type="button" class="btn primary" id="nextBtn">제출 → 다음 질문</button></div>`;
      } else {
        body = `${head}
          <div class="reccontrols">
            ${st.recording ? `<button type="button" class="btn rec" id="recStop"><span class="dot"></span>답변 완료</button><span class="rectime num" id="recTime">0:00</span><div class="level"><i id="level"></i></div>`
                           : `<button type="button" class="btn primary" id="recStart">${st.answered ? "다시 답변" : "답변 시작"}</button><button type="button" class="btn" id="readQ">질문 듣기</button>${st.answered ? `<span class="chip ok">녹음 ${fmtClock(st.lastAnswer ? st.lastAnswer.duration : 0)}</span>` : ""}`}
          </div>
          ${manual ? `<textarea class="input" id="answerText" placeholder="답변 요지를 작성하시오.">${esc(st.transcript)}</textarea>`
                   : st.answered && !st.recording ? `<div class="field"><label for="answerText" class="small muted">음성 인식 결과(수정 가능)</label><textarea class="input" id="answerText" style="min-height:90px" placeholder="인식된 말 없음">${esc(st.transcript)}</textarea></div>`
                   : `<div class="transcript" id="transcript">${st.transcript ? esc(st.transcript) : '<span class="interim">음성 인식 결과</span>'}${st.interim ? `<span class="interim"> ${esc(st.interim)}</span>` : ""}</div>`}
          ${foot}
          <div class="qactions"><button type="button" class="btn ${st.answered ? "primary" : ""}" id="nextBtn" ${st.recording ? "disabled" : ""}>${st.answered ? "다음 질문" : "답변 없이 넘기기"}</button></div>`;
      }
      body += st.err ? `<p class="callout warn">${esc(st.err)}</p>` : "";
    }
    q.innerHTML = body;
    const rs = $("#recStart"); if (rs) rs.addEventListener("click", startAnswer);
    const rp = $("#recStop"); if (rp) rp.addEventListener("click", stopAnswer);
    const rq = $("#readQ"); if (rq) rq.addEventListener("click", () => speak(st.cur.q));
    const nb = $("#nextBtn"); if (nb) nb.addEventListener("click", () => { const t = $("#answerText"); if (t) st.transcript = t.value.trim(); commitAnswer(); });
    const sk = $("#skipBtn"); if (sk) sk.addEventListener("click", () => { st.transcript = ""; commitAnswer(); });
    $$("[data-branch]", q).forEach(b => b.addEventListener("click", () => { const i = +b.dataset.branch; const br = st.pendingBranches[i]; st.pendingBranches = null; st.err = ""; st.treeNode = br.next; showTreeNode(); }));
    const log = $("#qlog"); if (log) { log.innerHTML = st.history.map((h, i) => `<li class="done"><span class="idx">Q${i + 1}</span><span>${esc(h.q)}</span><span class="small muted">${h.rec ? fmtClock(h.rec.duration) : h.a ? h.a.length + "자" : "—"}</span></li>`).join("") + (st.cur ? `<li class="cur"><span class="idx">Q${st.history.length + 1}</span><span>${esc(st.cur.q)}</span><span></span></li>` : ""); }
    const pl = $("#progressLabel"); if (pl) pl.textContent = st.mode === "all" ? `${st.qi}/${st.queue.length}` : `${st.history.length}개 답변`;
  }

  async function startAnswer() {
    st.transcript = ""; st.interim = ""; st.answered = false; st.err = "";
    try { recorder.start(l => { const el = $("#level"); if (el) el.style.width = (l * 100) + "%"; }); } catch (e) { st.err = "녹음을 시작할 수 없다: " + e.message; renderQcard(); return; }
    st.recording = true;
    if (S().stt === "webspeech" && stt.available) stt.start((fin, int) => { st.transcript = fin.trim(); st.interim = int; const t = $("#transcript"); if (t) t.innerHTML = (st.transcript ? esc(st.transcript) : "") + (st.interim ? `<span class="interim"> ${esc(st.interim)}</span>` : ""); });
    renderQcard();
  }
  async function stopAnswer() {
    if (!st.recording) return;
    st.recording = false;
    const spoken = stt.stop(); if (spoken) st.transcript = spoken;
    const t = $("#answerText"); if (t) st.transcript = t.value;
    const out = await recorder.stop();
    if (out && out.blob.size) {
      const cs = set(), n = st.history.length + 1;
      const rec = { id: `${st.sessionId}-${n}`, sessionId: st.sessionId, setId: cs.id, setLabel: db.label(cs), modeLabel: mode().code + " " + mode().label, question: st.cur ? st.cur.q : "", createdAt: Date.now(),
        duration: out.duration, mime: out.mime, blob: out.blob, filename: `${cs.id}_${st.mode}_${st.sessionId}_Q${String(n).padStart(2, "0")}.${extOf(out.mime)}` };
      try { await dbPut(rec); } catch (e) { st.err = "녹음을 브라우저에 저장하지 못했다(" + e.message + ")."; }
      st.recordings.push(rec); st.lastAnswer = rec;
    }
    st.answered = true; renderQcard();
  }
  function commitAnswer() {
    if (!st.cur) return;
    st.history.push({ q: st.cur.q, a: st.transcript, rec: st.lastAnswer || null });
    const answered = st.transcript; st.cur = null; st.answered = false; st.transcript = ""; st.interim = ""; st.lastAnswer = null;
    nextQuestion(answered);
  }

  /* ---------------- 다음 질문 결정 ---------------- */
  async function nextQuestion(lastAnswer) {
    const cs = set(), s = S(), ai = AI.resolve(sessionAi());
    if (st.mode === "all") {
      if (st.qi >= st.queue.length) { endInterview(); return; }
      st.cur = st.queue[st.qi++]; showQuestion(); return;
    }
    if (s.flow === "tree" && db.treeUsable(cs)) {
      if (st.treeNode === null && st.history.length === 0) { st.treeNode = cs.tree.root; showTreeNode(); return; }
      const node = cs.tree.nodes[st.treeNode];
      if (node && node.branches && node.branches.length) {
        if (ai.configured) { st.thinking = true; st.aiNote = "분기 분류 · " + ai.label; renderQcard();
          try { const i = await AI.classify(lastAnswer, node.branches, sessionAi()); st.treeNode = node.branches[i].next; }
          catch (e) { st.err = "분류 호출 실패: " + e.message; st.thinking = false; st.pendingBranches = node.branches; renderQcard(); return; }
          st.thinking = false; showTreeNode(); return; }
        st.pendingBranches = node.branches; renderQcard(); return;
      }
      st.treeNode = node ? node.next : null; showTreeNode(); return;
    }
    if (ai.configured) {
      st.thinking = true; st.aiNote = ai.label + " · 난이도 " + D.levels.difficulty[s.difficulty].label + " · 변형도 " + D.levels.variation[s.variation].label; renderQcard();
      try { const r = await AI.nextQuestion(cs, st.history, s.difficulty, s.variation, sessionAi(), st.plan); st.cur = { q: r.question, focus: r.focus, group: "AI 면접관" }; }
      catch (e) { st.err = "AI 호출 실패: " + e.message + " — 복기 질문 은행으로 대체."; st.cur = bankNext(cs); }
      st.thinking = false; showQuestion(); return;
    }
    st.cur = bankNext(cs); showQuestion();
  }
  function showTreeNode() {
    const cs = set();
    if (!st.treeNode || !cs.tree.nodes[st.treeNode]) {                 // 트리 끝
      st.treeNode = null;
      if (AI.resolve(sessionAi()).configured) { nextQuestionLive(); return; }
      st.cur = bankNext(cs); if (!st.cur) { endInterview(); return; } st.cur.group = "트리 종료 → 질문 은행"; showQuestion(); return;
    }
    const node = cs.tree.nodes[st.treeNode];
    st.cur = { q: node.q, group: "결정 트리" + (cs.tree.example ? "(예시)" : ""), focus: "" }; showQuestion();
  }
  async function nextQuestionLive() {
    const cs = set(), s = S(), ai = AI.resolve(sessionAi());
    st.thinking = true; st.aiNote = "트리 종료 → 실시간 생성 · " + ai.label; renderQcard();
    try { const r = await AI.nextQuestion(cs, st.history, s.difficulty, s.variation, sessionAi(), st.plan); st.cur = { q: r.question, focus: r.focus, group: "AI 면접관" }; }
    catch (e) { st.err = "AI 호출 실패: " + e.message + " — 복기 질문 은행으로 대체."; st.cur = bankNext(cs); }
    st.thinking = false; showQuestion();
  }
  /* 질문 은행: 문제지 문항(있으면) → 복기 추가질문. '복기 질문 전부' 모드와 키 없는 대체 경로가 함께 쓴다. */
  function pool(cs) { return [...(cs.tasks || []).map(t => ({ q: `${AI.taskHead(t)}. ${t.text}`, group: "문제" })), ...AI.bank(cs)]; }
  function bankNext(cs) {
    const asked = new Set(st.history.map(h => h.q));
    return pool(cs).find(x => !asked.has(x.q)) || null;
  }
  function showQuestion() { if (!st.cur) { endInterview(); return; } st.answered = false; st.transcript = ""; st.interim = ""; renderQcard(); speak(st.cur.q); }

  /* ---------------- 종료 ---------------- */
  async function endInterview() {
    clearInterval(st.tick);
    if (st.recording) await stopAnswer();
    if (st.cur && (st.answered || (st.answerMode === "text" && $("#answerText") && $("#answerText").value.trim()))) { const t = $("#answerText"); if (t) st.transcript = t.value.trim(); st.history.push({ q: st.cur.q, a: st.transcript, rec: st.lastAnswer || null }); }
    try { speechSynthesis.cancel(); } catch (e) {}
    st.phase = "done"; finishSession();
  }
  function finishSession() {
    recorder.release(); stt.stop(); if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    app.classList.remove("in-session");
    const cs = set(), m = mode();
    const total = st.history.reduce((n, h) => n + (h.rec ? h.rec.duration : 0), 0);
    app.innerHTML = `
      <section class="sec">
        <div class="eyebrow">${esc(db.label(cs))} · ${esc(cs.variantLabel)} · ${m.code} ${esc(m.label)} · ${st.answerMode === "voice" ? "음성" : "텍스트"}</div>
        <h1 class="h1">면접 종료</h1>
        <div class="row"><span class="chip">질문 ${st.history.length}</span>${st.answerMode === "voice" ? `<span class="chip">녹음 ${st.history.filter(h => h.rec).length} · ${fmtClock(total)}</span>` : `<span class="chip">답변 ${st.history.filter(h => h.a).length}</span>`}${st.memo ? `<span class="chip">메모 ${st.memo.length}자</span>` : ""}</div>
        <div class="row"><button type="button" class="btn primary" id="again">같은 세트 다시</button><a class="btn" href="practice.html">다른 세트</a><a class="btn ghost" href="db.html#${esc(cs.id)}">기출DB에서 보기</a></div>
      </section>
      ${st.answerMode === "voice" ? `<section class="sec"><div class="sec-head"><h2 class="h2">이번 세션 녹음</h2></div><div class="reclist" id="sessionRecs"></div></section>` : ""}
      <section class="sec"><div class="sec-head"><h2 class="h2">문답 기록</h2></div>
        <ol class="qlist">${st.history.map((h, i) => `<li class="done"><span class="idx">Q${i + 1}</span><span><b>${esc(h.q)}</b><br><span class="small muted">${esc(h.a || "(답변 기록 없음)")}</span></span><span class="small muted">${h.rec ? fmtClock(h.rec.duration) : "—"}</span></li>`).join("") || '<li><span></span><span class="muted">기록 없음</span><span></span></li>'}</ol></section>
      ${st.memo ? `<section class="sec"><div class="sec-head"><h2 class="h2">메모</h2></div><pre class="panel" style="white-space:pre-wrap;font:inherit">${esc(st.memo)}</pre></section>` : ""}
      <section class="sec"><div class="sec-head"><h2 class="h2">이 세트의 복기 질문 전체</h2></div>
        ${[...cs.followups, ...(cs.common || [])].map(f => `<div class="panel tight"><h3 class="h3" style="margin-bottom:6px">${esc(f.label)}</h3><ol class="qlist">${f.items.map((q, i) => `<li><span class="idx">Q${i + 1}</span><span>${esc(q)}</span><span></span></li>`).join("")}</ol></div>`).join("")}</section>`;
    $("#again").addEventListener("click", () => { st.phase = "setup"; st.step = 3; st.variant = ""; renderSetup(); });
    const el = $("#sessionRecs");
    if (el) {
      if (st.recordings.length) { el.innerHTML = st.recordings.map(recItem).join(""); $$("[data-del]", el).forEach(b => b.addEventListener("click", async () => { await dbDel(b.dataset.del); b.closest(".recitem").remove(); })); }
      else el.innerHTML = '<p class="small muted">녹음 없음</p>';
    }
  }

  renderSetup();
})();
