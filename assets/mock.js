/* ============================================================
   모의고사 — 학교별 실전 모의고사의 진행 조건·지시문·제시문·문항·추가질문을 본다.
   · 자리 = 묶음(data/mocks.js MOCK_DB.series, 순서 그대로 탭): 2027 고려대 AI 모의고사 · 김종수 모의고사.
   · 목록은 학교 순서(MOCK_DB.schools = 서울대 → 고려대 → … → 이화여대)로 이어진다. 기출DB처럼 연도로 묶지 않는다.
     교재 문제의 행은 학교 약칭 · 문제 번호, 분류가 있는 문제(AI 묶음: code·field·level)는 난이도 별 다섯 개 · 분야 넘버링(예: 인문 A).
   · 분류가 있는 묶음만 정렬을 고른다(설정 mockSort): 분야별(기본, 분야 머리) · 난이도 높은순 · 낮은순. 교재 묶음은 학교 순서 그대로.
   · 상세 머리(head): 묶음·학교·문제 번호(분류가 있으면 난이도 별), 주제, [이 문제로 모의면접], 진행 조건(시간표 띠 + 책의 header 줄).
     나머지는 기출DB와 같은 상세(assets/db.js window.DBDetail): AI 바, 지시문·문항·제시문, 제시문 해설, 녹음본 피드백,
     문항·추가질문(추가질문 번호는 문항 뒤로 이어진다)의 질문별 문답·예시답변. 문제는 SNU.db.set(문제 id)로 푼 세트다.
   · 주제는 기출DB와 같은 주제 가림 설정(dbHideThemes)을 따른다. 해시 #<문제 id>로 문제를, #<자리 id>(예: #ai)로 자리를 연다.
   · db.js가 쓰는 창구: window.MockPage = { render(), current(), head(세트) }.
   ============================================================ */
(function () {
  "use strict";
  const { $, esc, save, timeline, db } = window.SNU;
  const S = () => window.SNU.settings;
  const DD = window.DBDetail;   // db.js(mock.js보다 먼저 읽는다)
  const app = $("#app");
  const M = window.MOCK_DB || { schools: [], series: [] };

  /* ---------- 자리·문제 ---------- */
  const NONE = { id: "", name: "모의고사", sets: [] };   // 묶음이 하나도 없을 때
  const sources = () => M.series;
  const source = id => sources().find(s => s.id === id) || null;
  const find = id => { for (const src of sources()) { const set = src.sets.find(x => x.id === id); if (set) return { src, set }; } return null; };
  const school = id => M.schools.find(s => s.id === id) || { id, name: id, short: id };
  const followupCount = x => (x.followups || []).reduce((n, g) => n + g.items.length, 0);
  /* 분류(AI 묶음): 넘버링 라벨 '분야·분야 넘버링'(예: 법학·과학기술 B), 난이도 별 다섯 개(★ level개 + ☆). 교재 문제는 '문제 184' */
  const rated = x => Number.isInteger(x.level) && x.level >= 0 && x.level <= 5;
  const label = x => x.code ? [(x.field || []).join("·"), x.code].filter(Boolean).join(" ") : "문제 " + x.no;
  /* 정렬(분류 묶음만, 설정 mockSort). 분야 순서는 docs/MOCK_CLASSIFY.md·tools/validate-data.js MOCK_FIELDS와 같다.
     분야별: 첫 분야 순 → 단일 분야가 병기보다 앞 → 넘버링 순. 난이도: level 순 → 같으면 분야별 순서(level 없는 문제는 뒤) */
  const FIELDS = ["법학", "인문", "사회", "경제", "과학기술"];
  const SORTS = [["field", "분야별", ""], ["levelDesc", "난이도 높은순", ""], ["levelAsc", "난이도 낮은순", ""]];
  const sortable = src => src.sets.some(x => Array.isArray(x.field));
  const sortKey = () => SORTS.some(s => s[0] === S().mockSort) ? S().mockSort : "field";
  const fieldRank = x => { const i = FIELDS.indexOf((x.field || [])[0]); return i < 0 ? FIELDS.length : i; };
  const byField = (a, b) => fieldRank(a) - fieldRank(b) || (a.field || []).length - (b.field || []).length || String(a.code || "").localeCompare(String(b.code || "")) || a.no - b.no;
  const lvOf = x => rated(x) ? x.level : -1;
  const byLevel = dir => (a, b) => (lvOf(a) < 0) - (lvOf(b) < 0) || dir * (lvOf(a) - lvOf(b)) || byField(a, b);
  function sortedSets(src) {
    if (!sortable(src)) return src.sets;
    const k = sortKey();
    return [...src.sets].sort(k === "levelDesc" ? byLevel(-1) : k === "levelAsc" ? byLevel(1) : byField);
  }
  const firstSet = src => src.sets.length ? sortedSets(src)[0].id : "";   // 해시 없이 연 자리의 첫 문제 = 보이는 순서의 첫 행
  const stars = (x, cls) => `<span class="${cls ? cls + " " : ""}lv" role="img" aria-label="난이도 ${x.level}/5">${"★".repeat(x.level)}<span class="off">${"☆".repeat(5 - x.level)}</span></span>`;

  const st = { src: "", setId: "" };
  function fromHash() {
    const h = (location.hash || "").slice(1), hit = h && find(h);
    if (hit) { st.src = hit.src.id; st.setId = hit.set.id; return; }
    const src = (h && source(h)) || sources().find(s => s.sets.length) || M.series[0] || NONE;
    st.src = src.id; st.setId = firstSet(src);
  }

  /* ---------- 화면 ---------- */
  /* 목록 열(.dbside.fit)은 화면보다 길면 안에서 스크롤한다. 다시 그려도 같은 자리의 스크롤을 지키고,
     reveal이면(해시로 연 문제) 고른 행이 열 안에 보이게 한다. */
  let renderedSrc = "";
  function render(focus, reveal) {
    const src = source(st.src) || NONE, hit = st.setId ? find(st.setId) : null, hide = !!S().dbHideThemes;
    const cs = hit && hit.src === src ? db.set(hit.set.id) : null, drafts = DD.keep(cs);
    const oldSide = $(".dbside", app), sideTop = oldSide && renderedSrc === src.id ? oldSide.scrollTop : 0;
    app.innerHTML = `
      <section class="sec" style="gap:6px">
        <div class="eyebrow">모의고사</div>
        <h1 class="h1">학교별 실전 모의고사</h1>
      </section>
      <div class="schooltabs" role="group" aria-label="모의고사">${sources().map(s => `<button type="button" data-src="${esc(s.id)}" aria-pressed="${s.id === src.id}" class="${s.sets.length ? "" : "empty"}">${esc(s.name)}${s.sets.length ? `<span class="n">${s.sets.length}</span>` : ""}</button>`).join("")}</div>
      ${src.sets.length ? `<div class="dbgrid ${hide ? "themes-hidden" : ""}">
        <aside class="dbside fit">
          <div class="dbtools" role="group" aria-label="모의고사 표시">
            <button type="button" class="btn sm ${hide ? "primary" : ""}" id="toggleThemes" aria-pressed="${hide}">${hide ? "주제 보이기" : "주제 가리기"}</button>
            ${sortable(src) ? sortHtml() : ""}
          </div>
          <div class="setrows byschool">${rowsHtml(src, hide)}</div>
        </aside>
        <div class="dbmain" id="main">${cs ? DD.html(cs) : ""}</div>
      </div>` : `<div class="empty-school"><b>${esc(src.name)} — 추가 예정</b></div>`}`;
    renderedSrc = src.id;
    DD.mount(cs, drafts);
    fitTabs();
    const side = $(".dbside", app);
    if (side) {
      side.scrollTop = sideTop;
      const cur = reveal && $(".setrow[aria-pressed='true']", side);
      if (cur && side.scrollHeight > side.clientHeight) {
        const top = cur.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop;
        if (top < side.scrollTop || top + cur.offsetHeight > side.scrollTop + side.clientHeight) side.scrollTop = Math.max(0, top - 8);
      }
    }
    if (focus) { const el = app.querySelector(focus); if (el) el.focus({ preventScroll: true }); }
  }
  /* 자리 탭은 한 줄에 다 보이게: 넘치면(좁은 화면·큰 글자) .tight — 문제 수를 빼고 좌우 여백을 줄인다 */
  function fitTabs() {
    const t = $(".schooltabs", app);
    if (!t) return;
    t.classList.remove("tight");
    if (t.scrollWidth > t.clientWidth) t.classList.add("tight");
  }
  /* 정렬 버튼 셋(.btn.sm, 고른 것 primary·aria-pressed). 도구 줄이 좁으면 주제 가리기 아래 줄로 내려간다 */
  function sortHtml() {
    const k = sortKey();
    return `<div class="row" role="group" aria-label="정렬">${SORTS.map(([id, text, aria]) => `<button type="button" class="btn sm ${id === k ? "primary" : ""}" data-sort="${id}" aria-pressed="${id === k}"${aria ? ` aria-label="${aria}"` : ""}>${text}</button>`).join("")}</div>`;
  }
  /* 목록 행. 분야별 정렬이면 첫 분야가 바뀌는 자리에 분야 머리(.setyear. 병기 문제는 첫 분야 묶음에) */
  function rowsHtml(src, hide) {
    const heads = sortable(src) && sortKey() === "field";
    let prev = null;
    return sortedSets(src).map(x => {
      const f = heads ? (x.field || [])[0] || "분야 없음" : null, head = heads && f !== prev ? `<div class="setyear">${esc(f)}</div>` : "";
      prev = f;
      return head + row(x, hide);
    }).join("");
  }
  /* 세트 행(기출DB와 같은 .setrow): 연도 자리에 학교 약칭(분류가 있으면 난이도 별), 이름 자리에 문제 번호(분류가 있으면 분야 넘버링) */
  function row(x, hide) {
    const f = x.format, nf = followupCount(x);
    return `<button type="button" class="setrow" data-set="${esc(x.id)}" aria-pressed="${x.id === st.setId}">
      ${rated(x) ? stars(x, "yr") : `<span class="yr">${esc(school(x.school).short)}</span>`}
      <span><span class="nm">${esc(label(x))}</span><br><span class="th dbtheme" aria-hidden="${hide}">${esc(x.themes.join(" · "))}</span></span>
      <span class="mt"><span>제시문 ${x.passages.length}</span><span>문항 ${x.tasks.length}</span>${nf ? `<span>추가질문 ${nf}</span>` : ""}<span>준비 ${esc(f.prep)}분</span><span>면접 ${esc(f.duration)}분</span>${f.keynote ? `<span>기조발언 ${esc(f.keynote)}분</span>` : ""}</span></button>`;
  }
  /* 상세 머리(db.js setDetail이 부른다). x는 SNU.db가 푼 문제(원본 필드 + seriesName 등). 아래로 AI 바·제시문·문답은 db.js가 잇는다. */
  function head(x) {
    const f = x.format, nf = followupCount(x), hide = !!S().dbHideThemes, ref = x.source ? [x.source.book, x.source.pages ? "p." + x.source.pages : ""].filter(Boolean).join(" · ") : "";
    return `<div class="sethead">
        <div class="eyebrow">${esc(x.seriesName)} · ${esc(school(x.school).name)} · ${rated(x) ? stars(x) : esc(label(x))}</div>
        <h2 class="h1">${esc(x.name)}</h2>
        <div class="row dbtheme" aria-hidden="${hide}">${x.themes.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        ${ref ? `<div class="row"><span class="small muted">${esc(ref)}</span></div>` : ""}
        <div class="row"><a class="btn primary" href="practice.html?set=${esc(x.id)}">이 문제로 모의면접</a><span class="small muted">제시문 ${x.passages.length} · 문항 ${x.tasks.length}${nf ? ` · 추가질문 ${nf}` : ""}</span></div>
      </div>
      <section class="panel tight stack" aria-label="진행 조건">
        ${timeline({ prep: f.prep, wait: 0, interview: f.duration })}
        <ul class="study-list">${(x.header || []).map(h => `<li>${esc(h)}</li>`).join("")}</ul>
      </section>`;
  }

  /* ---------- 상호작용(위임) ---------- */
  let pendingFocus = "";
  app.addEventListener("click", e => {
    const t = e.target;
    const tab = t.closest("[data-src]");
    if (tab) {
      const src = source(tab.dataset.src);
      if (!src || src.id === st.src) return;
      st.src = src.id; st.setId = firstSet(src); DD.opened();
      history.replaceState(null, "", "#" + (st.setId || src.id));
      render(`[data-src="${src.id}"]`);
      return;
    }
    const sb = t.closest("[data-set]");
    if (sb) {
      if (sb.dataset.set === st.setId) return;
      st.setId = sb.dataset.set; DD.opened();
      history.replaceState(null, "", "#" + st.setId);
      render(`[data-set="${st.setId}"]`);
      return;
    }
    const so = t.closest("[data-sort]");
    if (so) {   // 고른 문제·해시·목록 스크롤 자리는 그대로(render가 같은 자리의 scrollTop을 지킨다)
      if (so.dataset.sort === sortKey()) return;
      pendingFocus = `[data-sort="${so.dataset.sort}"]`; save({ mockSort: so.dataset.sort });   // save → settings:change → render
      return;
    }
    if (t.closest("#toggleThemes")) { pendingFocus = "#toggleThemes"; save({ dbHideThemes: !S().dbHideThemes }); }   // save → settings:change → render
  });
  document.addEventListener("settings:change", () => { render(pendingFocus); pendingFocus = ""; });
  window.addEventListener("hashchange", () => { const before = st.setId; fromHash(); if (st.setId !== before) DD.opened(); render("", true); });
  window.addEventListener("resize", fitTabs);

  window.MockPage = { render: () => render(), current: () => st.setId, head };
  fromHash();
  render("", true);
})();
