/* ============================================================
   면접대비 서가 — 개요 · 도서 · 쟁점 · 읽는 순서, 책 상세 서랍
   데이터: data/library.js (window.LIBRARY_DATA). 진도는 localStorage에 저장.
   보류(build 단계): 연결 지도(SVG 보드), 효용–비용 산점도, 읽는 범위–쟁점 연결 그래프, 진도 내보내기/가져오기.
   ============================================================ */
(function () {
  "use strict";
  const { $, $$, esc, store } = window.SNU;
  const DATA = window.LIBRARY_DATA;
  const B = DATA.books, byId = {}; B.forEach(b => byId[b.id] = b);
  const CL = {}; DATA.clusters.forEach(c => CL[c.k] = c);
  const ET = { x: "맞서는 관계", c: "이어 읽기", l: "이론적 연결" };
  const LANG = { ko: "한국어판", lib: "한국어판·도서관 경로", en: "영어 원서 경로" };
  const ranked = B.slice().sort((a, b) => a.r - b.r);
  const adj = {}; B.forEach(b => adj[b.id] = []);
  DATA.edges.forEach(e => { adj[e.a].push({ o: e.b, t: e.t, n: e.n }); adj[e.b].push({ o: e.a, t: e.t, n: e.n }); });
  const issOf = {}; DATA.issues.forEach(it => it.books.forEach(x => (issOf[x.id] = issOf[x.id] || []).push(it)));
  const gb = (g, sm) => `<span class="g g-${g}${sm ? " sm" : ""}">${g}</span>`;
  const bk = (id, withRank) => { const b = byId[id]; return `<button type="button" class="bk" data-b="${id}">${gb(b.g, 1)}<span>${esc(b.lb)}</span>${withRank ? `<span class="n num">${b.r}위</span>` : ""}</button>`; };
  let spK = 30, spE = 15;
  const hrs = b => b.pg / (b.lang === "en" ? spE : spK);
  const fmtH = h => h < 10 ? (Math.round(h * 2) / 2).toString() : Math.round(h).toString();

  /* 진도 */
  const PROG = ["미시작", "요약 숙지", "지정 범위 독서", "반론 구술 완료"];
  let progress = {};
  try { const saved = JSON.parse(store.get("snu-library-progress-v1") || "{}"); for (const [k, v] of Object.entries(saved)) if (byId[+k] && Number.isInteger(v) && v >= 0 && v <= 3) progress[+k] = v; } catch (e) {}
  const prog = id => progress[id] || 0;
  function setProgress(id, v) { progress[id] = v; store.set("snu-library-progress-v1", JSON.stringify(progress)); renderProgress(); renderList(); $$(".status [data-progress]").forEach(el => el.setAttribute("aria-pressed", +el.dataset.progress === prog(+el.dataset.progressBook))); }

  /* 화면 전환 (해시) */
  const VIEWS = ["overview", "books", "issues", "order"];
  let cur = null;
  function show(v) {
    if (!VIEWS.includes(v)) v = "overview";
    cur = v;
    VIEWS.forEach(k => { $("#v-" + k).hidden = k !== v; });
    $$("#tabs button").forEach(t => { if (t.dataset.view === v) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current"); });
    if (v === "order") calc();
  }
  $("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) location.hash = b.dataset.view; });
  function route() { const h = location.hash.replace("#", ""); const m = /^b(\d{1,3})$/.exec(h); if (m && byId[+m[1]]) { if (!cur) show("books"); openBook(+m[1]); return; } show(h || "overview"); }
  window.addEventListener("hashchange", route);

  /* 개요 */
  (function () {
    const cnt = { S: 0, A: 0, B: 0, C: 0 }; B.forEach(b => cnt[b.g]++);
    $("#distBar").innerHTML = ["S", "A", "B"].map(g => `<span style="flex:${cnt[g]};background:var(--g${g});color:var(--g${g}-ink)">${g} ${cnt[g]}</span>`).join("") + `<span style="flex:${cnt.C};box-shadow:inset 0 0 0 1.5px var(--gC);color:var(--ink-2)">C ${cnt.C}</span>`;
    $("#distKey").innerHTML = [["S", "면접 전에 가장 먼저 읽는다."], ["A", "쟁점에 맞춰 지정 범위를 우선 읽는다."], ["B", "시간이 나면 지정한 장을 읽는다."], ["C", "사고 훈련용이다. 면접 뒤로 미뤄도 된다."]].map(([g, t]) => `<dt>${gb(g)} <b>${cnt[g]}권</b></dt><dd class="small">${t}</dd>`).join("");
    $("#topRows").innerHTML = ranked.filter(b => b.g === "S").map(b => `<button type="button" class="toprow" data-b="${b.id}"><span class="rk num">${b.r}</span>${gb(b.g)}<span><span class="ttl">${esc(b.t)}</span> <span class="au">${esc(b.a)}</span><span class="wy">${esc(b.why)}</span></span><span class="meta">${esc(b.read)}<br>약 ${b.pg}쪽</span></button>`).join("");
    $("#cluGrid").innerHTML = DATA.clusters.map(c => { const bs = ranked.filter(b => b.c === c.k); return `<button type="button" class="cluster" data-cl="${c.k}"><span class="nm"><span>${esc(c.name)}</span><span class="muted num">${bs.length}권</span></span><span class="sq">${bs.map(b => `<i class="${b.g}" title="${esc(b.lb)}"></i>`).join("")}</span><span class="ds">${esc(c.desc)}</span></button>`; }).join("");
    $("#criteria").innerHTML = [
      ["뺀 분야", "칸트·켈젠·하트·롤스·라즈 중심의 법철학, 헌법 교과서, AI 윤리, 페미니즘이 중심 주제인 저작. 영·프리커·너스바움처럼 논증 도중에 페미니즘 이론을 끌어 쓰는 책은 남겼다."],
      ["메울 빈틈", "한국의 민주주의·노동·가족을 정당과 대표, 계급과 재생산의 언어로 설명하는 사회과학. 선거·사법심사·독립기관의 정당성을 다투는 민주주의론. 권력·계급·위험·문화를 다루는 사회이론. 시장·국가·제도·기술을 둘러싼 정치경제. 판단과 선택의 한계를 다루는 행동경제학. 분배 패러다임 밖의 정의론과 자유지상주의·보수주의·자연법론. 공법 밖의 법학(민법·형법·증거법·법제사)."],
      ["등급", "빈틈의 크기, 논증의 전이 가능성, 반론 구성의 효용, 선택한 독서 경로의 비용을 함께 고려했다. 정량 점수와 순위는 편집상 판단이며 학교의 공식 추천 또는 출제 확률이 아니다."],
      ["해설의 층위", "'핵심 요약'은 저작의 논지에 대한 요약이고, '논증의 조건·반론'과 '면접 적용'은 학습 목적의 분석·재구성이다. 직접 인용과 저자의 실제 정책 지지로 읽지 않는다."]
    ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    $("#cluGrid").addEventListener("click", e => { const b = e.target.closest("[data-cl]"); if (!b) return; clearFilters(); fState.c = b.dataset.cl; syncFilters(); renderList(); location.hash = "books"; });
    $("#metaNote").textContent = `${DATA.meta.version} · ${DATA.meta.date} · ${DATA.meta.interpretation} 외부 출처 링크는 인터넷 연결이 필요하다.`;
  })();
  function renderProgress() {
    const counts = PROG.map((_, v) => B.filter(b => prog(b.id) === v).length);
    $("#progressTotals").innerHTML = counts.map((n, v) => `<button type="button" class="chip${v === 3 ? " ok" : ""}" data-filter-progress="${v}">${v} ${PROG[v]} ${n}</button>`).join("");
    $("#progressRows").innerHTML = DATA.clusters.map(c => { const bs = B.filter(b => b.c === c.k), done = bs.filter(b => prog(b.id) === 3).length, mid = bs.filter(b => prog(b.id) === 2).length, low = bs.filter(b => prog(b.id) === 1).length;
      return `<div class="row between small"><span class="muted" style="flex:1 1 140px">${esc(c.name)}</span><span class="dist-bar" style="flex:3 1 160px;height:12px"><span style="flex:${done};background:var(--gS)"></span><span style="flex:${mid};background:var(--gA)"></span><span style="flex:${low};background:var(--gB)"></span><span style="flex:${bs.length - done - mid - low};background:var(--surface-2)"></span></span><span class="num muted">${done}/${bs.length}</span></div>`; }).join("");
  }
  $("#progressTotals").addEventListener("click", e => { const b = e.target.closest("[data-filter-progress]"); if (!b) return; clearFilters(); fState.p = b.dataset.filterProgress; syncFilters(); renderList(); location.hash = "books"; });

  /* 도서 */
  const fState = { q: "", g: new Set(), c: "", l: "", so: "r", p: "" };
  $("#fc").innerHTML = `<option value="">분야 전체</option>` + DATA.clusters.map(c => `<option value="${c.k}">${esc(c.name)}</option>`).join("");
  function renderList() {
    const q = fState.q.trim().toLowerCase();
    const xs = B.filter(b => (fState.p === "" || prog(b.id) === +fState.p) && (!fState.g.size || fState.g.has(b.g)) && (!fState.c || b.c === fState.c) && (!fState.l || b.lang === fState.l) && (!q || (b.t + " " + b.a + " " + b.lb + " " + b.kw.join(" ") + " " + b.cat + " " + b.sh).toLowerCase().includes(q)));
    xs.sort(fState.so === "r" ? (a, b) => a.r - b.r : fState.so === "id" ? (a, b) => a.id - b.id : (a, b) => hrs(a) - hrs(b));
    $("#cnt").textContent = xs.length === B.length ? `전체 ${B.length}권` : `${xs.length}권`;
    $("#list").innerHTML = xs.map(b => `<button type="button" class="book" data-b="${b.id}"><span class="lft"><span class="rk">${b.r}</span>${gb(b.g)}</span><span style="min-width:0"><span class="ttl">${esc(b.t)}${b.isNew ? '<span class="mini-tag">신규</span>' : ""}</span><span class="au">${esc(b.a)}</span><span class="sh">${esc(b.sh)}</span><span class="tags"><span>${esc(CL[b.c].name)}</span><span class="num">약 ${b.pg}쪽 · ${fmtH(hrs(b))}시간</span><span>${LANG[b.lang]}</span><span>${PROG[prog(b.id)]}</span></span></span></button>`).join("") || `<p class="muted">조건에 맞는 책이 없다. 검색어를 줄이거나 등급 선택을 풀어 본다.</p>`;
  }
  function syncFilters() { $("#q").value = fState.q; $("#fc").value = fState.c; $("#fl").value = fState.l; $("#so").value = fState.so; $("#fp").value = fState.p; $$("#gf [data-g]").forEach(x => x.setAttribute("aria-pressed", fState.g.has(x.dataset.g))); }
  function clearFilters() { Object.assign(fState, { q: "", g: new Set(), c: "", l: "", so: "r", p: "" }); }
  $("#q").addEventListener("input", e => { fState.q = e.target.value; renderList(); });
  $("#gf").addEventListener("click", e => { const b = e.target.closest("[data-g]"); if (!b) return; const g = b.dataset.g; fState.g.has(g) ? fState.g.delete(g) : fState.g.add(g); b.setAttribute("aria-pressed", fState.g.has(g)); renderList(); });
  ["fc", "fl", "so", "fp"].forEach(id => $("#" + id).addEventListener("change", e => { fState[{ fc: "c", fl: "l", so: "so", fp: "p" }[id]] = e.target.value; renderList(); }));
  $("#resetFilters").addEventListener("click", () => { clearFilters(); syncFilters(); renderList(); });

  /* 읽는 순서 */
  function calc() {
    const w = +$("#iW").value, h = +$("#iH").value; spK = +$("#iK").value; spE = +$("#iE").value; const reserve = +$("#iR").value;
    $("#vW").textContent = w; $("#vH").textContent = h; $("#vK").textContent = spK; $("#vE").textContent = spE; $("#vR").textContent = reserve;
    const avail = w * 7 * h * (1 - reserve / 100), tot = { S: 0, A: 0, B: 0, C: 0 }; B.forEach(b => tot[b.g] += hrs(b));
    const all = tot.S + tot.A + tot.B + tot.C;
    let cum = 0, last = null; for (const b of ranked) { if (cum + hrs(b) > avail + 1e-9) break; cum += hrs(b); last = b; }
    const pct = Math.min(100, avail / all * 100);
    $("#cap").innerHTML = ["S", "A", "B"].map(g => `<span style="flex:${tot[g]};background:var(--g${g});color:var(--g${g}-ink)">${g} ${Math.round(tot[g])}시간</span>`).join("") + `<span class="last" style="flex:${tot.C};box-shadow:inset 0 0 0 1.5px var(--gC);color:var(--ink-2)">C ${Math.round(tot.C)}</span><i class="mk${pct > 60 ? " flip" : ""}" style="left:${pct}%"><em>읽을 수 있는 ${Math.round(avail)}시간</em></i>`;
    let v;
    if (!last) v = `이 시간으로는 1위 <b>${esc(ranked[0].t)}</b>의 지정 범위도 다 읽기 어렵다.`;
    else if (last.r === B.length) v = `<b>${B.length}권의 지정 범위를 모두</b> 읽고도 ${Math.round(avail - all)}시간이 남는다.`;
    else v = `${Math.round(avail)}시간이면 <b>${last.r}위 ${esc(last.t)}</b>까지 읽는 것으로 추정된다. ` + (avail < tot.S ? `S 7권을 마치려면 ${Math.ceil(tot.S - avail)}시간이 더 필요하다.` : avail < tot.S + tot.A ? `S 7권은 마치고, A 48권까지 마치려면 ${Math.ceil(tot.S + tot.A - avail)}시간이 더 필요하다.` : `S와 A 55권을 마치고 B로 넘어간다.`);
    $("#verdict").innerHTML = v;
    $("#tb").innerHTML = ranked.map(b => `<tr data-b="${b.id}" tabindex="0" role="button" style="cursor:pointer${last && b.id === last.id ? ";border-bottom:2px solid var(--ink)" : ""}${(!last || b.r > last.r) ? ";color:var(--ink-3)" : ""}"><td class="num">${b.r}</td><td>${gb(b.g, 1)}</td><td><b>${esc(b.t)}</b><br><span class="muted small">${esc(b.a)}</span></td><td>${esc(b.read)}</td><td class="num" style="white-space:nowrap">약 ${b.pg}쪽</td><td class="num">${fmtH(hrs(b))}</td><td>${LANG[b.lang]}</td></tr>`).join("");
    renderList();
  }
  ["iW", "iH", "iK", "iE", "iR"].forEach(id => $("#" + id).addEventListener("input", calc));
  $("#stages").innerHTML = DATA.stages.map(st => { const body = st.groups.map(g => g.t ? `<div class="grp"><div class="gt">${esc(g.t)}</div><div class="flow">${g.ids.map(i => bk(i, 1)).join("")}</div></div>` : `<div class="flow">${g.ids.map(i => bk(i, 1)).join("")}</div>`).join(""); return `<div class="stage"><h3 class="h3">${gb(st.grade)}${esc(st.name)}</h3><p class="sub small">${esc(st.note)}</p>${body}</div>`; }).join("");
  $("#pairs").innerHTML = DATA.pairs.map(p => `<div class="pair"><div class="flow">${bk(p.a)}${bk(p.b)}</div><div class="th">${esc(p.n)}</div></div>`).join("");

  /* 쟁점 */
  let curIss = DATA.issues[0].id;
  (function () {
    const cats = []; DATA.issues.forEach(it => { if (!cats.includes(it.cat)) cats.push(it.cat); });
    $("#issNav").innerHTML = cats.map(c => `<div><h4>${esc(c)}</h4>${DATA.issues.filter(it => it.cat === c).map(it => `<button type="button" data-iss="${it.id}">${esc(it.title)}</button>`).join("")}</div>`).join("");
    $("#issSel").innerHTML = cats.map(c => `<optgroup label="${esc(c)}">${DATA.issues.filter(it => it.cat === c).map(it => `<option value="${it.id}">${esc(it.title)}</option>`).join("")}</optgroup>`).join("");
    $("#issNav").addEventListener("click", e => { const b = e.target.closest("[data-iss]"); if (b) setIss(b.dataset.iss); });
    $("#issSel").addEventListener("change", e => setIss(e.target.value));
  })();
  function oralFlow(it) {
    const steps = [["개념 구별", "서로 다른 의미를 섞고 있지 않은가?", it.hinge], ["규범 기준", "권리·평등·자유·효율 중 무엇을 기준으로 삼는가?", "입장의 목표와 넘지 말아야 할 하한을 먼저 정한다. 같은 기준을 반대쪽에도 적용한다."], ["사실·인과", "결론에 꼭 필요한 사실과 가정은 무엇인가?", it.evidence], ["강한 반론", "상대 입장이 가장 강해지는 조건은 무엇인가?", `대립하는 두 기준을 함께 검토한다. “${it.axis[0]}” / “${it.axis[1]}”`], ["조건부 결론", "어떤 사실이 바뀌면 입장을 수정할 것인가?", "정당한 목표만으로 수단을 정당화하지 않는다. 불확실성과 감수하는 손실을 밝힌다."], ["제도 설계", "누가 결정하고 설명하며 잘못을 고치는가?", it.design]];
    return `<section class="sec"><div class="h3">90초 구술 답변 · 여섯 단계</div><div class="flow6">${steps.map((s, i) => `<div class="step6"><small>0${i + 1} ${s[0]}</small><b>${esc(s[1])}</b><p>${esc(s[2])}</p></div>`).join("")}</div><p class="note">모범답안이나 저자의 정책 제안이 아니라, 제시문에 따라 채워 넣는 논증 점검 틀이다.</p></section>`;
  }
  function setIss(id) {
    curIss = id; const it = DATA.issues.find(x => x.id === id);
    $$("#issNav [data-iss]").forEach(b => b.setAttribute("aria-current", b.dataset.iss === id)); $("#issSel").value = id;
    $("#issBody").innerHTML = `<div><div class="eyebrow">${esc(it.cat)}</div><h2 class="h2" style="font-size:1.4rem">${esc(it.title)}</h2></div>
      <div class="fact">${esc(it.fact)}</div>${oralFlow(it)}
      <div><div class="h3" style="margin-bottom:8px">맞서는 두 입장</div><div class="axis"><div>${esc(it.axis[0])}</div><i>대</i><div>${esc(it.axis[1])}</div></div></div>
      <div><div class="h3" style="margin-bottom:8px">꺼내 쓸 책 ${it.books.length}권</div><div class="use">${it.books.map(x => { const b = byId[x.id]; return `<button type="button" data-b="${b.id}">${gb(b.g)}<b>${esc(b.lb)}</b><span class="ro">${esc(x.role)}</span></button>`; }).join("")}</div></div>
      <div><div class="h3" style="margin-bottom:8px">스스로 답해 볼 질문</div><ol class="qs">${it.qs.map(q => `<li>${esc(q)}</li>`).join("")}</ol></div>`;
  }

  /* 책 상세 서랍 */
  let drawer = null, shade = null, lastFocus = null;
  function xref(t) { return esc(t).replace(/([가-힣A-Za-z』\)])\((\d{1,3})\)/g, (m, p, n) => byId[+n] ? `${p}<button type="button" class="xref" data-b="${n}" title="${esc(byId[+n].t)}">${n}</button>` : m); }
  function openBook(id) {
    const b = byId[id]; if (!b) return;
    if (!drawer) { lastFocus = document.activeElement; shade = document.createElement("div"); shade.className = "shade"; shade.addEventListener("click", closeBook); drawer = document.createElement("aside"); drawer.className = "bdrawer"; drawer.setAttribute("role", "dialog"); drawer.setAttribute("aria-modal", "true"); document.body.append(shade, drawer); document.body.style.overflow = "hidden"; }
    const prev = ranked[b.r - 2], next = ranked[b.r];
    const rels = adj[id].slice().sort((a, c) => "xcl".indexOf(a.t) - "xcl".indexOf(c.t));
    const iss = issOf[id] || [], labs = ["제시문 활용도", "쟁점 연결성", "빈틈 보완도"];
    drawer.innerHTML = `<div class="d-top"><div class="d-nav">${prev ? `<button type="button" class="btn ghost sm" data-b="${prev.id}">← ${prev.r}위</button>` : ""}${next ? `<button type="button" class="btn ghost sm" data-b="${next.id}">${next.r}위 →</button>` : ""}</div><button type="button" class="btn ghost sm" id="dClose">닫기</button></div>
      <div class="stack" style="gap:6px"><div class="eyebrow">${esc(CL[b.c].name)} · 전체 ${b.r}위 · 책 번호 ${b.id}</div><div style="display:flex;gap:12px;align-items:flex-start">${gb(b.g)}<h2 class="bd-title">${esc(b.t)}</h2></div><div class="bd-au">${esc(b.a)}</div></div>
      <p class="bd-why">${esc(b.why)}</p>
      <section class="sec"><div class="h3">학습 기록 · 완료한 가장 높은 단계</div><div class="status">${PROG.map((t, v) => `<button type="button" data-progress="${v}" data-progress-book="${b.id}" aria-pressed="${prog(b.id) === v}">${v} ${t}</button>`).join("")}</div><p class="note">구술 완료의 기준: 핵심 주장, 가장 강한 반론, 적용 조건을 자료 없이 설명한다.</p></section>
      <div class="bd-meta"><div><small>먼저 읽을 범위</small><b>${esc(b.read)}</b></div><div><small>분량과 시간</small><b class="num">약 ${b.pg}쪽 · ${fmtH(hrs(b))}시간</b></div><div><small>판본</small><b>${LANG[b.lang]}</b></div></div>
      <div class="bars">${b.s.map((v, i) => `<span>${labs[i]}</span><span class="bar5" role="img" aria-label="5점 중 ${v}점">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= v ? "on" : ""}"></i>`).join("")}</span>`).join("")}</div>
      <section class="sec"><div class="h3">핵심 요약 · 저작의 논지</div><div class="prose">${b.sum.map(p => `<p>${xref(p)}</p>`).join("")}</div></section>
      <section class="sec"><div class="h3">논증의 조건·반론 · 편집 분석</div><div class="prose">${(b.deep || []).map(p => `<p>${xref(p)}</p>`).join("")}</div></section>
      <section class="sec"><div class="h3">면접에서 쓰는 법 · 편집 응용</div><div class="prose">${b.use.map(p => `<p>${xref(p)}</p>`).join("")}</div></section>
      <section class="sec"><div class="h3">핵심 개념</div><div class="kw">${b.kw.map(k => `<span>${esc(k)}</span>`).join("")}</div></section>
      ${rels.length ? `<section class="sec"><div class="h3">이어진 책 ${rels.length}권</div><div class="stack" style="gap:2px">${rels.map(e => { const o = byId[e.o]; return `<button type="button" class="rel" data-b="${o.id}"><i class="ln ${e.t}"></i>${gb(o.g, 1)}<span class="rb"><b>${esc(o.lb)}</b> <span class="rt">${ET[e.t]}</span><span class="rn">${esc(e.n)}</span></span></button>`; }).join("")}</div></section>` : ""}
      ${iss.length ? `<section class="sec"><div class="h3">이 책을 쓰는 쟁점</div><div class="tagrow">${iss.map(it => `<button type="button" class="itag" data-goiss="${it.id}">${esc(it.title)}</button>`).join("")}</div></section>` : ""}
      <section class="sec bibl"><div class="h3">서지</div><p>${esc(b.bib)}</p><p class="muted">${esc(b.cat)}</p>${b.sources && b.sources.length ? `<div class="stack" style="gap:4px">${b.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`).join("")}</div>` : ""}<p class="note">${esc(b.basis || "")} 현재의 재고·번역본 유무·법령 시행 상태를 보증하지 않는다.</p></section>
      <section class="sec bibl"><div class="h3">관련 문헌 · 판본은 별도 확인</div><ul>${b.rel.map(r => `<li>${esc(r)}</li>`).join("")}</ul></section>`;
    drawer.scrollTop = 0; $("#dClose", drawer).focus({ preventScroll: true });
    if (location.hash !== "#b" + id) history.replaceState(null, "", "#b" + id);
  }
  function closeBook() { if (!drawer) return; drawer.remove(); shade.remove(); drawer = shade = null; document.body.style.overflow = ""; if (/^#b\d+$/.test(location.hash)) history.replaceState(null, "", "#" + (cur || "books")); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer) closeBook(); if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-b]")) { e.preventDefault(); openBook(+e.target.dataset.b); } });
  document.addEventListener("click", e => {
    if (e.target.closest("#dClose")) { closeBook(); return; }
    const pr = e.target.closest("[data-progress]"); if (pr) { setProgress(+pr.dataset.progressBook, +pr.dataset.progress); return; }
    const gi = e.target.closest("[data-goiss]"); if (gi) { closeBook(); setIss(gi.dataset.goiss); location.hash = "issues"; return; }
    const t = e.target.closest("[data-b]"); if (t) { e.preventDefault(); openBook(+t.dataset.b); }
  });

  /* 시작 */
  renderProgress(); setIss(curIss); syncFilters(); renderList(); calc(); route();
})();
