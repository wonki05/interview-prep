#!/usr/bin/env node
/* 데이터 검증: node tools/validate-data.js
   data/questions.js · data/models.js를 읽어 구조를 확인하고 세트별 제시문·질문 수를 출력한다. 문제가 있으면 종료 코드 1. */
"use strict";
const path = require("path");
const root = path.join(__dirname, "..");
global.window = {};
require(path.join(root, "data", "questions.js"));
require(path.join(root, "data", "models.js"));
const D = global.window.INTERVIEW_DB, M = global.window.MODEL_CATALOG;
const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);

if (!D || !D.levels || !Array.isArray(D.schools)) err("INTERVIEW_DB 구조가 아니다");
["low", "mid", "high", "max"].forEach(k => { if (!D.levels.difficulty[k]) err("levels.difficulty." + k + " 없음"); });
["low", "mid", "high"].forEach(k => { if (!D.levels.variation[k]) err("levels.variation." + k + " 없음"); });

const ids = new Set();
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
    if (!Array.isArray(s.passages) || !s.passages.length) err(tag + ": passages 없음");
    else s.passages.forEach((p, i) => {
      if (p.no !== i + 1) err(tag + ": 제시문 번호가 연속이 아니다(" + p.no + ")");
      if (!["prose", "dialog"].includes(p.kind)) err(tag + ": 제시문 " + p.no + " kind 오류");
      if (!p.text || p.text.trim().length < 50) err(tag + ": 제시문 " + p.no + " 본문이 비었거나 짧다");
    });
    if (!Array.isArray(s.themes) || s.themes.length !== (s.passages || []).length) warn(tag + ": themes 수(" + (s.themes || []).length + ") ≠ 제시문 수");
    if (!Array.isArray(s.followups) || !s.followups.length) err(tag + ": followups 없음");
    else s.followups.forEach(f => { if (!f.student || !f.label || !Array.isArray(f.items)) err(tag + ": followups 항목 오류"); (f.items || []).forEach((q, i) => { if (!q || !q.trim()) err(tag + ": " + f.label + " Q" + (i + 1) + " 비어 있음"); }); });
    (s.common || []).forEach(c => { if (!c.label || !Array.isArray(c.items)) err(tag + ": common 항목 오류"); });
    const trees = s.trees ? Object.entries(s.trees) : s.tree ? [["tree", s.tree]] : [];
    for (const [name, t] of trees) {
      const ttag = tag + " " + name;
      if (!t.root || !t.nodes || !t.nodes[t.root]) { err(ttag + ": root 없음"); continue; }
      for (const [id, n] of Object.entries(t.nodes)) {
        if (!n.q) err(ttag + ": 노드 " + id + " 질문 없음");
        const nexts = n.branches ? n.branches.map(b => b.next) : [n.next];
        if (n.branches && n.branches.length < 2) err(ttag + ": 노드 " + id + " 가지가 2개 미만");
        (n.branches || []).forEach(b => { if (!b.when) err(ttag + ": 노드 " + id + " when 없음"); });
        nexts.forEach(x => { if (x !== null && x !== undefined && !t.nodes[x]) err(ttag + ": 노드 " + id + " → 없는 노드 " + x); });
      }
      // 도달성·순환
      const seen = new Set(), stack = [t.root], onPath = new Set();
      const visit = (id, pathSet) => { if (pathSet.has(id)) { err(ttag + ": 순환 " + id); return; } if (seen.has(id)) return; seen.add(id); const n = t.nodes[id]; if (!n) return; const nexts = n.branches ? n.branches.map(b => b.next) : [n.next]; const p2 = new Set(pathSet); p2.add(id); nexts.forEach(x => { if (x) visit(x, p2); }); };
      visit(t.root, onPath);
      Object.keys(t.nodes).forEach(id => { if (!seen.has(id)) warn(ttag + ": root에서 닿지 않는 노드 " + id); });
    }
  }
}
// 모델 목록
for (const [prov, list] of Object.entries(M || {})) {
  const seen = new Set();
  for (const m of list) { if (!m.id || !m.label) err("models." + prov + ": id/label 누락"); if (seen.has(m.id)) err("models." + prov + ": id 중복 " + m.id); seen.add(m.id); }
}

console.log("세트 요약");
for (const sc of D.schools) {
  const n = sc.sets.length;
  console.log(`  ${sc.short.padEnd(6)} ${n ? "" : "(세트 없음)"}`);
  for (const s of sc.sets) {
    const q = s.followups.reduce((a, f) => a + f.items.length, 0) + (s.common || []).reduce((a, c) => a + c.items.length, 0);
    console.log(`    ${s.id.padEnd(12)} 제시문 ${s.passages.length}  질문 ${String(q).padStart(2)}  ${s.trees ? "trees:" + Object.keys(s.trees).join(",") : s.tree ? "tree" : ""}`);
  }
}
warns.forEach(w => console.log("경고: " + w));
errors.forEach(e => console.log("오류: " + e));
console.log(errors.length ? `실패 — 오류 ${errors.length}` : `통과 — 세트 ${ids.size}개, 경고 ${warns.length}`);
process.exit(errors.length ? 1 : 0);
