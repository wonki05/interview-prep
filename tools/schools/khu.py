# -*- coding: utf-8 -*-
"""경희대 수록 hook(docs/INGEST.md §8-2). tools/assemble_sets.py 가 부른다.
   - 본문 없는 제시문은 머리 뒤 작품 표기(source)를 본문으로 둔다(김종수 2024 (C) '이문재, <삼대>', 중앙대 김종수 2025 B (다)와 같은 처리).
     경희대는 함께 인쇄된 '*전문이 출제됨'도 본문 둘째 줄이다(work/ocr para. 작품 표기만으로는 9자라 validate 오류).
   - 추가질문 묶음 안의 복기자 설명(meta)은 마지막 제시문 notes가 아니라 변형 notes로 옮긴다
     (황변 2021 첫 글머리 '코로나 상황과 연관된 추가질문이 많았음.')."""

STOP = ("passage-head", "q", "q-group", "task", "set-head", "year-head", "instruction")
QMETA = set()   # (book, text): fix_blocks가 질문 묶음 안에서 본 meta. 조립은 모든 쪽의 fix_blocks를 먼저 부른다


def fix_blocks(book, page, blocks):
    out = [dict(b) for b in blocks]
    for i, b in enumerate(out):
        if b["type"] != "passage-head":
            continue
        j, body, src, ended = i + 1, False, None, False
        while j < len(out):
            t = out[j]["type"]
            if t in STOP:
                ended = True; break
            if t in ("para", "figure", "ellipsis"):
                body = True
            elif t == "source" and src is None:
                src = j
            j += 1
        if ended and not body and src is not None:
            out[src] = {"type": "para", "text": out[src]["text"]}
    in_group = False
    for b in out:
        if b["type"] == "q-group":
            in_group = True
        elif b["type"] in ("passage-head", "year-head", "set-head"):
            in_group = False
        elif b["type"] == "meta" and in_group:
            QMETA.add((book, b["text"].strip()))
    return out


def fix_set(book, s):
    for p in s["passages"]:
        moved = [n for n in p["notes"] if (book, n) in QMETA]
        if moved:
            p["notes"] = [n for n in p["notes"] if (book, n) not in QMETA]
            s["notes"].extend(moved)
    return s
