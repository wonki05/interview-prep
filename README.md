# 서울대학교 법학전문대학원 면접 및 구술고사 대비

기출 제시문으로 치르는 모의면접(준비 20분 → 대기 5분 → 면접 15분), 기출DB, 면접대비 서가. 서버 없는 정적 사이트. GitHub Pages에 그대로 올린다.

## 실행

```
npm install          # 테스트용(puppeteer). 사이트 자체는 설치가 필요 없다
npm run serve        # http://localhost:5173/  (또는 index.html을 Chrome에서 직접 연다)
npm test             # 데이터 검증 + 스모크 테스트
SMOKE_BASE_URL=https://<id>.github.io/<repo>/ npm run test:smoke   # 배포본 스모크. PowerShell: $env:SMOKE_BASE_URL="…"; npm run test:smoke
```

## 배포

`main`에 push → `.github/workflows/pages.yml`. 저장소 Settings → Pages → Source: GitHub Actions. 주소: `https://<id>.github.io/<repo>/`.

## 문서

| 파일 | 내용 |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Claude Code / Codex 작업 규칙(같은 내용) |
| `docs/SPEC.md` | 기능 명세 |
| `docs/BUILD_PLAN.md` | 작업 순서·완료 기준 |
| `docs/DESIGN.md` | 디자인 토큰·컴포넌트·문구 규칙 |
| `docs/AI.md` | AI 면접관 연동(엔드포인트·프롬프트·JSON 계약·트리) |
| `docs/DATA.md` | 데이터 구조·입력 규칙 |
| `docs/TRANSCRIPTION.md` | 녹음 전사 지침 |
| `docs/DECISIONS.md` | 결정 기록·열린 질문 |

## 저장되는 것

모두 브라우저 안: 설정·API 키(`localStorage`), 녹음(IndexedDB), 기출DB 문답·서가 진도(`localStorage`). API 키는 선택한 제공사 API로만 전송되고 저장소에는 넣지 않는다.

## 자료

제시문·추가질문: 해커스로스쿨 김종수 『로스쿨 면접 200주제』 3권 기출편(2026)과 『황변과 함께하는 로스쿨 면접 Q』 1권(2026)의 복기(개인 학습용). 세트마다 복기본 3종(통합(AI)·황변·김종수)을 두며 원본은 `data/sets/`, 옮기는 절차는 `docs/INGEST.md`. 서가: 면접 도서 100선.
