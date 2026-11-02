#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""세트 조립(docs/INGEST.md §2-C): python tools/assemble_sets.py kim|hwang
   work/ocr/<book>/pNNNN.json 의 블록을 쪽 순서대로 이어 set-head 블록으로 세트를 가르고
   변형 JSON(work/sets/<book>/<set id>.json)과 조립 보고서(work/reports/assemble-<book>.md)를 쓴다.
   모델을 쓰지 않는다. type·label·marker·cont·쪽 순서만 사용한다."""
import sys, re, json, pathlib

SESSION = {"A": ("오전 면접", "일반전형"), "B": ("오후 면접", "일반전형"), "C": ("특별전형", "특별전형")}
HW_KEY = {"오전": "A", "오후": "B", "특별전형": "C", "특별": "C"}
NUMERIC = {"1", "2", "3", "4", "5", "6"}
DIALOG = re.compile(r"^\s*[A-Za-z가-힣]{1,4}\s*[:：]\s")


def load_pages(book, lo, hi):
    pages = []
    for p in range(lo, hi + 1):
        f = pathlib.Path(f"work/ocr/{book}/p{p:04d}.json")
        pages.append((p, json.load(open(f, encoding="utf-8")) if f.exists() else None))
    return pages


def parse_set_head(book, text, year):
    if book == "kim":
        m = re.search(r"서[울물]\s*([ABC])\s*(문제|해설)?", text)
        if not m:
            return None
        y = re.search(r"(20\d\d)", text)
        kind = "commentary" if (m.group(2) == "해설" or "해설" in text) else "set"
        return {"key": m.group(1), "year": int(y.group(1)) if y else year, "kind": kind}
    for k, v in HW_KEY.items():
        if k in text:
            return {"key": v, "year": year, "kind": "set"}
    return None


def strip_paren(s):
    s = s.strip()
    m = re.match(r"^[\(（]\s*(.*?)\s*[\)）]$", s)
    return m.group(1) if m else s


def split_segments(book):
    mp = json.load(open(f"work/books/{book}/map.json", encoding="utf-8"))
    lo, hi = mp["pages"]
    pages = load_pages(book, lo, hi)
    missing = [p for p, pj in pages if pj is None]
    segs = []
    cur = {"kind": "format", "id": "_format", "blocks": [], "pages": set(), "year": None, "key": None}
    segs.append(cur)
    year = None
    for p, pj in pages:
        if pj is None:
            continue
        for b in pj["blocks"]:
            t = b["type"]
            if t == "year-head":
                m = re.search(r"(20\d\d)", b["text"])
                if m:
                    year = int(m.group(1))
                cur = {"kind": "preamble", "id": f"_year-{year}", "blocks": [], "pages": set(), "year": year, "key": None}
                segs.append(cur)
                cur["blocks"].append((p, b)); cur["pages"].add(p)
                continue
            if t == "set-head":
                info = parse_set_head(book, b["text"], year)
                if info:
                    year = info["year"] or year
                    sid = f"snu-{year}-{info['key']}"
                    cur = {"kind": info["kind"], "id": sid if info["kind"] == "set" else sid + "-commentary",
                           "blocks": [], "pages": set(), "year": year, "key": info["key"]}
                    segs.append(cur)
            cur["blocks"].append((p, b)); cur["pages"].add(p)
    return mp, segs, missing


def build_set(book, mp, seg, report):
    sid, key, year = seg["id"], seg["key"], seg["year"]
    sess, track = SESSION[key]
    out = {"id": sid, "book": book, "school": "snu", "year": year, "key": key, "name": f"서울대 {key}", "session": sess, "track": track,
           "instruction": None, "instructionTag": None, "passages": [], "followups": [], "common": [], "refs": [], "notes": [],
           "srcPages": sorted(seg["pages"])}
    footnotes, cur, groups, warns, joins = {}, None, out["followups"], [], []
    for p, b in seg["blocks"]:
        t, text = b["type"], b["text"].strip()
        if t in ("set-head", "skip", "year-head", "format"):
            continue
        if t == "instruction":
            if out["instruction"] is None:
                out["instruction"], out["instructionTag"] = text, (b.get("label") or None)
            else:
                warns.append(f"지시문 둘 이상 p{p}: {text[:30]}")
        elif t == "passage-head":
            lab = (b.get("label") or "").strip()
            cur = {"no": len(out["passages"]) + 1, "label": None if lab in NUMERIC else (lab or None),
                   "kind": "case" if lab == "사례" else "prose", "length": None, "text": "", "source": "", "notes": [],
                   "_parts": [], "_sources": [], "_markers": [], "_headRaw": text}
            out["passages"].append(cur)
            if lab in NUMERIC and int(lab) != cur["no"]:
                warns.append(f"제시문 번호 어긋남 p{p}: label {lab} ≠ 순번 {cur['no']}")
        elif t in ("para", "ellipsis"):
            if cur is None:
                out["notes"].append(text); warns.append(f"제시문 머리 전 본문 p{p}: {text[:30]}"); continue
            if b.get("cont") and cur["_parts"]:
                prev = cur["_parts"][-1]
                joins.append(f"p{p} …{prev[-20:]}▮{text[:20]}…")
                cur["_parts"][-1] = prev + text
            else:
                cur["_parts"].append(text)
            if b.get("marker"):
                cur["_markers"].append(b["marker"].strip())
        elif t == "source":
            if cur:
                cur["_sources"].append(text)
            else:
                warns.append(f"제시문 밖 출처 p{p}: {text[:30]}")
        elif t == "length":
            if cur:
                cur["length"] = strip_paren(text)
        elif t == "meta":
            (cur["notes"] if cur else out["notes"]).append(text)
        elif t == "footnote":
            footnotes[(b.get("marker") or "").strip()] = text
        elif t == "q-group":
            lab = (b.get("label") or "").strip()
            groups.append({"student": lab or "공통", "label": f"{lab}학생 추가질문" if lab else "추가질문", "items": []})
        elif t == "q":
            if not groups:
                groups.append({"student": "공통", "label": "추가질문", "items": []})
            item = {"label": (b.get("label") or None), "text": text, "note": (b.get("note") or None)}
            if b.get("cont") and groups[-1]["items"]:
                groups[-1]["items"][-1]["text"] += " " + text
                joins.append(f"p{p} 질문 이어짐: {text[:20]}")
            else:
                groups[-1]["items"].append(item)
        elif t == "ref":
            out["refs"].append(text)
    for ps in out["passages"]:
        ps["text"] = "\n".join(ps["_parts"])
        srcs = ps["_sources"] + [footnotes[m] for m in ps["_markers"] if m in footnotes]
        for m in ps["_markers"]:
            if m not in footnotes:
                warns.append(f"각주 기호 {m} 에 해당하는 각주 없음(제시문 {ps['no']})")
        ps["source"] = "; ".join(s for s in srcs if s)
        if sum(1 for part in ps["_parts"] if DIALOG.match(part)) >= 3:
            ps["kind"] = "dialog"
        if len(ps["text"]) < 50:
            warns.append(f"제시문 {ps['no']} 본문 {len(ps['text'])}자")
        for k in [k for k in ps if k.startswith("_")]:
            del ps[k]
    if not out["passages"]:
        warns.append("제시문 없음")
    if not groups:
        warns.append("질문 없음")
    for g in groups:
        if not g["items"]:
            warns.append(f"빈 묶음 {g['label']}")
    expect = next((s for s in mp["sets"] if s["set"] == sid), None)
    if not expect:
        warns.append("지도에 없는 세트")
    else:
        a, b2 = expect["pages"]
        if min(out["srcPages"]) < a or max(out["srcPages"]) > b2:
            warns.append(f"지도 범위 {a}-{b2} 밖의 쪽 {out['srcPages']}")
    tag = f" [{out['instructionTag']}]" if out["instructionTag"] else ""
    report.append(f"## {sid}  쪽 {out['srcPages']}  지시문 {'있음' if out['instruction'] else '없음'}{tag}")
    for ps in out["passages"]:
        lab = f" ({ps['label']})" if ps["label"] else ""
        report.append(f"- 제시문 {ps['no']}{lab} {ps['kind']} {len(ps['text'])}자  출처: {ps['source'][:50] or '-'}  분량: {ps['length'] or '-'}  notes {len(ps['notes'])}")
    for g in groups:
        report.append(f"- 묶음 {g['student']} / {g['label']}: {len(g['items'])}문")
    if out["refs"]:
        report.append(f"- 참고 {len(out['refs'])}")
    for j in joins:
        report.append(f"- 이음 확인: {j}")
    for w in warns:
        report.append(f"- ⚠ {w}")
    report.append("")
    return out, warns


def main():
    book = sys.argv[1]
    mp, segs, missing = split_segments(book)
    outdir = pathlib.Path(f"work/sets/{book}"); outdir.mkdir(parents=True, exist_ok=True)
    cdir = pathlib.Path("work/commentary"); cdir.mkdir(parents=True, exist_ok=True)
    report = [f"# 조립 보고서 — {book}", ""]
    if missing:
        report.append(f"⚠ 정제 결과 없는 쪽: {missing}\n")
    total_w, ids, fmt = 0, [], []
    for seg in segs:
        if seg["kind"] in ("format", "preamble"):
            fmt.append({"id": seg["id"], "year": seg["year"], "pages": sorted(seg["pages"]),
                        "blocks": [b for _, b in seg["blocks"] if b["type"] in ("format", "year-head")]})
        elif seg["kind"] == "commentary":
            json.dump({"id": seg["id"], "pages": sorted(seg["pages"]), "blocks": [dict(b, page=p) for p, b in seg["blocks"]]},
                      open(cdir / f"{seg['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        else:
            s, warns = build_set(book, mp, seg, report)
            json.dump(s, open(outdir / f"{s['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            total_w += len(warns); ids.append(s["id"])
    json.dump(fmt, open(outdir / "_format.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    expected = {s["set"] for s in mp["sets"]}
    for sid in sorted(expected - set(ids)):
        report.append(f"⚠ 지도에 있으나 조립되지 않은 세트: {sid}")
    pathlib.Path("work/reports").mkdir(parents=True, exist_ok=True)
    pathlib.Path(f"work/reports/assemble-{book}.md").write_text("\n".join(report), encoding="utf-8")
    print(f"{book}: 세트 {len(ids)}개 조립, 경고 {total_w}, 보고서 work/reports/assemble-{book}.md")
    if missing:
        print("정제 결과 없는 쪽:", missing)


if __name__ == "__main__":
    main()
