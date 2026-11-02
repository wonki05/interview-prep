#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""승격한 세트 ↔ 교재 텍스트층 대조(docs/INGEST.md §8-5): python tools/check_layer.py <school>
   data/sets/<school>-*/{kim,hwang}.json 을 그 세트 쪽의 ABBYY 텍스트층(work/books/<book>/pages/pNNNN.txt, books/*.pdf 줄 좌표)과 대조해
   (1) 바꿔치기 후보: 본문·문항·질문과 텍스트층이 짧게 다른 곳(대개 텍스트층 오인식. 정제가 낱말을 바꿔 쓴 곳을 찾는다)
   (2) 누락 후보: 어느 변형·지시문·학교 format에도 들어가지 않은 텍스트층 한글 구간(꼬리말·옆탭·세트 머리는 대개 여기 나온다)
   (3) 문단 후보: 양쪽 정렬에서 짧게 끝난 줄(문단 끝) 자리가 본문에서는 한 문단 안에 이어진 곳(missing),
       본문의 문단 나뉨이 텍스트층에서는 줄 가운데인 곳(midline). 도표·그림 문단은 뺀다
   을 work/reports/layer-check-<school>.md 에 쓴다. 후보는 쪽 이미지로 판정한다(텍스트층 자체 오류가 많다)."""
import sys, re, json, glob, difflib, pathlib, unicodedata
import fitz  # pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF = {"kim": "2026학년도 김종수 로스쿨 면접 3권 (기출편).pdf", "hwang": "2026학년도 황변 로스쿨 면접 1권.pdf"}
HANGUL = re.compile(r"[가-힣]")
PB = "¶"   # 정규화한 본문 안의 문단 나뉨


def norm(s):
    """NFKC(전각 괄호·쌍점 → 반각) 뒤 공백 제거. 문단 나뉨은 PB로 남긴다."""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s).replace("\n", PB))


def strings(v):
    """변형의 (종류, 문자열): 제시문·문항·질문(대조 대상)."""
    for p in v["passages"]:
        yield "제시문", p["text"]
    for t in v.get("tasks") or []:
        yield "문항", t["text"]
    for g in list(v["followups"]) + list(v.get("common") or []):
        for i in g["items"]:
            yield "질문", i["text"] if isinstance(i, dict) else i


def extras(v, meta):
    """누락 점검에서 '들어간 것'으로 칠 나머지 문자열(라벨·분량·출처·notes·refs·지시문)."""
    yield meta.get("instruction") or ""
    for p in v["passages"]:
        yield from (p.get("label") or "", p.get("length") or "", p.get("source") or "")
        for x in list(p.get("notes") or []) + list(p.get("refs") or []):
            yield x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)
    for g in list(v["followups"]) + list(v.get("common") or []):
        yield g.get("label") or ""
        for i in g["items"]:
            if isinstance(i, dict):
                yield i.get("note") or ""


def layer_text(book, pages):
    return "".join((ROOT / "work" / "books" / book / "pages" / f"p{p:04d}.txt").read_text(encoding="utf-8")
                   for p in pages if (ROOT / "work" / "books" / book / "pages" / f"p{p:04d}.txt").exists())


# ---------- (1) 바꿔치기 ----------
def substitutions(text, L):
    T = norm(text).replace(PB, "")
    if len(T) < 4:
        return []
    sm = difflib.SequenceMatcher(None, T, L, autojunk=False)
    blocks = [m for m in sm.get_matching_blocks() if m.size >= 3]
    if not blocks:
        return []
    lo, hi = max(0, min(m.b for m in blocks) - 5), max(m.b + m.size for m in blocks) + 5
    sm = difflib.SequenceMatcher(None, T, L[lo:hi], autojunk=False)
    if sm.ratio() < 0.25:          # 짧은 질문이 엉뚱한 곳에 맞춰진 경우
        return []
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        t, l = T[i1:i2], L[lo + j1:lo + j2]
        if op == "replace" and len(t) <= 6 and len(l) <= 6 and HANGUL.search(t) and HANGUL.search(l):
            out.append((t, l, T[max(0, i1 - 12):i2 + 12]))
    return out


# ---------- (3) 문단: PDF 줄 좌표 ----------
_docs = {}


def page_lines(book, pg):
    if book not in _docs:
        _docs[book] = fitz.open(str(ROOT / "books" / PDF[book]))
    L = []
    for b in _docs[book][pg - 1].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"])
            if t.strip():
                L.append((t, *l["bbox"], max(s["size"] for s in l["spans"])))
    L.sort(key=lambda r: (round(r[2] / 3), r[1]))
    return L


def junctions(L):
    """바로 아래로 이어지는 줄 쌍 (앞 줄, 뒤 줄, 앞 줄이 짧은가, 모자란 폭). 기준 폭은 이웃 줄 가운데 가장 긴 것."""
    out = []
    for i in range(len(L) - 1):
        a, b = L[i], L[i + 1]
        h = max(a[4] - a[2], 6)
        if not (0 < b[2] - a[2] < 2.6 * h) or (abs(b[1] - a[1]) > 40 and abs(b[3] - a[3]) > 40):
            continue
        near = [L[j][3] for j in range(max(0, i - 3), min(len(L), i + 4)) if abs(L[j][1] - a[1]) < 25 or abs(L[j][3] - a[3]) < 25]
        right = max(near + [a[3], b[3]])
        out.append((a[0], b[0], a[3] < right - 1.2 * max(a[5], 5), round(right - a[3], 1)))
    return out


def unique(hay, needle):
    i = hay.find(needle)
    return i if i >= 0 and hay.find(needle, i + 1) < 0 else -1


def paragraphs(book, pages, passages):
    texts = [(p["no"], norm(p["text"])) for p in passages]
    figs = []
    for no, T in texts:
        pos = 0
        for par in T.split(PB):
            if par.startswith("[도표]") or par.startswith("[그림]"):
                figs.append((no, pos, pos + len(par)))
            pos += len(par) + 1
    in_fig = lambda no, k: any(n == no and s <= k <= e for n, s, e in figs)
    out, seen = [], set()
    for pg in pages:
        for la, lb, short, gap in junctions(page_lines(book, pg)):
            A, B = norm(la), norm(lb)
            if len(A) < 3 or len(B) < 3:
                continue
            hit = None
            for w in (8, 6, 4):
                for no, T in texts:
                    k = unique(T, A[-w:] + PB + B[:w])
                    if k >= 0:
                        hit = (no, k + min(w, len(A)), True); break
                    k = unique(T, A[-w:] + B[:w])
                    if k >= 0:
                        hit = (no, k + min(w, len(A)), False); break
                if hit:
                    break
            if not hit or in_fig(hit[0], hit[1]):
                continue
            no, k, has_break = hit
            if has_break:
                seen.add((no, k))
            elif short:
                out.append(("missing", pg, no, la.strip()[-30:], lb.strip()[:30], gap))
    lines = "|".join(norm(t) for pg in pages for t, *_ in page_lines(book, pg))
    for no, T in texts:
        for m in re.finditer(PB, T):
            k = m.start()
            left, right = T[max(0, k - 6):k], T[k + 1:k + 7]
            if (no, k) in seen or in_fig(no, k) or in_fig(no, k + 1) or PB in left + right or len(left) < 4 or len(right) < 4:
                continue
            if unique(lines, left + right) >= 0:      # 줄 경계(|) 없이 이어짐 = 줄 가운데에서 나눴다
                out.append(("midline", None, no, left, right, None))
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    school = sys.argv[1]
    db = json.loads((ROOT / "data" / "sets" / "_db.json").read_text(encoding="utf-8"))
    fmt = next((s.get("format") for s in db["schools"] if s["id"] == school), None) or {}
    fmt_strings = list(fmt.get("basics") or []) + [x for row in fmt.get("details") or [] for x in row]
    subs, gaps, paras = [], [], []
    page_strings = {}
    for f in sorted(glob.glob(str(ROOT / "data" / "sets" / f"{school}-*" / "*.json"))):
        f = pathlib.Path(f)
        book, sid = f.stem, f.parent.name
        if book not in PDF:
            continue
        v = json.loads(f.read_text(encoding="utf-8"))
        meta = json.loads((f.parent / "meta.json").read_text(encoding="utf-8"))
        a, b = map(int, v["source"]["pages"].split("-"))
        pages = range(a, b + 1)
        L = norm(layer_text(book, pages)).replace(PB, "")
        for kind, s in strings(v):
            subs += [(sid, book, kind, *x) for x in substitutions(s, L)]
        paras += [(sid, book, *x) for x in paragraphs(book, pages, v["passages"])]
        ss = [norm(x).replace(PB, "") for _, x in strings(v)] + [norm(x).replace(PB, "") for x in extras(v, meta) if x]
        for p in pages:
            page_strings.setdefault((book, p), []).extend(ss)
    fs = [norm(x).replace(PB, "") for x in fmt_strings]
    for (book, p), ss in sorted(page_strings.items()):
        L = norm(layer_text(book, [p])).replace(PB, "")
        cov = [False] * len(L)
        for s in ss + fs:
            if len(s) < 3:
                continue
            for m in difflib.SequenceMatcher(None, s, L, autojunk=False).get_matching_blocks():
                if m.size >= 4:
                    cov[m.b:m.b + m.size] = [True] * m.size
        i = 0
        while i < len(L):
            if cov[i]:
                i += 1; continue
            j = i
            while j < len(L) and not cov[j]:
                j += 1
            seg = L[i:j]
            if len(HANGUL.findall(seg)) >= 8:
                gaps.append((book, p, seg[:120]))
            i = j

    out = ROOT / "work" / "reports" / f"layer-check-{school}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    md = [f"# 텍스트층 대조 — {school}", "",
          f"바꿔치기 후보 {len(subs)} · 누락 후보 {len(gaps)} · 문단 후보 {len(paras)}. 후보는 쪽 이미지로 판정한다(텍스트층 오인식·꼬리말·도표 글자가 섞인다).", "",
          "## 1. 바꿔치기 후보 (정제 ← 텍스트층)", "", "| 세트 | 책 | 종류 | 정제 | 텍스트층 | 앞뒤 |", "|---|---|---|---|---|---|"]
    md += [f"| {s} | {b} | {k} | {t} | {l} | {c} |" for s, b, k, t, l, c in subs]
    md += ["", "## 2. 누락 후보 (어느 변형에도 없는 텍스트층 한글 구간)", "", "| 책 | 쪽 | 구간(공백 뺌) |", "|---|---|---|"]
    md += [f"| {b} | {p} | {seg} |" for b, p, seg in gaps]
    md += ["", "## 3. 문단 후보", "", "missing: 짧은 줄(문단 끝) 다음 줄이 본문에서는 같은 문단. midline: 본문의 나뉨이 텍스트층 줄 가운데. 그림 옆 짧은 줄은 오탐.", "",
           "| 세트 | 책 | 종류 | 쪽 | 제시문 | 앞 | 뒤 | 모자란 폭(pt) |", "|---|---|---|---|---|---|---|---|"]
    md += [f"| {s} | {b} | {k} | {pg or ''} | {no} | {x} | {y} | {gap if gap is not None else ''} |" for s, b, k, pg, no, x, y, gap in paras]
    out.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"{school}: substitutions {len(subs)}, gaps {len(gaps)}, paragraphs {len(paras)} -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
