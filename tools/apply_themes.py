#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""주제어·태그 반영: python tools/apply_themes.py <ingest-themes 워크플로 결과 파일>
   Workflow(ingest-themes)가 돌려준 [{id, themes, tags}] 를 data/sets/<id>/meta.json 의 themes·tags 에 넣는다.
   themes 수가 그 세트의 제시문 수(기본 변형 기준)와 다르면 넣지 않고 보고한다."""
import sys, json, pathlib

def main():
    doc = json.load(open(sys.argv[1], encoding="utf-8"))
    items = doc["result"] if isinstance(doc, dict) and "result" in doc else doc
    n, bad = 0, []
    for it in items:
        if not it or not it.get("id"): continue
        d = pathlib.Path("data/sets") / it["id"]
        mf = d / "meta.json"
        if not mf.exists(): bad.append(f"{it['id']}: meta.json 없음"); continue
        meta = json.load(open(mf, encoding="utf-8"))
        vf = d / f"{meta.get('variant', 'kim')}.json"
        if not vf.exists(): vf = next(d.glob("*.json"))
        npass = len(json.load(open(vf, encoding="utf-8"))["passages"])
        themes = [t.strip() for t in it.get("themes", []) if t and t.strip()]
        if len(themes) != npass: bad.append(f"{it['id']}: themes {len(themes)}개 ≠ 제시문 {npass}개 → 넣지 않음 {themes}"); continue
        meta["themes"] = themes
        meta["tags"] = [t.strip() for t in it.get("tags", []) if t and t.strip()]
        mf.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        n += 1
    print(f"meta.json 갱신 {n}개")
    for b in bad: print("⚠", b)

if __name__ == "__main__":
    main()
