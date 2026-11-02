# tools/

데이터 검증·생성과 교재 수록 파이프라인(`docs/INGEST.md`). Python 스크립트는 `python -I tools/<name>.py`, 의존성은 `tools/requirements.txt`(pymupdf).

| 스크립트 | 역할 |
|---|---|
| `validate-data.js` | `node tools/validate-data.js`. 데이터 구조 검증(`docs/DATA.md` §5) |
| `build_questions.js` | `data/sets/` → `data/questions.js` 생성(`docs/DATA.md` §1.1). 데이터를 고친 뒤 항상 실행 |
| `export_sets.js` | 옛 평면 `data/questions.js`를 `data/sets/`로 옮긴 1회용 이행 스크립트 |
| `book_extract.py` | 교재 PDF 쪽 이미지(150dpi 회색조)·ABBYY 텍스트층 → `work/books/<tag>/pages/` |
| `ocr_collect.py` | Workflow `ingest-ocr` 결과 JSON → `work/ocr/<book>/pNNNN.json` |
| `check_ocr.py` | 정제 결과를 텍스트층과 difflib로 대조, 라벨 순서 점검 → `work/reports/ocr-check.md` |
| `assemble_sets.py` | 쪽 블록 → 세트 변형 JSON(`work/sets/<book>/`) + 조립 보고서 |
| `diff_existing.py` | 기존 세트 본문 ↔ OCR 조립본 대조 → `work/reports/existing-diff.md`(변경은 사용자 승인 뒤) |
| `promote_sets.py` | `work/sets/<book>/` → `data/sets/<id>/<book>.json`(+ 새 세트 `meta.json`) |
| (예정) `transcribe.py` | 녹음 배치 전사. 지침: `docs/TRANSCRIPTION.md` §3 |
| (예정) `gen_tree.py` | 세트별·난이도별 결정 트리 생성. 지침: `docs/AI.md` §6 |

스크립트는 키를 환경변수(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)로만 받고, 교재 원본(`books/`)과 중간 산출물(`work/`)은 커밋하지 않는다(`.gitignore`).
