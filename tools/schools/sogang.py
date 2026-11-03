# -*- coding: utf-8 -*-
"""서강대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   - 쪽에 각주가 없는데 문단에 원문자 marker가 있으면 목록 번호(김종수 2024 A 상자 안 ①~③)이므로 본문 머리로 되돌린다.
   - 조립 뒤: 문단이 모두 '갑: …'·'을: …' 발화인 제시문은 발화가 둘뿐이어도 대화체(황변 2021 가군. 조립은 셋 이상만 대화체로 본다)."""
import re

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
DIALOG = re.compile(r"^\s*[A-Za-z가-힣]{1,4}\s*[:：]\s")


def fix_blocks(book, page, blocks):
    out = []
    feet = {(b.get("marker") or "").strip() for b in blocks if b["type"] == "footnote"}
    for b in blocks:
        m = (b.get("marker") or "").strip()
        if b["type"] == "para" and len(m) == 1 and m in CIRCLED and m not in feet:
            b = {k: v for k, v in b.items() if k != "marker"}
            if not b["text"].lstrip().startswith(m):
                b["text"] = f"{m} {b['text'].lstrip()}"
        out.append(b)
    return out


def fix_set(book, s):
    for p in s["passages"]:
        parts = [x for x in p["text"].split("\n") if x.strip()]
        if p["kind"] == "prose" and len(parts) >= 2 and all(DIALOG.match(x) for x in parts):
            p["kind"] = "dialog"
    return s
