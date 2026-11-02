#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""학교별 수록 설정 읽기(docs/INGEST.md §8). 다른 tools/*.py 가 import 한다.
   설정: tools/schools/<school>.json — 쪽 범위·세트 머리 규칙·세션 기호·OCR 학교 주석·세트 기본 진행 방식·조립 선택지.
   hook: tools/schools/<school>.py(있으면) — fix_blocks(book, page, blocks)·fix_set(book, set) 로 학교별 예외를 처리한다."""
import json, pathlib, importlib.util

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
BOOKS = ("kim", "hwang")
OPTIONS = {"implicitPassage": False, "kimTasksBeforeGroup": False, "splitOnRestart": False}


def load(school):
    f = TOOLS / "schools" / f"{school}.json"
    if not f.exists():
        raise SystemExit(f"학교 설정 없음: {f}")
    cfg = json.load(open(f, encoding="utf-8"))
    cfg["options"] = dict(OPTIONS, **(cfg.get("options") or {}))
    cfg.setdefault("instruction", "다음 제시문을 읽고, 문제에 답하시오.")
    for b in BOOKS:
        bc = cfg["books"].get(b)
        if bc:
            bc.setdefault("sets", [])
            bc.setdefault("notes", "")
    return cfg


def page_range(cfg, book):
    bc = cfg["books"].get(book)
    if not bc or not bc.get("pages"):
        return []
    lo, hi = bc["pages"]
    return list(range(lo, hi + 1))


def hook(school):
    f = TOOLS / "schools" / f"{school}.py"
    if not f.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"school_hook_{school}", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
