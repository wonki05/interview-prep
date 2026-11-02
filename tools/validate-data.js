#!/usr/bin/env node
/* 데이터 검증: node tools/validate-data.js [--in <questions.js 경로>]
   data/questions.js · data/models.js를 읽어 구조를 확인하고 세트·변형별 제시문·질문 수를 출력한다. 문제가 있으면 종료 코드 1.
   세트는 복기본 변형(variants: merged | hwang | kim)을 가진다(docs/DATA.md §1). 변형마다 제시문·질문을 검사한다.
   --in은 build_questions.js --out으로 만든 다른 파일을 검사한다(학교별 세션의 검증용). */
"use strict";
const path = require("path");
const root = path.join(__dirname, "..");
const inArg = process.argv.indexOf("--in");
global.window = {};
require(inArg >= 0 ? path.resolve(process.argv[inArg + 1]) : path.join(root, "data", "questions.js"));
require(path.join(root, "data", "models.js"));
const D = global.window.INTERVIEW_DB, M = global.window.MODEL_CATALOG;
const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);
const VARIANTS = ["merged", "hwang", "kim"];
const HANGUL = "가나다라마바사아자차카타파하", LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

if (!D || !D.levels || !Array.isArray(D.schools)) err("INTERVIEW_DB 구조가 아니다");
["low", "mid", "high", "max"].forEach(k => { if (!D.levels.difficulty[k]) err("levels.difficulty." + k + " 없음"); });
["low", "mid", "high"].forEach(k => { if (!D.levels.variation[k]) err("levels.variation." + k + " 없음"); });

/* 변형 하나의 제시문·질문 검사. 제시문 번호는 1부터 연속, label은 원표기가 숫자가 아닐 때의 짧은 낱말((가)·(A)·사례·사례 1·에피소드),
   한 글자 라벨은 가나다…·ABC… 순서. 문제지 문항(tasks)은 있으면 문장이 비지 않아야 한다. */
function checkVariant(tag, v) {
  if (!Array.isArray(v.passages) || !v.passages.length) { err(tag + ": passages 없음"); return 0; }
  v.passages.forEach((p, i) => {
    if (p.no !== i + 1) err(tag + ": 제시문 번호가 연속이 아니다(" + p.no + ")");
    if (!["prose", "dialog", "case"].includes(p.kind)) err(tag + ": 제시문 " + p.no + " kind 오류");
    if (p.label !== undefined && !(typeof p.label === "string" && /^[^\n]{1,12}$/.test(p.label) && !/^\d+$/.test(p.label))) err(tag + ": 제시문 " + p.no + " label 오류(" + p.label + ")");
    if (!p.text || p.text.trim().length < 10) err(tag + ": 제시문 " + p.no + " 본문이 비었다");
    else if (p.text.trim().length < 50) warn(tag + ": 제시문 " + p.no + " 본문이 짧다(" + p.text.trim().length + "자)");
  });
  for (const abc of [HANGUL, LATIN]) {
    const labels = v.passages.filter(p => p.label && p.label.length === 1 && abc.includes(p.label)).map(p => p.label);
    if (labels.length && labels.join("") !== abc.slice(0, labels.length)) err(tag + ": 한 글자 라벨 순서 오류 " + labels.join(""));
  }
  if (v.tasks !== undefined) {
    if (!Array.isArray(v.tasks)) err(tag + ": tasks는 배열");
    else v.tasks.forEach((t, i) => { if (!t || typeof t.text !== "string" || !t.text.trim()) err(tag + ": 문제 " + (i + 1) + " 비어 있음"); if (t && typeof t.label !== "string") err(tag + ": 문제 " + (i + 1) + " label은 문자열"); });
  }
  if (!Array.isArray(v.followups) || (!v.followups.length && !(Array.isArray(v.tasks) && v.tasks.length))) err(tag + ": followups 없음(문제지 문항도 없음)");
  else {                                            // 문제지 문항만 복기된 세트는 followups가 비어도 된다(docs/DATA.md 규칙 3)
    const students = new Set();
    v.followups.forEach(f => {
      if (!f.student || !f.label || !Array.isArray(f.items)) err(tag + ": followups 항목 오류");
      if (students.has(f.student)) err(tag + ": followups student 중복(" + f.student + ") — 문답 키가 충돌한다"); students.add(f.student);
      (f.items || []).forEach((q, i) => { if (!q || !String(q).trim()) err(tag + ": " + f.label + " Q" + (i + 1) + " 비어 있음"); });
    });
  }
  (v.common || []).forEach(c => { if (!c.label || !Array.isArray(c.items)) err(tag + ": common 항목 오류"); });
  return (v.followups || []).reduce((a, f) => a + f.items.length, 0) + (v.common || []).reduce((a, c) => a + c.items.length, 0) + (Array.isArray(v.tasks) ? v.tasks.length : 0);
}

const ids = new Set();
const summary = [];
for (const sc of D.schools) {
  if (!sc.id || !sc.name || !sc.short) err("학교 필드 누락: " + JSON.stringify(sc).slice(0, 60));
  if (!Array.isArray(sc.sets)) err(sc.id + ": sets가 배열이 아니다");
  if (sc.format) {
    const t = sc.format.timeline || {};
    if (!(t.prep > 0) || !(t.interview > 0) || !(t.wait >= 0)) err(sc.id + ": format.timeline 값 오류");
    if (!Array.isArray(sc.format.basics) || !Array.isArray(sc.format.details)) err(sc.id + ": format.basics/details 누락");
  }
  for (const s of sc.sets) {
    const tag = sc.id + "/" + s.id;
    if (!s.id) { err(sc.id + ": 세트 id 없음"); continue; }
    if (ids.has(s.id)) err(tag + ": 세트 id 중복"); ids.add(s.id);
    if (!/^[a-z]+-\d{4}-[A-Za-z0-9]+$/.test(s.id)) warn(tag + ": id 형식은 <school>-<year>-<name> 권장");
    if (s.school !== sc.id) err(tag + ": set.school(" + s.school + ") ≠ 학교 id");
    if (!s.year || !s.name || !s.session || !s.track || !s.instruction) err(tag + ": 기본 필드 누락");
    if (!s.name.startsWith(sc.short + " ")) warn(tag + ": name은 '" + sc.short + " …' 꼴 권장(" + s.name + ")");
    if (!s.format || !(s.format.prep > 0)) err(tag + ": set.format 누락(ai.js가 format.prep을 읽는다)");
    if (!s.variants || typeof s.variants !== "object" || !Object.keys(s.variants).length) { err(tag + ": variants 없음"); continue; }
    const keys = Object.keys(s.variants);
    keys.forEach(k => { if (!VARIANTS.includes(k)) err(tag + ": 모르는 변형 " + k); if (!s.variants[k].label) err(tag + "/" + k + ": label 없음"); });
    if (!s.variant || !keys.includes(s.variant)) err(tag + ": 기본 변형(variant=" + s.variant + ")이 variants에 없다");
    if (s.variants.merged && Array.isArray(s.variants.merged.basis) && !s.variants.merged.basis.every(b => keys.includes(b))) err(tag + ": merged.basis가 variants에 없는 변형을 가리킨다");
    const counts = {};
    for (const k of keys) counts[k] = checkVariant(tag + "/" + k, s.variants[k]);
    const nps = keys.map(k => (s.variants[k].passages || []).length);
    if (new Set(nps).size > 1) warn(tag + ": 변형 간 제시문 수가 다르다 " + keys.map((k, i) => k + "=" + nps[i]).join(" "));
    if (!Array.isArray(s.themes) || nps.some(n => n !== s.themes.length)) warn(tag + ": themes 수(" + (s.themes || []).length + ") ≠ 제시문 수 " + nps.join("/"));
    if (s.tags !== undefined && !Array.isArray(s.tags)) err(tag + ": tags는 배열");
    const trees = s.trees ? Object.entries(s.trees) : s.tree ? [["tree", s.tree]] : [];
    for (const [name, t] of trees) {
      const ttag = tag + " " + name;
      if (t.basis && !keys.includes(t.basis)) err(ttag + ": basis(" + t.basis + ")가 variants에 없다");
      if (!t.basis) warn(ttag + ": basis 없음(어느 복기본의 문구인지)");
      if (!t.root || !t.nodes || !t.nodes[t.root]) { err(ttag + ": root 없음"); continue; }
      for (const [id, n] of Object.entries(t.nodes)) {
        if (!n.q) err(ttag + ": 노드 " + id + " 질문 없음");
        const nexts = n.branches ? n.branches.map(b => b.next) : [n.next];
        if (n.branches && n.branches.length < 2) err(ttag + ": 노드 " + id + " 가지가 2개 미만");
        (n.branches || []).forEach(b => { if (!b.when) err(ttag + ": 노드 " + id + " when 없음"); });
        nexts.forEach(x => { if (x !== null && x !== undefined && !t.nodes[x]) err(ttag + ": 노드 " + id + " → 없는 노드 " + x); });
      }
      const seen = new Set();
      const visit = (id, pathSet) => { if (pathSet.has(id)) { err(ttag + ": 순환 " + id); return; } if (seen.has(id)) return; seen.add(id); const n = t.nodes[id]; if (!n) return; const nexts = n.branches ? n.branches.map(b => b.next) : [n.next]; const p2 = new Set(pathSet); p2.add(id); nexts.forEach(x => { if (x) visit(x, p2); }); };
      visit(t.root, new Set());
      Object.keys(t.nodes).forEach(id => { if (!seen.has(id)) warn(ttag + ": root에서 닿지 않는 노드 " + id); });
    }
    summary.push({ school: sc.short, id: s.id, variant: s.variant, keys, nps, counts, tree: trees.length ? trees.map(([n, t]) => n + (t.basis ? "(" + t.basis + ")" : "")).join(",") : "" });
  }
}
for (const [prov, list] of Object.entries(M || {})) {
  const seen = new Set();
  for (const m of list) { if (!m.id || !m.label) err("models." + prov + ": id/label 누락"); if (seen.has(m.id)) err("models." + prov + ": id 중복 " + m.id); seen.add(m.id); }
}

console.log("세트 요약(변형별 제시문/질문)");
let lastSchool = "";
for (const sc of D.schools) {
  console.log(`  ${sc.short.padEnd(6)} ${sc.sets.length ? "" : "(세트 없음)"}`);
  for (const r of summary.filter(x => x.school === sc.short)) {
    console.log(`    ${r.id.padEnd(12)} 기본 ${r.variant.padEnd(6)} ${r.keys.map((k, i) => `${k} ${r.nps[i]}/${String(r.counts[k]).padStart(2)}`).join("  ")}${r.tree ? "  tree:" + r.tree : ""}`);
  }
}
const nv = summary.reduce((n, r) => n + r.keys.length, 0);
warns.forEach(w => console.log("경고: " + w));
errors.forEach(e => console.log("오류: " + e));
console.log(errors.length ? `실패 — 오류 ${errors.length}` : `통과 — 세트 ${ids.size}개, 변형 ${nv}개, 경고 ${warns.length}`);
process.exit(errors.length ? 1 : 0);
