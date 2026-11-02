/* ============================================================
   공통 스크립트: 설정 저장소, 테마·블루라이트·글자 크기 적용, 설정 서랍, 앱바, 시간표 띠, 모델 목록.
   모든 페이지가 먼저 읽는다. 설정은 localStorage에 저장하며 서버로 보내지 않는다.
   ============================================================ */
(function () {
  "use strict";
  const KEY = "snu-iv-settings-v1";
  const SITE = "서울대학교 법학전문대학원 면접전형 대비";
  const DEFAULTS = {
    theme: "system",            // system | light | dark
    bluelight: "off",           // off | low | mid | high
    fontScale: "md",            // sm | md | lg | xl
    /* AI 기본값 — 모의면접 옵션 창과 기출DB에 기본으로 뜨고, 그 자리에서 바꿀 수 있다 */
    provider: "anthropic",      // anthropic | openai
    anthropicKey: "", anthropicModel: "claude-sonnet-5-5",
    openaiKey: "", openaiModel: "gpt-6.1-sol",
    /* 모의면접 기본값 — 옵션 창에서 고른 값이 마지막에 쓴 값으로 저장된다 */
    answerMode: "voice",        // voice | text
    stt: "webspeech",           // webspeech | manual
    tts: true,
    flow: "tree",               // tree | live
    waitEnabled: true, waitMinutes: 5,
    prepMinutes: 20, interviewMinutes: 15,
    knock: true,
    difficulty: "mid",          // low | mid | high | max
    variation: "mid",           // low | mid | high
    variant: "merged",          // 기본 복기본: merged(통합) | hwang | kim. 세트에 없으면 kim으로 대체(db.pick)
    lastSchool: "snu", lastSet: "snu-2023-A", lastMode: "timed"
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }
  };
  const settings = Object.assign({}, DEFAULTS);
  try { Object.assign(settings, JSON.parse(store.get(KEY) || "{}")); } catch (e) { /* 손상된 값은 무시 */ }
  if (settings.lastSet && !/^[a-z]+-\d{4}-/.test(settings.lastSet)) settings.lastSet = "snu-" + settings.lastSet;   // 이전 샘플의 세트 id 보정
  if (settings.openaiModel === "gpt-5") settings.openaiModel = DEFAULTS.openaiModel;                                 // 이전 샘플의 기본값 보정

  function save(patch) {
    Object.assign(settings, patch || {});
    store.set(KEY, JSON.stringify(settings));
    apply();
    document.dispatchEvent(new CustomEvent("settings:change", { detail: settings }));
  }
  function apply() {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", settings.theme);
    root.setAttribute("data-font", settings.fontScale);
    root.setAttribute("data-bluelight", settings.bluelight);
  }
  apply();

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 모델 목록(data/models.js) ---------- */
  const models = {
    list(provider) { return (window.MODEL_CATALOG && window.MODEL_CATALOG[provider]) || []; },
    label(provider, id) { const m = this.list(provider).find(x => x.id === id); return m ? m.label : (id || "모델 미지정"); },
    providerLabel(p) { return p === "anthropic" ? "Claude" : "ChatGPT"; },
    /* <select> + 직접 입력 칸. 바뀌면 onChange(id)를 부른다. */
    select(provider, cur, opts) {
      opts = opts || {};
      const list = this.list(provider), known = list.some(x => x.id === cur);
      return `<span class="modelsel" data-provider="${provider}"><select class="input ${opts.sm ? "sm" : ""}" aria-label="모델" ${opts.style ? `style="${opts.style}"` : ""}>${list.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? "selected" : ""}>${esc(m.label)}</option>`).join("")}<option value="__custom" ${known ? "" : "selected"}>직접 입력…</option></select><input class="input ${opts.sm ? "sm" : ""}" type="text" placeholder="모델 ID" value="${known ? "" : esc(cur || "")}" ${known ? "hidden" : ""} aria-label="모델 ID 직접 입력" ${opts.style ? `style="${opts.style}"` : ""}></span>`;
    },
    bind(root, onChange) {
      $$(".modelsel", root).forEach(w => {
        const sel = $("select", w), inp = $("input", w);
        sel.addEventListener("change", () => { if (sel.value === "__custom") { inp.hidden = false; inp.focus(); if (inp.value.trim()) onChange(inp.value.trim(), w.dataset.provider); } else { inp.hidden = true; onChange(sel.value, w.dataset.provider); } });
        inp.addEventListener("change", () => { if (inp.value.trim()) onChange(inp.value.trim(), w.dataset.provider); });
      });
    }
  };

  /* ---------- 시간표 띠 ----------
     plan: { prep, wait, interview } (분; wait 0이면 생략, interview 0이면 무제한 ∞)
     opts: { cls, phase: 현재 단계 id | null(계획 표시), progress: 0~1, crit }  */
  function timeline(plan, opts) {
    opts = opts || {};
    const segs = [["prep", "준비", plan.prep], ["wait", "대기", plan.wait], ["interview", "면접", plan.interview]].filter(s => s[0] === "interview" || s[2] > 0);
    const weight = s => s[2] > 0 ? s[2] : Math.max(10, plan.prep || 15);
    const total = segs.reduce((n, s) => n + weight(s), 0);
    const ci = opts.phase ? segs.findIndex(s => s[0] === opts.phase) : -1;
    return `<div class="tl ${opts.cls || ""}" role="img" aria-label="${segs.map(s => `${s[1]} ${s[2] > 0 ? s[2] + "분" : "무제한"}`).join(", ")}">${segs.map((s, i) => {
      const w = weight(s), share = w / total;
      const state = ci < 0 ? "plan" : i < ci ? "done" : i === ci ? "cur" + (opts.crit ? " crit" : "") : "todo";
      const fill = i === ci ? Math.round((opts.progress || 0) * 100) : 0;
      return `<div class="tl-seg ${state} ${share < .16 ? "narrow" : ""}" data-k="${s[0]}" style="--w:${w}"${i === ci ? ' id="tlCur"' : ""}><i style="width:${fill}%"></i><span class="tl-n">${s[1]}</span><span class="tl-m num">${s[2] > 0 ? s[2] + "분" : "∞"}</span></div>`;
    }).join("")}</div>`;
  }

  /* ---------- 앱바 ---------- */
  function mountAppbar() {
    const page = document.body.dataset.page || "";
    const gear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    const bar = document.createElement("header");
    bar.className = "appbar";
    const cur = p => page === p ? 'aria-current="page"' : "";
    bar.innerHTML = `<div class="appbar-in">
      <a class="brand" href="index.html"><b>${SITE}</b></a>
      <nav class="nav" aria-label="화면">
        <a href="index.html" ${cur("home")}>홈</a>
        <a href="practice.html" ${cur("practice")}>모의면접</a>
        <a href="db.html" ${cur("db")}>기출DB</a>
        <a href="library.html" ${cur("library")}>서가</a>
      </nav>
      <button type="button" class="iconbtn" id="openSettings" aria-label="설정" title="설정">${gear}</button>
    </div>`;
    document.body.prepend(bar);
    const bl = document.createElement("div"); bl.className = "bluelight"; bl.setAttribute("aria-hidden", "true");
    document.body.append(bl);
    $("#openSettings").addEventListener("click", openSettings);
  }

  /* ---------- 설정 서랍 ---------- */
  let drawer = null, shade = null, lastFocus = null;
  function seg(name, opts, cur) {
    return `<div class="seg" role="group" data-seg="${name}">${opts.map(o => `<button type="button" data-v="${o[0]}" aria-pressed="${cur === o[0]}">${o[1]}</button>`).join("")}</div>`;
  }
  function keyField(id, label, key, placeholder) {
    const has = !!settings[key];
    return `<div class="field"><label for="${id}">${label}</label><div class="keyrow"><input class="input" id="${id}" type="password" autocomplete="off" placeholder="${placeholder}" value="${esc(settings[key])}"><button type="button" class="btn" data-savekey="${key}" data-for="${id}">저장</button><button type="button" class="btn ghost" data-clearkey="${key}" data-for="${id}" ${has ? "" : "disabled"}>지우기</button><span class="st" id="${id}St">${has ? "이 브라우저에 저장됨" : "저장된 키 없음"}</span></div></div>`;
  }
  function openSettings() {
    if (drawer) return;
    lastFocus = document.activeElement;
    shade = document.createElement("div"); shade.className = "shade"; shade.addEventListener("click", closeSettings);
    drawer = document.createElement("aside"); drawer.className = "drawer"; drawer.setAttribute("role", "dialog"); drawer.setAttribute("aria-modal", "true"); drawer.setAttribute("aria-labelledby", "dTitle");
    const s = settings;
    drawer.innerHTML = `
      <div class="d-top"><h2 class="d-title" id="dTitle">설정</h2><button type="button" class="btn ghost sm" id="closeSettings">닫기</button></div>
      <p class="small muted">이 브라우저에만 저장된다.</p>

      <section class="d-sec">
        <h3>화면</h3>
        <div class="field"><span class="lab">테마</span>${seg("theme", [["system", "시스템"], ["light", "밝게"], ["dark", "어둡게"]], s.theme)}</div>
        <div class="field"><span class="lab">블루라이트 차단</span>${seg("bluelight", [["off", "없음"], ["low", "하"], ["mid", "중"], ["high", "상"]], s.bluelight)}</div>
        <div class="field"><span class="lab">글자 크기</span>${seg("fontScale", [["sm", "작게"], ["md", "보통"], ["lg", "크게"], ["xl", "아주 크게"]], s.fontScale)}</div>
      </section>

      <section class="d-sec">
        <h3>AI 면접관</h3>
        <p class="d-desc">API 키는 이 브라우저(localStorage)에만 저장되고 해당 제공사 서버로만 전송된다. 저장소에는 넣지 않는다.</p>
        <div class="field"><span class="lab">기본 제공사</span>${seg("provider", [["anthropic", "Claude"], ["openai", "ChatGPT"]], s.provider)}</div>
        ${keyField("sAnthropicKey", "Anthropic API 키", "anthropicKey", "sk-ant-…")}
        <div class="field"><span class="lab">Claude 기본 모델</span>${models.select("anthropic", s.anthropicModel)}</div>
        ${keyField("sOpenaiKey", "OpenAI API 키", "openaiKey", "sk-…")}
        <div class="field"><span class="lab">ChatGPT 기본 모델</span>${models.select("openai", s.openaiModel)}</div>
      </section>

      <section class="d-sec">
        <h3>모의면접 기본값</h3>
        <div class="field"><span class="lab">답변 방식</span>${seg("answerMode", [["voice", "음성"], ["text", "텍스트"]], s.answerMode)}</div>
        <div class="field"><span class="lab">흐름</span>${seg("flow", [["tree", "사전 결정 트리"], ["live", "실시간 생성"]], s.flow)}</div>
        <div class="field"><span class="lab">복기본</span>${seg("variant", VARIANT_KEYS.map(k => [k, VARIANT_LABEL[k]]), s.variant)}</div>
        <div class="field"><span class="lab">전사(음성 답변)</span>${seg("stt", [["webspeech", "브라우저 음성 인식"], ["manual", "직접 입력"]], s.stt)}</div>
        <label class="switch"><input type="checkbox" id="sTts" ${s.tts ? "checked" : ""}><span>질문 음성 읽기</span></label>
        <div class="grid3">
          <div class="field"><label for="sPrep">준비(분)</label><input class="input" id="sPrep" type="number" min="1" max="60" value="${s.prepMinutes}"></div>
          <div class="field"><label for="sWait">대기(분)</label><input class="input" id="sWait" type="number" min="0" max="60" value="${s.waitMinutes}"></div>
          <div class="field"><label for="sInt">면접(분)</label><input class="input" id="sInt" type="number" min="1" max="60" value="${s.interviewMinutes}"></div>
        </div>
        <label class="switch"><input type="checkbox" id="sKnock" ${s.knock ? "checked" : ""}><span>종료 1분 전 노크</span></label>
      </section>

      <section class="d-sec">
        <h3>초기화</h3>
        <button type="button" class="btn danger sm" id="sReset">설정 초기화(키 포함)</button>
      </section>`;
    document.body.append(shade, drawer);
    document.body.style.overflow = "hidden";
    drawer.addEventListener("click", e => {
      const b = e.target.closest("[data-seg] button");
      if (b) { const name = b.closest("[data-seg]").dataset.seg; save({ [name]: b.dataset.v }); $$("button", b.parentElement).forEach(x => x.setAttribute("aria-pressed", x === b)); return; }
      const sk = e.target.closest("[data-savekey]"); if (sk) { const inp = $("#" + sk.dataset.for, drawer); save({ [sk.dataset.savekey]: inp.value.trim() }); $("#" + sk.dataset.for + "St", drawer).textContent = inp.value.trim() ? "이 브라우저에 저장됨" : "저장된 키 없음"; $(`[data-clearkey="${sk.dataset.savekey}"]`, drawer).disabled = !inp.value.trim(); return; }
      const ck = e.target.closest("[data-clearkey]"); if (ck) { save({ [ck.dataset.clearkey]: "" }); $("#" + ck.dataset.for, drawer).value = ""; $("#" + ck.dataset.for + "St", drawer).textContent = "저장된 키 없음"; ck.disabled = true; return; }
      if (e.target.closest("#closeSettings")) closeSettings();
      if (e.target.closest("#sReset")) { Object.keys(settings).forEach(k => delete settings[k]); save(Object.assign({}, DEFAULTS)); closeSettings(); openSettings(); }
    });
    const bind = (id, key, map) => $("#" + id, drawer).addEventListener("change", e => save({ [key]: map ? map(e.target) : e.target.value }));
    bind("sTts", "tts", t => t.checked); bind("sKnock", "knock", t => t.checked);
    bind("sWait", "waitMinutes", t => Math.max(0, +t.value || 0)); bind("sPrep", "prepMinutes", t => Math.max(1, +t.value || 20)); bind("sInt", "interviewMinutes", t => Math.max(1, +t.value || 15));
    $$("#sAnthropicKey, #sOpenaiKey", drawer).forEach(inp => inp.addEventListener("keydown", e => { if (e.key === "Enter") $(`[data-for="${inp.id}"][data-savekey]`, drawer).click(); }));
    models.bind(drawer, (id, provider) => save({ [provider === "anthropic" ? "anthropicModel" : "openaiModel"]: id }));
    $("#closeSettings", drawer).focus();
  }
  function closeSettings() {
    if (!drawer) return;
    drawer.remove(); shade.remove(); drawer = shade = null; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer) closeSettings(); });

  /* ---------- 기출 데이터 접근(데이터 파일이 있는 페이지에서만) ----------
     세트는 복기본 변형(set.variants: merged | hwang | kim)을 가진다(docs/DATA.md §1). 여기서 변형 하나를 골라
     passages·followups·common이 세트 위에 펼쳐진 "해석된 세트"를 돌려주므로 소비자는 변형 구조를 몰라도 된다.
     고르는 순서: 인자 v → URL ?variant= → 설정 variant → 세트 기본값(set.variant). 세트에 없으면 kim, 그것도 없으면 첫 변형. */
  const VARIANT_KEYS = ["merged", "hwang", "kim"];
  const VARIANT_LABEL = { merged: "통합(AI)", hwang: "황변", kim: "김종수" };
  const urlVariant = () => { try { return new URLSearchParams(location.search).get("variant") || ""; } catch (e) { return ""; } };
  const db = {
    raw() { return (window.INTERVIEW_DB && window.INTERVIEW_DB.schools) || []; },
    pick(set, v) {
      const keys = set.variants ? Object.keys(set.variants) : [];
      if (!keys.length) return null;
      const want = v || urlVariant() || settings.variant || set.variant;
      return keys.includes(want) ? want : keys.includes("kim") ? "kim" : keys[0];
    },
    resolve(set, v) {
      if (!set || !set.variants) return set;
      const k = this.pick(set, v), out = Object.assign({}, set, set.variants[k]);
      out.variant = k; out.defaultVariant = set.variant; out.variantKeys = Object.keys(set.variants); out.variantLabel = set.variants[k].label || VARIANT_LABEL[k];
      delete out.variants;
      return out;
    },
    schools(v) { return this.raw().map(sc => Object.assign({}, sc, { sets: sc.sets.map(s => this.resolve(s, v)) })); },
    school(id, v) { return this.schools(v).find(s => s.id === id) || null; },
    sets(v) { return this.schools(v).flatMap(s => s.sets); },
    set(id, v) { const s = this.raw().flatMap(sc => sc.sets).find(x => x.id === id); return s ? this.resolve(s, v) : null; },
    label(set) { return `${set.year}학년도 ${set.name}`; },
    count(set) { return set.followups.reduce((n, f) => n + f.items.length, 0) + (set.common || []).reduce((n, c) => n + c.items.length, 0); },
    /* 기출DB 문답 키 접두사: kim은 접두사 없음(기존 저장 데이터와 호환), 그 밖은 "<variant>/" */
    keyPrefix(set) { return set.variant && set.variant !== "kim" ? set.variant + "/" : ""; },
    variantLabel(k) { return VARIANT_LABEL[k] || k; },
    variantKeys: VARIANT_KEYS,
    /* 복기본 seg의 버튼들: 눌림은 실효 변형, 비활성은 세트에 없는 변형. 감싸는 .seg는 호출하는 쪽이 둔다(클릭 위임 속성이 다르다). */
    variantButtons(set) { return VARIANT_KEYS.map(k => `<button type="button" data-v="${k}" aria-pressed="${set.variant === k}" ${(set.variantKeys || []).includes(k) ? "" : "disabled"}>${VARIANT_LABEL[k]}</button>`).join(""); },
    /* 트리는 한 복기본의 문구에 묶여 있다(tree.basis). 실효 변형이 다르면 쓰지 않는다. */
    treeUsable(set) { return !!(set.tree && (!set.tree.basis || set.tree.basis === set.variant)); }
  };

  /* ---------- 공개 ---------- */
  window.SNU = { SITE, settings, save, store, $, $$, esc, openSettings, DEFAULTS, timeline, db, models,
    fmtClock(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAppbar); else mountAppbar();
})();
