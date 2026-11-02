# tools/

- `validate-data.js` — `node tools/validate-data.js`. 데이터 구조 검증(`docs/DATA.md` §5).
- (예정) `transcribe.py` — 녹음 배치 전사. 지침: `docs/TRANSCRIPTION.md` §3. 의존성은 `tools/requirements.txt`에.
- (예정) `gen_tree.py` — 세트별·난이도별 결정 트리 생성. 지침: `docs/AI.md` §6.

스크립트는 키를 환경변수(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)로만 받고, 입력·출력 파일(녹음·전사·세션 기록)은 커밋하지 않는다(`.gitignore`).
