# -*- coding: utf-8 -*-
"""이화여대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   - 황변 2024학년도 기출문제는 김종수 2024 B와 같은 시험이다(여론조사 표 두 개, 두 주장 <A>·<B>, 문항 셋). 황변은 세션 글머리가 없어
     연도 띠가 기호 A 세트를 연다(single). 2024 연도 띠 바로 뒤에 세트 머리 '=B'를 넣으면 설정 books.hwang.sessions('=B' → B)가
     B 세트를 열고, 연도 띠가 연 빈 A 세트는 조립이 건너뛴다.
   - 세트 session: 김종수 지시문 꼬리표 '[가군]'(2025 A)·'[나군]'(2023 A)를 session에 쓴다(두 책 같은 값). 꼬리표 없는 해는 설정 keys의 '면접'."""
import re

HWANG_KEY = {2024: "B"}          # 연도 → 황변 그해 세트의 김종수 기호(A가 아닌 해만). 제시문 대조
SESSION = {(2025, "A"): "가군 면접", (2023, "A"): "나군 면접"}


def fix_blocks(book, page, blocks):
    if book != "hwang":
        return blocks
    out = []
    for b in blocks:
        out.append(b)
        if b["type"] == "year-head":
            m = re.search(r"(20\d\d)", b["text"])
            key = HWANG_KEY.get(int(m.group(1))) if m else None
            if key:
                out.append({"type": "set-head", "text": f"={key}"})
    return out


def fix_set(book, s):
    sess = SESSION.get((s["year"], s["key"]))
    if sess:
        s["session"] = sess
    return s
