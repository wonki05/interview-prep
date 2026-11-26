#!/usr/bin/env node
/* data/mocks/ → data/mocks.js 생성(docs/DATA.md §6). data/sets/ → build_questions.js → data/questions.js와 같은 방식.
   node tools/build_mocks.js [--in <폴더>] [--out <파일>]
   입력: data/mocks/<id>.json(한 문제 한 파일. id = mock-<묶음>-<학교 id>-<문제 번호>), data/sets/_db.json(학교 순서·이름)
   출력: data/mocks.js — window.MOCK_DB. 원본의 notes는 넣지 않고, format의 null 값(keynote·memo)은 뺀다(기출 세트 format과 같은 모양).
   원본의 추가질문(followups: 문항과 같은 평평한 [{label, text}], 책 번호)은 기출 세트와 같은 묶음 [{ student: "공통", label: "추가질문", items: [문장] }]으로 싣는다.
   사이트에는 문장만 넣고 번호는 화면이 문항 뒤로 이어 붙인다(책 번호가 그와 다르면 경고).
   --in·--out은 다른 폴더·파일로 만든다(추출 결과를 사이트에 넣기 전에 볼 때). 형식 검사는 tools/validate-data.js가 한다. */
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const IN = opt("--in") ? path.resolve(opt("--in")) : path.join(root, "data", "mocks");
const OUT = opt("--out") ? path.resolve(opt("--out")) : path.join(root, "data", "mocks.js");
const DB = JSON.parse(fs.readFileSync(path.join(root, "data", "sets", "_db.json"), "utf8"));
const SCHOOLS = DB.schools.map(s => ({ id: s.id, name: s.name, short: s.short }));   // 학교 순서 = INTERVIEW_DB.schools
const SCHOOL_ORDER = SCHOOLS.map(s => s.id);
/* 교재 묶음. name이 모의고사 화면의 자리 이름이다. AI 맞춤 모의고사는 브라우저에서 만드는 자리라 여기에 없다. */
const SERIES = [{ id: "kim", name: "김종수 모의고사" }];
const ID_RE = /^mock-([a-z]+)-([a-z]+)-(\d+)$/;

let failed = 0;
const fail = m => { console.error("오류: " + m); failed++; };
const files = fs.existsSync(IN) ? fs.readdirSync(IN).filter(f => f.endsWith(".json")).sort() : [];
const sets = [];
for (const f of files) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(IN, f), "utf8")); } catch (e) { fail(`${f}: JSON 읽기 실패 — ${e.message}`); continue; }
  const hit = ID_RE.exec(m.id || "");
  if (!hit) { fail(`${f}: id 형식 오류(${m.id}) — mock-<묶음>-<학교 id>-<문제 번호>`); continue; }
  const [, series, school, no] = hit;
  if (!SERIES.some(s => s.id === series)) { fail(`${f}: 모르는 묶음 ${series}`); continue; }
  const sc = SCHOOLS.find(s => s.id === school);
  if (!sc || m.school !== school) { fail(`${f}: school(${m.school})이 모르는 학교이거나 id의 학교(${school})와 다르다`); continue; }
  if (m.no !== Number(no)) { fail(`${f}: no(${m.no})가 id의 번호(${no})와 다르다`); continue; }
  if (f !== m.id + ".json") console.log(`경고: 파일 이름 ${f} ≠ ${m.id}.json`);
  if (m.followups !== undefined && !Array.isArray(m.followups)) { fail(`${f}: followups는 배열(없으면 [])`); continue; }
  const tasks = (m.tasks || []).map(t => ({ label: t.label || "", text: t.text }));
  const fu = m.followups || [];
  fu.forEach((q, i) => { const want = String(tasks.length + i + 1); if (q && q.label && String(q.label) !== want) console.log(`경고: ${f}: 추가질문 번호 ${q.label} — 화면은 Q${want}(문항 ${tasks.length}개 뒤로 이어 붙임)`); });
  const fm = m.format || {};
  const format = { prep: fm.prep, duration: fm.duration };
  if (fm.keynote !== null && fm.keynote !== undefined) format.keynote = fm.keynote;
  if (fm.memo !== null && fm.memo !== undefined) format.memo = fm.memo;
  sets.push({
    id: m.id, series, school, no: m.no, name: `${sc.short} ${m.no}`,   // 표시 이름 = 학교 약칭 + 문제 번호(CLAUDE.md 규칙 11)
    source: m.source, header: m.header, format, instruction: m.instruction,
    themes: m.themes || [], tags: m.tags || [],
    passages: (m.passages || []).map(p => { const q = { no: p.no }; if (p.label) q.label = p.label; q.kind = p.kind; if (p.length) q.length = p.length; q.text = p.text; q.source = p.source || ""; return q; }),
    tasks,
    followups: fu.length ? [{ student: "공통", label: "추가질문", items: fu.map(q => q && q.text) }] : []
  });
}
if (failed) { console.error(`실패 — 오류 ${failed}, ${path.relative(root, OUT)}를 쓰지 않았다`); process.exit(1); }
sets.sort((a, b) => SCHOOL_ORDER.indexOf(a.school) - SCHOOL_ORDER.indexOf(b.school) || a.no - b.no || a.id.localeCompare(b.id));
const series = SERIES.map(s => {
  const ss = sets.filter(x => x.series === s.id), withBook = ss.find(x => x.source && x.source.book);
  return { id: s.id, name: s.name, book: withBook ? withBook.source.book : "", sets: ss };
});

/* ---------- 직렬화(build_questions.js와 같은 모양: 사람이 읽을 수 있는 들여쓰기, 여러 줄 문자열은 템플릿 리터럴) ---------- */
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
    }
    return "[\n" + v.map(x => pad1 + emit(x, ind + 1)).join(",\n") + "\n" + pad + "]";
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (!entries.length) return "{}";
  const flat = "{ " + entries.map(([k, x]) => ident(k) + ": " + emit(x, ind + 1)).join(", ") + " }";
  if (flat.length < 110 && !flat.includes("\n")) return flat;
  return "{\n" + entries.map(([k, x]) => pad1 + ident(k) + ": " + emit(x, ind + 1)).join(",\n") + "\n" + pad + "}";
}

const lines = [];
lines.push(`/* ============================================================
   모의고사 데이터 — 생성 파일: node tools/build_mocks.js 가 data/mocks/ 에서 만든다. 직접 고치지 말 것.
   출처: 해커스 김종수 『로스쿨 면접 200주제』 2권 심화&실전 모의고사편(2026)의 학교별 실전모의고사를
         사용자가 제공한 PDF에서 옮김. 제시문 각주·출처 표시는 source에 그대로.
   구조(docs/DATA.md §6):
     MOCK_DB.schools[]       — 학교 순서·표시 이름 { id, name, short }(INTERVIEW_DB.schools와 같은 순서)
     MOCK_DB.series[]        — 교재 묶음 { id, name, book, sets[] }. sets는 학교 순서 → 문제 번호 순
       set                   — { id, series, school, no, name, source, header, format, instruction, themes, tags, passages[], tasks[], followups[] }
         header[]            — 진행 조건 줄(책 그대로)
         format              — { prep, duration, keynote?, memo? }(분. prep은 소수일 수 있다)
         passages[]          — { no, label?, kind: "prose"|"dialog"|"case", length?, text, source }
         tasks[]             — 문항 { label: "1"|"1-1"|"", text }
         followups[]         — 추가질문 묶음 { student: "공통", label: "추가질문", items: [문장] }(기출 세트와 같은 모양, 없으면 []). 번호는 문항 뒤로 이어진다
   ============================================================ */`);
lines.push("window.MOCK_DB = {");
lines.push("  schools: [");
SCHOOLS.forEach((s, i) => lines.push("    " + emit(s, 2) + (i < SCHOOLS.length - 1 ? "," : "")));
lines.push("  ],");
lines.push("  series: [");
series.forEach((sr, si) => {
  lines.push(`   { id: ${JSON.stringify(sr.id)}, name: ${JSON.stringify(sr.name)}, book: ${JSON.stringify(sr.book)},`);
  if (!sr.sets.length) { lines.push("    sets: [] }" + (si < series.length - 1 ? "," : "")); return; }
  lines.push("    sets: [");
  sr.sets.forEach((s, i) => {
    lines.push(`    /* ---------------------------------------------------------- ${s.name} ---- */`);
    lines.push("    " + emit(s, 2) + (i < sr.sets.length - 1 ? "," : ""));
  });
  lines.push("    ]");
  lines.push("   }" + (si < series.length - 1 ? "," : ""));
});
lines.push("  ]");
lines.push("};");
const text = lines.join("\n") + "\n";
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text, "utf8");
const nSchools = new Set(sets.map(s => s.school)).size;
console.log(`${path.relative(root, OUT)} 생성: 문제 ${sets.length}(학교 ${nSchools}), ${Math.round(Buffer.byteLength(text, "utf8") / 1024)}KB${files.length ? "" : ` — 입력 없음(${path.relative(root, IN) || IN})`}`);
