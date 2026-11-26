#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""새 학년도 황변 단독 세트 승격(docs/INGEST.md §9): python tools/promote_year.py <school> [--src work/hwang27/out]
       [--book "황변과 함께하는 로스쿨 면접 Q 1권(2027)"] [--data-root data/sets] [--overwrite-existing]
   하위 세션이 쪽 이미지·텍스트층을 대조해 옮긴 <src>/<school>-<year>-<기호>.json(변형 파일 형식)과
   <set id>.meta.json(책 세션 머리 bookLabel·themes·tags, 고칠 때만 session·track), <school>-format.json(그해 진행 방식,
   책이 밝힌 값만)을 data/sets/<set id>/hwang.json·meta.json으로 옮긴다.
   김종수 교재가 없는 해라 variant는 hwang, 지시문은 학교 설정 instruction, format은 학교 설정 setFormat에 그해 값을 덮는다.
   session은 bookLabel(〈가군 (토) 오전〉 → '가군 토요일 오전', 〈나군〉 → '나군 면접', 〈가군오전〉 → '가군 오전 면접')에서 만든다.
   이미 있는 변형 파일은 --overwrite-existing 없이는 덮어쓰지 않는다(규칙 5)."""
import sys, re, json, pathlib, argparse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import schoolcfg

LABEL = "황변 복기"
TAGS = {"법·제도", "사회·공동체", "윤리", "경제·시장", "법철학", "정치·민주주의", "과학기술·AI", "생명·환경", "언어·인식", "문화·예술", "역사"}
DAYS = {"토": "토요일", "일": "일요일"}


def dump(p, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def session_of(label):
    """책 세션 머리 → (session, track)."""
    s = re.sub(r"[〈〉<>\s]", "", label or "")
    if "특별" in s:
        return "특별전형", "특별전형"
    gun = re.search(r"([가나다])군", s)
    day = re.search(r"\(([토일])\)", s)
    ampm = re.search(r"오전|오후", s)
    parts = [gun.group(0) if gun else None, DAYS[day.group(1)] if day else None, ampm.group(0) if ampm else None]
    words = [x for x in parts if x]
    if not day:
        words.append("면접")
    return " ".join(words), "일반전형"


def set_format(cfg, fmt):
    """학교 setFormat에 그해 값(검사를 통과한 것만)을 덮는다. keynote는 책에 있을 때만(DATA.md 규칙 7)."""
    out = dict(cfg["setFormat"])
    if isinstance(fmt.get("ratio"), str) and re.fullmatch(r"\d+:\d+", fmt["ratio"]):
        out["ratio"] = fmt["ratio"]
    for k in ("prep", "duration"):
        if isinstance(fmt.get(k), (int, float)) and not isinstance(fmt.get(k), bool) and 0 < fmt[k] <= 60:
            out[k] = fmt[k]
    for k in ("memo", "followup"):
        if isinstance(fmt.get(k), bool):
            out[k] = fmt[k]
    kn = fmt.get("keynote")
    if isinstance(kn, int) and not isinstance(kn, bool) and 0 < kn < out["duration"]:
        out["keynote"] = kn
    return out


def variant_of(v, book):
    """하위 세션 출력 → 변형 파일(키 순서·빈 값 정리)."""
    out = {"label": LABEL, "source": {"book": book, "pages": v["source"]["pages"]},
           "passages": [{"no": p["no"], "label": p.get("label"), "kind": p.get("kind") or "prose", "length": p.get("length"),
                         "text": p["text"], "source": p.get("source") or "", "notes": p.get("notes") or []} for p in v["passages"]],
           "followups": [{"student": g["student"], "label": g["label"],
                          "items": [{"label": it.get("label"), "text": it["text"], "note": it.get("note")} for it in g["items"]]}
                         for g in v.get("followups") or []],
           "common": v.get("common") or []}
    if v.get("tasks"):
        out["tasks"] = [{"label": t.get("label") or "", "text": t["text"], "note": t.get("note")} for t in v["tasks"]]
    if v.get("refs"):
        out["refs"] = v["refs"]
    if v.get("notes"):
        out["notes"] = v["notes"]
    if v.get("instructionRaw"):
        out["instructionRaw"] = v["instructionRaw"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("school")
    ap.add_argument("--src", default="work/hwang27/out")
    ap.add_argument("--book", default="황변과 함께하는 로스쿨 면접 Q 1권(2027)")
    ap.add_argument("--data-root", default="data/sets")
    ap.add_argument("--overwrite-existing", action="store_true")
    a = ap.parse_args()
    cfg = schoolcfg.load(a.school)
    src = pathlib.Path(a.src)
    ff = src / f"{cfg['id']}-format.json"
    fmt = json.load(open(ff, encoding="utf-8")) if ff.exists() else {}
    n_new = n_skip = 0
    for f in sorted(src.glob(f"{cfg['id']}-[0-9][0-9][0-9][0-9]-*.json")):
        if f.name.endswith(".meta.json"):
            continue
        sid = f.stem
        m = re.fullmatch(rf"{cfg['id']}-(\d{{4}})-([A-Z])", sid)
        if not m:
            raise SystemExit(f"세트 id 형식 아님: {sid}")
        year, key = int(m.group(1)), m.group(2)
        v = json.load(open(f, encoding="utf-8"))
        draft = json.load(open(src / f"{sid}.meta.json", encoding="utf-8"))
        bad = [t for t in draft.get("tags") or [] if t not in TAGS]
        if bad:
            raise SystemExit(f"{sid}: 태그 어휘 밖 {bad}")
        session, track = session_of(draft.get("bookLabel"))
        d = pathlib.Path(a.data_root) / sid
        d.mkdir(parents=True, exist_ok=True)
        out = d / "hwang.json"
        if out.exists() and not a.overwrite_existing:
            n_skip += 1
            continue
        dump(out, variant_of(v, a.book))
        meta = {"id": sid, "school": cfg["id"], "year": year, "name": f"{cfg['short']} {key}",
                "session": draft.get("session") or session, "track": draft.get("track") or track,
                "instruction": cfg["instruction"], "format": set_format(cfg, fmt),
                "themes": draft.get("themes") or [], "tags": draft.get("tags") or [], "variant": "hwang"}
        dump(d / "meta.json", meta)
        n_new += 1
    print(f"{cfg['short']}: 세트 {n_new}개 승격, {n_skip}개 유지(기존)")


if __name__ == "__main__":
    main()
