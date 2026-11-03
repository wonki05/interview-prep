#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""조립본 승격(docs/INGEST.md §2-F·§8): python tools/promote_sets.py <school> kim|hwang [--overwrite-existing] [--refresh-format] [--data-root data/sets]
   work/sets/<book>/<school>-*.json(OCR 조립본)을 data/sets/<set id>/<book>.json(변형 파일, 커밋 대상)으로 옮기고,
   meta.json이 없는 새 세트는 조립본에서 세트 공통 필드를 만든다(themes·tags는 비워 두고 ingest-themes가 채운다).
   세트 format(교수:학생, 준비·면접 시간, 메모, 추가질문)은 김종수 연도 머리의 진행 방식 줄에서 읽고, 없으면 학교 설정 setFormat.
   이미 있는 변형 파일(기존 사이트 본문, 규칙 5)은 --overwrite-existing 없이는 덮어쓰지 않는다. kim을 먼저 승격한다."""
import sys, re, json, pathlib, argparse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import schoolcfg

BOOK = {"kim": {"label": "김종수 복기", "book": "해커스 김종수 로스쿨 면접 200주제 3권 기출편(2026)"},
        "hwang": {"label": "황변 복기", "book": "황변과 함께하는 로스쿨 면접 Q 1권(2026)"}}

def dump(p, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

def minutes(m):
    """'N분 M초' 일치 → 분(초가 있으면 소수, 없으면 정수)."""
    s = int(m.group(2) or 0)
    return int(m.group(1)) + round(s / 60, 2) if s else int(m.group(1))


def year_formats(school, base):
    """김종수 연도 머리의 진행 방식 줄 → {연도: 세트 format}. 예: ① 교수:학생 = 3:1 ② 면접 준비 14분, 면접 시간 11분 ③ 메모 허용 ④ 추가질문 있음
       같은 해의 연도 머리가 여럿이면(해설 쪽 '2021' 등 진행 방식 줄이 없는 머리) 항목을 가장 많이 읽어 낸 것을 쓴다."""
    f = pathlib.Path(f"work/sets/kim/_format-{school}.json")
    out, hits = {}, {}
    if not f.exists():
        return out
    for seg in json.load(open(f, encoding="utf-8")):
        if not seg.get("year"):
            continue
        text = " ".join(b["text"] for b in seg["blocks"])
        fm, n = dict(base), 0
        m = re.search(r"교수\W*학생\s*=?\s*(\d+)\s*[:：]\s*(\d+)", text)
        if m: fm["ratio"] = f"{m.group(1)}:{m.group(2)}"; n += 1
        m = re.search(r"면접\s*준비\s*(?:시간)?\s*(\d+)\s*분(?:\s*(\d+)\s*초)?", text)   # '9분 30초' → 9.5
        if m: fm["prep"] = minutes(m); n += 1
        m = re.search(r"면접\s*시간\s*(\d+)\s*분(?:\s*(\d+)\s*초)?", text)
        if m: fm["duration"] = minutes(m); n += 1
        if re.search(r"메모\s*(불가|금지|불허)", text): fm["memo"] = False; n += 1
        elif re.search(r"메모\s*(허용|가능)", text): fm["memo"] = True; n += 1
        if re.search(r"추가\s*질문\s*없음", text): fm["followup"] = False; n += 1
        elif re.search(r"추가\s*질문\s*있음", text): fm["followup"] = True; n += 1
        if n and n > hits.get(seg["year"], 0):
            out[seg["year"]], hits[seg["year"]] = fm, n
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("school"); ap.add_argument("book", choices=schoolcfg.BOOKS)
    ap.add_argument("--overwrite-existing", action="store_true")
    ap.add_argument("--refresh-format", action="store_true", help="이미 있는 meta.json의 format도 진행 방식 줄 값으로 다시 쓴다(그 학교 세트만)")
    ap.add_argument("--data-root", default="data/sets")
    a = ap.parse_args()
    cfg, book = schoolcfg.load(a.school), a.book
    yf = year_formats(cfg["id"], cfg["setFormat"])
    src = pathlib.Path(f"work/sets/{book}")
    n_new, n_skip, n_meta = 0, 0, 0
    for f in sorted(src.glob(f"{cfg['id']}-*.json")):
        if f.stem.endswith(("-dup", "-personality", "-commentary")):
            continue
        s = json.load(open(f, encoding="utf-8"))
        d = pathlib.Path(a.data_root) / s["id"]; d.mkdir(parents=True, exist_ok=True)
        pages = s.get("srcPages") or []
        variant = {"label": BOOK[book]["label"], "source": {"book": BOOK[book]["book"], "pages": f"{min(pages)}-{max(pages)}" if pages else ""},
                   "passages": [{"no": p["no"], "label": p.get("label"), "kind": p["kind"], "length": p.get("length"), "text": p["text"], "source": p.get("source") or "", "notes": p.get("notes") or []} for p in s["passages"]],
                   "followups": [{"student": g["student"], "label": g["label"], "items": [{"label": it.get("label"), "text": it["text"], "note": it.get("note")} for it in g["items"]]} for g in s["followups"]],
                   "common": [{"label": c["label"], "items": [{"label": None, "text": it["text"] if isinstance(it, dict) else it, "note": None} for it in c["items"]]} for c in s.get("common", [])]}
        if s.get("tasks"): variant["tasks"] = [{"label": t.get("label") or "", "text": t["text"], "note": t.get("note")} for t in s["tasks"]]
        if s.get("refs"): variant["refs"] = s["refs"]
        if s.get("notes"): variant["notes"] = s["notes"]
        if s.get("instruction") and book != "kim": variant["instructionRaw"] = s["instruction"]
        out = d / f"{book}.json"
        if out.exists() and not a.overwrite_existing:
            n_skip += 1
        else:
            dump(out, variant); n_new += 1
        meta_f = d / "meta.json"
        if not meta_f.exists():
            meta = {"id": s["id"], "school": s["school"], "year": s["year"], "name": s["name"], "session": s["session"], "track": s["track"],
                    "instruction": (s.get("instruction") if book == "kim" else None) or cfg["instruction"],
                    "format": yf.get(s["year"], cfg["setFormat"]),
                    "themes": [], "tags": [], "variant": book}
            dump(meta_f, meta); n_meta += 1
        else:
            meta = json.load(open(meta_f, encoding="utf-8")); changed = False
            if book == "kim" and meta.get("variant") == "hwang":   # 황변이 먼저 만든 meta: 기본 복기본(통합본 전까지 kim)과 지시문을 김종수 것으로
                meta["variant"] = "kim"; changed = True
                if s.get("instruction"): meta["instruction"] = s["instruction"]
            elif book == "kim" and not meta.get("instruction") and s.get("instruction"):
                meta["instruction"] = s["instruction"]; changed = True
            if a.refresh_format and meta.get("format") != yf.get(s["year"], cfg["setFormat"]):
                meta["format"] = yf.get(s["year"], cfg["setFormat"]); changed = True
            if changed: dump(meta_f, meta)
    print(f"{cfg['short']} {book}: 변형 파일 {n_new}개 작성, {n_skip}개 유지(기존), meta 신규 {n_meta}")

if __name__ == "__main__":
    main()
