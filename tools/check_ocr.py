#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""OCR 정제 결과 결정적 점검(docs/INGEST.md §2-B 3·§8): python tools/check_ocr.py <school> [kim|hwang ...]
   tools/schools/<school>.json 의 쪽 범위에 있는 work/ocr/<book>/pNNNN.json 블록 텍스트를 ABBYY 텍스트층과 difflib로 정렬해
   유사도·한쪽에만 있는 긴 구간·라벨 순서를 점검하고 work/reports/ocr-check-<school>.md 를 쓴다."""
import sys, re, json, pathlib, difflib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import schoolcfg

PUNCT = re.compile(r"[\s　.,;:!?'\"‘’“”「」『』〈〉《》<>＜＞()（）\[\]［］{}【】·•・…—–\-~～_/\|*※①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸]+")
def norm(s): return PUNCT.sub("", s)

QLABEL = re.compile(r"^Q(\d+)(?:-(\d+))?$")
# 제시문 머리 label: 숫자, 한 글자 가나다·ABC, 사례(번호), 에피소드 등 짧은 낱말. ""는 "제시문〉" 빈 머리(조립이 무시)
PLABEL = re.compile(r"^(\d+|[가-하]|[A-Z]|사례( ?\d+)?|[가-힣]{2,6})?$")
PLACEHOLDER = re.compile(r"미전사|전사\s*(생략|보류)|본문\s*(생략|미전사)|원문\s*(생략|미전사)|요지만")

def runs(opcodes, tag, src, minlen):
    out = []
    for t, i1, i2, j1, j2 in opcodes:
        if t == tag:
            seg = src[i1:i2] if tag == "delete" else src[j1:j2]
            if len(seg) >= minlen: out.append(seg)
        elif t == "replace":
            a, b = (i2 - i1), (j2 - j1)
            if tag == "delete" and a - b >= minlen: out.append("~" + src[i1:i2])
            if tag == "insert" and b - a >= minlen: out.append("~" + src[j1:j2])
    return out

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
    plabels = [bl.get("label", "") for bl in blocks if bl["type"] == "passage-head"]
    bad = [l for l in plabels if not PLABEL.match(l or "")]
    if bad: issues.append(f"passage-head label 이상: {bad}")
    ph = [i for i, bl in enumerate(blocks) if PLACEHOLDER.search(bl.get("text", ""))]
    if ph: issues.append(f"자리표시(미전사 등) 블록: {ph}")
    if book == "kim":
        group_started = False; expect_main = None
        for bl in blocks:
            if bl["type"] == "q-group": group_started = True; expect_main = 1
            elif bl["type"] == "q":
                lab = bl.get("label", "")
                if not lab:
                    issues.append(f"김종수 q 라벨 없음: {bl['text'][:30]}"); continue
                m = QLABEL.match(lab)
                if not m: issues.append(f"q 라벨 형식: {lab}"); continue
                main = int(m.group(1)); sub = m.group(2)
                if expect_main is None:
                    expect_main = main  # 앞 쪽 묶음의 이어짐, 또는 문제지 문항으로 시작
                if sub is None:
                    if main != expect_main and not (group_started and main > 1 and expect_main == 1):
                        issues.append(f"q 번호 건너뜀: {lab} (기대 Q{expect_main})")
                    expect_main = main + 1
                else:
                    if main not in (expect_main - 1, expect_main): issues.append(f"q 부번호 소속 이상: {lab} (직전 주번호 {expect_main-1})")
                    if main == expect_main: expect_main = main + 1
    empty = [i for i, bl in enumerate(blocks) if not bl["text"].strip()]
    if empty: issues.append(f"빈 블록: {empty}")
    return {"ratio": ratio, "chars_abbyy": len(a), "chars_refined": len(b), "only_abbyy": only_abbyy, "only_refined": only_refined,
            "issues": issues, "verdict": pj.get("verdict"), "attempts": pj.get("attempts"), "model": pj.get("model"), "ok": pj.get("ok")}

def main():
    if len(sys.argv) < 2:
        raise SystemExit("사용: python tools/check_ocr.py <school> [kim|hwang ...]")
    cfg = schoolcfg.load(sys.argv[1])
    books = sys.argv[2:] or [b for b in schoolcfg.BOOKS if cfg["books"].get(b)]
    lines = [f"# OCR 정제 점검 — {cfg['short']}", ""]
    flagged, missing = 0, []
    for book in books:
        for p in schoolcfg.page_range(cfg, book):
            f = pathlib.Path(f"work/ocr/{book}/p{p:04d}.json")
            if not f.exists():
                missing.append(f"{book} p{p}"); continue
            pj = json.load(open(f, encoding="utf-8"))
            txt = pathlib.Path(f"work/books/{book}/pages/p{p:04d}.txt").read_text(encoding="utf-8")
            r = check_page(book, pj, txt)
            v = r["verdict"] or {}
            verified = bool(v) and v.get("ok", False)
            flag = r["ratio"] < 0.9 or r["only_refined"] or r["issues"] or (bool(v) and not verified) or r["ok"] is False
            flagged += bool(flag)
            how = ("검증 ok" if verified else f"검증 issues {len(v.get('issues', []))}") if v else f"검증 없음({r['model'] or '-'})"
            lines.append(f"## {book} p{p} {'⚠' if flag else 'ok'}  유사도 {r['ratio']:.3f}  ABBYY {r['chars_abbyy']}자 / 정제 {r['chars_refined']}자  시도 {r['attempts']}  {how}")
            for s in r["only_refined"]: lines.append(f"- 정제문에만(≥8자): `{s[:80]}`")
            for s in r["only_abbyy"][:12]: lines.append(f"- 텍스트층에만(≥8자): `{s[:80]}`")
            for s in r["issues"]: lines.append(f"- 라벨/구조: {s}")
            for i in (v.get("issues") or [])[:10]: lines.append(f"- 검증자: 블록 {i.get('block')} [{i.get('kind')}] 기대 `{str(i.get('expected'))[:60]}` / 실제 `{str(i.get('got'))[:60]}`")
            lines.append("")
    if missing:
        lines.insert(2, f"⚠ 정제 결과 없는 쪽 {len(missing)}: {', '.join(missing)}\n")
    pathlib.Path("work/reports").mkdir(parents=True, exist_ok=True)
    out = pathlib.Path(f"work/reports/ocr-check-{cfg['id']}.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"{out} 작성. 주의 쪽 {flagged}, 정제 결과 없는 쪽 {len(missing)}")

if __name__ == "__main__":
    main()
