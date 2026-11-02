#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""기존 5세트 대조(docs/INGEST.md §2-D): python tools/diff_existing.py
   data/sets/<id>/kim.json(기존 사이트 본문)과 work/sets/kim/<id>.json(교재 OCR 조립본)을 비교해
   work/reports/existing-diff.md 를 쓴다. 따옴표·공백·원문자·전각 괄호를 정규화한 뒤 difflib로 다른 구간을 뽑는다.
   변경은 하지 않는다(규칙 5). 승인은 사용자가 work/reports/existing-diff.approved.json 에 적는다."""
import re, json, pathlib, difflib

QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "（": "(", "）": ")", "［": "[", "］": "]", "＜": "<", "＞": ">", "〈": "<", "〉": ">", "：": ":", "·": "·"})
CIRC = {"⑴": "(1)", "⑵": "(2)", "⑶": "(3)", "⑷": "(4)", "⑸": "(5)"}

def norm(s):
    s = (s or "").translate(QUOTES)
    for k, v in CIRC.items(): s = s.replace(k, v)
    return re.sub(r"\s+", "", s)

def segs(a, b, ctx=12):
    """정규화한 두 문자열의 다른 구간을 (종류, a쪽, b쪽) 목록으로."""
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal": continue
        out.append((tag, a[max(0, i1 - ctx):i2 + ctx], b[max(0, j1 - ctx):j2 + ctx], a[i1:i2], b[j1:j2]))
    return sm.ratio(), out

def main():
    lines = ["# 기존 5세트 ↔ 김종수 OCR 조립본 대조", "", "좌: 현재 사이트(data/sets/<id>/kim.json), 우: 교재 OCR(work/sets/kim/<id>.json). 정규화 뒤 비교. 변경은 사용자 승인 뒤에만(Q-13).", ""]
    total = 0
    for d in sorted(pathlib.Path("data/sets").glob("snu-*")):
        sid = d.name
        cur_f, ocr_f = d / "kim.json", pathlib.Path(f"work/sets/kim/{sid}.json")
        if not cur_f.exists() or not ocr_f.exists(): continue
        cur, ocr = json.load(open(cur_f, encoding="utf-8")), json.load(open(ocr_f, encoding="utf-8"))
        meta = json.load(open(d / "meta.json", encoding="utf-8"))
        lines.append(f"## {sid}")
        # 지시문
        if norm(meta.get("instruction")) != norm(ocr.get("instruction")):
            lines.append(f"- 지시문: 사이트 `{meta.get('instruction')}` / 책 `{ocr.get('instruction')}`" + (f" [{ocr.get('instructionTag')}]" if ocr.get("instructionTag") else ""))
        # 제시문
        if len(cur["passages"]) != len(ocr["passages"]):
            lines.append(f"- ⚠ 제시문 수 다름: 사이트 {len(cur['passages'])} / 책 {len(ocr['passages'])}")
        for pc, po in zip(cur["passages"], ocr["passages"]):
            a, b = norm(pc["text"]), norm(po["text"])
            ratio, diffs = segs(a, b)
            if a == b:
                lines.append(f"- 제시문 {pc['no']}: 동일(정규화 후). 사이트 {len(pc['text'])}자")
            else:
                total += len(diffs)
                lines.append(f"- 제시문 {pc['no']}: 유사도 {ratio:.3f}, 다른 구간 {len(diffs)}")
                for tag, ca, cb, xa, xb in diffs[:15]:
                    lines.append(f"    - [{tag}] 사이트 `{xa or '∅'}` / 책 `{xb or '∅'}`  (…{ca}… / …{cb}…)")
            if norm(pc.get("source")) != norm(po.get("source")):
                lines.append(f"    - 출처: 사이트 `{pc.get('source')}` / 책 `{po.get('source')}`")
            if norm(pc.get("length")) != norm(po.get("length")):
                lines.append(f"    - 분량: 사이트 `{pc.get('length')}` / 책 `{po.get('length')}`")
            if (pc.get("kind") != po.get("kind")) or ((pc.get("label") or None) != (po.get("label") or None)):
                lines.append(f"    - kind/label: 사이트 {pc.get('kind')}/{pc.get('label')} / 책 {po.get('kind')}/{po.get('label')}")
        # 질문 묶음
        cg = [(g["student"], g["label"], [it["text"] if isinstance(it, dict) else it for it in g["items"]]) for g in cur["followups"]]
        og = [(g["student"], g["label"], [it["text"] for it in g["items"]]) for g in ocr["followups"]]
        lines.append(f"- 묶음: 사이트 {[(s, len(i)) for s, _, i in cg]} / 책 {[(s, len(i)) for s, _, i in og]}" + (f"; 사이트 common {[(c['label'], len(c['items'])) for c in cur.get('common', [])]}(책에 없음)" if cur.get("common") else ""))
        for (cs_, cl, ci), (os_, ol, oi) in zip(cg, og):
            for n, (qa, qb) in enumerate(zip(ci, oi), 1):
                if norm(qa) != norm(qb):
                    total += 1
                    lines.append(f"    - {cs_} Q{n}: 사이트 `{qa}` / 책 `{qb}`")
            if len(ci) != len(oi):
                lines.append(f"    - ⚠ {cs_} 질문 수 다름: 사이트 {len(ci)} / 책 {len(oi)}")
                for q in (ci[len(oi):] if len(ci) > len(oi) else oi[len(ci):]):
                    lines.append(f"        - {'사이트에만' if len(ci) > len(oi) else '책에만'}: `{q}`")
        lines.append("")
    pathlib.Path("work/reports").mkdir(parents=True, exist_ok=True)
    pathlib.Path("work/reports/existing-diff.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"work/reports/existing-diff.md 작성. 다른 구간 {total}")

if __name__ == "__main__":
    main()
