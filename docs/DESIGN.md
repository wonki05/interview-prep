# DESIGN — 디자인 규칙

차분하고 단순한 문서형 UI. 종이 위에 먹색 글자, 강조색 하나. 모든 값은 `assets/app.css`의 토큰이며 페이지별 재정의는 하지 않는다.

## 1. 색

| 토큰 | 밝음 | 어둠 | 용도 |
|---|---|---|---|
| `--bg` | #F4F3EF | #15151A | 바탕(따뜻한 회백) |
| `--surface` / `-2` / `-3` | #FFFFFF / #ECEAE4 / #E0DED6 | #1D1D24 / #27272F / #31313B | 면, 띠 배경 |
| `--ink` / `-2` / `-3` | #2B2B33 / #55535C / #848189 | #ECEAE6 / #B5B2AE / #847F8A | 글자. **순흑(#000, #1x) 금지** |
| `--btn-bg` / `--btn-fg` | #3C3B46 / #F6F5F1 | #E6E4DF / #1B1B21 | 기본 버튼, 선택된 seg, 단계 번호, 시간표 '면접' 구간 |
| `--line` / `-2` | #DCDAD2 / #C7C4BA | #2E2E37 / #41414C | 가는 선, 테두리 |
| `--accent` / `-soft` / `-ink` | #3F3D8F / #ECEBF7 / #2F2D73 | #A9A5F2 / #2A2947 / #C5C1F8 | 유일한 강조색: 선택 레일, 진행 채움, 링크, 포커스 |
| `--rec` | #B8432F | #E0665A | 녹음·위험만 |
| `--ok` / `--warn` | #2E7A57 / #A8731C | #4FA882 / #D6A04A | 상태 칩 |
| `--paper` / `--paper-line` | #FBFAF6 / #E7E3D6 | #1F1F27 / #30303A | 제시문 카드 |

규칙: 강조색은 하나(남보라). 검정 대신 `--btn-bg`(진회색). 색으로만 의미를 전달하지 않는다(상태 칩에는 글자가 있다).

## 2. 글자

- UI: `IBM Plex Sans KR` 400/500/600/700. 본문 16px(설정으로 14~20), 줄간 1.6.
- 명조 `Noto Serif KR` 400/600/700: 페이지 제목(`.h1`, `.h2`), 제시문(`.paper`), 면접 질문(`.qcard .qtext`), 단계 번호·모드 코드·연도. 그 밖에는 쓰지 않는다.
- `word-break: keep-all; overflow-wrap: anywhere`. 숫자는 `.num`(tabular).
- 글꼴은 Google Fonts에서 받고 실패하면 시스템 글꼴. 글꼴 파일을 저장소에 넣지 않는다.

## 3. 치수

- 본문 폭 1120px, 좌우 여백 16px(safe-area 포함). 세로 리듬: 섹션 간 44px(`.page`), 섹션 안 14px, 세션 화면은 18px(`.page.in-session`).
- 모서리 10px(`--radius`), 작은 것 6~8px.
- **버튼 높이: 기본 38px(`.btn`), 작은 것 32px(`.btn.sm`), 큰 것 48px(`.btn.big`).** 같은 줄에 놓인 버튼은 같은 크기. seg 버튼 36px, 입력 38px(`.input`), 작은 입력 32px(`.input.sm`).
- 앱바 56px, sticky. 진행 바는 앱바 아래 sticky, 높이는 JS가 `--tb-h`로 전달한다(오른쪽 열이 그 아래에 붙는다).

## 4. 컴포넌트

| 클래스 | 쓰임 |
|---|---|
| `.appbar` `.brand` `.nav` `.iconbtn` | 상단 바. 메뉴 홈·모의면접·기출DB·모의고사·서가. 오른쪽 아이콘은 면접 기록(`#openRecords`, `assets/records.js`를 읽은 화면만)·설정 순. 모바일(≤760)에서 브랜드·아이콘 줄 + 메뉴 줄 두 줄(메뉴 좌우 여백 8px: 400px '아주 크게'에서 한 줄) |
| `.h1` `.h2` `.h3` `.eyebrow` `.lead` `.sub` `.small` `.muted` | 글자 단계 |
| `.btn` (`.primary` `.ghost` `.danger` `.rec` `.big` `.sm`) `.linkbtn` | 버튼 |
| `.seg` (`.fill`, `[data-seg]`) `.switch` `.input` `select.input` `.minutes` `.keyrow` | 입력 |
| `.effort-control` `.effort-heading` `.effort-ticks` | 설정·모의면접·기출DB 공통 effort 슬라이더. 모델별 단계와 현재 값 표시 |
| `.chip` (`.ok` `.warn` `.rec` `.accent` `.line`) `.callout` (`.warn` `.rec` `.ok`) | 상태 |
| `.panel` `.panel.tight` `.cols` `.grid2` `.grid3` `.row` `.stack` `.kv` | 배치 |
| `.tl` `.tl-seg` (`.plan`/`.done`/`.cur`/`.todo`, `.narrow`) `.tl-cap` | 시간표 띠(서명 요소). `SNU.timeline(plan, opts)`로만 생성 |
| `.stepper` `.step` (`.active`/`.done`/`.todo`) `.step-n` `.step-h` `.step-b` | 번호 붙은 단계 |
| `.schooltabs` `.setrows` `.setrow` `.empty-school` `.modes` `.mode` `.opts` `.opt-group` `.opt-title` `.startrow` `.promptview` | 모의면접 설정 |
| `.timerbar` `.session` `.coll` `.colr`(sticky) `.qcard` `.reccontrols` `.level` `.transcript` `.qactions` `.qlist` `.memo-pane` `.wait-screen` `.wait-wrap` `.knock` `.mobile-tabs` | 세션 |
| `.reclist` `.recitem` | 녹음 |
| `.dbgrid` `.dbside` `.dbmain` `.sethead` `.aibar` `.fold` `.qgroup` `.qrow` `.qhead` `.thread` `.msg` (`.user`/`.ai`) | 기출DB. 면접관 바 아래 해설 모델 바도 같은 `.aibar`·모델 선택·effort 컴포넌트를 재사용 |
| `.dbtools` `.dbtheme` `.themes-hidden` | 목록 상단 주제 가림·정렬, 목록·상세 주제 blur. 질문 행 왼쪽 여백 13.5px(모바일 12px), 이전의 75% |
| `.qtoggle` `.study-panel` `.study-result` `.study-notes` | 질문 본문으로 문답 펼침, 오른쪽 예시답변 버튼. 결과는 기존 색·글꼴·작은 버튼 사용. 제시문 해설은 제시문 아래 배치 |
| `#recordingPanel` `.rec-form` `.rec-ask` `.folds` `.study-transcript` | 녹음본 피드백(제시문 해설 아래). 새 색·글꼴·버튼 높이 없이 기존 컴포넌트로 만든다: 폼(`.rec-form`)과 결과를 `.study-result` 상자 둘로 나누고, 버튼은 `.btn.sm`(키 없음 옆 [설정]과 첨부의 [빼기]는 `.linkbtn`), 전사 모델은 `select.input.sm`, 첨부 목록·개선 방안·고민해볼 추가질문은 `.study-list`(개선 방안·추가질문은 `ol`, 추가질문의 근거 한 줄은 `.small.muted`), 진행은 `.study-status`, 오류는 `.callout.warn` 한 줄, 입력 확인은 `.promptview`, 화면 낭독기용 상태 한 줄은 `.sr`. 결과 구획 머리는 `.h3`, 제시문별 항목은 `.study-passage` + `.study-notes`. 문답별 평가는 `.folds` 안의 `.fold` 목록(이웃 선은 `.runs`처럼 한 줄, 요약줄 굵기 500)이고 펼치면 `.study-notes`(원문·답변 요지·평가·개선). '평가한 문답'도 결과 안의 `.fold`이며 원문 구간과 전문 본문 `.study-transcript`는 360px 안에서 스크롤한다. 후속 질문(`.rec-ask`)은 기출DB 문답 스레드의 `.msg.user`·`.msg.ai` 말풍선을 쓰고 본문은 줄바꿈을 살리는 `.study-text`로 감싼다. 문답 칸은 최소 180px, 후속 질문 칸은 문답 스레드와 같은 96px |
| `.runs` `.fold.run` | 쌓이는 AI 결과(예시답변·제시문 해설·면접 피드백). `SNU.runs(list, opts)`로만 생성. 결과마다 `.fold` 블록, 머리는 `n차 · 모델 · effort · 시각`(원문이 바뀐 결과는 `.chip.line` '이전 원문'), 최신이 위·처음엔 최신만 펼침, 본문 끝에 작은 [삭제] |
| `.setrows.byschool` `.dbside.fit` `.lv` | 모의고사 목록: 세트 행의 연도 자리에 학교 약칭(열 4.8rem, 네 글자까지 한 줄), 이름 자리에 문제 번호. AI 묶음은 그 자리에 난이도 별 `.lv`(`★` 채움 + `.off` `☆` 빈칸 `--ink-3`, `role="img"`·`aria-label` '난이도 n/5', 행에서는 UI 글꼴 .86rem로 4.8rem 열에 한 줄)와 분야 넘버링(`인문 A`). 상세 머리(`.eyebrow`) 끝에도 같은 `.lv`. 자리 탭은 한 줄에 다 보여야 해서 넘치면(400px '아주 크게') JS가 `.schooltabs.tight`를 붙여 문제 수(`.n`)를 빼고 좌우 여백을 10px로 줄인다. 목록 열(`.dbside.fit`)은 화면보다 길면 열 안에서 스크롤(세션 `.colr`와 같은 방식, 900 이하 1열에서 해제). 나머지는 기존 컴포넌트: 자리 탭 `.schooltabs`, 목록·상세 `.dbgrid` `.dbtools` `.setrow` `.sethead`, 진행 조건 `.panel.tight` 안의 `.tl` + `.study-list`, 제시문 `.fold` 안의 `.papers`, 문항·추가질문 `.fold`(기본 접힘) 안의 `.qlist`(추가질문 번호는 문항 뒤로 이어짐), 빈 자리 `.empty-school` |
| `.paper` `.papers` `.instr` | 제시문 |
| `.drawer` `.shade` `.d-sec` | 설정 서랍 |
| `.drawer.wide` | 면접 기록 서랍(폭 760px, 모바일 100%). 목록은 `.setrows`/`.setrow`, 상세는 `.sethead`·`.d-sec`·`.aibar`·`.qlist`·`.reclist`를 그대로 쓴다. 설정 서랍이 위에 열리면 Esc는 위 서랍만 닫는다 |
| 서가: `.tabs` `.tools` `.booklist` `.book` `.toprow` `.cluster` `.iss*` `.stage` `.pairs` `.calc` `.cap` `.bdrawer` `.prose` 등 | 서가(원본 이식) |

새 컴포넌트가 필요하면 위 표에 추가하고, 기존 토큰만으로 만든다.

## 5. 문구

- 간결. 명령형("답변을 작성하시오.")·명사형("녹음 없음", "키 있음"). 설명문·안내문·격려문 금지. 느낌표·이모지 금지.
- 버튼은 동사구 2~6자("시작", "다음 질문", "기록만 남기기"). 화살표 `→`는 단계 전환 버튼에만.
- 도움말(`.help`)은 조건부 한 줄만(예: "이 세트에는 트리가 없어 실시간 생성으로 진행된다.").
- 오류는 `.callout.warn` 한 줄: 원인 + 대체 동작("AI 호출 실패: 401 — 복기 질문 은행으로 대체.").

## 6. 반응형·상태

- ≤980: 세션 1열 + 제시문/면접/메모 탭, 기출DB 1열. ≤860: 모드 3→1열, 서가 2→1열. ≤760: 옵션 2→1열, 앱바 두 줄, 진행 바 띠 둘째 줄. ≤560: 세트 행 메타 줄바꿈.
- 어둠 테마: `prefers-color-scheme` + `html[data-theme]`. 블루라이트 오버레이는 테마와 무관하게 위에 얹는다.
- `prefers-reduced-motion`: 전환·애니메이션 제거. 인쇄: 앱바·서랍·진행 바 숨김.
- 포커스 링 2px 강조색. 모든 토글은 `aria-pressed`, 현재 탭은 `aria-current`.
