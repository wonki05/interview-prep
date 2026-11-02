# -*- coding: utf-8 -*-
"""연세대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   (황변 2022·2021의 '〈특별전형〉' 세트는 설정 mode 'single' + sessions 특별전형 → C로 연다.)
   - 번호 없는 '제시문〉' 머리(황변 2021, 아래 [가]~[다]가 제시문을 연다)는 skip.
   - 그림 캡션('<그림 1> …', '(그림 1)')을 제시문 머리로 적은 블록은 다음 figure 글 앞에 붙인다(다음이 figure가 아니면 본문).
   - '참고〉' 뒤 문단(황변 2021 특별전형 헤겔의 법철학)은 참고(ref)로.
   - 쪽에 각주가 없는데 문단에 원문자 marker가 있으면 목록 번호(김종수 2023 (마) ①~⑤)이므로 본문 머리로 되돌린다.
   - 조립 뒤: 질문 없는 '추가질문' 큰 머리 묶음(황변 2022 '- 문제1〉 추가질문' 소머리 위)은 빼고 공통 묶음 번호를 다시 매긴다."""
import re

CAPTION = re.compile(r"^\s*[<＜(（\[［]\s*그림")
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"


def fix_blocks(book, page, blocks):
    out = []
    feet = {(b.get("marker") or "").strip() for b in blocks if b["type"] == "footnote"}
    for i, b in enumerate(blocks):
        t = b["type"]
        if t == "passage-head" and not (b.get("label") or "").strip():
            b = dict(b, type="skip")
        elif t == "passage-head" and CAPTION.match(b["text"]):
            nxt = blocks[i + 1] if i + 1 < len(blocks) else None
            if nxt is not None and nxt["type"] == "figure":
                nxt["text"] = f"{b['text'].strip()} / {nxt['text'].strip()}"
                continue
            b = {"type": "para", "text": b["text"]}
        elif t == "para" and out and out[-1]["type"] == "ref":
            b = dict(b, type="ref")
        elif t == "para" and len((b.get("marker") or "").strip()) == 1 and b["marker"].strip() in CIRCLED and b["marker"].strip() not in feet:
            m = b["marker"].strip()
            b = {k: v for k, v in b.items() if k != "marker"}
            if not b["text"].lstrip().startswith(m):
                b["text"] = f"{m} {b['text'].lstrip()}"
        out.append(b)
    return out


def fix_set(book, s):
    for p in s["passages"]:                 # 연세대 구간에는 대화체가 없다('갑:'·'을:'·'병:' 견해 목록이 대화체로 잡힌다)
        if p["kind"] == "dialog":
            p["kind"] = "prose"
    groups = [g for g in s["followups"] if g["items"]]
    n = 0
    for g in groups:
        if g["student"].startswith("공통"):
            n += 1
            g["student"] = "공통" if n == 1 else f"공통{n}"
            g["label"] = "추가질문" if n == 1 else f"추가질문 {n}"
    s["followups"] = groups
    return s
