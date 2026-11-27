/* ============================================================
   모의면접 — 세션 실행기
   설정 단계: ① 세트(학교 토글 → 세트) → ② 모드 → ③ 옵션 + 시작
   진행 단계: 준비(prep: 제시문 공개·메모) → 대기(wait, 선택: 제시문 없이 메모만) → 면접(interview) → 종료(done)
   모드: timed 1-A 면접시간 AI 면접관 / endless 1-B 무한시간 AI 면접관 / all 2 무한시간 모든 질문 답변
   답변: 음성(MediaRecorder 녹음 → IndexedDB, 전사는 브라우저 음성 인식 또는 직접 입력) 또는 텍스트 입력.
   AI: assets/ai.js. 제공사·모델은 옵션 창에서 고르고(기본값은 설정), 키가 없으면 복기 질문 은행(변형 없음)으로 대체한다.
   기록: assets/records.js. 답변을 제출할 때마다 세션 기록(문답·메모·옵션)을 저장하고, 종료 화면에서 AI 피드백을 받는다.
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

  /* ---------------- 녹음·세션 기록 보관: IndexedDB "snu-interview"(assets/records.js) ---------------- */
  const Records = window.Records;

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
    memo: "", tab: "interview", knocked: false, treeNode: null, pendingBranches: null, err: "", lastAnswer: null,
    startedAt: 0, options: null, aiUsed: null, ending: false, saveChain: Promise.resolve(), saveErr: "",   // 세션 기록(assets/records.js)
    tm: null,                                         // 세트별 시간표·기조발언 스위치(timing()). 전역 설정과 분리
    kn: null, cutNote: ""                             // 기조발언 시계 { start, end, round, pending, cut }, 끊김 알림(다음 질문 카드)
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
  /* 모의고사 문제(SNU.db가 MOCK_DB에서 푼 세트, cs.mock): 복기본·학년도가 없고 질문은 '복기 질문'이 아니다. */
  const setLine = cs => [db.label(cs), cs.session, cs.variantLabel].filter(Boolean).join(" · ");
  const qWord = cs => cs.mock ? "질문" : "복기 질문";
  const modeText = (k, v, cs) => cs.mock && k === "all" ? { desc: "문항·추가질문을 순서대로 전부 답한다.", feats: v.feats.map(f => f === "복기 질문 전체" ? "질문 전체" : f) } : v;

  /* ---------------- 시간표: 설정값 또는 세트 시간표 ----------------
     학교 format.timeline에 keynote가 있는 학교(고려대)는 세트의 책 값(format.prep·duration·keynote, 없으면 학교 값)으로
     시간표를 시작한다. 이 값과 기조발언 제한 스위치는 세션 상태(st.tm)에만 두고 전역 설정은 읽지도 쓰지도 않는다.
     그 세트를 고르고 있는 동안([같은 세트 다시] 포함) 고친 값을 유지하고, 다른 세트를 고르면 그 세트의 기본값으로 돌아간다.
     그 밖의 학교는 시간표를 설정값으로 정하고, 기조발언 스위치만 세션 상태(기본 꺼짐)다.
     모의고사 문제는 학교와 관계없이 문제의 진행 조건(format.prep·duration·keynote)으로 시작한다. 기조발언이 있는 문제만 제한이 켜져 시작한다. */
  function setTimeline(cs) {
    const sc = (D.schools || []).find(x => x.id === cs.school), t = sc && sc.format && sc.format.timeline;
    if (cs.mock) {
      const f = cs.format || {}, interview = f.duration > 0 ? f.duration : (t && t.interview) || 15;
      return { mock: true, short: cs.mockLabel, prep: f.prep > 0 ? f.prep : (t && t.prep) || 20, wait: 0, interview, keynote: f.keynote > 0 ? Math.max(1, Math.min(interview - 1, f.keynote)) : 0, basis: 0 };
    }
    if (!t || !(t.keynote > 0)) return null;
    const f = cs.format || {}, interview = f.duration > 0 ? f.duration : t.interview, own = f.keynote > 0;
    return { short: sc.short, prep: f.prep > 0 ? f.prep : t.prep, wait: t.wait || 0, interview, keynote: Math.max(1, Math.min(interview - 1, own ? f.keynote : t.keynote)), basis: own ? 0 : sc.format.year };   // basis: 그해 값이 책에 없어 쓴 학교 기준 연도
  }
  function timing() {
    if (st.tm && st.tm.setId === st.setId) return st.tm;
    const base = setTimeline(db.set(st.setId));
    st.tm = { setId: st.setId, base, on: !!base && base.keynote > 0, keynote: base ? base.keynote : 0 };
    if (base) Object.assign(st.tm, { prep: base.prep, waitOn: base.wait > 0, wait: base.wait || 5, interview: base.interview });
    return st.tm;
  }
  const keynoteOffered = () => mode().timed && (set().tasks || []).length > 0;   // 1-A이고 문제지 문항이 있는 세트(실효 복기본)만
  function currentPlan() {
    const s = S(), m = mode(), tm = timing();
    const plan = tm.base
      ? { prep: tm.prep, wait: tm.waitOn ? tm.wait : 0, interview: m.timed ? tm.interview : 0 }
      : { prep: Math.max(1, +s.prepMinutes || 20), wait: s.waitEnabled ? Math.max(1, +s.waitMinutes || 5) : 0, interview: m.timed ? Math.max(1, +s.interviewMinutes || 15) : 0 };
    if (tm.on && keynoteOffered() && plan.interview > 1) plan.keynote = Math.max(1, Math.min(plan.interview - 1, tm.keynote || Math.round(plan.interview / 2)));   // 면접 시간보다 작게
    return plan;
  }
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
          ${stepHead(1, "세트", cs ? esc([db.label(cs), cs.session].filter(Boolean).join(" · ")) : "")}
          ${st.step === 1 ? `<div class="step-b">${mockPick(cs)}${schoolTabs()}${setList()}</div>` : ""}
        </section>
        <section class="step ${stepCls(2)}" id="step2">
          ${stepHead(2, "모드", `${m.code} ${esc(m.label)}`)}
          ${st.step === 2 ? `<div class="step-b"><div class="modes" id="modePick">${Object.entries(MODES).map(([k, v]) => { const x = modeText(k, v, cs); return `<button type="button" class="mode" data-mode="${k}" aria-pressed="${k === st.mode}"><span class="code">${v.code}</span><span class="t">${esc(v.label)}</span><span class="d">${esc(x.desc)}</span><span class="f">${x.feats.map(f => `<span>${esc(f)}</span>`).join("")}</span></button>`; }).join("")}</div></div>` : ""}
        </section>
        <section class="step ${stepCls(3)}" id="step3">
          ${stepHead(3, "옵션과 시작", "")}
          ${st.step === 3 ? `<div class="step-b">${optionsPanel()}</div>` : ""}
        </section>
      </div>

      <section class="sec">
        <div class="row between"><h2 class="h2">지난 면접</h2><button type="button" class="btn sm" id="openRecordsList">전체 기록</button></div>
        <div id="vault"><p class="small muted">불러오는 중…</p></div>
      </section>`;
    bindOptions();
    Records.mountList($("#vault"), 5);
  }
  /* 지금 세트가 모의고사 문제면(모의고사 상세의 [이 문제로 모의면접]) 그 문제를 맨 위에 두고 모의고사로 돌아가는 길을 둔다. 아래 학교 목록에서 기출 세트로 바꿀 수 있다. */
  function mockPick(cs) {
    if (!cs || !cs.mock) return "";
    return `<div class="setrows byschool" id="mockPick"><button type="button" class="setrow" data-set="${esc(cs.id)}" aria-pressed="true">
        <span class="yr">${esc((db.school(cs.school) || { short: cs.school }).short)}<small>모의고사</small></span>
        <span><span class="nm">${esc(cs.name)}</span><br><span class="th">${esc(cs.seriesName)}</span></span>
        <span class="mt"><span>제시문 ${cs.passages.length}</span><span>질문 ${db.count(cs)}</span><span>준비 ${esc(cs.format.prep)}분</span><span>면접 ${esc(cs.format.duration)}분</span>${cs.format.keynote ? `<span>기조발언 ${esc(cs.format.keynote)}분</span>` : ""}</span></button></div>
      <div class="row"><a class="btn sm" href="mock.html#${esc(cs.id)}">모의고사</a></div>`;
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
    const plan = currentPlan(), tm = timing(), b = tm.base, kOffer = keynoteOffered();
    const voice = s.answerMode === "voice";
    const minutes = (label, attr, value, on, max) => `<label class="minutes"><span class="small">${label}</span><input class="input sm num" type="number" min="1" max="${max || 60}" ${attr} value="${value}" ${on ? "" : "disabled"}><span class="small muted">분</span></label>`;
    const capRight = b && b.mock ? `${esc(b.short)} 진행 조건 ${b.prep}·${b.interview}${b.keynote ? ` · 기조발언 ${b.keynote}` : ""}`
      : b ? `${esc(b.short)} ${cs.year} 복기 ${b.prep}·${b.interview} · 기조발언 ${b.keynote}${b.basis ? `(${b.basis} 기준)` : ""}`
      : sc.format ? `${esc(sc.short)} ${sc.format.year} 기준 ${sc.format.timeline.prep}·${sc.format.timeline.wait}·${sc.format.timeline.interview}` : "";
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
          <div class="opt-title">${cs.mock ? "모의고사" : "복기본"}</div>
          ${cs.mock ? "" : `<div class="field"><span class="lab">제시문·질문</span><div class="seg" data-seg="variant">${db.variantButtons(cs)}</div>${s.variant !== cs.variant ? `<span class="help">${esc(db.variantLabel(s.variant))} 없음 — ${esc(cs.variantLabel)}로 진행된다.</span>` : ""}</div>`}
          <div class="row"><span class="chip line">제시문 ${cs.passages.length}</span><span class="chip line">${qWord(cs)} ${db.count(cs)}</span>${cs.source && cs.source.pages ? `<span class="chip line">p.${esc(cs.source.pages)}</span>` : ""}</div>
        </div>

        <div class="opt-group">
          <div class="opt-title">시간표</div>
          <div class="row" style="gap:18px">
            ${b ? minutes("준비", 'data-tm="prep"', tm.prep, true) + minutes("대기", 'data-tm="wait"', tm.wait, tm.waitOn)
                : minutes("준비", 'data-num="prepMinutes"', s.prepMinutes, true) + minutes("대기", 'data-num="waitMinutes"', s.waitMinutes || 5, s.waitEnabled)}
            ${m.timed ? minutes("면접", b ? 'data-tm="interview"' : 'data-num="interviewMinutes"', b ? tm.interview : s.interviewMinutes, true) : `<span class="chip line">면접 시간 제한 없음</span>`}
            ${kOffer ? minutes("기조발언", 'data-tm="keynote"', plan.keynote || tm.keynote || Math.max(1, Math.round(plan.interview / 2)), !!plan.keynote, Math.max(1, plan.interview - 1)) : ""}
          </div>
          <label class="switch"><input type="checkbox" ${b ? `data-tmbool="waitOn" ${tm.waitOn ? "checked" : ""}` : `data-bool="waitEnabled" ${s.waitEnabled ? "checked" : ""}`}><span>대기 시간(준비와 면접 사이)</span></label>
          ${m.timed ? `<label class="switch"><input type="checkbox" data-bool="knock" ${s.knock ? "checked" : ""}><span>종료 1분 전 노크</span></label>` : ""}
          ${kOffer ? `<label class="switch"><input type="checkbox" data-tmbool="on" ${tm.on ? "checked" : ""}><span>기조발언 시간 제한</span></label>${plan.keynote ? '<span class="help">30초 넘기면 면접관이 끊을 수 있다.</span>' : ""}` : ""}
          <div>${timeline(plan, { phase: null })}<div class="tl-cap"><span>준비 ${plan.prep}분${plan.wait ? ` → 대기 ${plan.wait}분` : ""} → 면접 ${plan.interview ? plan.interview + "분" : "무제한"}${plan.keynote ? `(기조발언 ${plan.keynote}분)` : ""}</span><span>${capRight}</span></div></div>
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
        <div class="span2 row"><span class="chip">${qWord(cs)} ${db.count(cs)}개</span><span class="chip">AI 없음</span></div>`}
      </div>
      <div class="startrow">
        <button type="button" class="btn primary big" id="startBtn">시작 — ${esc(cs.mock ? cs.name : db.label(cs))}</button>
        ${voice ? '<span class="small muted">마이크 권한 필요</span>' : ""}
      </div>
      <p class="callout rec" id="setupErr" hidden></p>
      ${preview ? '<p class="callout warn">claude.ai 미리보기: 마이크·내려받기 불가. 텍스트 답변은 끝까지 진행된다.</p>' : ""}`;
  }
  function promptPreview(cs, plan) {
    const s = S();
    /* 기조발언 제한이 켜져 있으면 첫 AI 호출은 기조발언 뒤다. 자리표시 답변이 든 기조발언 문답 하나와 남은 시간으로 같은 모양을 보인다. */
    const hist = plan.keynote ? [{ q: AI.KEYNOTE.q, a: "(기조발언 답변이 여기에 들어간다)", group: AI.KEYNOTE.group }] : [];
    const inp = AI.buildNextQuestionInput(cs, hist, s.difficulty, s.variation, plan, plan.keynote ? (plan.interview - plan.keynote) * 60 : undefined);
    return `<details class="promptview" id="pv" ${st.promptOpen ? "open" : ""}><summary>AI 입력 미리 보기 — 제시문 ${cs.passages.length}편 전문 + ${qWord(cs)} ${db.count(cs)}개 포함</summary>
      <p class="small muted" style="margin-top:8px">${plan.keynote ? "기조발언 뒤 " : ""}첫 질문 생성 시 실제 입력. 이후 호출에는 '지금까지의 문답'이 덧붙는다. 결정 트리의 분기 분류 호출만 답변·분기 조건을 보내는 경량 호출.</p>
      <pre><b>[system]</b>\n${esc(inp.system)}\n\n<b>[user]</b>\n${esc(inp.user)}</pre></details>`;
  }
  function sessionAi() { return { provider: st.ai.provider, model: st.ai.model || undefined, effort: st.ai.effort }; }

  /* 설정 화면의 상호작용은 #app에 한 번 위임한다(단계가 바뀔 때마다 innerHTML을 다시 그리므로). */
  app.addEventListener("click", e => {
    if (st.phase !== "setup") return;
    const t = e.target;
    const go = t.closest("[data-goto]"); if (go) { st.step = +go.dataset.goto; renderSetup(); return; }
    const sch = t.closest("[data-school]"); if (sch) { st.schoolId = sch.dataset.school; save({ lastSchool: st.schoolId }); renderSetup(); return; }
    const sb = t.closest("[data-set]"); if (sb) { st.setId = sb.dataset.set; st.schoolId = set().school; if (!db.isMock(st.setId)) save({ lastSet: st.setId, lastSchool: st.schoolId }); st.step = 2; renderSetup(); scrollToStep(2); return; }   // 모의고사 문제는 마지막 기출 세트로 남기지 않는다
    const mb = t.closest("[data-mode]"); if (mb) { st.mode = mb.dataset.mode; save({ lastMode: st.mode }); st.step = 3; renderSetup(); scrollToStep(3); return; }
    const seg = t.closest("[data-seg] button"); if (seg) { save({ [seg.closest("[data-seg]").dataset.seg]: seg.dataset.v }); return; }   // save → settings:change → refreshOptions
    const aseg = t.closest("[data-aiseg] button"); if (aseg) { st.ai.provider = aseg.dataset.v; st.ai.model = ""; st.ai.effort = undefined; refreshOptions(); return; }
    if (t.closest("#aiSaveDefault")) { const ai = AI.resolve(sessionAi()); st.ai.model = ""; st.ai.effort = undefined; save({ provider: ai.provider, [ai.provider + "Model"]: ai.model, [ai.provider + "Effort"]: ai.effort || "medium" }); return; }
    if (t.closest("#optOpenSettings")) { window.SNU.openSettings(); return; }
    if (t.closest("#openRecordsList")) { Records.open(); return; }
    if (t.closest("#startBtn")) { startSession(); return; }
  });
  app.addEventListener("change", e => {
    if (st.phase !== "setup") return;
    const t = e.target;
    if (t.matches("[data-bool]")) save({ [t.dataset.bool]: t.checked });
    else if (t.matches("[data-num]")) { const v = Math.max(+t.min || 0, Math.min(+t.max || 999, +t.value || 0)); save({ [t.dataset.num]: v }); }
    /* 세트 시간표·기조발언: 세션 상태만 고친다(설정에 저장하지 않는다) */
    else if (t.matches("[data-tm]")) { timing()[t.dataset.tm] = Math.max(+t.min || 1, Math.min(+t.max || 60, Math.round(+t.value) || 0)); refreshOptions(); }
    else if (t.matches("[data-tmbool]")) {
      const tm = timing(); tm[t.dataset.tmbool] = t.checked;
      if (t.dataset.tmbool === "on" && t.checked && !tm.keynote) tm.keynote = Math.max(1, Math.round(currentPlan().interview / 2));   // 세트 시간표가 없는 학교: 면접 시간의 절반
      refreshOptions();
    }
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

  function recItem(r) {
    const url = URL.createObjectURL(r.blob);
    return `<div class="recitem"><div style="min-width:0"><div class="q">${esc(r.question)}</div><div class="m">${esc(r.setLabel)} · ${esc(r.modeLabel)} · ${new Date(r.createdAt).toLocaleString("ko-KR")} · ${fmtClock(r.duration)}</div><audio controls preload="none" src="${url}"></audio></div>
      <div class="stack"><a class="btn sm" download="${esc(r.filename)}" href="${url}">내려받기</a><button type="button" class="btn sm ghost" data-del="${r.id}">삭제</button></div></div>`;
  }

  /* ---------------- 세션 시작·단계 전환 ---------------- */
  async function startSession() {
    const err = $("#setupErr"); if (err) err.hidden = true;
    const s = S();
    st.plan = currentPlan(); st.answerMode = s.answerMode; st.kn = null; st.cutNote = "";
    st.variant = set().variant;                       // 세션 동안 복기본 고정(설정을 바꿔도 제시문·질문 은행이 바뀌지 않는다)
    if (st.answerMode === "voice") { try { await recorder.init(); } catch (e) { if (err) { err.textContent = "마이크를 열 수 없다: " + e.message + " — 답변 방식을 텍스트로 바꾸면 마이크 없이 진행된다."; err.hidden = false; } return; } }
    audioCtx(); keepAwake();
    st.sessionId = Date.now().toString(36); st.history = []; st.recordings = []; st.qi = 0; st.cur = null; st.knocked = false; st.memo = ""; st.err = ""; st.treeNode = null; st.pendingBranches = null; st.tab = "passage";
    st.queue = st.mode === "all" ? pool(set()) : [];
    /* 기록에 남길 옵션과 면접관 모델은 시작할 때 고정한다(세션 중 설정을 바꿔도 기록이 흔들리지 않게). */
    const ai = AI.resolve(sessionAi());
    st.startedAt = Date.now(); st.ending = false; st.saveChain = Promise.resolve(); st.saveErr = "";
    st.options = mode().ai ? { difficulty: s.difficulty, variation: s.variation, flow: s.flow } : null;
    st.aiUsed = mode().ai && ai.configured ? { provider: ai.provider, model: ai.model, effort: ai.effort, label: ai.label } : null;
    enterPhase("prep", st.plan.prep * 60);
  }
  /* ---------------- 세션 기록 ----------------
     답변을 제출할 때마다 저장해 탭이 닫혀도 그때까지의 문답이 남는다(endedAt 없음 = 중단). 문답·메모가 없으면 저장하지 않는다. */
  function sessionRecord(final) {
    const cs = set(), m = mode();
    return {
      id: st.sessionId, setId: cs.id, variant: cs.variant, school: cs.school, setLabel: db.label(cs), variantLabel: cs.variantLabel,
      mode: st.mode, modeLabel: m.code + " " + m.label, answerMode: st.answerMode, plan: Object.assign({}, st.plan), options: st.options, ai: st.aiUsed,
      createdAt: st.startedAt, updatedAt: Date.now(), endedAt: final ? Date.now() : null,
      history: st.history.map(h => Object.assign({ q: h.q, a: h.a || "", group: h.group || "", recFilename: h.rec ? h.rec.filename : "", duration: h.rec ? h.rec.duration : 0 },
        Number.isFinite(h.elapsed) ? { elapsed: h.elapsed } : {}, h.cut ? { cut: true } : {})),   // 기조발언 문답만: 경과 초, 끊겼으면 cut
      memo: st.memo
    };
  }
  let memoTimer = 0;
  function saveRecord(final) {
    clearTimeout(memoTimer);
    if (st.ending && !final) return Promise.resolve(false);   // 종료를 시작한 뒤의 중간 저장이 종료 기록을 '중단'으로 되돌리지 않게
    if (!st.history.length && !(final && st.memo.trim())) return Promise.resolve(false);
    const rec = sessionRecord(final);
    st.saveChain = st.saveChain.then(() => Records.saveSession(rec)).catch(() => false).then(saved => { st.saveErr = saved ? "" : "기록 저장 실패: 새로 고침하면 사라진다."; return true; });
    return st.saveChain;
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
    if (st.phase === "interview" && st.cur && st.cur.keynote && st.kn) keynoteTick();
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
    const memo = $("#memo"); if (memo) { const cnt = () => { $("#memoCount").textContent = memo.value.length + "자"; }; cnt(); memo.addEventListener("input", () => { st.memo = memo.value; cnt(); if (st.history.length) { clearTimeout(memoTimer); memoTimer = setTimeout(() => saveRecord(false), 1000); } }); }
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
          <div class="qcard"><div class="qmeta"><span>${esc(setLine(cs))}</span><span>${mode().code} ${esc(mode().label)}</span></div>
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
      const side = st.cur.keynote ? `<span class="chip num${keynoteElapsed() > st.plan.keynote * 60 ? " warn" : ""}" id="knClock">${esc(keynoteLabel())}</span>` : `<span>${st.cur.focus ? "초점: " + esc(st.cur.focus) : ""}</span>`;
      const head = `<div class="qmeta"><span>질문 ${st.history.length + 1}${st.cur.group ? " · " + esc(st.cur.group) + (st.cur.idx ? " Q" + st.cur.idx : "") : ""}</span>${side}</div><p class="qtext">${esc(st.cur.q)}</p>`;
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
    if (st.cutNote && !(st.cur && st.cur.keynote)) body = `<p class="callout warn">${esc(st.cutNote)}</p>` + body;   // 기조발언이 끊겼음을 다음 질문 카드에
    q.innerHTML = body;
    const rs = $("#recStart"); if (rs) rs.addEventListener("click", startAnswer);
    const rp = $("#recStop"); if (rp) rp.addEventListener("click", stopAnswer);
    const rq = $("#readQ"); if (rq) rq.addEventListener("click", () => speak(st.cur.q));
    const nb = $("#nextBtn"); if (nb) nb.addEventListener("click", () => { const t = $("#answerText"); if (t) st.transcript = t.value.trim(); commitAnswer(); });
    const sk = $("#skipBtn"); if (sk) sk.addEventListener("click", () => { st.transcript = ""; commitAnswer(); });
    $$("[data-branch]", q).forEach(b => b.addEventListener("click", () => { const i = +b.dataset.branch; const br = st.pendingBranches[i]; st.pendingBranches = null; st.err = ""; st.treeNode = br.next; showTreeNode(); }));
    const log = $("#qlog"); if (log) { log.innerHTML = st.history.map((h, i) => `<li class="done"><span class="idx">Q${i + 1}</span><span>${esc(h.q)}</span><span class="small muted">${h.rec ? fmtClock(h.rec.duration) : h.a ? h.a.length + "자" : "—"}${h.cut ? " · 끊김" : ""}</span></li>`).join("") + (st.cur ? `<li class="cur"><span class="idx">Q${st.history.length + 1}</span><span>${esc(st.cur.q)}</span><span></span></li>` : ""); }
    const pl = $("#progressLabel"); if (pl) pl.textContent = st.mode === "all" ? `${st.qi}/${st.queue.length}` : `${st.history.length}개 답변`;
  }

  async function startAnswer() {
    st.transcript = ""; st.interim = ""; st.answered = false; st.err = "";
    try { recorder.start(l => { const el = $("#level"); if (el) el.style.width = (l * 100) + "%"; }); } catch (e) { st.err = "녹음을 시작할 수 없다: " + e.message; renderQcard(); return; }
    st.recording = true;
    if (st.cur && st.cur.keynote) st.kn = { start: recorder.startedAt, end: 0, round: 0, pending: false, cut: false };   // 음성 기조발언 시계: 녹음 시작부터(다시 답변하면 처음부터)
    if (S().stt === "webspeech" && stt.available) stt.start((fin, int) => { st.transcript = fin.trim(); st.interim = int; const t = $("#transcript"); if (t) t.innerHTML = (st.transcript ? esc(st.transcript) : "") + (st.interim ? `<span class="interim"> ${esc(st.interim)}</span>` : ""); });
    renderQcard();
  }
  async function stopAnswer() {
    if (!st.recording) return;
    st.recording = false;
    if (st.cur && st.cur.keynote && st.kn && !st.kn.end) st.kn.end = Date.now();
    const spoken = stt.stop(); if (spoken) st.transcript = spoken;
    const t = $("#answerText"); if (t) st.transcript = t.value;
    const out = await recorder.stop();
    if (out && out.blob.size) {
      const cs = set(), n = st.history.length + 1;
      const rec = { id: `${st.sessionId}-${n}`, sessionId: st.sessionId, setId: cs.id, setLabel: db.label(cs), modeLabel: mode().code + " " + mode().label, question: st.cur ? st.cur.q : "", createdAt: Date.now(),
        duration: out.duration, mime: out.mime, blob: out.blob, filename: `${cs.id}_${st.mode}_${st.sessionId}_Q${String(n).padStart(2, "0")}.${extOf(out.mime)}` };
      try { await Records.putRecording(rec); } catch (e) { st.err = "녹음을 브라우저에 저장하지 못했다(" + e.message + ")."; }
      st.recordings.push(rec); st.lastAnswer = rec;
    }
    st.answered = true; renderQcard();
  }
  /* 문답 한 건. 기조발언 문답에는 경과 초(elapsed)와, 끊겼을 때만 cut을 남긴다. */
  function entry() {
    const h = { q: st.cur.q, a: st.transcript, rec: st.lastAnswer || null, group: st.cur.group || "" };
    if (st.cur.keynote && st.kn && st.kn.start) { h.elapsed = Math.round(((st.kn.end || Date.now()) - st.kn.start) / 1000); if (st.kn.cut) h.cut = true; }
    return h;
  }
  function commitAnswer(cutNote) {
    if (!st.cur) return;
    st.cutNote = cutNote || "";                       // 끊김 알림은 다음 질문 카드에만
    st.history.push(entry());
    const answered = st.transcript; st.cur = null; st.answered = false; st.transcript = ""; st.interim = ""; st.lastAnswer = null;
    saveRecord(false);
    nextQuestion(answered);
  }

  /* ---------------- 기조발언 시간 제한(plan.keynote, 1-A · 문제지 문항 있는 세트) ----------------
     시계: 음성은 [답변 시작]부터(다시 답변하면 처음부터), 텍스트는 질문이 뜬 때부터. 답변을 끝내면 멈춘다.
     제한 + 30초에 아직 답변 중이면 1차 판정, 그 뒤 30초마다 다시 판정한다. 확률은 AI가 답변 내용을 보고 정하거나(키 있음·답변 글 있음),
     시간만으로 n차 25·50·75·100%(키 없음·호출 실패·답변 글이 거의 없음). 판정 중에는 다시 부르지 않고, 늦게 온 응답은 버린다. */
  const KEYNOTE_MIN_TEXT = 20;                        // 이보다 짧은 답변 글(음성 인식이 안 되는 브라우저 등)은 내용 검토 없이 시간만으로
  function keynoteElapsed() { const k = st.kn; return k && k.start ? ((k.end || Date.now()) - k.start) / 1000 : 0; }
  function keynoteLabel() { return `기조발언 ${fmtClock(keynoteElapsed())} / ${fmtClock(st.plan.keynote * 60)}`; }
  function keynoteLive() { const k = st.kn; return st.phase === "interview" && !st.ending && !!(st.cur && st.cur.keynote && k && k.start && !k.end) && (st.answerMode === "text" || st.recording); }
  function keynoteText() { const t = $("#answerText"); return t ? t.value.trim() : `${st.transcript} ${st.interim}`.trim(); }   // 텍스트·직접 입력은 입력란, 음성 인식은 확정 + 중간 결과
  function keynoteTick() {
    const k = st.kn, sec = keynoteElapsed(), limit = st.plan.keynote * 60, el = $("#knClock");
    if (el) { el.textContent = keynoteLabel(); el.classList.toggle("warn", sec > limit); }
    if (keynoteLive() && !k.pending && sec >= limit + 30 * (k.round + 1)) judgeKeynote(k, sec);
  }
  async function judgeKeynote(k, sec) {
    const cur = st.cur, n = ++k.round, text = keynoteText();
    let cut = Math.min(100, 25 * n), remark = "";
    k.pending = true;
    if (AI.resolve(sessionAi()).configured && text.length >= KEYNOTE_MIN_TEXT) {
      try { const r = await AI.keynoteCheck(set(), text, { limit: st.plan.keynote, elapsed: sec, round: n }, sessionAi()); cut = r.cut; remark = r.remark.trim(); }
      catch (e) { /* 호출 실패: 시간만의 확률로 판정 */ }
    }
    k.pending = false;
    if (st.kn !== k || st.cur !== cur || !keynoteLive()) return;   // 그 사이 답변을 끝냈거나 다시 시작했거나 질문이 바뀌었다
    if (Math.random() * 100 < cut) cutKeynote(remark);
  }
  async function cutKeynote(remark) {
    const k = st.kn;
    k.end = Date.now(); k.cut = true; beep(1);
    const note = `기조발언 ${fmtClock(keynoteElapsed())} — 면접관이 끊음${remark ? ": " + remark : ""}`;
    if (st.answerMode === "voice") { await stopAnswer(); if (st.ending || st.phase !== "interview") return; }   // 녹음을 멈춰 저장
    else { const t = $("#answerText"); if (t) st.transcript = t.value.trim(); }                                // 적힌 데까지 답변으로
    commitAnswer(note);
  }

  /* ---------------- 다음 질문 결정 ---------------- */
  function interviewRemaining() { return st.phaseEnd ? Math.max(0, Math.ceil((st.phaseEnd - Date.now()) / 1000)) : null; }
  async function nextQuestion(lastAnswer) {
    const cs = set(), s = S(), ai = AI.resolve(sessionAi());
    if (st.mode === "all") {
      if (st.qi >= st.queue.length) { endInterview(); return; }
      st.cur = st.queue[st.qi++]; showQuestion(); return;
    }
    if (st.plan.keynote && !st.history.length) {      // 기조발언: AI를 부르지 않는 고정 첫 질문(문제지 문항은 왼쪽 지시문 상자에 있다)
      st.cur = { q: AI.KEYNOTE.q, group: AI.KEYNOTE.group, focus: "", keynote: true };
      st.kn = { start: st.answerMode === "text" ? Date.now() : 0, end: 0, round: 0, pending: false, cut: false };
      showQuestion(); return;
    }
    if (s.flow === "tree" && db.treeUsable(cs)) {
      if (st.treeNode === null && st.history.length === (st.plan.keynote ? 1 : 0)) { st.treeNode = cs.tree.root; showTreeNode(); return; }
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
      try { const r = await AI.nextQuestion(cs, st.history, s.difficulty, s.variation, sessionAi(), st.plan, interviewRemaining()); st.cur = { q: r.question, focus: r.focus, group: "AI 면접관" }; }
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
    try { const r = await AI.nextQuestion(cs, st.history, s.difficulty, s.variation, sessionAi(), st.plan, interviewRemaining()); st.cur = { q: r.question, focus: r.focus, group: "AI 면접관" }; }
    catch (e) { st.err = "AI 호출 실패: " + e.message + " — 복기 질문 은행으로 대체."; st.cur = bankNext(cs); }
    st.thinking = false; showQuestion();
  }
  /* 질문 은행: 문제지 문항(있으면) → 복기 추가질문. '복기 질문 전부' 모드와 키 없는 대체 경로가 함께 쓴다. */
  function pool(cs) { return [...(cs.tasks || []).map(t => ({ q: `${AI.taskHead(t)}. ${t.text}`, group: "문제" })), ...AI.bank(cs)]; }
  function bankNext(cs) {
    const asked = new Set(st.history.map(h => h.q));
    return pool(cs).find(x => !asked.has(x.q) && !(st.plan.keynote && x.group === "문제")) || null;   // 기조발언에서 문제지 문항에 이미 답했다
  }
  function showQuestion() { if (!st.cur) { endInterview(); return; } st.answered = false; st.transcript = ""; st.interim = ""; renderQcard(); speak(st.cur.q); }

  /* ---------------- 종료 ---------------- */
  async function endInterview() {
    if (st.ending) return;                            // 시간 종료와 [면접 종료]가 겹쳐도 한 번만 마친다
    st.ending = true;
    clearInterval(st.tick);
    if (st.recording) await stopAnswer();
    if (st.cur && (st.answered || (st.answerMode === "text" && $("#answerText") && $("#answerText").value.trim()))) { const t = $("#answerText"); if (t) st.transcript = t.value.trim(); st.history.push(entry()); }
    st.cur = null;                                    // 남은 [제출]이 같은 질문을 다시 넣지 않게
    try { speechSynthesis.cancel(); } catch (e) {}
    st.phase = "done"; await finishSession();
  }
  /* 종료 화면의 질문 전체: 기출은 복기 추가질문 묶음, 모의고사는 문항 + 추가질문(번호는 책처럼 문항 뒤로 이어진다). */
  function allQuestions(cs) {
    const groups = cs.mock ? [{ label: "문항", items: (cs.tasks || []).map(t => `${AI.taskHead(t)}. ${t.text}`) }, ...cs.followups] : [...cs.followups, ...(cs.common || [])];
    let n = 0;
    const html = groups.filter(f => !cs.mock || f.items.length).map(f => `<div class="panel tight"><h3 class="h3" style="margin-bottom:6px">${esc(f.label)}</h3><ol class="qlist">${f.items.map((q, i) => `<li><span class="idx">Q${cs.mock ? ++n : i + 1}</span><span>${esc(q)}</span><span></span></li>`).join("")}</ol></div>`).join("");
    return `<section class="sec"><div class="sec-head"><h2 class="h2">${cs.mock ? "이 문제의 질문 전체" : "이 세트의 복기 질문 전체"}</h2></div>
        ${html}</section>`;
  }
  async function finishSession() {
    recorder.release(); stt.stop(); if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    app.classList.remove("in-session");
    const saved = !!(st.history.length || st.memo.trim()), sessionId = st.sessionId;   // 저장할 기록이 있는지(저장은 화면을 그린 뒤)
    const cs = set(), m = mode();
    const total = st.history.reduce((n, h) => n + (h.rec ? h.rec.duration : 0), 0);
    app.innerHTML = `
      <section class="sec">
        <div class="eyebrow">${esc([db.label(cs), cs.variantLabel].filter(Boolean).join(" · "))} · ${m.code} ${esc(m.label)} · ${st.answerMode === "voice" ? "음성" : "텍스트"}</div>
        <h1 class="h1">면접 종료</h1>
        <div class="row"><span class="chip">질문 ${st.history.length}</span>${st.answerMode === "voice" ? `<span class="chip">녹음 ${st.history.filter(h => h.rec).length} · ${fmtClock(total)}</span>` : `<span class="chip">답변 ${st.history.filter(h => h.a).length}</span>`}${st.memo ? `<span class="chip">메모 ${st.memo.length}자</span>` : ""}</div>
        <div class="row"><button type="button" class="btn primary" id="again">같은 세트 다시</button><a class="btn" href="practice.html">다른 세트</a>${cs.mock ? `<a class="btn ghost" href="mock.html#${esc(cs.id)}">모의고사에서 보기</a>` : `<a class="btn ghost" href="db.html#${esc(cs.id)}">기출DB에서 보기</a>`}${saved ? '<button type="button" class="btn ghost" id="openRecord" disabled>기록 보기</button>' : ""}</div>
        <p class="callout warn" id="saveErr" hidden></p>
      </section>
      ${saved && st.history.length ? '<section class="sec"><div class="sec-head"><h2 class="h2">AI 피드백</h2></div><div class="stack" id="feedback"><p class="small muted">저장 중…</p></div></section>' : ""}
      ${st.answerMode === "voice" ? `<section class="sec"><div class="sec-head"><h2 class="h2">이번 세션 녹음</h2></div><div class="reclist" id="sessionRecs"></div></section>` : ""}
      <section class="sec"><div class="sec-head"><h2 class="h2">문답 기록</h2></div>
        <ol class="qlist">${st.history.map((h, i) => `<li class="done"><span class="idx">Q${i + 1}</span><span><b>${esc(h.q)}</b><br><span class="small muted">${esc(h.a || "(답변 기록 없음)")}</span></span><span class="small muted">${h.rec ? fmtClock(h.rec.duration) : Number.isFinite(h.elapsed) ? fmtClock(h.elapsed) : "—"}${h.cut ? " · 끊김" : ""}</span></li>`).join("") || '<li><span></span><span class="muted">기록 없음</span><span></span></li>'}</ol></section>
      ${st.memo ? `<section class="sec"><div class="sec-head"><h2 class="h2">메모</h2></div><pre class="panel" style="white-space:pre-wrap;font:inherit">${esc(st.memo)}</pre></section>` : ""}
      ${allQuestions(cs)}`;
    $("#again").addEventListener("click", () => { st.phase = "setup"; st.step = 3; st.variant = ""; renderSetup(); });
    const el = $("#sessionRecs");
    if (el) {
      if (st.recordings.length) { el.innerHTML = st.recordings.map(recItem).join(""); $$("[data-del]", el).forEach(b => b.addEventListener("click", async () => { await Records.deleteRecording(b.dataset.del, sessionId); b.closest(".recitem").remove(); })); }
      else el.innerHTML = '<p class="small muted">녹음 없음</p>';
    }
    /* 종료 시각을 남긴 뒤 [기록 보기]·피드백 영역을 붙인다. 그 사이 다른 화면으로 옮겼으면 붙이지 않는다. */
    if (!saved) return;
    const record = $("#openRecord"), fb = $("#feedback"), err = $("#saveErr");
    await saveRecord(true);
    if (!record.isConnected) return;
    record.disabled = false; record.addEventListener("click", () => Records.open(sessionId));
    if (st.saveErr) { err.textContent = st.saveErr; err.hidden = false; }
    if (fb) Records.mountFeedback(fb, sessionId);
  }

  renderSetup();
})();
