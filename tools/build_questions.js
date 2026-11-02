#!/usr/bin/env node
/* data/sets/ → data/questions.js 생성(docs/INGEST.md §2-F, docs/DATA.md §1).
   node tools/build_questions.js [--school <id>] [--out <파일>]
   --school은 그 학교 세트만(디렉터리 이름 <id>-*), --out은 다른 파일로 쓴다(학교별 세션의 검증용. docs/INGEST.md §8).
   입력: data/sets/_db.json(levels·학교), data/sets/<id>/meta.json(세트 공통), data/sets/<id>/{kim,hwang,merged}.json(변형)
   출력: data/questions.js — window.INTERVIEW_DB. 사람이 읽을 수 있는 들여쓰기, 제시문은 템플릿 리터럴.
   변형 파일의 items[{label,text,note}]는 문장만 넣고, passages[].notes·refs는 사이트에 넣지 않는다(작업 자료는 data/sets/에 남는다). */
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const dir = path.join(root, "data", "sets");
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const ONLY = opt("--school");
const OUT = opt("--out") ? path.resolve(opt("--out")) : path.join(root, "data", "questions.js");
const DB = JSON.parse(fs.readFileSync(path.join(dir, "_db.json"), "utf8"));
const VARIANT_ORDER = ["merged", "hwang", "kim"];
const SCHOOL_ORDER = DB.schools.map(s => s.id);

const sets = [];
for (const name of fs.readdirSync(dir)) {
  const d = path.join(dir, name);
  if (!fs.statSync(d).isDirectory()) continue;
  if (ONLY && !name.startsWith(ONLY + "-")) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf8"));
  const variants = {};
  for (const k of VARIANT_ORDER) {
    const f = path.join(d, k + ".json");
    if (!fs.existsSync(f)) continue;
    const v = JSON.parse(fs.readFileSync(f, "utf8"));
    const o = { label: v.label };
    if (v.basis) o.basis = v.basis;
    if (v.source) o.source = v.source;
    o.passages = v.passages.map(p => { const q = { no: p.no }; if (p.label) q.label = p.label; q.kind = p.kind; if (p.length) q.length = p.length; q.text = p.text; q.source = p.source || ""; return q; });
    if (v.tasks && v.tasks.length) o.tasks = v.tasks.map(t => ({ label: t.label || "", text: t.text }));
    o.followups = v.followups.map(g => ({ student: g.student, label: g.label, items: g.items.map(i => typeof i === "string" ? i : i.text) }));
    o.common = (v.common || []).map(c => ({ label: c.label, items: c.items.map(i => typeof i === "string" ? i : i.text) }));
    variants[k] = o;
  }
  const keys = Object.keys(variants);
  if (!keys.length) { console.error(`변형 없음: ${name}`); process.exit(1); }
  const variant = keys.includes(meta.variant) ? meta.variant : VARIANT_ORDER.find(k => keys.includes(k));
  const set = { id: meta.id, school: meta.school, year: meta.year, name: meta.name, session: meta.session, track: meta.track,
    instruction: meta.instruction, format: meta.format, themes: meta.themes, tags: meta.tags || [], variant, variants };
  if (meta.tree) set.tree = meta.tree;
  sets.push(set);
}
sets.sort((a, b) => SCHOOL_ORDER.indexOf(a.school) - SCHOOL_ORDER.indexOf(b.school) || b.year - a.year || a.id.localeCompare(b.id));

/* ---------- 직렬화 ---------- */
const ident = k => /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
const str = s => s.includes("\n") ? "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`" : JSON.stringify(s);
function emit(v, ind) {
  const pad = "  ".repeat(ind), pad1 = "  ".repeat(ind + 1);
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return str(v);
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (v.every(x => typeof x !== "object" || x === null)) {
      const flat = "[" + v.map(x => emit(x, ind + 1)).join(", ") + "]";
      if (flat.length < 100 && !flat.includes("\n")) return flat;
      return "[\n" + v.map(x => pad1 + emit(x, ind + 1)).join(",\n") + "\n" + pad + "]";
    }
    return "[\n" + v.map(x => pad1 + emit(x, ind + 1)).join(",\n") + "\n" + pad + "]";
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (!entries.length) return "{}";
  const flat = "{ " + entries.map(([k, x]) => ident(k) + ": " + emit(x, ind + 1)).join(", ") + " }";
  if (flat.length < 110 && !flat.includes("\n")) return flat;
  return "{\n" + entries.map(([k, x]) => pad1 + ident(k) + ": " + emit(x, ind + 1)).join(",\n") + "\n" + pad + "}";
}

const bySchool = {};
for (const s of sets) (bySchool[s.school] = bySchool[s.school] || []).push(s);
const lines = [];
lines.push(`/* ============================================================
   기출 데이터 — 로스쿨 면접 복기. 생성 파일: node tools/build_questions.js 가 data/sets/ 에서 만든다. 직접 고치지 말 것.
   출처: 해커스 김종수 『로스쿨 면접 200주제』 3권 기출편(2026), 『황변과 함께하는 로스쿨 면접 Q』 1권(2026)의 복기를
         사용자가 제공한 PDF에서 OCR·정제해 옮김(docs/INGEST.md). 제시문 각주·출처 표시는 source에 그대로.
   구조(docs/DATA.md §1):
     INTERVIEW_DB.levels            — 난이도·변형도 정의(AI 면접관 프롬프트에 쓰임)
     INTERVIEW_DB.schools[]         — 학교 하나 = { id, name, short, format, sets[] }
       set.variant                  — 기본 복기본(merged | hwang | kim). SNU.db.set(id, v)가 해석한다
       set.variants[v]              — 복기본 하나 = { label, source?, basis?, passages[], followups[], common[] }
         passages[]                 — { no, label?, kind: "prose"|"dialog"|"case", length?, text, source }
         tasks[]?                   — 문제지에 제시된 문항 { label: "1-1"|"", text }(서울대에는 없다)
         followups[]                — { student, label, items: [질문…] }
       set.tree                     — 사전 결정 트리(basis: 어느 복기본의 문구에 묶였는지)
   ============================================================ */`);
lines.push("window.INTERVIEW_DB = {");
lines.push("  levels: " + emit(DB.levels, 1) + ",");
lines.push("  schools: [");
DB.schools.forEach((sc, si) => {
  const ss = bySchool[sc.id] || [];
  lines.push(`   { id: ${JSON.stringify(sc.id)}, name: ${JSON.stringify(sc.name)}, short: ${JSON.stringify(sc.short)},`);
  lines.push(`    format: ${emit(sc.format, 2)},`);
  if (!ss.length) { lines[lines.length - 1] += " sets: [] }" + (si < DB.schools.length - 1 ? "," : ""); return; }
  lines.push("    sets: [");
  ss.forEach((s, i) => {
    lines.push(`    /* ---------------------------------------------------------- ${s.year} ${s.name} ---- */`);
    lines.push("    " + emit(s, 2) + (i < ss.length - 1 ? "," : ""));
  });
  lines.push("    ]");
  lines.push("   }" + (si < DB.schools.length - 1 ? "," : ""));
});
lines.push("  ]");
lines.push("};");
const text = lines.join("\n") + "\n";
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text, "utf8");
const nv = sets.reduce((n, s) => n + Object.keys(s.variants).length, 0);
console.log(`${path.relative(root, OUT)} 생성: 세트 ${sets.length}, 변형 ${nv}, ${Math.round(Buffer.byteLength(text, "utf8") / 1024)}KB`);
