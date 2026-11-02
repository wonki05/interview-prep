#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""워크플로 인자 만들기(docs/INGEST.md §8): python tools/ocr_args.py <school> [--books kim,hwang] [--pages kim:136-140,hwang:287]
       [--only-missing | --have-ocr] [--themes] [--out <파일>]
   Workflow tools/workflows/ingest-ocr.js·ingest-typo.js 에 넘길 args JSON을 쓴다:
     { root, school, short, notes: { kim, hwang }, pages: [{ book, page, abbyy }] }   (abbyy = 텍스트층 글자 수, 공백·구두점 제외)
   --only-missing 은 work/ocr 결과가 없는 쪽만, --have-ocr 는 결과가 있는 쪽만(오탈자 검수용).
   --themes 는 ingest-themes.js 인자 { root, school, sets: [{ id, n, hwang, labeled }] }(data/sets/<school>-*).
   기본 출력은 work/<school>/ocr-args.json(--themes면 themes-args.json)."""
import sys, re, json, pathlib, argparse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import schoolcfg

PUNCT = re.compile(r"[\s　.,;:!?'\"‘’“”「」『』〈〉《》<>＜＞()（）\[\]［］{}【】·•・…—–\-~～_/\|*※①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸]+")

def parse_pages(spec):
    out = {}
    for part in (spec or "").split(","):
        if not part.strip():
            continue
        book, rng = part.split(":")
        lo, _, hi = rng.partition("-")
        out.setdefault(book.strip(), set()).update(range(int(lo), int(hi or lo) + 1))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("school")
    ap.add_argument("--books", default="kim,hwang")
    ap.add_argument("--pages", help="예: kim:136-140,hwang:287")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--only-missing", action="store_true")
    g.add_argument("--have-ocr", action="store_true")
    ap.add_argument("--themes", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    cfg = schoolcfg.load(a.school)
    root = str(schoolcfg.ROOT)
    if a.themes:
        sets = []
        for d in sorted(pathlib.Path("data/sets").glob(f"{cfg['id']}-*")):
            meta = json.load(open(d / "meta.json", encoding="utf-8"))
            vf = d / f"{meta.get('variant', 'kim')}.json"
            if not vf.exists():
                vf = d / "kim.json" if (d / "kim.json").exists() else d / "hwang.json"
            ps = json.load(open(vf, encoding="utf-8"))["passages"]
            sets.append({"id": meta["id"], "n": len(ps), "kim": (d / "kim.json").exists(), "hwang": (d / "hwang.json").exists(),
                         "labeled": any(p.get("label") for p in ps)})
        args = {"root": root, "school": cfg["short"], "sets": sets}
        out = pathlib.Path(a.out or f"work/{cfg['id']}/themes-args.json")
    else:
        only = parse_pages(a.pages)
        pages = []
        for book in a.books.split(","):
            if not cfg["books"].get(book):
                continue
            for p in schoolcfg.page_range(cfg, book):
                if only and p not in only.get(book, set()):
                    continue
                has = pathlib.Path(f"work/ocr/{book}/p{p:04d}.json").exists()
                if (a.only_missing and has) or (a.have_ocr and not has):
                    continue
                t = pathlib.Path(f"work/books/{book}/pages/p{p:04d}.txt")
                if not t.exists():
                    raise SystemExit(f"쪽 추출 안 됨: {t} (tools/book_extract.py 먼저)")
                pages.append({"book": book, "page": p, "abbyy": len(PUNCT.sub("", t.read_text(encoding="utf-8")))})
        args = {"root": root, "school": cfg["id"], "short": cfg["short"],
                "notes": {b: cfg["books"][b]["notes"] for b in schoolcfg.BOOKS if cfg["books"].get(b)}, "pages": pages}
        out = pathlib.Path(a.out or f"work/{cfg['id']}/ocr-args.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(args, ensure_ascii=False, indent=1), encoding="utf-8")
    n = len(args.get("pages", args.get("sets", [])))
    print(f"{out}: {'세트' if a.themes else '쪽'} {n}개")

if __name__ == "__main__":
    main()
