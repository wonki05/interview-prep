/* 스모크 테스트: npm run test:smoke
   puppeteer(번들 Chromium)로 네 화면과 모의면접 흐름을 돌려 보고, 페이지 오류·콘솔 오류·모바일 가로 넘침을 확인한다.
   스크린샷은 tests/shots/ (git 무시). 마이크는 가짜 장치로 흉내 낸다. AI 호출은 키가 없으므로 대체 경로(질문 은행·수동 분기)를 탄다. */
"use strict";
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
/* puppeteer(번들 Chromium)가 없으면 puppeteer-core + 설치된 Chrome(PUPPETEER_EXECUTABLE_PATH 또는 기본 경로)을 쓴다 */
let puppeteer, executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
try { puppeteer = require("puppeteer"); } catch (e) {
  puppeteer = require("puppeteer-core");
  executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => fs.existsSync(p));
}

/* SMOKE_BASE_URL(배포본 https://<id>.github.io/<repo>/ 또는 로컬 서버)이 있으면 그 주소를, 없으면 저장소 폴더를 file://로 연다 */
const BASE_URL = process.env.SMOKE_BASE_URL;
const ROOT = BASE_URL ? BASE_URL.replace(/\/?$/, "/") : pathToFileURL(path.join(__dirname, "..") + path.sep).href;   // file:///…/interviewprep-buildspace/
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failures++; };

(async () => {
  const browser = await puppeteer.launch({ headless: "new", executablePath, args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => errors.push("PAGEERROR " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_INTERNET|fonts\.g/.test(m.text())) errors.push("console.error: " + m.text()); });
  const shot = async (name, w, h, full) => { await page.setViewport({ width: w || 1280, height: h || 900 }); await sleep(250); await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: !!full }); };
  const goto = async (p) => { await page.goto(ROOT + p, { waitUntil: "domcontentloaded", timeout: BASE_URL ? 60000 : 30000 }); await sleep(300); };   // 배포본 60초(기본 30초)
  const clickVisible = async sel => { await page.$eval(sel, el => el.scrollIntoView({ block: "center" })); await page.click(sel); };   // 붙박이 앱바 아래로 스크롤된 버튼 대신 앱바 링크를 누르지 않게
  const fresh = async p => { await goto(p); await page.reload({ waitUntil: "domcontentloaded" }); await sleep(300); };   // 같은 주소로 가면 새로 불러오지 않아 앞 단계 상태가 남는다
  const setSettings = async (obj) => { await page.evaluate(o => localStorage.setItem("snu-iv-settings-v1", JSON.stringify(o)), obj); };
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const drawerFits = async () => page.$eval("#recordsDrawer", d => d.scrollWidth <= d.clientWidth);   // 서랍 안쪽 가로 넘침
  const setEffort = async (selector, value) => page.$eval(selector, (input, n) => {
    input.value = String(n); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  const effortState = selector => page.$eval(selector, input => ({ value: input.value, max: input.max, disabled: input.disabled, label: input.getAttribute("aria-valuetext") }));

  console.log("홈");
  await page.setViewport({ width: 1280, height: 900 });
  await goto("index.html");
  check(await page.$(".tl"), "시간표 띠 렌더");
  const nSets = await page.evaluate(() => window.SNU.db.school("snu").sets.length);
  check(nSets >= 5 && (await page.$$("#setList .setrow")).length === nSets, "세트 행 " + nSets + "개(연도 소제목 제외)");
  await shot("home", 1280, 900, true);
  const other = await page.evaluate(() => { const s = window.SNU.db.schools().find(x => x.id !== "snu" && x.sets.length); return s && { id: s.id, n: s.sets.length }; });
  if (other) {
    await page.click(`#schoolTabs [data-school="${other.id}"]`); await sleep(200);
    const hrefs = await page.$$eval("#setList .setrow", a => a.map(x => x.getAttribute("href")));
    check(hrefs.length === other.n && hrefs.every(h => h.includes("set=" + other.id + "-")), `학교 토글 → ${other.id} 세트 행 ${hrefs.length}개`);
  }

  console.log("모의면접 설정 3단계");
  /* 해설 설정을 면접관(Claude 기본값)과 다르게 저장해 둔다: 면접 피드백의 기본 모델이 해설 설정을 따르는지 확인한다 */
  await goto("practice.html"); await setSettings({ tts: false, answerMode: "text", explanationProvider: "openai", explanationOpenaiModel: "gpt-6-luna", explanationOpenaiEffort: "low" }); await goto("practice.html");
  check((await page.$$("[data-school]")).length === 10, "학교 토글 10개");
  await page.click('[data-set="snu-2023-A"]'); await sleep(300);
  check(await page.$("#step2.active"), "세트 선택 → 2단계");
  await page.click('[data-mode="timed"]'); await sleep(300);
  check(await page.$("#step3.active") && await page.$("#startBtn"), "모드 선택 → 3단계 + 시작 버튼");
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll("#step3 .modelsel select option")).map(o => o.textContent));
  check(opts.includes("Sonnet 5.5") && opts.includes("직접 입력…"), "모델 목록 표시명 " + opts.join("/"));
  check(await page.$('#step3 [data-seg="variant"] [data-v="kim"][aria-pressed="true"]'), "복기본 seg(김종수 눌림, 통합 없음 → 대체)");
  await page.click("#pv summary"); await sleep(150);
  const pv = await page.evaluate(() => document.querySelector("#pv pre").textContent);
  check(pv.includes("<제시문 1>") && pv.includes("<제시문 4>") && pv.includes("[복기된 실제 추가질문 전체]"), "AI 입력 미리 보기에 제시문 전문·복기 질문 포함");
  check((await effortState("#practice-effort")).value === "1", "Claude 추론 강도 기본값 보통");
  await setEffort("#practice-effort", 2);
  check(await page.evaluate(() => SNU.settings.anthropicEffort === "medium"), "세션 추론 강도는 기본 설정과 분리");
  await page.click("#aiSaveDefault");
  check(await page.evaluate(() => SNU.settings.anthropicEffort === "high"), "세션 추론 강도 기본값 저장");
  await page.click('[data-aiseg="provider"] [data-v="openai"]');
  check((await effortState("#practice-effort")).max === "4", "GPT-6.1 Sol 추론 강도 5단계");
  await page.select("#step3 .modelsel select", "gpt-6-astra");
  check((await effortState("#practice-effort")).max === "4", "GPT-6 Astra 추론 강도 5단계");
  await page.select("#step3 .modelsel select", "gpt-6.1-terra");
  check((await effortState("#practice-effort")).max === "5", "GPT-6.1 Terra 추론 없음 포함 6단계");
  await setEffort("#practice-effort", 5);
  await page.select("#step3 .modelsel select", "gpt-6-luna");
  check((await effortState("#practice-effort")).value === "5", "같은 지원 범위 모델 변경 시 추론 강도 유지");
  await page.select("#step3 .modelsel select", "gpt-6.1-sol");
  check((await effortState("#practice-effort")).value === "4", "모델 변경 시 최대 강도 단계 재계산");
  await page.select("#step3 .modelsel select", "__custom");
  await page.$eval("#step3 .modelsel input", input => { input.value = "custom-model"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  check((await effortState("#practice-effort")).disabled, "직접 입력한 미확인 모델은 추론 강도 자동");
  await page.click('[data-aiseg="provider"] [data-v="anthropic"]');
  await shot("practice-step3", 1280, 900, true);

  console.log("세션: 준비 → 대기 → 면접 → 종료 (텍스트)");
  await page.click("#startBtn"); await sleep(600);
  check(await page.$("#timerbar") && await page.$("#tlCur[data-k=prep]"), "준비 단계 진행 바");
  await page.evaluate(() => window.scrollTo(0, 900)); await sleep(200);
  const stickyTop = await page.evaluate(() => document.querySelector(".colr").getBoundingClientRect().top);
  check(stickyTop > 60 && stickyTop < 220, "오른쪽 열 sticky (top=" + Math.round(stickyTop) + ")");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.type("#memo", "메모 테스트");
  await page.click("#toNext"); await sleep(400);
  check(!(await page.$(".paper")) && await page.$("#clockBig"), "대기: 제시문 숨김 + 큰 시계");
  await page.click("#toInterview"); await sleep(600);
  check(await page.$("#answerText") && await page.$("#nextBtn"), "면접: 텍스트 답변 입력란");
  const hs = await page.evaluate(() => Array.from(document.querySelectorAll(".qactions .btn")).map(b => Math.round(b.getBoundingClientRect().height)));
  check(hs.length && hs.every(h => h === hs[0]), "같은 줄 버튼 높이 동일 " + hs.join(","));
  await page.type("#answerText", "네 제시문은 모두 통념을 뒤집는다.");
  await page.click("#nextBtn"); await sleep(400);
  const br = await page.$("[data-branch]"); if (br) { await br.click(); await sleep(300); }
  await page.click("#endBtn"); await sleep(600);
  check(await page.$("#again") && (await page.$$(".qlist li.done")).length >= 1, "종료 화면 + 문답 기록");
  await shot("practice-done", 1280, 900, true);

  console.log("면접 기록: 저장·AI 피드백 누적·기록 서랍");
  await page.waitForSelector("#openRecord:not([disabled])"); await page.waitForSelector("#feedback .aibar");   // 종료 화면을 그린 뒤 저장을 마치고 붙인다
  const savedSession = await page.evaluate(async () => { const list = await Records.listSessions(); const s = list[0] && await Records.getSession(list[0].id); return s && { id: s.id, n: s.history.length, ended: !!s.endedAt, memo: s.memo, answerMode: s.answerMode, first: s.history[0] && s.history[0].a }; });
  check(savedSession && savedSession.n >= 1 && savedSession.ended && savedSession.memo === "메모 테스트" && savedSession.answerMode === "text" && savedSession.first === "네 제시문은 모두 통념을 뒤집는다.", "텍스트 면접 기록 저장(문답·메모·종료 시각)");
  check(await page.$("#feedback [data-fb-run][disabled]"), "종료 화면: 기록 보기·AI 피드백(키 없으면 비활성)");
  /* 피드백 응답만 지연 mock으로 바꾸고 실제 UI·저장소·누적·모델 선택을 확인한다. 키 저장·외부 호출 없음. */
  await page.evaluate(() => {
    const mock = window.__fbMock = { calls: [], pending: [] };
    const resolve = AIClient.resolve;
    AIClient.resolve = override => Object.assign({}, resolve(override), { configured: true });
    AIClient.review = (cs, s, ai) => { mock.calls.push({ id: cs.id, variant: cs.variant, n: s.history.length, ai }); return new Promise(done => mock.pending.push(() => done({ summary: "회귀검증 총평 " + mock.calls.length, strengths: [], gaps: ["반론 처리"], items: s.history.map((h, i) => ({ no: i + 1, comment: "회귀검증 검토", better: "회귀검증 보완 <b>굵게</b>" })), next: ["다음 연습"] }))); };
    SNU.save({});
  });
  await page.waitForSelector("#feedback [data-fb-run]:not([disabled])");
  await page.$eval("#feedback [data-fb-run]", b => { b.click(); b.click(); });
  await page.waitForFunction(() => __fbMock.calls.length === 1);
  check(await page.$eval("#feedback [data-fb-run]", b => b.disabled) && await page.evaluate(() => __fbMock.calls.length === 1), "피드백 생성 중 중복 요청 막음");
  check(await page.evaluate(() => { const ai = __fbMock.calls[0].ai; return SNU.settings.provider === "anthropic" && ai.provider === "openai" && ai.model === "gpt-6-luna" && ai.effort === "low"; }), "피드백 기본 모델 = AI 면접해설 설정(면접관 설정과 다름)");
  await page.evaluate(() => __fbMock.pending[0]());
  await page.waitForSelector("#feedback details.run[open]");
  await page.click('#feedback [data-fbseg] [data-v="anthropic"]');
  await page.waitForSelector('#feedback .modelsel[data-provider="anthropic"]');
  await page.select("#feedback .modelsel select", "claude-opus-5-5");
  await page.waitForSelector("#feedback [data-fb-run]:not([disabled])");
  await page.click("#feedback [data-fb-run]");
  await page.waitForFunction(() => __fbMock.calls.length === 2);
  await page.evaluate(() => __fbMock.pending[1]());
  await page.waitForFunction(() => document.querySelectorAll("#feedback details.run").length === 2);
  check(await page.evaluate(() => { const ai = __fbMock.calls[1].ai; return ai.provider === "anthropic" && ai.model === "claude-opus-5-5"; }), "피드백 제공사·모델을 그 자리에서 바꿔 다시 받기");
  check(await page.$$eval("#feedback details.run", d => d[0].open && !d[1].open && d[0].querySelector("summary b").textContent === "2차"), "피드백 누적: 최신 펼침·이전 접힘");
  check(await page.$eval("#feedback details.run", d => d.textContent.includes("<b>굵게</b>") && !d.querySelector(".study-text b")), "피드백 텍스트를 HTML로 실행하지 않음");
  check(await page.evaluate(async id => (await Records.getSession(id)).feedbacks.length === 2, savedSession.id), "피드백은 세션 기록 안에 저장");
  await page.click("#openRecords"); await page.waitForSelector("#recordsDrawer [data-rec]");
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "rClose" && document.body.style.overflow === "hidden"), "기록 서랍: 닫기 버튼 초점·배경 스크롤 잠금");
  await page.click(`#recordsDrawer [data-rec="${savedSession.id}"]`); await page.waitForSelector("#recordsDrawer details.run");
  check((await page.$$("#recordsDrawer details.run")).length === 2 && await page.$eval("#recordsDrawer", d => d.textContent.includes("메모 테스트") && d.textContent.includes("네 제시문은 모두 통념을 뒤집는다.")), "기록 서랍 상세: 문답·메모·피드백");
  await page.keyboard.press("Escape");
  check(!(await page.$("#recordsDrawer")) && await page.evaluate(() => document.body.style.overflow === ""), "Esc로 기록 서랍 닫기");
  await goto("library.html");
  await page.click("#openRecords"); await page.waitForSelector(`#recordsDrawer [data-rec="${savedSession.id}"]`);
  await page.click(`#recordsDrawer [data-rec="${savedSession.id}"]`); await page.waitForSelector("#recordsDrawer [data-fb-run]");
  check((await page.$$("#recordsDrawer details.run")).length === 2 && await page.evaluate(() => !!window.INTERVIEW_DB && !!window.AIClient), "새 화면(서가)에서 기록·피드백 유지, 세트·AI 지연 로드");
  await clickVisible("#recordsDrawer details.run[open] [data-run-del]");
  await page.waitForFunction(() => document.querySelectorAll("#recordsDrawer details.run").length === 1);
  check(await page.evaluate(async id => (await Records.getSession(id)).feedbacks.length === 1, savedSession.id), "피드백 하나 삭제(저장소 반영)");
  await shot("records-drawer", 1280, 900);
  await page.click("#rClose");

  console.log("세션: 분류 실패 후 수동 분기");
  await setSettings({ tts: false, answerMode: "text", waitEnabled: false, flow: "tree", variant: "kim" });
  await goto("practice.html?set=snu-2023-A");
  /* 브라우저 메모리에만 테스트 트리와 실패 응답을 넣는다. 키 저장·API 호출·원본 파일 변경은 없다. */
  await page.evaluate(() => {
    const cs = SNU.db.raw().flatMap(sc => sc.sets).find(s => s.id === "snu-2023-A");
    cs.tree = { basis: "kim", root: "test-root", nodes: {
      "test-root": { q: "분류 테스트 질문", branches: [{ when: "첫 번째 입장", next: "test-first" }, { when: "두 번째 입장", next: "test-second" }] },
      "test-first": { q: "첫 번째 분기 질문", next: null },
      "test-second": { q: "두 번째 분기 질문", next: null }
    } };
    const resolve = AIClient.resolve;
    AIClient.resolve = override => Object.assign({}, resolve(override), { configured: true });
    AIClient.classify = async () => { throw new Error("분류 응답 없음"); };
    AIClient.nextQuestion = async () => { throw new Error("예상치 않은 질문 생성"); };
  });
  await page.click('[data-mode="endless"]'); await page.click("#startBtn");
  await page.waitForSelector("#toNext"); await page.click("#toNext");
  await page.waitForSelector("#answerText"); await page.type("#answerText", "두 번째 입장이다.");
  await page.click("#nextBtn"); await page.waitForSelector('[data-branch="1"]');
  check((await page.$$("[data-branch]")).length === 2, "분류 실패 시 첫 가지로 진행하지 않고 수동 선택 대기");
  check(await page.$eval("#qcard", el => el.textContent.includes("분류 응답 없음")), "분류 실패 원인 표시");
  await page.click('[data-branch="1"]');
  check(await page.$eval("#qcard .qtext", el => el.textContent === "두 번째 분기 질문"), "수동으로 고른 분기 질문으로 진행");
  await page.click("#endBtn"); await page.waitForSelector("#again");

  console.log("세션: 음성(가짜 마이크)");
  await goto("practice.html?set=snu-2021-B"); await setSettings({ tts: false, answerMode: "voice", waitEnabled: false, lastMode: "endless" }); await goto("practice.html?set=snu-2021-B");
  check(await page.$("#step2.active"), "?set= 진입 시 2단계부터");
  await page.click('[data-mode="endless"]'); await sleep(200);
  await page.click("#startBtn"); await sleep(800);
  await page.click("#toNext"); await sleep(600);
  await page.click("#recStart"); await sleep(1200);
  check(await page.$("#recStop"), "녹음 중");
  await page.click("#recStop"); await sleep(600);
  check(await page.$(".chip.ok"), "녹음 저장 칩");
  await page.click("#nextBtn"); await sleep(300);
  await page.click("#endBtn"); await sleep(800);
  check((await page.$$("#sessionRecs .recitem")).length === 1, "종료 화면 녹음 1개");

  console.log("기출DB");
  await setSettings({ variant: "kim" }); await goto("db.html#snu-2023-A");
  const selectedBeforeSort = await page.evaluate(() => ({ hash: location.hash, id: document.querySelector('.dbside [data-set][aria-pressed="true"]').dataset.set }));
  const dbOrder = () => page.$$eval(".dbside [data-set]", rows => rows.map(row => row.dataset.set));
  const newest = await dbOrder();
  await page.click("#sortSets");
  const oldestExpected = await page.evaluate(() => [...SNU.db.school("snu").sets].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)).map(s => s.id));
  check(JSON.stringify(await dbOrder()) === JSON.stringify(oldestExpected), "기출 세트 과거순 정렬");
  check(await page.evaluate(before => location.hash === before.hash && document.querySelector('.dbside [data-set][aria-pressed="true"]').dataset.set === before.id, selectedBeforeSort), "정렬 시 현재 세트·해시 유지");
  await page.click("#toggleThemes");
  const topicsHidden = () => page.$$eval(".dbtheme", elements => elements.length > 0 && elements.every(el => getComputedStyle(el).filter.includes("blur(") && el.getAttribute("aria-hidden") === "true"));
  check(await topicsHidden() && await page.$('.sethead .dbtheme'), "목록·상세 주제 함께 가림");
  if (other) {
    await page.click(`.schooltabs [data-school="${other.id}"]`);
    check(await topicsHidden(), "학교 전환 시 주제 가림 유지");
  }
  await goto("db.html#snu-2023-A");
  check(await topicsHidden() && JSON.stringify(await dbOrder()) === JSON.stringify(oldestExpected), "새로고침 후 가림·정렬 설정 유지");
  await page.click("#sortSets");
  check(JSON.stringify(await dbOrder()) === JSON.stringify(newest), "최신순 정렬 복귀");
  await page.click("#toggleThemes");
  check(await page.$$eval(".dbtheme", elements => elements.every(el => getComputedStyle(el).filter === "none" && el.getAttribute("aria-hidden") === "false")), "주제 가림 해제");
  check(await page.$('[data-vseg] [data-v="kim"][aria-pressed="true"]'), "복기본 seg: 김종수 눌림");
  const hwangBtn = await page.$('[data-vseg] [data-v="hwang"]:not([disabled])');
  if (hwangBtn) {
    const before = await page.evaluate(() => document.querySelector(".papers").textContent);   // 첫 문단은 두 복기본이 같을 수 있다
    await hwangBtn.click(); await sleep(400);
    const after = await page.evaluate(() => document.querySelector(".papers").textContent);
    check(before !== after && await page.$('[data-vseg] [data-v="hwang"][aria-pressed="true"]'), "복기본 전환(황변) → 제시문 바뀜");
    check(await page.$('[data-toggle^="hwang/"]'), "황변 복기본 문답 키 접두사 hwang/");
    await page.click('[data-vseg] [data-v="kim"]'); await sleep(400);
  } else console.log("  --   황변 복기본 없음(건너뜀)");
  await page.click('[data-toggle="A-3"]'); await sleep(200);
  await page.type("#ta-A-3", "테스트 답변");
  await setEffort("#db-effort", 3);
  check(await page.$eval("#ta-A-3", input => input.value === "테스트 답변"), "추론 강도 변경 시 작성 중 답변 유지");
  await page.click("#toggleThemes"); await page.click("#sortSets");
  check(await page.$eval("#ta-A-3", input => input.value === "테스트 답변"), "가림·정렬 변경 시 작성 중 답변 유지");
  await page.click('[data-keep="A-3"]'); await sleep(200);
  check((await page.$$(".msg.user")).length === 1, "기록만 남기기");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("snu-db-threads-v1") || "{}"));
  check(saved["snu-2023-A"] && saved["snu-2023-A"]["A-3"], "문답 localStorage 저장");
  await shot("db", 1280, 900, true);

  console.log("기출DB: 예시답변·제시문 해설");
  await setSettings({ variant: "kim", provider: "anthropic", explanationProvider: "openai", explanationOpenaiModel: "gpt-6.1-terra", explanationOpenaiEffort: "max" });
  await fresh("db.html#snu-2023-A");
  check(await page.$eval("#dbExplanationAi .modelsel select", el => el.value === "gpt-6.1-terra") && (await effortState("#db-explanation-effort")).value === "5", "해설 모델 바는 별도 해설 기본값 표시");
  /* 생성 응답만 지연 mock으로 바꾸고 실제 UI·역할별 설정·캐시·경합 처리를 확인한다. */
  await page.evaluate(() => {
    const mock = window.__studyMock = { exampleCalls: [], passageCalls: [], pending: [], source: JSON.stringify(INTERVIEW_DB), threads: localStorage.getItem("snu-db-threads-v1") };
    const resolve = AIClient.resolve;
    AIClient.resolve = override => Object.assign({}, resolve(override), { configured: true });
    AIClient.exampleAnswers = (cs, question, ai) => {
      mock.exampleCalls.push({ id: cs.id, variant: cs.variant, question, ai });
      return new Promise(done => mock.pending.push(() => done({ examples: [
        { label: "회귀검증 기준 중심", answer: "구체적인 피해를 <b>판단 기준</b>으로 삼겠습니다.", importance: "판단 기준의 중요성", cautions: "제시문 근거 확인" },
        { label: "회귀검증 반론 중심", answer: "실질적인 선택 가능성을 먼저 검토하겠습니다.", importance: "반론의 중요성", cautions: "적용 한계 확인" }
      ] })));
    };
    AIClient.explainPassages = (cs, books, ai) => {
      mock.passageCalls.push({ id: cs.id, variant: cs.variant, books, ai });
      return new Promise(done => { mock.finishPassages = () => done({
        overview: "회귀검증 해설 개관", passages: cs.passages.map(p => ({ no: p.no, summary: "제시문 요약", intent: "의도에 관한 해석", keyPoints: ["논증 구조"], notes: "주석의 근거 확인" })),
        questionStrategy: ["판단 기준과 근거 연결"], sourceNotes: "복기 원문에 기초한 해석", books: books.length ? [{ id: books[0].id, reason: "관련 논증 연습" }] : []
      }); });
    };
  });
  check(await page.$eval('[data-example="A-3"]', el => el.tagName === "BUTTON" && !el.closest("button button")), "예시답변은 질문 펼침과 독립된 버튼");
  await page.click('[data-toggle="A-3"]'); await page.type("#ta-A-3", "작성 중인 답변");
  await page.$eval('[data-example="A-3"]', el => { el.click(); el.click(); });
  await page.waitForFunction(() => __studyMock.exampleCalls.length === 1);
  check(await page.evaluate(() => __studyMock.exampleCalls.length === 1), "예시답변 중복 클릭 시 생성 1회");
  check(await page.$eval("#ta-A-3", el => el.value === "작성 중인 답변"), "예시답변 생성 중 작성 내용 유지");
  check(await page.$eval("#examples-A-3", el => el.getAttribute("aria-busy") === "true"), "예시답변 생성 상태 표시");
  check(await page.evaluate(() => { const ai = __studyMock.exampleCalls[0].ai; return ai.provider === "openai" && ai.model === "gpt-6.1-terra" && ai.effort === "max"; }), "예시답변은 별도 해설 모델·추론 강도 사용");
  await page.evaluate(() => __studyMock.pending[0]());
  await page.waitForSelector("#examples-A-3 .study-example", { visible: true });
  check((await page.$$("#examples-A-3 .study-example")).length === 2 && (await page.$$("#examples-A-3 .study-importance")).length === 2 && (await page.$$("#examples-A-3 .study-cautions")).length === 2, "예시답변 2종과 각각의 중요성·유의점 표시");
  check(await page.$eval("#examples-A-3 .study-answer", el => el.textContent.includes("<b>") && !el.querySelector("b")), "AI 답변을 HTML로 실행하지 않고 텍스트로 표시");
  check(await page.$eval("#ta-A-3", el => el.value === "작성 중인 답변"), "생성 결과 표시 후 작성 내용 유지");
  await page.click('[data-example="A-3"]'); await page.click('[data-example="A-3"]');
  check(await page.evaluate(() => __studyMock.exampleCalls.length === 1), "예시답변 다시 열 때 캐시 사용");
  const interviewerModel = await page.$eval("#dbInterviewerAi .modelsel select", el => el.value);
  const interviewerEffort = await effortState("#db-effort");
  await page.select("#dbExplanationAi .modelsel select", "gpt-6-astra");
  await setEffort("#db-explanation-effort", 2);
  check(await page.$eval("#dbInterviewerAi .modelsel select", (el, model) => el.value === model, interviewerModel) && (await effortState("#db-effort")).value === interviewerEffort.value, "해설 모델·강도 변경은 면접관 바와 독립");
  check(await page.$eval("#ta-A-3", el => el.value === "작성 중인 답변") && await page.evaluate(() => __studyMock.exampleCalls.length === 1), "해설 모델 변경 시 작성 내용·기존 결과 유지, 자동 호출 없음");
  await clickVisible('[data-example-refresh="A-3"]');
  await page.waitForFunction(() => __studyMock.exampleCalls.length === 2);
  check(await page.evaluate(() => { const ai = __studyMock.exampleCalls[1].ai; return ai.provider === "openai" && ai.model === "gpt-6-astra" && ai.effort === "high" && SNU.settings.explanationOpenaiModel === "gpt-6.1-terra" && SNU.settings.explanationOpenaiEffort === "max"; }), "예시답변 재생성은 화면 모델·강도 적용, 기본 설정 유지");
  check(await page.$$eval("#examples-A-3 details.run", d => d.length === 1) && await page.$("#examples-A-3 .study-status"), "다시 생성 중 이전 결과 유지");
  await page.evaluate(() => __studyMock.pending[1]());
  await page.waitForFunction(() => document.querySelectorAll("#examples-A-3 details.run").length === 2);
  check(await page.$$eval("#examples-A-3 details.run", d => d[0].open && !d[1].open && d[0].querySelector("summary b").textContent === "2차" && d[1].querySelector("summary b").textContent === "1차"), "예시답변 누적: 2차 펼침·1차 접힘");
  await page.$eval("#examples-A-3 details.run:not([open]) summary", s => s.click());
  check(await page.$$eval("#examples-A-3 details.run[open]", d => d.length === 2), "이전 결과를 함께 펼쳐 비교");
  await clickVisible('#q-A-3 [data-toggle="A-3"]'); await clickVisible('#q-A-3 [data-toggle="A-3"]');
  check(await page.$$eval("#examples-A-3 details.run[open]", d => d.length === 2), "질문 행을 다시 그려도 펼침 상태 유지");
  await clickVisible("#examples-A-3 .runs > details:last-of-type [data-run-del]");
  check(await page.$$eval("#examples-A-3 details.run", d => d.length === 1) && await page.evaluate(() => JSON.parse(localStorage.getItem("snu-db-study-v1")).entries[JSON.stringify(["snu-2023-A", "kim"])].examples["A-3"].length === 1), "결과 하나 삭제(저장소 반영)");
  await clickVisible("#explainPassages");
  await page.waitForFunction(() => __studyMock.passageCalls.length === 1);
  check(await page.evaluate(() => __studyMock.passageCalls.length === 1 && __studyMock.passageCalls[0].books.length > 0), "제시문 해설에 서가 후보 도서 포함");
  check(await page.evaluate(() => { const ai = __studyMock.passageCalls[0].ai; return ai.provider === "openai" && ai.model === "gpt-6-astra" && ai.effort === "high"; }), "제시문 해설도 같은 해설 모델 바 적용");
  await page.evaluate(() => __studyMock.finishPassages());
  await page.waitForFunction(() => document.querySelector("#passageExplanation").textContent.includes("회귀검증 해설 개관"));
  check(await page.$('#passageExplanation a[href^="library.html#"]'), "해설 추천 도서는 서가 내부 링크");
  await clickVisible("#explainPassages"); await clickVisible("#explainPassages");
  check(await page.evaluate(() => __studyMock.passageCalls.length === 1), "제시문 해설 다시 열 때 캐시 사용");
  await clickVisible('[data-explanationseg] [data-v="anthropic"]');
  check(await page.$eval("#dbExplanationAi .modelsel select", el => el.value === SNU.settings.explanationAnthropicModel), "해설 제공사 전환 시 해당 제공사의 해설 기본 모델 사용");
  await page.select("#dbExplanationAi .modelsel select", "claude-opus-5-5");
  await setEffort("#db-explanation-effort", 4);
  await clickVisible("#refreshPassages");
  await page.waitForFunction(() => __studyMock.passageCalls.length === 2);
  check(await page.evaluate(() => { const ai = __studyMock.passageCalls[1].ai; return ai.provider === "anthropic" && ai.model === "claude-opus-5-5" && ai.effort === "max"; }), "제시문 해설 재생성은 변경한 제공사·모델·강도 적용");
  await page.evaluate(() => __studyMock.finishPassages());
  await page.waitForFunction(() => document.querySelectorAll("#passageExplanation details.run").length === 2);
  check(await page.$$eval("#passageExplanation details.run", d => d[0].open && !d[1].open) && await page.$('#passageExplanation details.run[open] a[href^="library.html#"]'), "제시문 해설 누적: 최신 펼침, 서가 링크 유지");
  check(await page.evaluate(() => JSON.stringify(INTERVIEW_DB) === __studyMock.source && localStorage.getItem("snu-db-threads-v1") === __studyMock.threads), "예시답변·해설은 기출 원문과 내 문답 기록에 섞이지 않음");

  await page.click('[data-example="A-2"]');
  await page.waitForFunction(() => __studyMock.exampleCalls.length === 3);
  await page.click('.dbside [data-set="snu-2021-A"]');
  await page.evaluate(async () => { __studyMock.pending[2](); await new Promise(done => setTimeout(done, 0)); });
  check(!(await page.$(".study-example")), "세트 이동 뒤 도착한 응답을 현재 세트에 표시하지 않음");
  await page.click('.dbside [data-set="snu-2023-A"]');
  if (await page.$('[data-vseg] [data-v="hwang"]:not([disabled])')) {
    await page.click('[data-example="A-1"]');
    await page.waitForFunction(() => __studyMock.exampleCalls.length === 4);
    await page.click('[data-vseg] [data-v="hwang"]');
    await page.evaluate(async () => { __studyMock.pending[3](); await new Promise(done => setTimeout(done, 0)); });
    check(!(await page.$(".study-example")), "복기본 전환 뒤 도착한 응답을 다른 복기본에 표시하지 않음");
    await page.click('[data-vseg] [data-v="kim"]');
    await page.waitForSelector("#examples-A-1 .study-example", { visible: true });
    check(await page.evaluate(() => __studyMock.exampleCalls.length === 4), "원래 복기본의 늦은 응답을 재호출 없이 표시");
  }

  console.log("기출DB: 면접관 응답 중 세트 이동");
  await page.evaluate(() => {
    __studyMock.interviewerCalls = [];
    AIClient.respond = (cs, question, thread, ai) => {
      __studyMock.interviewerCalls.push({ id: cs.id, variant: cs.variant, question, thread, ai });
      return new Promise(done => { __studyMock.finishInterview = () => done({ feedback: "회귀검증 면접관 피드백", followup: "회귀검증 꼬리질문" }); });
    };
  });
  await page.click('[data-toggle="A-3"]'); await page.type("#ta-A-3", "면접관 경합 검증 답변");
  await page.click('[data-send="A-3"]'); await page.waitForFunction(() => __studyMock.interviewerCalls.length === 1);
  await page.click('.dbside [data-set="snu-2021-A"]');
  check(await page.evaluate(() => location.hash === "#snu-2021-A" && document.querySelector(".sethead .eyebrow").textContent.includes("2021학년도") && document.querySelector('.dbside [data-set="snu-2021-A"]').getAttribute("aria-pressed") === "true"), "면접관 대기 중 세트 선택과 상세 화면 즉시 일치");
  const newSetQuestionKey = await page.evaluate(() => (document.querySelector('.dbmain [data-toggle="A-3"]') || document.querySelector(".dbmain [data-toggle]")).dataset.toggle);
  await page.evaluate(key => document.getElementById("q-" + key).querySelector("[data-toggle]").click(), newSetQuestionKey);
  await page.type(".thread textarea", "새 세트 작성 중인 답변");
  check(await page.evaluate(key => !document.getElementById("q-" + key).querySelector("[data-send]").disabled, newSetQuestionKey), "다른 세트의 같은 질문 키에 면접관 대기 상태가 전파되지 않음");
  const newSetQuestion = await page.evaluate(key => document.getElementById("q-" + key).querySelector(".qtxt").textContent, newSetQuestionKey);
  const priorExampleCalls = await page.evaluate(() => __studyMock.exampleCalls.length);
  await page.evaluate(key => document.getElementById("q-" + key).querySelector("[data-example]").click(), newSetQuestionKey);
  await page.waitForFunction(n => __studyMock.exampleCalls.length === n + 1, {}, priorExampleCalls);
  check(await page.evaluate(question => { const call = __studyMock.exampleCalls[__studyMock.exampleCalls.length - 1]; return call.id === "snu-2021-A" && call.variant === "kim" && call.question === question; }, newSetQuestion), "새 세트 예시답변 요청과 화면의 제시문·질문 일치");
  await page.evaluate(() => __studyMock.pending[__studyMock.pending.length - 1]());
  await page.waitForSelector(".study-example", { visible: true });
  await page.evaluate(async () => {
    __studyMock.newView = document.querySelector(".dbmain").textContent;
    __studyMock.finishInterview(); await new Promise(done => setTimeout(done, 0));
  });
  check(await page.evaluate(() => location.hash === "#snu-2021-A" && document.querySelector(".dbmain").textContent === __studyMock.newView && document.querySelector(".thread textarea").value === "새 세트 작성 중인 답변"), "이전 면접관 응답이 현재 화면·초안을 바꾸지 않음");
  await page.click('.dbside [data-set="snu-2023-A"]'); await page.click('[data-toggle="A-3"]');
  check(await page.$eval("#q-A-3", el => el.textContent.includes("면접관 경합 검증 답변") && el.textContent.includes("회귀검증 면접관 피드백") && el.textContent.includes("회귀검증 꼬리질문")), "원래 세트 복귀 시 면접관 문답 표시");
  check(await page.evaluate(key => {
    const records = JSON.parse(localStorage.getItem("snu-db-threads-v1"));
    const origin = records["snu-2023-A"]["A-3"];
    return origin[origin.length - 2].text === "면접관 경합 검증 답변" && origin[origin.length - 1].text === "회귀검증 면접관 피드백" && !(records["snu-2021-A"] || {})[key];
  }, newSetQuestionKey), "면접관 결과는 요청한 세트·질문에만 저장");

  await fresh("db.html#snu-2023-A");
  await page.evaluate(() => {
    window.__cachedStudyCalls = 0;
    AIClient.exampleAnswers = async () => { window.__cachedStudyCalls++; throw new Error("캐시 재호출 오류"); };
  });
  await clickVisible('[data-example="A-3"]'); await page.waitForSelector("#examples-A-3 .study-example", { visible: true });
  check(await page.evaluate(() => __cachedStudyCalls === 0 && !AIClient.resolve().configured), "새로고침 후 API 키 없이 저장된 예시답변 열람");
  if (await page.evaluate(() => !!window.SNU.db.set("snu-2019-C"))) {
    await goto("db.html#snu-2019-C");
    check(await page.$('[data-vseg] [data-v="merged"][disabled]') && await page.$('[data-vseg] [data-v="hwang"][disabled]') && await page.$('[data-vseg] [data-v="kim"][aria-pressed="true"]'), "2019-C: 통합·황변 비활성, 김종수 눌림");
    check(await page.evaluate(() => document.querySelector(".paper .ptitle").textContent.includes("(가)")), "2019-C: 제시문 머리에 (가) 표기");
  }

  console.log("문제지 문항(tasks)");
  /* 문항만 있고 추가질문이 없는 세트를 먼저 고른다(없으면 문항이 있는 아무 세트) */
  const tk = await page.evaluate(() => { const all = window.SNU.db.schools().flatMap(s => s.sets); const s = all.find(x => (x.tasks || []).length && !x.followups.length) || all.find(x => (x.tasks || []).length); return s && { id: s.id, n: s.tasks.length }; });
  if (tk) {
    await goto("db.html#" + tk.id);
    check((await page.$$(".instr .tasks li")).length === tk.n, `${tk.id}: 지시문 상자에 문항 ${tk.n}개`);
    check(await page.$('[data-toggle$="task-1"]'), `${tk.id}: 기출DB "문제" 묶음`);
    await goto("practice.html?set=" + tk.id); await setSettings({ tts: false, answerMode: "text", waitEnabled: false, lastMode: "all" }); await goto("practice.html?set=" + tk.id);
    await page.click('[data-mode="all"]'); await sleep(200);
    await page.click("#startBtn"); await sleep(500);
    check((await page.$$(".instr .tasks li")).length === tk.n, `${tk.id}: 준비 화면 문항 ${tk.n}개`);
    await page.click("#toNext"); await sleep(500);
    const q1 = await page.evaluate(() => (document.querySelector(".qtext") || {}).textContent || "");
    check(q1.startsWith("문제"), `${tk.id}: '복기 질문 전부' 첫 질문이 문항 (${q1.slice(0, 20)}…)`);
    await page.click("#endBtn"); await sleep(600);
    check(await page.$("#again"), `${tk.id}: 종료 화면`);
  } else console.log("  --   문항 있는 세트 없음(건너뜀)");

  console.log("서가");
  await goto("library.html#books");
  check((await page.$$(".book")).length > 50, "도서 목록");
  await goto("library.html#b16"); await sleep(400);
  check(await page.$(".bdrawer"), "책 상세 서랍");

  console.log("설정 서랍·테마");
  await goto("index.html");
  await page.click("#openSettings"); await sleep(300);
  check((await page.$$("[data-savekey]")).length === 2 && (await page.$$('[data-ai-role="interviewer"] .modelsel')).length === 2 && (await page.$$('[data-ai-role="explanation"] .modelsel')).length === 2, "공용 API 키 + 면접관·해설 모델 설정 분리");
  await setEffort("#settings-anthropic-effort", 0);
  await setEffort("#settings-openai-effort", 4);
  check(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("snu-iv-settings-v1")); return s.anthropicEffort === "low" && s.openaiEffort === "max"; }), "제공사별 추론 강도 저장");
  await goto("index.html"); await page.click("#openSettings");
  check((await effortState("#settings-anthropic-effort")).value === "0" && (await effortState("#settings-openai-effort")).value === "4", "새로고침 후 추론 강도 복원");
  const interviewerSettings = await page.evaluate(() => [SNU.settings.provider, SNU.settings.anthropicModel, SNU.settings.openaiModel, SNU.settings.anthropicEffort, SNU.settings.openaiEffort]);
  await page.click('[data-ai-role="explanation"] [data-seg="explanationProvider"] [data-v="openai"]');
  await page.select('[data-ai-role="explanation"] .modelsel[data-provider="openai"] select', "gpt-6.1-terra");
  await setEffort("#settings-explanation-openai-effort", 5);
  await page.select('[data-ai-role="explanation"] .modelsel[data-provider="anthropic"] select', "claude-opus-5-5");
  await setEffort("#settings-explanation-anthropic-effort", 2);
  check(await page.evaluate(before => JSON.stringify(before) === JSON.stringify([SNU.settings.provider, SNU.settings.anthropicModel, SNU.settings.openaiModel, SNU.settings.anthropicEffort, SNU.settings.openaiEffort]), interviewerSettings), "해설 설정 변경 시 면접관 설정 유지");
  await goto("index.html"); await page.click("#openSettings");
  check(await page.evaluate(() => SNU.settings.explanationProvider === "openai" && SNU.settings.explanationOpenaiModel === "gpt-6.1-terra" && SNU.settings.explanationOpenaiEffort === "max" && SNU.settings.explanationAnthropicModel === "claude-opus-5-5" && SNU.settings.explanationAnthropicEffort === "high"), "별도 해설 모델·추론 강도 저장 및 복원");
  check((await effortState("#settings-anthropic-effort")).value === "0" && (await effortState("#settings-explanation-anthropic-effort")).value === "2", "면접관·해설 슬라이더 각각 복원");
  await page.click('[data-seg="theme"] [data-v="dark"]'); await page.click('[data-seg="bluelight"] [data-v="mid"]'); await sleep(200);
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "다크 테마 적용");
  await shot("settings-dark", 1280, 900);
  await page.click("#closeSettings");
  await setSettings({});

  console.log("모바일 가로 넘침");
  await page.setViewport({ width: 400, height: 820 });
  for (const p of ["index.html", "practice.html", "db.html", "library.html#issues"].concat(tk ? ["db.html#" + tk.id] : [])) { await goto(p); check(await noOverflow(), p); }
  const appbar = await page.evaluate(() => { const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; }, nav = document.querySelector(".nav"); return { row: Math.abs(mid(document.querySelector(".brand")) - mid(document.querySelector("#openRecords"))) < 12 && Math.abs(mid(document.querySelector("#openRecords")) - mid(document.querySelector("#openSettings"))) < 2, below: nav.getBoundingClientRect().top >= document.querySelector("#openRecords").getBoundingClientRect().bottom - 1, fits: nav.scrollWidth <= nav.clientWidth }; });
  check(appbar.row && appbar.below && appbar.fits, "모바일 앱바: 브랜드·기록·설정 한 줄, 메뉴는 다음 줄에 넘침 없이");
  await goto("practice.html?set=snu-2021-A"); await setSettings({ tts: false, answerMode: "text", lastMode: "all" }); await goto("practice.html?set=snu-2021-A");
  await page.click('[data-mode="all"]'); await sleep(200); await page.click("#startBtn"); await sleep(500);
  check(await noOverflow(), "세션 화면(모바일)");
  await shot("session-mobile", 400, 820);
  await goto("index.html"); await page.click("#openRecords"); await page.waitForSelector("#recordsDrawer [data-rec]");
  check(await noOverflow() && await drawerFits(), "기록 서랍 목록(모바일)");
  await page.click("#recordsDrawer [data-rec]"); await page.waitForSelector("#recordsDrawer .sethead");
  check(await noOverflow() && await drawerFits(), "기록 서랍 상세(모바일)");
  await shot("records-mobile", 400, 820);
  await page.click("#rClose");

  console.log("새 컨트롤: 밝음·어둠·아주 크게");
  for (const width of [1280, 400]) {
    await page.setViewport({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await setSettings({ theme, fontScale: "xl", tts: false, answerMode: "text", provider: "openai", openaiModel: "gpt-6.1-terra", openaiEffort: "max", dbHideThemes: true });
      await goto("db.html#snu-2023-A");
      check(await noOverflow(), `기출DB ${width}px ${theme} 아주 크게`);
      const inset = await page.$eval(".qhead", el => el.querySelector(".qidx").getBoundingClientRect().left - el.getBoundingClientRect().left);
      const expectedInset = width === 400 ? 12 : 13.5;
      check(Math.abs(inset - expectedInset) < 1, `질문 번호 왼쪽 여백 ${width}px (${inset}px, 기존의 75%)`);
      await page.$eval(".aibar", el => el.scrollIntoView({ block: "start" }));
      await shot(`db-controls-${width}-${theme}-xl`, width, 900);
      await page.click("#openRecords"); await page.waitForSelector(`#recordsDrawer [data-rec="${savedSession.id}"]`);
      await page.click(`#recordsDrawer [data-rec="${savedSession.id}"]`); await page.waitForSelector("#recordsDrawer [data-fb-run]");
      const headButtons = await page.$$eval("#recordsDrawer .sethead .row .btn", b => b.map(x => Math.round(x.getBoundingClientRect().height)));
      check(await noOverflow() && await drawerFits() && headButtons.length === 3 && headButtons.every(h => h === headButtons[0]), `기록 서랍 ${width}px ${theme} 아주 크게 (버튼 ${headButtons.join(",")})`);
      await shot(`records-${width}-${theme}-xl`, width, 900);
      if (width === 1280 && theme === "light") {
        await page.click("#recordsDrawer [data-fb-settings]"); await page.waitForSelector("#dTitle");
        await page.keyboard.press("Escape");
        check(!(await page.$("#dTitle")) && await page.$("#recordsDrawer") && await page.evaluate(() => document.body.style.overflow === "hidden" && !!document.activeElement.closest("#recordsDrawer")), "기록 서랍 위 설정 서랍: Esc는 위 서랍만 닫고 초점은 기록 서랍에");
      }
      await page.click("#rClose");
      await page.click("#openSettings");
      check(await noOverflow(), `설정 서랍 ${width}px ${theme} 아주 크게`);
      await page.click("#closeSettings");
      await goto("practice.html?set=snu-2023-A");
      await page.click('[data-mode="timed"]');
      check(await noOverflow(), `모의면접 옵션 ${width}px ${theme} 아주 크게`);
    }
  }

  console.log("오류: " + (errors.length ? "\n" + errors.join("\n") : "없음"));
  if (errors.length) failures++;
  await browser.close();
  console.log(failures ? `실패 ${failures}` : "모두 통과");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
