# -*- coding: utf-8 -*-
"""중앙대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   - 황변 세션 글머리('• 가군 (토) 오전' 등)와 김종수 A~D의 대응이 해마다 다르다. 두 책의 제시문을 대조한 연도별 표(HWANG)로
     글머리 끝에 '=기호'를 붙이고, 설정 books.hwang.sessions('=A' → A …)가 그 기호로 세트를 연다.
     김종수에 없는 황변 세션은 그해 다음 기호(C, D)다.
   - 세트 session은 황변 글머리의 요일·오전/오후(김종수 꼬리표 '[가군]'·'[가군 오전]'·'[가군 오후]'보다 자세하다).
     황변이 없는 2020·2019는 설정 keys의 '가군'.
   - 본문 없는 제시문은 머리 뒤 저자·작품 표기(source)를 본문으로 둔다(김종수 2025 B (다) '황동규, <즐거운 편지>' + meta '*전문이 출제됨').
     표기도 없으면 복기자 요약(meta)이 곧 본문이다(김종수 2021 C (다) '1909년 일제강점기에 관한 내용이 제시되었다. …')."""
import re

# 황변 연도 띠가 있는 쪽(텍스트층 확인). 쪽 첫머리의 연도 = 앞 쪽까지 나온 마지막 연도 띠
HWANG_YEAR_HEADS = [(522, 2025), (526, 2024), (530, 2023), (534, 2022), (537, 2021)]
# 연도 → 황변 세션(요일+오전/오후) → 김종수 기호. 제시문 대조(work/reports/cau-summary.md 대응표)
HWANG = {
    2025: {"토오전": "B", "토오후": "C", "일오전": "A", "일오후": "D"},
    2024: {"토오전": "C", "토오후": "A", "일오전": "D", "일오후": "B"},
    2023: {"토오전": "C", "토오후": "B", "일오전": "D", "일오후": "A"},
    2022: {"토오전": "D", "토오후": "A", "일오전": "C", "일오후": "B"},
    2021: {"토오전": "B", "토오후": "A", "일오전": "C", "일오후": "D"},
}
DAY = {"토": "토요일", "일": "일요일"}
SESSION = {(y, k): f"가군 {DAY[s[0]]} {s[1:]}" for y, m in HWANG.items() for s, k in m.items()}
SESS = re.compile(r"(토|일)\s*\W*\s*(오전|오후)")
STOP = ("passage-head", "q", "q-group", "task", "set-head", "year-head", "instruction")


def year_at(page):
    y = None
    for p, yy in HWANG_YEAR_HEADS:
        if p < page:
            y = yy
    return y


def fix_blocks(book, page, blocks):
    out = [dict(b) for b in blocks]
    if book == "hwang":
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
    for i, b in enumerate(out):                       # 본문 없는 제시문: 머리 뒤 출처 표기, 없으면 복기자 요약을 본문으로
        if b["type"] != "passage-head":
            continue
        j, body, src, metas, ended = i + 1, False, None, [], False
        while j < len(out):
            t = out[j]["type"]
            if t in STOP:
                ended = True; break
            if t in ("para", "figure", "ellipsis"):
                body = True
            elif t == "source" and src is None:
                src = j
            elif t == "meta":
                metas.append(j)
            j += 1
        if ended and not body:
            for k in ([src] if src is not None else metas):
                out[k] = {"type": "para", "text": out[k]["text"]}
    return out


def fix_set(book, s):
    sess = SESSION.get((s["year"], s["key"]))
    if sess:
        s["session"] = sess
    return s
