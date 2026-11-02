#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""세트 조립(docs/INGEST.md §2-C·§8): python tools/assemble_sets.py <school> kim|hwang [--out-root work]
   tools/schools/<school>.json 의 쪽 범위·세트 머리 규칙에 따라 work/ocr/<book>/pNNNN.json 의 블록을 쪽 순서대로 이어
   세트 머리 블록으로 세트를 가르고 변형 JSON(<out-root>/sets/<book>/<set id>.json)과
   조립 보고서(<out-root>/reports/assemble-<school>-<book>.md)를 쓴다.
   학교별 예외는 tools/schools/<school>.py 의 fix_blocks(book, page, blocks)·fix_set(book, set)(있으면)으로 처리한다.
   모델을 쓰지 않는다. type·label·marker·cont·쪽 순서만 사용한다."""
import sys, re, json, pathlib, argparse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import schoolcfg

NUMERIC = re.compile(r"^\d+$")
DIALOG = re.compile(r"^\s*[A-Za-z가-힣]{1,4}\s*[:：]\s")
QMAIN = re.compile(r"^Q?(\d+)(?:-(\d+))?$")


def load_pages(book, pages, hook):
    out = []
    for p in pages:
        f = pathlib.Path(f"work/ocr/{book}/p{p:04d}.json")
        pj = json.load(open(f, encoding="utf-8")) if f.exists() else None
        if pj is not None and hook and hasattr(hook, "fix_blocks"):
            pj["blocks"] = hook.fix_blocks(book, p, pj["blocks"])
        out.append((p, pj))
    return out


def parse_set_head(cfg, book, text, year):
    """세트 머리 → {key, year, kind}. kim은 학교 약칭 정규식 + 세션 기호, hwang은 설정의 세션 글머리 규칙."""
    if book == "kim":
        m = re.search(rf"(?:{cfg['books']['kim']['head']})\s*([A-Z]|인성)\s*(문제|해설)?", text)
        if not m:
            return None
        y = re.search(r"(20\d\d)", text)
        kind = "commentary" if (m.group(2) == "해설" or "해설" in text) else ("personality" if m.group(1) == "인성" else "set")
        return {"key": m.group(1), "year": int(y.group(1)) if y else year, "kind": kind}
    hw = cfg["books"]["hwang"]
    mode = hw.get("mode", "label")
    if mode in ("label", "single"):          # single: 연도 머리가 첫 기호 세트를 열고, sessions에 있는 글머리(• 특별전형 등)만 다른 세트를 연다
        for k, v in (hw.get("sessions") or {}).items():
            if k in text:
                return {"key": v, "year": year, "kind": "set"}
        return None
    if mode == "order":                      # 연도 안에서 n번째 세션 글머리 = keys의 n번째 기호
        return {"key": None, "year": year, "kind": "set"}
    return None


REF_A = re.compile(r"[＜<〈]\s*제시문\s*(\d)\s*[＞>〉]")
REF_B = re.compile(r"(?<![＜<〈])제시문\s*(\d)\s*[〉>＞]")

def norm_refs(q):
    """질문 속 제시문 참조를 <제시문 n>으로 통일한다(docs/DATA.md 규칙 4). (가)(나)·<제시문 다> 표기는 그대로 둔다."""
    q = REF_A.sub(r"<제시문 \1>", q)
    return REF_B.sub(r"<제시문 \1>", q)


def strip_paren(s):
    s = s.strip()
    m = re.match(r"^[\(（]\s*(.*?)\s*[\)）]$", s)
    return m.group(1) if m else s


def split_segments(cfg, book, hook):
    bc = cfg["books"][book]
    school = cfg["id"]
    pages = load_pages(book, schoolcfg.page_range(cfg, book), hook)
    missing = [p for p, pj in pages if pj is None]
    keys = list(cfg["keys"].keys())
    mode = bc.get("mode", "label") if book == "hwang" else "head"
    segs = []
    cur = {"kind": "format", "id": "_format", "blocks": [], "pages": set(), "year": None, "key": None}
    segs.append(cur)
    year, order = None, {}

    def open_set(info, y):
        sid = f"{school}-{y}-{info['key']}"
        if info["kind"] == "commentary":
            sid += "-commentary"
        elif info["kind"] == "personality":
            sid = f"{school}-{y}-personality"
        return {"kind": info["kind"], "id": sid, "blocks": [], "pages": set(), "year": y, "key": info["key"]}

    for p, pj in pages:
        if pj is None:
            continue
        for b in pj["blocks"]:
            t = b["type"]
            if t == "year-head":
                m = re.search(r"(20\d\d)", b["text"])
                if m:
                    year = int(m.group(1))
                cur = {"kind": "preamble", "id": f"_year-{year}", "blocks": [], "pages": set(), "year": year, "key": None}
                segs.append(cur)
                cur["blocks"].append((p, b)); cur["pages"].add(p)
                if mode == "single" and year:
                    cur = open_set({"key": keys[0], "kind": "set"}, year)
                    segs.append(cur)
                continue
            if t == "set-head":
                info = parse_set_head(cfg, book, b["text"], year)
                if info:
                    year = info["year"] or year
                    if info["key"] is None:          # order 모드
                        n = order.get(year, 0); order[year] = n + 1
                        info["key"] = keys[n] if n < len(keys) else f"X{n + 1}"
                    if not (mode == "single" and cur["kind"] == "set" and cur["key"] == info["key"] and cur["year"] == year):
                        cur = open_set(info, year)   # single 모드에서 연도 머리가 이미 연 같은 세트의 글머리는 새로 열지 않는다
                        segs.append(cur)
            cur["blocks"].append((p, b))
            if t != "skip":                  # skip만 있는 쪽(다음 세트 머리 앞의 꼬리말 등)은 세트 쪽 범위에 넣지 않는다
                cur["pages"].add(p)
    return segs, missing


def build_set(cfg, book, seg, report, hook):
    sid, key, year = seg["id"], seg["key"], seg["year"]
    opts = cfg["options"]
    kk = cfg["keys"].get(key)
    sess, track = (kk["session"], kk["track"]) if kk else ("면접", "일반전형")
    out = {"id": sid, "book": book, "school": cfg["id"], "year": year, "key": key, "name": f"{cfg['short']} {key}", "session": sess, "track": track,
           "instruction": None, "instructionTag": None, "passages": [], "followups": [], "common": [], "refs": [], "notes": [],
           "srcPages": sorted(seg["pages"])}
    footnotes, cur, groups, warns, joins, tasks = {}, None, out["followups"], [], [], []
    if not kk:
        warns.append(f"설정 keys에 없는 세션 기호 {key}")
    seen_group, last_main = False, None

    def new_passage(lab, head_raw):
        ps = {"no": len(out["passages"]) + 1, "label": None if (not lab or NUMERIC.match(lab)) else lab,
              "kind": "case" if lab.startswith("사례") else "prose", "length": None, "text": "", "source": "", "notes": [],
              "_parts": [], "_sources": [], "_markers": [], "_headRaw": head_raw}
        out["passages"].append(ps)
        return ps

    def add_group(student, label):
        base, n = student, 1
        while any(g["student"] == student for g in groups):
            n += 1; student = f"{base}{n}"
        groups.append({"student": student, "label": label if n == 1 else f"{label} {n}", "items": []})

    for p, b in seg["blocks"]:
        t, text = b["type"], b["text"].strip()
        if t in ("set-head", "skip", "year-head", "format"):
            continue
        if t == "instruction":
            if out["instruction"] is None:
                out["instruction"], out["instructionTag"] = text, (b.get("label") or None)
            else:
                warns.append(f"지시문 둘 이상 p{p}: {text[:30]}")
        elif t == "passage-head":
            lab = (b.get("label") or "").strip()
            if not lab:                      # 황변 2023의 "제시문〉" 빈 머리: 아래 [n] 머리가 제시문을 연다
                warns.append(f"라벨 없는 제시문 머리 p{p}: {text}"); cur = None; continue
            cur = new_passage(lab, text)
            if NUMERIC.match(lab) and int(lab) != cur["no"]:
                warns.append(f"제시문 번호 어긋남 p{p}: label {lab} ≠ 순번 {cur['no']}")
        elif t in ("para", "ellipsis", "figure"):
            if t == "figure":                # 그림·도표: 그림 안에 보이는 글자만 "[도표] …" 한 문단으로(docs/DATA.md 규칙 1)
                text = f"[{(b.get('label') or '도표').strip()}] {text}"
            if cur is None:
                if not opts["implicitPassage"]:
                    out["notes"].append(text); warns.append(f"제시문 머리 전 본문 p{p}: {text[:30]}"); continue
                cur = new_passage("", "(머리 없음)")
                warns.append(f"머리 없는 본문 p{p} → 제시문 {cur['no']}: {text[:20]}")
            if b.get("cont") and cur["_parts"]:
                prev = cur["_parts"][-1]
                gap = " " if b["text"][:1].isspace() else ""   # cont 블록 text 앞의 공백 = 쪽 경계가 어절 사이(새 문장)라는 표시
                joins.append(f"p{p} …{prev[-20:]}▮{gap}{text[:20]}…")
                cur["_parts"][-1] = prev + gap + text
            else:
                cur["_parts"].append(text)
            if b.get("marker"):
                cur["_markers"].append(b["marker"].strip())
        elif t == "source":
            if cur:
                cur["_sources"].append(text)
            else:
                warns.append(f"제시문 밖 출처 p{p}: {text[:30]}")
        elif t == "length":
            if cur:
                cur["length"] = strip_paren(text)
        elif t == "meta":
            (cur["notes"] if cur else out["notes"]).append(text)
        elif t == "footnote":
            footnotes[(b.get("marker") or "").strip()] = text
        elif t == "q-group":
            lab = (b.get("label") or "").strip()
            add_group(lab or "공통", f"{lab}학생 추가질문" if lab else "추가질문")
            seen_group, last_main = True, None
        elif t == "task" or (t == "q" and book == "kim" and opts["kimTasksBeforeGroup"] and not seen_group):
            lab = re.sub(r"^(Q|문제)\s*", "", (b.get("label") or "").strip())
            if b.get("cont") and tasks:
                tasks[-1]["text"] += " " + text
                joins.append(f"p{p} 문제 이어짐: {text[:20]}")
            else:
                tasks.append({"label": lab, "text": norm_refs(text), "note": (b.get("note") or None)})
        elif t == "q":
            lab = (b.get("label") or "").strip()
            m = QMAIN.match(lab)
            if opts["splitOnRestart"] and m and not m.group(2) and not b.get("cont") and last_main is not None and int(m.group(1)) <= last_main:
                add_group("공통", "추가질문")       # 번호가 처음으로 돌아감 = 배지 없는 다른 학생의 묶음
                warns.append(f"번호 되돌아감 p{p} {lab} → 새 묶음 {groups[-1]['student']}")
            if m:
                last_main = int(m.group(1))
            if not groups:
                groups.append({"student": "공통", "label": "추가질문", "items": []})
            item = {"label": (b.get("label") or None), "text": norm_refs(text), "note": (b.get("note") or None)}
            if b.get("cont") and groups[-1]["items"]:
                groups[-1]["items"][-1]["text"] += " " + text
                joins.append(f"p{p} 질문 이어짐: {text[:20]}")
            else:
                groups[-1]["items"].append(item)
        elif t == "ref":
            out["refs"].append(text)
    if tasks:
        out["tasks"] = tasks
    for ps in out["passages"]:
        ps["text"] = "\n".join(ps["_parts"])
        srcs = ps["_sources"] + [footnotes[m] for m in ps["_markers"] if m in footnotes]
        for m in ps["_markers"]:
            if m not in footnotes:
                warns.append(f"각주 기호 {m} 에 해당하는 각주 없음(제시문 {ps['no']})")
        ps["source"] = "; ".join(s for s in srcs if s)
        if sum(1 for part in ps["_parts"] if DIALOG.match(part)) >= 3:
            ps["kind"] = "dialog"
        if len(ps["text"]) < 50:
            warns.append(f"제시문 {ps['no']} 본문 {len(ps['text'])}자")
        for k in [k for k in ps if k.startswith("_")]:
            del ps[k]
    if not out["passages"]:
        warns.append("제시문 없음")
    if not groups:
        warns.append("질문 없음")
    for g in groups:
        if not g["items"]:
            warns.append(f"빈 묶음 {g['label']}")
    if hook and hasattr(hook, "fix_set"):
        out = hook.fix_set(book, out)
    maps = cfg["books"][book]["sets"]
    expect = next((s for s in maps if s["set"] == sid), None)
    if maps and not expect:
        warns.append("지도에 없는 세트")
    elif expect:
        a, b2 = expect["pages"]
        if min(out["srcPages"]) < a or max(out["srcPages"]) > b2:
            warns.append(f"지도 범위 {a}-{b2} 밖의 쪽 {out['srcPages']}")
    tag = f" [{out['instructionTag']}]" if out["instructionTag"] else ""
    report.append(f"## {sid}  쪽 {out['srcPages']}  지시문 {'있음' if out['instruction'] else '없음'}{tag}")
    for ps in out["passages"]:
        lab = f" ({ps['label']})" if ps["label"] else ""
        report.append(f"- 제시문 {ps['no']}{lab} {ps['kind']} {len(ps['text'])}자  출처: {ps['source'][:50] or '-'}  분량: {ps['length'] or '-'}  notes {len(ps['notes'])}")
    for tk in out.get("tasks", []):
        report.append(f"- 문제 {tk['label'] or '-'}: {tk['text'][:40]}")
    for g in out["followups"]:
        report.append(f"- 묶음 {g['student']} / {g['label']}: {len(g['items'])}문")
    if out["refs"]:
        report.append(f"- 참고 {len(out['refs'])}")
    for j in joins:
        report.append(f"- 이음 확인: {j}")
    for w in warns:
        report.append(f"- ⚠ {w}")
    report.append("")
    return out, warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("school"); ap.add_argument("book", choices=schoolcfg.BOOKS)
    ap.add_argument("--out-root", default="work", help="sets/·reports/를 쓸 곳(회귀 점검용)")
    a = ap.parse_args()
    cfg, book = schoolcfg.load(a.school), a.book
    hook = schoolcfg.hook(a.school)
    segs, missing = split_segments(cfg, book, hook)
    root = pathlib.Path(a.out_root)
    outdir = root / "sets" / book; outdir.mkdir(parents=True, exist_ok=True)
    cdir = root / "commentary"; cdir.mkdir(parents=True, exist_ok=True)
    report = [f"# 조립 보고서 — {cfg['short']} {book}", ""]
    if missing:
        report.append(f"⚠ 정제 결과 없는 쪽: {missing}\n")
    total_w, ids, fmt, pers = 0, [], [], []
    for seg in segs:
        if seg["kind"] in ("format", "preamble"):
            fmt.append({"id": seg["id"], "year": seg["year"], "pages": sorted(seg["pages"]),
                        "blocks": [b for _, b in seg["blocks"] if b["type"] in ("format", "year-head")]})
        elif seg["kind"] == "commentary":
            json.dump({"id": seg["id"], "pages": sorted(seg["pages"]), "blocks": [dict(b, page=p) for p, b in seg["blocks"]]},
                      open(cdir / f"{seg['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        elif seg["kind"] == "personality":      # 인성 질문 묶음: 세트가 아니다. 학교 format.details 후보로 따로 둔다
            items = [b["text"].strip() for _, b in seg["blocks"] if b["type"] == "q"]
            json.dump({"id": seg["id"], "year": seg["year"], "pages": sorted(seg["pages"]), "items": items},
                      open(outdir / f"{seg['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            pers.append(f"{seg['id']} {len(items)}문")
        elif not any(b["type"] not in ("set-head", "skip") for _, b in seg["blocks"]):
            report.append(f"빈 세트 건너뜀: {seg['id']}(연도 머리가 연 세트에 내용 없이 다른 세션 글머리가 이어짐)\n")
        else:
            s, warns = build_set(cfg, book, seg, report, hook)
            if s["id"] in ids:                      # 같은 세트 머리가 두 번 잡힘(쪽 누락·오인식) → 덮어쓰지 않고 표시
                report.append(f"⚠ 중복 세트 id {s['id']} (쪽 {s['srcPages']}) → {s['id']}-dup 로 저장\n")
                s["id"] += "-dup"; warns.append("중복 세트 id")
            json.dump(s, open(outdir / f"{s['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            total_w += len(warns); ids.append(s["id"])
    json.dump(fmt, open(outdir / f"_format-{cfg['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if pers:
        report.append(f"인성 질문 묶음(세트 아님): {', '.join(pers)}\n")
    expected = {s["set"] for s in cfg["books"][book]["sets"]}
    for sid in sorted(expected - set(ids)):
        report.append(f"⚠ 지도에 있으나 조립되지 않은 세트: {sid}")
    (root / "reports").mkdir(parents=True, exist_ok=True)
    rp = root / "reports" / f"assemble-{cfg['id']}-{book}.md"
    rp.write_text("\n".join(report), encoding="utf-8")
    print(f"{cfg['short']} {book}: 세트 {len(ids)}개 조립, 경고 {total_w}, 보고서 {rp}")
    if missing:
        print("정제 결과 없는 쪽:", missing)


if __name__ == "__main__":
    main()
