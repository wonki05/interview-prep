# tools/

데이터 검증·생성과 교재 수록 파이프라인(`docs/INGEST.md`). Python 스크립트는 `python -I tools/<name>.py`, 의존성은 `tools/requirements.txt`(pymupdf).

| 스크립트 | 역할 |
|---|---|
| `validate-data.js` | `node tools/validate-data.js [--in <파일>]`. 데이터 구조 검증(`docs/DATA.md` §5) |
| `build_questions.js` | `data/sets/` → `data/questions.js` 생성(`docs/DATA.md` §1.1). 데이터를 고친 뒤 항상 실행. `--school <id> --out <파일>`은 한 학교만 다른 파일로(학교 세션 검증용) |
| `export_sets.js` | 옛 평면 `data/questions.js`를 `data/sets/`로 옮긴 1회용 이행 스크립트 |
| `schoolcfg.py`, `schools/<id>.json` | 학교별 수록 설정(쪽 범위·세트 머리·세션 기호·OCR 학교 주석·조립 선택지, `docs/INGEST.md` §8-2). `schools/<id>.py`(선택)는 학교별 예외 hook |
| `book_extract.py` | 교재 PDF 쪽 이미지(150dpi 회색조)·ABBYY 텍스트층 → `work/books/<tag>/pages/` |
| `ocr_args.py` | 워크플로 인자 JSON(`<id> [--pages] [--only-missing\|--have-ocr] [--themes]`) → `work/<id>/` |
| `workflows/ingest-ocr.js` | Workflow(`scriptPath`): Haiku 정제 → 미흡하면 Haiku 재시도 → 마지막 Sonnet. `verify: true`면 Sonnet 이미지 대조(파일럿) |
| `ocr_collect.py` | Workflow `ingest-ocr` 결과 JSON → `work/ocr/<book>/pNNNN.json` |
| `ocr_from_journal.py` | 중단된 `ingest-ocr`의 journal에서 정제 결과 수집 |
| `check_ocr.py` | `<id> [book…]`: 정제 결과를 텍스트층과 difflib로 대조, 라벨·자리표시 점검 → `work/reports/ocr-check-<id>.md` |
| `workflows/ingest-typo.js` | Workflow: Sonnet 쪽당 1회 오탈자 검수(글자 단위 오류만) |
| `apply_fixes.py` | `<id> <ingest-typo 결과>`: 수정 반영 → `work/ocr/`, 보고서 `work/reports/typo-<id>.md`(책 자체 오탈자 의심은 고치지 않고 목록만) |
| `assemble_sets.py` | `<id> kim\|hwang`: 쪽 블록 → 세트 변형 JSON(`work/sets/<book>/`) + 조립 보고서 `assemble-<id>-<book>.md` |
| `diff_existing.py` | 기존 세트 본문 ↔ OCR 조립본 대조 → `work/reports/existing-diff.md`(변경은 사용자 승인 뒤) |
| `promote_sets.py` | `<id> kim\|hwang`(kim 먼저): `work/sets/<book>/` → `data/sets/<id>/<book>.json`(+ 새 세트 `meta.json`, 세트 format은 김종수 그해 진행 방식 줄). `--refresh-format`은 이미 있는 meta의 format도 다시 쓴다 |
| `workflows/ingest-themes.js`, `apply_themes.py` | Sonnet 세트당 1회 주제어·태그 → `meta.json`의 themes·tags |
| `check_merged.py` | 통합본 `merged.json` ↔ kim·hwang 대조(스키마·질문·날조 의심 문장·누락 참고, meta `variant`) → `work/reports/merged-check.md` |
| (예정) `transcribe.py` | 녹음 배치 전사. 지침: `docs/TRANSCRIPTION.md` §3 |
| (예정) `gen_tree.py` | 세트별·난이도별 결정 트리 생성. 지침: `docs/AI.md` §6 |

스크립트는 키를 환경변수(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)로만 받고, 교재 원본(`books/`)과 중간 산출물(`work/`)은 커밋하지 않는다(`.gitignore`).
