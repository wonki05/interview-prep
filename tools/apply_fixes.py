#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""오탈자 검수 결과 반영(docs/INGEST.md §8): python tools/apply_fixes.py <school> <ingest-typo 결과 JSON> [--dry]
   Workflow tools/workflows/ingest-typo.js 결과 [{ book, page, fixes: [{ block, from, to, kind, reason }], bookTypos, longGaps }]의
   fixes를 work/ocr/<book>/pNNNN.json 의 blocks[block].text 에 적용한다. from이 그 블록 text에 있을 때만 처음 한 곳을 바꾸고,
   적용 기록은 쪽 JSON의 "fixes"에 남겨 같은 수정을 두 번 적용하지 않는다. skip 블록은 고치지 않는다.
   보고서 work/reports/typo-<school>.md(--dry면 typo-<school>.dry.md, 쪽 JSON은 그대로): 적용·실패 목록, 책 자체 오탈자 의심(bookTypos, 고치지 않음), 긴 누락 의심(longGaps)."""
import sys, json, pathlib, argparse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import schoolcfg

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("school"); ap.add_argument("result"); ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    cfg = schoolcfg.load(a.school)
    doc = json.load(open(a.result, encoding="utf-8"))
    items = doc["result"] if isinstance(doc, dict) and "result" in doc else doc
    applied, failed, book_typos, gaps = [], [], [], []
    for it in items:
        if not it:
            continue
        book, page = it["book"], int(it["page"])
        f = pathlib.Path(f"work/ocr/{book}/p{page:04d}.json")
        if not f.exists():
            failed.append(f"{book} p{page}: 정제 결과 없음"); continue
        pj = json.load(open(f, encoding="utf-8"))
        done = pj.setdefault("fixes", [])
        changed = False
        for fx in it.get("fixes") or []:
            i, frm, to = fx.get("block"), fx.get("from") or "", fx.get("to") or ""
            where = f"{book} p{page} 블록 {i}"
            if not isinstance(i, int) or not (0 <= i < len(pj["blocks"])):
                failed.append(f"{where}: 블록 번호 범위 밖 `{frm}`→`{to}`"); continue
            bl = pj["blocks"][i]
            if bl["type"] == "skip" or not frm or frm == to:
                failed.append(f"{where}: 적용 안 함(skip 블록·빈 수정) `{frm}`→`{to}`"); continue
            if any(d.get("block") == i and d.get("from") == frm and d.get("to") == to for d in done):
                continue                                   # 이미 적용한 수정
            if frm not in bl["text"]:
                failed.append(f"{where} [{fx.get('kind')}]: from을 찾지 못함 `{frm}`→`{to}`"); continue
            if bl["text"].count(frm) > 1:
                failed.append(f"{where} [{fx.get('kind')}]: from이 여러 번 나옴(첫 곳만 고침) `{frm}`")
            bl["text"] = bl["text"].replace(frm, to, 1)
            done.append({"block": i, "from": frm, "to": to, "kind": fx.get("kind"), "reason": fx.get("reason")})
            applied.append(f"{where} [{fx.get('kind')}] `{frm}` → `{to}`  {fx.get('reason') or ''}")
            changed = True
        for bt in it.get("bookTypos") or []:
            book_typos.append(f"{book} p{page} 블록 {bt.get('block')}: `{bt.get('text')}` {bt.get('reason') or ''}")
        for gp in it.get("longGaps") or []:
            gaps.append(f"{book} p{page} 블록 {gp.get('block')}: {gp.get('note')}")
        if changed and not a.dry:
            f.write_text(json.dumps(pj, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = [f"# 오탈자 검수 — {cfg['short']}{' (dry)' if a.dry else ''}", "",
             f"적용 {len(applied)} · 실패 {len(failed)} · 책 오탈자 의심 {len(book_typos)} · 긴 누락 의심 {len(gaps)}", "",
             "## 적용", *[f"- {x}" for x in applied], "", "## 실패(직접 확인)", *[f"- {x}" for x in failed], "",
             "## 책 자체 오탈자 의심(고치지 않음)", *[f"- {x}" for x in book_typos], "", "## 긴 누락 의심(쪽 다시 정제)", *[f"- {x}" for x in gaps], ""]
    out = pathlib.Path(f"work/reports/typo-{cfg['id']}{'.dry' if a.dry else ''}.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"{out}: 적용 {len(applied)}, 실패 {len(failed)}, 책 오탈자 의심 {len(book_typos)}, 긴 누락 의심 {len(gaps)}")

if __name__ == "__main__":
    main()
