#!/usr/bin/env node
/* 기존 data/questions.js(평면 세트)를 data/sets/ 구조로 내보낸다(한 번만 쓰는 이행 스크립트).
   node tools/export_sets.js
   · data/sets/_db.json                 levels + 학교 목록(format 포함, sets 제외)
   · data/sets/<id>/meta.json           세트 공통 필드(id·school·year·name·session·track·instruction·format·themes·tags·variant·tree)
   · data/sets/<id>/kim.json            김종수 복기 변형(기존 본문 그대로)
   이미 variants 구조인 세트는 변형별 파일로 나눠 쓴다. 쪽 범위는 work/books/kim/map.json이 있으면 채운다. */
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
global.window = {};
require(path.join(root, "data", "questions.js"));
const D = global.window.INTERVIEW_DB;
const out = path.join(root, "data", "sets");
fs.mkdirSync(out, { recursive: true });
const write = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 1) + "\n", "utf8");
let pages = {};
try { for (const s of JSON.parse(fs.readFileSync(path.join(root, "work", "books", "kim", "map.json"), "utf8")).sets) pages[s.set] = s.pages; } catch (e) { /* 지도 없음 */ }

write(path.join(out, "_db.json"), { levels: D.levels, schools: D.schools.map(s => ({ id: s.id, name: s.name, short: s.short, format: s.format })) });
const BOOK = { kim: { label: "김종수 복기", book: "해커스 김종수 로스쿨 면접 200주제 3권 기출편(2026)" }, hwang: { label: "황변 복기", book: "황변과 함께하는 로스쿨 면접 Q 1권(2026)" }, merged: { label: "통합(AI)" } };
const toItems = items => items.map(q => typeof q === "string" ? { label: null, text: q, note: null } : q);
let n = 0;
for (const sc of D.schools) for (const s of sc.sets) {
  const dir = path.join(out, s.id); fs.mkdirSync(dir, { recursive: true });
  const meta = { id: s.id, school: s.school, year: s.year, name: s.name, session: s.session, track: s.track, instruction: s.instruction, format: s.format, themes: s.themes, tags: s.tags || [], variant: s.variant || "kim" };
  if (s.tree) meta.tree = Object.assign({ basis: "kim" }, s.tree);
  write(path.join(dir, "meta.json"), meta);
  const variants = s.variants || { kim: { passages: s.passages, followups: s.followups, common: s.common || [] } };
  for (const [k, v] of Object.entries(variants)) {
    const info = BOOK[k] || { label: k };
    const file = { label: v.label || info.label, source: v.source || (info.book ? { book: info.book, pages: pages[s.id] ? pages[s.id].join("-") : "" } : undefined),
      passages: v.passages.map(p => Object.assign({ no: p.no, label: p.label || null, kind: p.kind, length: p.length || null, text: p.text, source: p.source || "", notes: p.notes || [] })),
      followups: v.followups.map(f => ({ student: f.student, label: f.label, items: toItems(f.items) })),
      common: (v.common || []).map(c => ({ label: c.label, items: toItems(c.items) })) };
    if (v.basis) file.basis = v.basis;
    if (v.notes) file.notes = v.notes;
    write(path.join(dir, k + ".json"), file);
  }
  n++;
}
console.log(`내보냄: 세트 ${n}개 → data/sets/`);
