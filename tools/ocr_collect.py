#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""OCR 워크플로 결과 수집: python tools/ocr_collect.py <workflow 결과 파일>...
   Workflow(ingest-ocr)가 돌려준 JSON({"result":[{book,page,attempts,result,verdict,model?,ok?}]})을 읽어
   work/ocr/<book>/pNNNN.json 으로 쪽마다 저장한다. 같은 쪽이 여러 결과 파일에 있으면 뒤의 것이 덮어쓴다."""
import sys, json, pathlib

def main():
    out_root = pathlib.Path("work/ocr")
    n = 0
    for f in sys.argv[1:]:
        doc = json.load(open(f, encoding="utf-8"))
        items = doc["result"] if isinstance(doc, dict) and "result" in doc else doc
        for it in items:
            if not it or not it.get("result"):
                print("결과 없음:", it and (it.get("book"), it.get("page")))
                continue
            r = it["result"]
            page = {"book": it["book"], "page": it["page"], "attempts": it.get("attempts"),
                    "verdict": it.get("verdict"), "blocks": r.get("blocks", [])}
            for k in ("model", "ok"):
                if k in it: page[k] = it[k]
            d = out_root / it["book"]; d.mkdir(parents=True, exist_ok=True)
            (d / f"p{it['page']:04d}.json").write_text(json.dumps(page, ensure_ascii=False, indent=1), encoding="utf-8")
            n += 1
    print(f"저장 {n}쪽 → {out_root}")

if __name__ == "__main__":
    main()
