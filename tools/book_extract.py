#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""쪽 이미지·텍스트층 추출: python tools/book_extract.py <pdf> <tag> <from>-<to> [--dpi 150] [--out work/books]
   pymupdf로 쪽마다 회색조 PNG와 ABBYY 텍스트층을 work/books/<tag>/pages/pNNNN.{png,txt}에 저장한다(docs/INGEST.md §2-A).
   books/·work/는 git 무시 대상이다."""
import sys, argparse, pathlib
import fitz  # pymupdf

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf"); ap.add_argument("tag"); ap.add_argument("range", help="예: 259-314")
    ap.add_argument("--dpi", type=int, default=150); ap.add_argument("--out", default="work/books")
    a = ap.parse_args()
    lo, hi = [int(x) for x in a.range.split("-")]
    outdir = pathlib.Path(a.out) / a.tag / "pages"; outdir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(a.pdf)
    n = 0
    for p in range(lo, hi + 1):
        page = doc[p - 1]
        pix = page.get_pixmap(dpi=a.dpi, colorspace=fitz.csGRAY)
        pix.save(str(outdir / f"p{p:04d}.png"))
        (outdir / f"p{p:04d}.txt").write_text(page.get_text(), encoding="utf-8")
        n += 1
    print(f"{a.tag}: {n}쪽 → {outdir} ({pix.width}x{pix.height}px @ {a.dpi}dpi)")

if __name__ == "__main__":
    main()
