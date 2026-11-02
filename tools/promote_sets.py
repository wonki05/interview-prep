#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""조립본 승격(docs/INGEST.md §2-F): python tools/promote_sets.py kim|hwang [--overwrite-existing]
   work/sets/<book>/<set id>.json(OCR 조립본)을 data/sets/<set id>/<book>.json(변형 파일, 커밋 대상)으로 옮기고,
   meta.json이 없는 새 세트는 kim 조립본에서 세트 공통 필드를 만든다(themes·tags는 비워 두고 ingest-themes가 채운다).
   이미 있는 kim.json(기존 사이트 본문, 규칙 5)은 --overwrite-existing 없이는 덮어쓰지 않는다."""
import sys, json, pathlib, re

BOOK = {"kim": {"label": "김종수 복기", "book": "해커스 김종수 로스쿨 면접 200주제 3권 기출편(2026)"},
        "hwang": {"label": "황변 복기", "book": "황변과 함께하는 로스쿨 면접 Q 1권(2026)"}}
SNU_SET_FORMAT = {"ratio": "3:1", "prep": 20, "duration": 15, "memo": True, "followup": True}

def dump(p, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

def main():
    book = sys.argv[1]; overwrite = "--overwrite-existing" in sys.argv
    src = pathlib.Path(f"work/sets/{book}")
    n_new, n_skip, n_meta = 0, 0, 0
    for f in sorted(src.glob("snu-*.json")):
        s = json.load(open(f, encoding="utf-8"))
        d = pathlib.Path("data/sets") / s["id"]; d.mkdir(parents=True, exist_ok=True)
        pages = s.get("srcPages") or []
        variant = {"label": BOOK[book]["label"], "source": {"book": BOOK[book]["book"], "pages": f"{min(pages)}-{max(pages)}" if pages else ""},
                   "passages": [{"no": p["no"], "label": p.get("label"), "kind": p["kind"], "length": p.get("length"), "text": p["text"], "source": p.get("source") or "", "notes": p.get("notes") or []} for p in s["passages"]],
                   "followups": [{"student": g["student"], "label": g["label"], "items": [{"label": it.get("label"), "text": it["text"], "note": it.get("note")} for it in g["items"]]} for g in s["followups"]],
                   "common": [{"label": c["label"], "items": [{"label": None, "text": it["text"] if isinstance(it, dict) else it, "note": None} for it in c["items"]]} for c in s.get("common", [])]}
        if s.get("refs"): variant["refs"] = s["refs"]
        if s.get("notes"): variant["notes"] = s["notes"]
        if s.get("instruction") and book != "kim": variant["instructionRaw"] = s["instruction"]
        out = d / f"{book}.json"
        if out.exists() and not overwrite:
            n_skip += 1
        else:
            dump(out, variant); n_new += 1
        meta_f = d / "meta.json"
        if not meta_f.exists():
            meta = {"id": s["id"], "school": s["school"], "year": s["year"], "name": s["name"], "session": s["session"], "track": s["track"],
                    "instruction": s.get("instruction") or "다음 제시문을 읽고, 문제에 답하시오.", "format": SNU_SET_FORMAT,
                    "themes": [], "tags": [], "variant": "kim"}
            dump(meta_f, meta); n_meta += 1
        elif book == "kim":
            meta = json.load(open(meta_f, encoding="utf-8"))
            if not meta.get("instruction") and s.get("instruction"):
                meta["instruction"] = s["instruction"]; dump(meta_f, meta)
    print(f"{book}: 변형 파일 {n_new}개 작성, {n_skip}개 유지(기존), meta 신규 {n_meta}")

if __name__ == "__main__":
    main()
