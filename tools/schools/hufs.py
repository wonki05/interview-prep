# -*- coding: utf-8 -*-
"""한국외대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   - 황변 세션 글머리('• 가군 (토) 오전' 등)와 김종수 A~D의 대응이 해마다 다르다. 두 책의 제시문을 대조한 연도별 표(HWANG)로
     글머리 끝에 '=기호'를 붙이고, 설정 books.hwang.sessions('=A' → A …)가 그 기호로 세트를 연다.
     김종수에 없는 황변 세션은 그해 다음 기호다(2025는 김종수 A 하나뿐이라 나머지 세 세션이 황변 등장 순으로 B·C·D).
   - 세트 session은 황변 글머리의 요일·오전/오후(김종수 꼬리표 '[가군]'보다 자세하다). 황변이 없는 2019는 김종수 꼬리표
     ('[가군 오전]'·'[가군 오후]'·'[나군 오전]'·'[나군 오후]'), 두 책 모두 표기가 없는 2020은 설정 keys의 '면접'."""
import re

# 황변 연도 띠가 있는 쪽(이미지 확인). 쪽 첫머리의 연도 = 앞 쪽까지 나온 마지막 연도 띠
HWANG_YEAR_HEADS = [(573, 2025), (576, 2024), (578, 2023), (580, 2022), (582, 2021)]
# 연도 → 황변 세션(요일+오전/오후) → 김종수 기호. 제시문 대조(work/reports/hufs-summary.md 대응표)
HWANG = {
    2025: {"토오전": "B", "토오후": "A", "일오전": "C", "일오후": "D"},
    2024: {"토오전": "D", "토오후": "B", "일오전": "C", "일오후": "A"},
    2023: {"토오전": "A", "토오후": "D", "일오전": "C", "일오후": "B"},
    2022: {"토오전": "D", "토오후": "B", "일오전": "C", "일오후": "A"},
    2021: {"토오전": "C", "토오후": "A", "일오전": "D", "일오후": "B"},
}
DAY = {"토": "토요일", "일": "일요일"}
SESSION = {(y, k): f"가군 {DAY[s[0]]} {s[1:]}" for y, m in HWANG.items() for s, k in m.items()}
SESSION.update({(2019, "A"): "가군 오전", (2019, "B"): "가군 오후", (2019, "C"): "나군 오전", (2019, "D"): "나군 오후"})
SESS = re.compile(r"(토|일)\s*\W*\s*(오전|오후)")


def year_at(page):
    y = None
    for p, yy in HWANG_YEAR_HEADS:
        if p < page:
            y = yy
    return y


def fix_blocks(book, page, blocks):
    out = [dict(b) for b in blocks]
    if book != "hwang":
        return out
    year = year_at(page)
    for b in out:
        if b["type"] == "year-head":
            m = re.search(r"(20\d\d)", b["text"])
            if m:
                year = int(m.group(1))
        elif b["type"] == "set-head":
            m = SESS.search(re.sub(r"[()（）\[\]［］]", " ", b["text"]))
            key = HWANG.get(year, {}).get(m.group(1) + m.group(2)) if m else None
            if key:
                b["text"] = f"{b['text'].strip()} ={key}"
    return out


def fix_set(book, s):
    sess = SESSION.get((s["year"], s["key"]))
    if sess:
        s["session"] = sess
    return s
