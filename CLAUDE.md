# CLAUDE.md — 서울대학교 법학전문대학원 면접전형 대비 (interviewprep)

Claude Code가 이 저장소에서 작업할 때 따르는 규칙. Codex는 같은 내용의 `AGENTS.md`를 읽는다. 두 파일은 항상 같은 내용으로 유지한다.

## 1. 프로젝트

서울대 로스쿨 면접(준비 20분 → 대기 5분 → 면접 15분)을 기출 제시문으로 연습하는 **정적 웹사이트**. GitHub Pages에 그대로 올린다. 서버 없음. 네 화면: 홈 / 모의면접 / 기출DB / 면접대비 서가. 사용자는 한 명(제작자 본인)이며 이 사이트를 직접 쓴다.

현재 상태: 구조·디자인이 확정된 **샘플 코드**가 들어 있고 동작한다. 이 위에 `docs/BUILD_PLAN.md`의 순서대로 기능을 완성한다. 요구사항은 `docs/SPEC.md`, 디자인 규칙은 `docs/DESIGN.md`, AI 연동은 `docs/AI.md`, 데이터 규칙은 `docs/DATA.md`, 전사는 `docs/TRANSCRIPTION.md`, 결정 사항·열린 질문은 `docs/DECISIONS.md`.

## 2. 절대 규칙

1. **빌드 도구·프레임워크·번들러·TypeScript 금지.** 브라우저가 그대로 읽는 HTML/CSS/ES2020 JS만. 외부 라이브러리는 추가하지 않는다(글꼴 CDN 제외). 필요하면 `docs/DECISIONS.md`에 사유를 적고 사용자에게 묻는다.
2. **모든 경로는 상대 경로.** `https://<id>.github.io/<repo>/` 하위 경로에서 열린다. `file://`로 열어도 동작해야 한다.
3. **API 키는 코드·저장소에 절대 넣지 않는다.** 키는 사용자의 브라우저 `localStorage`에만 저장되고 해당 제공사 API로만 전송된다. 예시 키, `.env`, 테스트용 키도 커밋 금지(`.gitignore` 참조). 키가 필요한 테스트는 환경변수로 받고 없으면 건너뛴다.
4. **모든 사용자 데이터는 브라우저 안에만 둔다.** 녹음(IndexedDB), 문답·설정·진도(localStorage). 외부 전송은 사용자가 고른 AI 제공사 API 호출뿐이다.
5. **제시문 텍스트는 수정하지 않는다.** `data/questions.js`의 `passages[].text`는 복기 원문이다. 오탈자 수정도 사용자 확인 뒤에만.
6. **UI 문구는 간결하게.** 사용자는 설명이 필요 없다. 명령형·명사형("답변을 작성하시오.", "녹음 없음"), 사족·안내 문장 금지, 도움말은 꼭 필요한 한 줄만. 새 문구를 넣을 때 기존 문구의 길이를 기준으로 한다.
7. **디자인 토큰과 컴포넌트를 재사용한다.** 새 색·새 글꼴·새 버튼 높이를 만들지 않는다. `docs/DESIGN.md`의 규칙(버튼 높이 38/32/48, 같은 줄의 버튼은 같은 크기, 순흑색 금지, 강조색 하나)을 지킨다.
8. **파일 구조를 유지한다.** 새 페이지는 `*.html` + `assets/<name>.js`, 새 데이터는 `data/*.js`(`window.X = {...}` 전역). 모듈 번들 없이 `<script>` 순서로 의존한다(app.js → data → ai.js → 페이지 스크립트).
9. **주석과 문서는 한국어.** 코드 식별자는 영어.
10. **데이터 구조를 바꾸면 같은 커밋에서 `docs/DATA.md`와 `tools/validate-data.js`를 갱신한다.**
11. **기출 세트 이름은 학교 약칭에 '대'를 붙여 쓴다.** 세트 `name`은 `school.short` + 공백 + 세션 기호(예: `서울대 A`, `연세대 B`)이고, 복기본의 `서울 A`처럼 '대'를 뺀 표기는 옮기지 않는다. 모든 학교의 기출 작업에 적용한다(세부: `docs/DATA.md` §1 규칙 8).

## 3. 파일 지도

```
index.html / practice.html / db.html / library.html   페이지 셸(헤드에서 app.css, app.js, data/*.js, ai.js 로드)
assets/app.css      토큰(밝음/어둠), 공통 컴포넌트, 시간표 띠(.tl), 단계 선택(.step), 세션 레이아웃(.session), 기출DB(.dbgrid), 서가
assets/app.js       설정 저장소(localStorage "snu-iv-settings-v1"), 테마/블루라이트/글자 크기, 앱바, 설정 서랍, 시간표 띠 생성, 모델 목록 select, SNU.db 데이터 접근
assets/ai.js        AI 클라이언트(Anthropic/OpenAI 직접 호출), setContext(제시문 전문+복기 질문 전체), 프롬프트 빌더, nextQuestion/classify/respond
assets/practice.js  모의면접: ①세트 ②모드 ③옵션·시작 → 준비→대기→면접→종료, 녹음(MediaRecorder→IndexedDB "snu-interview"), STT/TTS, 결정 트리 보행
assets/db.js        기출DB: 학교·세트 탐색, 제시문, 질문별 문답 스레드(localStorage "snu-db-threads-v1")
assets/library.js   서가: 개요/도서/쟁점/읽는 순서, 책 상세 서랍, 진도(localStorage "snu-library-progress-v1")
data/sets/          세트 원본(<set id>/meta·kim·hwang·merged.json, _db.json의 levels·학교 format). 고친 뒤 tools/build_questions.js
data/questions.js   INTERVIEW_DB = { levels, schools[] } — data/sets/에서 생성. 서울대 18 · 고려대 7 · 연세대 9 · 성균관대 14 · 한양대 7세트, 결정 트리 예시(snu-2023-A), 다른 5개 학교 빈 자리
data/models.js      MODEL_CATALOG — 선택 가능한 모델 목록(표시명·API id)
data/library.js     도서 100선 데이터(크다, 720KB)
docs/               SPEC, BUILD_PLAN, DESIGN, AI, DATA, TRANSCRIPTION, DECISIONS
tests/smoke.js      puppeteer 스모크 테스트(화면 흐름·콘솔 오류·모바일 가로 넘침)
tools/              데이터 검증·생성, 교재 수록 파이프라인(schools/ 학교별 설정, workflows/ 에이전트 워크플로), (향후) 전사·트리 생성
```

## 4. 작업 절차

1. `docs/BUILD_PLAN.md`에서 다음 항목을 고른다. 항목 번호를 커밋 메시지와 PR 제목에 쓴다(예: `P1-3 녹음 zip 내려받기`).
2. 구현 전에 영향 받는 파일과 문서를 읽는다. 불명확하면 `docs/DECISIONS.md`의 열린 질문을 확인하고, 없으면 거기에 질문을 적고 사용자에게 묻는다. 추측으로 요구사항을 넓히지 않는다.
3. 구현한다. 한 항목 = 한 커밋(또는 작은 커밋 몇 개). 관련 없는 리팩터링을 섞지 않는다.
4. 검증한다.
   - `node tools/validate-data.js` (데이터를 건드렸을 때)
   - `npm run test:smoke` (puppeteer; 처음 한 번 `npm install`)
   - 직접 확인: 데스크톱 1280px·모바일 400px, 밝음·어둠 테마, 글자 크기 '아주 크게'에서 깨지지 않는지. 세션 화면은 텍스트 답변 모드로 끝까지 진행해 본다.
5. 완료 기준을 만족하면 `docs/BUILD_PLAN.md`의 항목 상태를 `[x]`로 바꾸고, 결정이 있었으면 `docs/DECISIONS.md`에 한 줄 적는다.

## 5. 실행·검증

- 로컬: `npx -y serve -l 5173 .` 뒤 `http://localhost:5173/` 또는 `index.html`을 Chrome에서 직접 연다(`file://`에서도 마이크 동작).
- 음성 인식(Web Speech API)은 Chrome·Safari만. 테스트에서는 `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`로 마이크를 흉내 낸다(`tests/smoke.js`).
- `npm install`이 puppeteer의 Chromium을 받지 못하는 환경이면 `npm i -D puppeteer-core` 뒤 `PUPPETEER_EXECUTABLE_PATH`에 설치된 Chrome 경로를 넣는다(`tests/smoke.js`가 자동으로 대체한다).
- AI 호출은 키가 있을 때만. 키 없는 경로(복기 질문 은행 대체, 수동 분기 선택)가 항상 동작해야 한다.
- 배포: `main`에 push → `.github/workflows/pages.yml`이 GitHub Pages에 올린다. 저장소 Settings → Pages → Source: GitHub Actions.

## 6. 하지 말 것

- 설명문·안내문·환영 문구 추가, 이모지, 느낌표.
- `data/library.js`를 손으로 편집(원본 HTML에서 추출한 데이터; 바꿀 일이 있으면 추출 스크립트로).
- 설정 키 이름 변경(기존 사용자의 localStorage가 깨진다). 꼭 필요하면 마이그레이션 코드를 `app.js`에 넣는다.
- 글꼴·색·간격을 페이지별로 따로 정의하는 것. 모두 `app.css` 토큰으로.
- 테스트 통과 없이 "완료" 표시.
