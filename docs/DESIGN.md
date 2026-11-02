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
| `.appbar` `.brand` `.nav` `.iconbtn` | 상단 바. 모바일(≤760)에서 브랜드 줄 + 메뉴 줄 두 줄 |
| `.h1` `.h2` `.h3` `.eyebrow` `.lead` `.sub` `.small` `.muted` | 글자 단계 |
| `.btn` (`.primary` `.ghost` `.danger` `.rec` `.big` `.sm`) `.linkbtn` | 버튼 |
| `.seg` (`.fill`, `[data-seg]`) `.switch` `.input` `select.input` `.minutes` `.keyrow` | 입력 |
| `.chip` (`.ok` `.warn` `.rec` `.accent` `.line`) `.callout` (`.warn` `.rec` `.ok`) | 상태 |
| `.panel` `.panel.tight` `.cols` `.grid2` `.grid3` `.row` `.stack` `.kv` | 배치 |
| `.tl` `.tl-seg` (`.plan`/`.done`/`.cur`/`.todo`, `.narrow`) `.tl-cap` | 시간표 띠(서명 요소). `SNU.timeline(plan, opts)`로만 생성 |
| `.stepper` `.step` (`.active`/`.done`/`.todo`) `.step-n` `.step-h` `.step-b` | 번호 붙은 단계 |
| `.schooltabs` `.setrows` `.setrow` `.empty-school` `.modes` `.mode` `.opts` `.opt-group` `.opt-title` `.startrow` `.promptview` | 모의면접 설정 |
| `.timerbar` `.session` `.coll` `.colr`(sticky) `.qcard` `.reccontrols` `.level` `.transcript` `.qactions` `.qlist` `.memo-pane` `.wait-screen` `.wait-wrap` `.knock` `.mobile-tabs` | 세션 |
| `.reclist` `.recitem` | 녹음 |
| `.dbgrid` `.dbside` `.dbmain` `.sethead` `.aibar` `.fold` `.qgroup` `.qrow` `.qhead` `.thread` `.msg` (`.user`/`.ai`) | 기출DB |
| `.paper` `.papers` `.instr` | 제시문 |
| `.drawer` `.shade` `.d-sec` | 설정 서랍 |
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
