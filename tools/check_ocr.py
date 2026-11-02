#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""OCR 정제 결과 결정적 점검(docs/INGEST.md §2-B 3): python tools/check_ocr.py [kim|hwang ...]
   work/ocr/<book>/pNNNN.json 의 블록 텍스트를 ABBYY 텍스트층과 difflib로 정렬해
   유사도·한쪽에만 있는 긴 구간·라벨 순서를 점검하고 work/reports/ocr-check.md 를 쓴다."""
import sys, re, json, pathlib, difflib

PUNCT = re.compile(r"[\s　.,;:!?'\"‘’“”「」『』〈〉《》<>＜＞()（）\[\]［］{}【】·•・…—–\-~～_/\|*※①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸]+")
def norm(s): return PUNCT.sub("", s)

QLABEL = re.compile(r"^Q(\d+)(?:-(\d+))?$")
PLABELS = {"1","2","3","4","5","가","나","다","라","마","사례",""}   # ""는 황변 2023의 "제시문〉" 빈 머리(조립이 무시)

def runs(opcodes, tag, src, minlen):
    out = []
    for t, i1, i2, j1, j2 in opcodes:
        if t == tag:
            seg = src[i1:i2] if tag == "delete" else src[j1:j2]
            if len(seg) >= minlen: out.append(seg)
        elif t == "replace":
            a, b = (i2 - i1), (j2 - j1)
            if tag == "delete" and a - b >= minlen: out.append("~" + opcodes_src(src, i1, i2))
            if tag == "insert" and b - a >= minlen: out.append("~" + opcodes_src(src, j1, j2))
    return out
def opcodes_src(s, a, b): return s[a:b]

def check_page(book, pj, txt):
    blocks = pj["blocks"]
    body = "".join(b["text"] for b in blocks if b["type"] != "skip")
    skipped = [b["text"] for b in blocks if b["type"] == "skip"]
    a = norm(txt)
    for s in skipped:
        ns = norm(s)
        if len(ns) >= 4: a = a.replace(ns, "")
    b = norm(body)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    ratio = sm.ratio()
    ops = sm.get_opcodes()
    only_abbyy = runs(ops, "delete", a, 8)     # 텍스트층에만: 누락 후보(옆탭 잡문자 포함)
    only_refined = runs(ops, "insert", b, 8)   # 정제문에만: 이미지에서 복원했거나 날조
    issues = []
    # 라벨 점검
    plabels = [bl.get("label","") for bl in blocks if bl["type"] == "passage-head"]
    bad = [l for l in plabels if l not in PLABELS]
    if bad: issues.append(f"passage-head label 이상: {bad}")
    if book == "kim":
        group_started = False; expect_main = None; prev_main = None
        for bl in blocks:
            if bl["type"] == "q-group": group_started = True; expect_main = 1; prev_main = None
            elif bl["type"] == "q":
                lab = bl.get("label","")
                if not lab:
                    issues.append(f"김종수 q 라벨 없음: {bl['text'][:30]}"); continue
                m = QLABEL.match(lab)
                if not m: issues.append(f"q 라벨 형식: {lab}"); continue
                main = int(m.group(1)); sub = m.group(2)
                if not group_started and expect_main is None:
                    expect_main = main  # 앞 쪽 묶음의 이어짐
                if sub is None:
                    if main != expect_main: issues.append(f"q 번호 건너뜀: {lab} (기대 Q{expect_main})")
                    expect_main = main + 1
                else:
                    if main not in (expect_main - 1, expect_main): issues.append(f"q 부번호 소속 이상: {lab} (직전 주번호 {expect_main-1})")
                    if main == expect_main: expect_main = main + 1
    empty = [i for i, bl in enumerate(blocks) if not bl["text"].strip()]
    if empty: issues.append(f"빈 블록: {empty}")
    return {"ratio": ratio, "chars_abbyy": len(a), "chars_refined": len(b), "only_abbyy": only_abbyy, "only_refined": only_refined,
            "issues": issues, "verdict": pj.get("verdict"), "attempts": pj.get("attempts")}

def main():
    books = sys.argv[1:] or ["kim", "hwang"]
    lines = ["# OCR 정제 점검", ""]
    flagged = 0
    for book in books:
        d = pathlib.Path("work/ocr") / book
        for f in sorted(d.glob("p*.json")):
            pj = json.load(open(f, encoding="utf-8"))
            p = pj["page"]
            txt = pathlib.Path(f"work/books/{book}/pages/p{p:04d}.txt").read_text(encoding="utf-8")
            r = check_page(book, pj, txt)
            v = r["verdict"] or {}
            flag = r["ratio"] < 0.9 or r["only_refined"] or r["issues"] or not v.get("ok", False)
            flagged += bool(flag)
            lines.append(f"## {book} p{p} {'⚠' if flag else 'ok'}  유사도 {r['ratio']:.3f}  ABBYY {r['chars_abbyy']}자 / 정제 {r['chars_refined']}자  시도 {r['attempts']}  검증 {'ok' if v.get('ok') else 'issues ' + str(len(v.get('issues', [])))}")
            for s in r["only_refined"]: lines.append(f"- 정제문에만(≥8자): `{s[:80]}`")
            for s in r["only_abbyy"][:12]: lines.append(f"- 텍스트층에만(≥8자): `{s[:80]}`")
            for s in r["issues"]: lines.append(f"- 라벨/구조: {s}")
            for i in (v.get("issues") or [])[:10]: lines.append(f"- 검증자: 블록 {i.get('block')} [{i.get('kind')}] 기대 `{str(i.get('expected'))[:60]}` / 실제 `{str(i.get('got'))[:60]}`")
            lines.append("")
    pathlib.Path("work/reports").mkdir(parents=True, exist_ok=True)
    pathlib.Path("work/reports/ocr-check.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"work/reports/ocr-check.md 작성. 주의 쪽 {flagged}")

if __name__ == "__main__":
    main()
