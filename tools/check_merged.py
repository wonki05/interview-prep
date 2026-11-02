#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""통합(AI) 복기본 점검(docs/MERGE_PROMPT.md §5): python -I tools/check_merged.py
   data/sets/<id>/merged.json 을 같은 세트의 kim.json·hwang.json과 기계적으로 대조한다(모델 없음).
   (가) 스키마 (나) 질문 (다) 날조 의심 문장 (라) 누락(참고), 그리고 meta.json variant를 보고
   work/reports/merged-check.md 를 쓴다. 고치지 않는다. (가)(나)·variant 오류가 있으면 종료 코드 1."""
import re, sys, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "work/reports/merged-check.md"
STRIP = re.compile(r"[\s'\"‘’“”「」『』`()（）\[\]［］{}<>＜＞〈〉《》【】]+")   # 공백·따옴표·괄호
SPLIT = re.compile(r"(?<=[.?!])|\n")   # 문장 경계: 마침표·물음표·느낌표 뒤와 문단 경계
MIN = 12   # 이보다 짧은 조각은 세지 않는다
SEG = 6    # 날조 의심 문장을 원문 조각으로 분해할 때 조각의 최소 길이
BACKBONE = re.compile(r"골자\s*(kim|hwang)")
SUMMARY = re.compile(r"(kim|hwang)\s*=\s*(요약|현대어 풀이)")

def load(p): return json.load(open(p, encoding="utf-8"))
def norm(s): return STRIP.sub("", s or "")
def ws(s): return re.sub(r"\s+", " ", s or "").strip()
def text(it): return it["text"] if isinstance(it, dict) else it

def sentences(t):
    """(원문 조각, 정규화) 목록. 정규화 뒤 MIN자 미만은 뺀다."""
    out = []
    for raw in SPLIT.split(t or ""):
        n = norm(raw)
        if len(n) >= MIN: out.append((raw.strip(), n))
    return out

def pieces(n, srcs):
    """n을 원문(srcs: {이름: 정규화 본문})의 SEG자 이상 부분 문자열로 덮는 최소 분해. 덮지 못한 글자는 출처 None."""
    L = len(n); cost = [0] + [10 ** 9] * L; back = [None] * (L + 1)
    for i in range(1, L + 1):
        if cost[i - 1] + 100 < cost[i]: cost[i], back[i] = cost[i - 1] + 100, (i - 1, None)
        for j in range(i - SEG + 1):
            if cost[j] + 1 < cost[i]:
                src = next((k for k, t in srcs.items() if n[j:i] in t), None)
                if src: cost[i], back[i] = cost[j] + 1, (j, src)
    out, i = [], L
    while i:
        j, src = back[i]
        if out and src is None and out[-1][0] is None: out[-1] = (None, n[j:i] + out[-1][1])
        else: out.append((src, n[j:i]))
        i = j
    return out[::-1]

def check_schema(m, k):
    errs = []
    if m.get("label") != "통합(AI)": errs.append(f"label `{m.get('label')}`")
    if m.get("basis") != ["kim", "hwang"]: errs.append(f"basis `{m.get('basis')}`")
    mp, kp = m.get("passages") or [], k.get("passages") or []
    if len(mp) != len(kp): errs.append(f"제시문 수 {len(mp)} / kim {len(kp)}")
    for a, b in zip(mp, kp):
        for f in ("no", "label", "kind"):
            if (a.get(f) or None) != (b.get(f) or None): errs.append(f"제시문 {b.get('no')} {f} `{a.get(f)}` / kim `{b.get(f)}`")
    return errs

def check_questions(m, k, h):
    errs = []
    mg, kg = m.get("followups") or [], k.get("followups") or []
    for n, (a, b) in enumerate(zip(mg, kg), 1):
        if (a.get("student"), a.get("label")) != (b.get("student"), b.get("label")):
            errs.append(f"묶음 {n}: `{a.get('student')}/{a.get('label')}` / kim `{b.get('student')}/{b.get('label')}`")
        ai, bi = [ws(text(x)) for x in a["items"]], [ws(text(x)) for x in b["items"]]
        if len(ai) != len(bi): errs.append(f"묶음 {n}({b.get('student')}) 질문 수 {len(ai)} / kim {len(bi)}")
        for q, (x, y) in enumerate(zip(ai, bi), 1):
            if x != y: errs.append(f"묶음 {n}({b.get('student')}) Q{q}: `{x}` / kim `{y}`")
    if len(mg) < len(kg): errs.append(f"묶음 수 {len(mg)} / kim {len(kg)}")
    extra = mg[len(kg):]
    hw = [norm(text(x)) for g in h.get("followups") or [] for x in g["items"]] + [norm(text(x)) for g in h.get("common") or [] for x in g["items"]]
    for g in extra:
        if g.get("student") != "황변": errs.append(f"추가 묶음 student `{g.get('student')}`(황변만 허용)"); continue
        for x in g["items"]:
            if not any(norm(text(x)) in y for y in hw): errs.append(f"황변 원문에 없는 질문: `{ws(text(x))}`")
    mc = [(c.get("label"), [ws(text(x)) for x in c["items"]]) for c in m.get("common") or []]
    kc = [(c.get("label"), [ws(text(x)) for x in c["items"]]) for c in k.get("common") or []]
    if mc != kc: errs.append("common이 kim과 다름")
    nk = sum(len(g["items"]) for g in kg) + sum(len(c["items"]) for c in k.get("common") or [])
    nh = sum(len(g["items"]) for g in extra)
    return errs, f"kim {len(kg)}묶음 {nk}문 + 황변 {nh}문"

def check_passages(m, k, h):
    """(다) 날조 의심 문장과 (라) 누락 수. 같은 번호 제시문끼리 비교한다."""
    sus, notes, total, miss_other, bones = [], [], 0, 0, []
    kp, hp = {p["no"]: p for p in k["passages"]}, {p["no"]: p for p in h["passages"]}
    for p in m["passages"]:
        no = p["no"]
        srcs = {"kim": norm(kp.get(no, {}).get("text")), "hwang": norm(hp.get(no, {}).get("text"))}
        mn = norm(p["text"])
        for raw, n in sentences(p["text"]):
            total += 1
            if not any(n in t for t in srcs.values()): sus.append((no, raw, pieces(n, srcs)))
        # 골자: notes의 "골자 kim|hwang", 없으면 통합본에 문장이 더 많이 들어 있는 쪽
        cover = {v: sum(n in mn for _, n in sentences((kp if v == "kim" else hp).get(no, {}).get("text"))) for v in ("kim", "hwang")}
        found = BACKBONE.search(" ".join(p.get("notes") or []))
        bone = found.group(1) if found else max(cover, key=cover.get)
        other = "hwang" if bone == "kim" else "kim"
        so = sentences((kp if other == "kim" else hp).get(no, {}).get("text"))
        sb = sentences((kp if bone == "kim" else hp).get(no, {}).get("text"))
        mo, mb = sum(n not in mn for _, n in so), sum(n not in mn for _, n in sb)
        miss_other += mo; bones.append(bone[0])
        summ = [f"{a}={b}" for a, b in SUMMARY.findall(" ".join(p.get("notes") or []))]
        notes.append(f"제시문 {no}(골자 {bone}{'' if found else ', 추정'}{', ' + '·'.join(summ) if summ else ''}): {other} {len(so)}문장 중 통합본에 없음 {mo}, 골자 {len(sb)}문장 중 없음 {mb}")
    return sus, total, miss_other, "/".join(bones), notes

def describe(segs):
    rest = [s for src, s in segs if src is None]
    if rest: return f"원문 {SEG}자 이상 조각으로 덮이지 않는 부분: " + ", ".join(f"「{s}」" for s in rest)
    return "원문 조각 결합(덮이지 않는 부분 없음): " + " + ".join(f"{src} {len(s)}자" for src, s in segs)

def main():
    rows, details, plain, errors, flagged, nsus = [], [], [], 0, [], 0
    for d in sorted(p.parent for p in (ROOT / "data/sets").glob("*/meta.json")):
        meta = load(d / "meta.json")
        if not (d / "merged.json").exists():
            plain.append(f"{d.name} `{meta.get('variant')}`" + ("" if meta.get("variant") == "kim" else " ← kim이어야 함"))
            errors += meta.get("variant") != "kim"
            continue
        if not (d / "kim.json").exists() or not (d / "hwang.json").exists():
            rows.append(f"| {d.name} | `{meta.get('variant')}` | kim.json·hwang.json 없음 | | | | |"); errors += 1; continue
        m, k, h = load(d / "merged.json"), load(d / "kim.json"), load(d / "hwang.json")
        se = check_schema(m, k)
        qe, qsum = check_questions(m, k, h)
        sus, total, miss, bones, pnotes = check_passages(m, k, h)
        verr = meta.get("variant") != "merged"
        errors += bool(se) + bool(qe) + verr
        nsus += len(sus)
        if sus: flagged.append(d.name)
        rows.append(f"| {'⚠ ' if sus else ''}{d.name} | `{meta.get('variant')}`{' ← merged여야 함' if verr else ''} | {'통과' if not se else f'실패 {len(se)}'} | {('통과(' if not qe else f'실패 {len(qe)}(') + qsum + ')'} | {len(sus)} / {total}문장 | {miss} | {bones} |")
        details += [f"## {'⚠ ' if sus else ''}{d.name}", ""]
        details += [f"- (가) {e}" for e in se] + [f"- (나) {e}" for e in qe]
        for no, raw, segs in sus:
            details += [f"- (다) 제시문 {no}: {raw}", f"    - {describe(segs)}"]
        if not (se or qe or sus): details.append("- (가)(나)(다) 이상 없음")
        details += [f"- (라) {n}" for n in pnotes] + [""]
    lines = ["# 통합(AI) 복기본 점검", "",
             "`python -I tools/check_merged.py` 결과. 고치지 않고 보고만 한다.", "",
             f"- (가) 스키마: `label` \"통합(AI)\", `basis` [\"kim\",\"hwang\"], 제시문 수·`no`·`label`·`kind`가 kim과 같음.",
             f"- (나) 질문: `followups` 앞부분이 kim 묶음과 문장·순서·개수 같음(공백 정규화), 그 뒤는 student \"황변\" 묶음만이고 그 질문은 hwang 원문에 있음, `common`이 kim과 같음.",
             f"- (다) 날조 의심: 통합 제시문 문장(마침표·물음표·느낌표 뒤와 문단 경계로 분리, 공백·따옴표·괄호 제거, {MIN}자 이상)이 같은 번호 kim·hwang 본문에 부분 문자열로 없음. 세트 줄의 \"의심 / 전체\". 상세에는 그 문장을 두 원문의 {SEG}자 이상 조각으로 분해한 결과(덮이지 않는 부분, 또는 조각 결합)를 붙인다.",
             "- (라) 누락(참고): 골자가 아닌 변형의 문장 가운데 통합본에 없는 것의 수. 요약·풀이로 판정한 변형은 많이 빠지는 것이 정상.",
             "- ⚠ = 날조 의심 문장이 하나라도 있는 세트. 골자는 제시문 순서대로 k(kim)/h(hwang).", "",
             "| 세트 | variant | (가) 스키마 | (나) 질문 | (다) 날조 의심 | (라) 누락(참고) | 골자 |",
             "|---|---|---|---|---|---|---|", *rows, "",
             "통합본 없음: " + (", ".join(plain) or "없음"), ""] + details
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT).as_posix()} 작성. 통합 {len(rows)}세트, 날조 의심 {nsus}문장({', '.join(flagged) or '없음'}), 스키마/질문/variant 오류 {errors}")
    sys.exit(1 if errors else 0)

if __name__ == "__main__":
    main()
