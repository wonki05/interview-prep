# -*- coding: utf-8 -*-
"""고려대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   - 김종수 2021(p145~146): <명제>·<사례 1~3> 뒤의 '<제시문 1>'·'<제시문 2>'는 순번(5·6)과 번호가 달라 label '제시문 1'·'제시문 2'로 둔다(화면 머리 = 책 머리).
   - 김종수 2020(p148): 'Q2.' 문항 뒤 머리 없는 대화체 제시문은 앞 제시문(<에피소드>)에 붙지 않게 제시문 2 머리를 넣는다."""
import re

NUM = re.compile(r"^\d+$")


def fix_blocks(book, page, blocks):
    if book != "kim":
        return blocks
    if page in (145, 146):
        for b in blocks:
            lab = (b.get("label") or "").strip()
            if b["type"] == "passage-head" and NUM.match(lab) and "제시문" in b["text"]:
                b["label"] = f"제시문 {lab}"
    if page == 148:
        out, after_q2 = [], False
        for b in blocks:
            if b["type"] == "q" and (b.get("label") or "").strip() == "Q2":
                after_q2 = True
            elif after_q2 and b["type"] == "passage-head":
                after_q2 = False
            elif after_q2 and b["type"] == "para":
                out.append({"type": "passage-head", "text": "(머리 없음: Q2 대화문)", "label": "2"})
                after_q2 = False
            out.append(b)
        return out
    return blocks


def fix_set(book, s):
    return s
