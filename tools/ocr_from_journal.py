#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""중단된 ingest-ocr 워크플로의 journal.jsonl에서 정제 결과(blocks)를 거둬 work/ocr/<book>/pNNNN.json 으로 저장한다.
   python tools/ocr_from_journal.py <journal.jsonl>   (이미 있는 쪽은 덮어쓰지 않는다. 검증 결과는 없음(verdict null))."""
import sys, json, pathlib
n = 0; skipped = 0
for line in open(sys.argv[1], encoding="utf-8"):
    try: j = json.loads(line)
    except Exception: continue
    if j.get("type") != "result": continue
    r = j.get("result") or {}
    if not (isinstance(r, dict) and r.get("blocks") and r.get("book") and r.get("page")): continue
    out = pathlib.Path(f"work/ocr/{r['book']}/p{int(r['page']):04d}.json")
    if out.exists(): skipped += 1; continue
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"book": r["book"], "page": r["page"], "attempts": 1, "verdict": None, "blocks": r["blocks"]}, ensure_ascii=False, indent=1), encoding="utf-8")
    n += 1
print(f"저장 {n}쪽, 기존 유지 {skipped}쪽")
