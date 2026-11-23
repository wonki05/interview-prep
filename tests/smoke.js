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
  check(opts.join("/") === "Fable 5.2/Fable 5.1/Opus 5.5/Sonnet 5.5/Haiku 5.5/직접 입력…", "모델 목록 표시명(상위 모델이 위) " + opts.join("/"));
  await page.select("#step3 .modelsel select", "claude-fable-5-2");
  check((await effortState("#practice-effort")).max === "4", "Fable 5.2 추론 강도 5단계");
  await page.select("#step3 .modelsel select", "claude-sonnet-5-5");
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
  check(await page.$eval("#step3 .modelsel select", el => el.value === "gpt-6.2-astra") && (await effortState("#practice-effort")).max === "4", "GPT 기본 모델 = 최상위 GPT-6.2 Astra, 추론 강도 5단계");
  const gptOpts = await page.evaluate(() => Array.from(document.querySelectorAll("#step3 .modelsel select option")).map(o => o.textContent));
  check(gptOpts.join("/") === "GPT-6.2 Astra/GPT-6 Astra/GPT-6.2 Sol/GPT-6.1 Sol/GPT-6.1 Terra/GPT-6 Luna/직접 입력…", "GPT 모델 목록(상위 모델이 위) " + gptOpts.join("/"));
  await page.select("#step3 .modelsel select", "gpt-6.2-astra");
  check((await effortState("#practice-effort")).max === "4", "GPT-6.2 Astra 추론 강도 5단계");
  await page.select("#step3 .modelsel select", "gpt-6.2-sol");
  check((await effortState("#practice-effort")).max === "4", "GPT-6.2 Sol 추론 강도 5단계");
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

  console.log("고려대: 세트 시간표·기조발언 시간 제한");
  /* 전역 시간 설정을 기본값과 다르게 두고, 고려대 세트 시간표가 설정을 읽지도 쓰지도 않는지 본다. API 키 없음 → 시간만의 대체 경로 */
  const globalTime = { prepMinutes: 18, waitEnabled: true, waitMinutes: 4, interviewMinutes: 16 };
  const knSettings = Object.assign({ tts: false, answerMode: "text", variant: "kim", knock: false }, globalTime);
  const setNum = (sel, v) => page.$eval(sel, (el, value) => { el.value = String(value); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const tlState = () => page.evaluate(() => {
    const num = k => { const el = document.querySelector(`#step3 [data-tm="${k}"]`); return el ? (el.disabled ? "off:" : "") + el.value : null; };
    const sw = k => { const el = document.querySelector(`#step3 [data-tmbool="${k}"]`); return el ? el.checked : null; };
    return { prep: num("prep"), wait: num("wait"), interview: num("interview"), keynote: num("keynote"), waitOn: sw("waitOn"), on: sw("on"), cap: document.querySelector("#step3 .tl-cap").textContent, help: !!document.querySelector("#step3 .opt-group > .help") };
  });
  const sameGlobal = () => page.evaluate(g => { const stored = JSON.parse(localStorage.getItem("snu-iv-settings-v1")); return Object.keys(g).every(k => SNU.settings[k] === g[k] && stored[k] === g[k]); }, globalTime);
  const domClick = sel => page.$eval(sel, el => el.click());   // 붙박이 앱바에 가린 단계 머리도 누른다
  const toStep3 = async id => { await domClick('#step1 [data-goto="1"]'); await domClick(`[data-school="${id.split("-")[0]}"]`); await domClick(`[data-set="${id}"]`); await domClick('[data-mode="timed"]'); await page.waitForSelector("#startBtn"); };
  const latestRecord = () => page.evaluate(async () => { const list = await Records.listSessions(); const s = list[0] && await Records.getSession(list[0].id); return s && { plan: s.plan, history: s.history }; });
  await setSettings(knSettings); await fresh("practice.html?set=korea-2023-A");
  await page.click('[data-mode="timed"]'); await page.waitForSelector("#step3 [data-tm]");
  let tl = await tlState();
  check(tl.prep === "15" && tl.interview === "13" && tl.keynote === "7" && tl.wait === "off:5" && tl.waitOn === false && tl.on === true && tl.help, "고려대 2023 기본값: 준비 15·면접 13·기조발언 7, 대기 꺼짐, 제한 켜짐");
  check(tl.cap.includes("준비 15분 → 면접 13분(기조발언 7분)") && tl.cap.includes("고려대 2023 복기 15·13 · 기조발언 7") && !tl.cap.includes("기준"), "시간표 캡션 " + tl.cap);
  await setNum('#step3 [data-tm="prep"]', 12); await setNum('#step3 [data-tm="interview"]', 6);
  await domClick('#step3 [data-tmbool="waitOn"]');
  tl = await tlState();
  check(tl.prep === "12" && tl.wait === "5" && tl.waitOn && tl.keynote === "5" && tl.cap.includes("준비 12분 → 대기 5분 → 면접 6분(기조발언 5분)"), "시간 수정 반영, 기조발언은 면접 시간보다 작게 " + tl.cap);
  await setNum('#step3 [data-tm="interview"]', 13);
  await domClick('#step3 [data-seg="variant"] [data-v="hwang"]'); await page.waitForSelector('#step3 [data-seg="variant"] [data-v="hwang"][aria-pressed="true"]');
  tl = await tlState();
  check(tl.prep === "12" && tl.waitOn && tl.interview === "13" && tl.keynote === "7" && await sameGlobal(), "고친 값은 세션에만(복기본을 바꿔도 유지, 전역 설정 그대로)");
  await domClick('#step3 [data-seg="variant"] [data-v="kim"]');
  await toStep3("korea-2024-A");
  tl = await tlState();
  check(tl.prep === "15" && tl.interview === "12" && tl.keynote === "6" && tl.waitOn === false && tl.on === true && tl.cap.includes("고려대 2024 복기 15·12 · 기조발언 6(2025 기준)"), "다른 세트(2024)는 그 세트 기본값 " + tl.cap);
  await toStep3("korea-2023-A");
  check((await tlState()).prep === "15", "세트를 다시 고르면 기본값으로");
  await toStep3("snu-2023-A");
  const snuTime = await page.evaluate(() => ({ kn: !!document.querySelector("#step3 [data-tm], #step3 [data-tmbool]"), prep: document.querySelector('#step3 [data-num="prepMinutes"]').value, wait: document.querySelector('#step3 [data-num="waitMinutes"]').value, interview: document.querySelector('#step3 [data-num="interviewMinutes"]').value, cap: document.querySelector("#step3 .tl-cap").textContent }));
  check(!snuTime.kn && snuTime.prep === "18" && snuTime.wait === "4" && snuTime.interview === "16" && !snuTime.cap.includes("기조발언") && await sameGlobal(), "서울대: 기조발언 스위치 없음, 설정 시간 그대로");
  const tasked = await page.evaluate(() => (SNU.db.sets().find(s => s.school !== "korea" && (s.tasks || []).length) || {}).id);
  if (tasked) {
    await toStep3(tasked);
    tl = await tlState();
    check(tl.on === false && tl.keynote === "off:8" && !tl.prep && !tl.help, `${tasked}: 문항 있는 다른 학교는 스위치 꺼짐(설정 시간표)`);
    await domClick('#step3 [data-tmbool="on"]');
    tl = await tlState();
    check(tl.on && tl.keynote === "8" && tl.help && tl.cap.includes("면접 16분(기조발언 8분)") && await sameGlobal(), `${tasked}: 켜면 면접 시간의 절반`);
  }

  console.log("고려대: 기조발언 세션(텍스트, 키 없음)");
  await fresh("practice.html?set=korea-2023-A");
  await page.click('[data-mode="timed"]'); await page.waitForSelector("#pv");
  await page.click("#pv summary");
  const pvk = await page.$eval("#pv", el => el.textContent);
  check(pvk.includes("기조발언 뒤 첫 질문") && pvk.includes("Q1: 문제에 대한 답변을 시작하십시오.\nA1: (기조발언 답변이 여기에 들어간다)\n(기조발언 제한 7분)") && pvk.includes("남은 시간 6분 0초") && pvk.includes("7분 안팎의 기조발언"), "AI 입력 미리 보기: 기조발언 문답·남은 시간");
  await shot("korea-step3", 1280, 900, true);
  await page.click("#startBtn"); await page.waitForSelector("#toNext");
  check(await page.$eval("#toNext", b => b.textContent.includes("→ 면접")), "대기 없음: 준비 마침 → 면접");
  await page.click("#toNext"); await page.waitForSelector("#knClock");
  const kq = await page.evaluate(() => ({ q: document.querySelector("#qcard .qtext").textContent, meta: document.querySelector("#qcard .qmeta").textContent, clock: document.querySelector("#knClock").textContent, warn: document.querySelector("#knClock").classList.contains("warn"), tasks: document.querySelectorAll(".instr .tasks li").length }));
  check(kq.q === "문제에 대한 답변을 시작하십시오." && kq.meta.includes("질문 1 · 기조발언") && /^기조발언 0:0\d \/ 7:00$/.test(kq.clock) && !kq.warn && kq.tasks === 2, "첫 질문은 기조발언 요청(문항은 지시문 상자) " + kq.clock);
  await shot("korea-keynote", 1280, 900);
  const knAnswer = "문제 1에는 수명 연장이 불평등을 키운다고 답하겠습니다.";
  await page.type("#answerText", knAnswer);
  /* 페이지 안의 시각만 앞당기고 난수를 고정한다(30 → 1차 25%는 계속, 2차 50%에서 끊음) */
  await page.evaluate(() => { const real = Date.now.bind(Date); window.__warp = 0; Date.now = () => real() + window.__warp; Math.random = () => 0.3; });
  await page.evaluate(() => { window.__warp = (7 * 60 + 31) * 1000; }); await sleep(700);
  const k1 = await page.evaluate(() => ({ q: document.querySelector("#qcard .qtext").textContent, warn: document.querySelector("#knClock").classList.contains("warn"), clock: document.querySelector("#knClock").textContent }));
  check(k1.q === "문제에 대한 답변을 시작하십시오." && k1.warn && k1.clock.startsWith("기조발언 7:3"), "제한 + 30초 1차 판정(25%): 계속, 경고 색 " + k1.clock);
  await page.evaluate(() => { window.__warp = (8 * 60 + 2) * 1000; }); await page.waitForFunction(() => !document.querySelector("#knClock"), { timeout: 5000 });
  const k2 = await page.evaluate(() => ({ q: document.querySelector("#qcard .qtext").textContent, note: (document.querySelector("#qcard .callout.warn") || {}).textContent || "", expected: AIClient.bank(SNU.db.set("korea-2023-A", "kim"))[0].q, log: document.querySelector("#qlog").textContent }));
  check(k2.q === k2.expected && /^기조발언 8:0\d — 면접관이 끊음$/.test(k2.note) && k2.log.includes("끊김"), "2차 판정(50%)에서 끊고 다음 질문(문제지 문항 건너뜀) " + k2.note);
  await shot("korea-keynote-cut", 1280, 900);
  await sleep(300);
  let kr = await latestRecord();
  check(kr && kr.plan.keynote === 7 && kr.history.length === 1 && kr.history[0].group === "기조발언" && kr.history[0].cut === true && kr.history[0].elapsed >= 480 && kr.history[0].a === knAnswer, "기록: plan.keynote·끊김·경과 초 " + JSON.stringify(kr && kr.history[0]).slice(0, 120));
  await page.type("#answerText", "제시문 2에 공감합니다.");
  await page.click("#nextBtn"); await sleep(200);
  check(!(await page.$("#qcard .callout.warn")), "끊김 알림은 다음 질문 카드에만");
  await page.click("#endBtn"); await page.waitForSelector("#again");
  check(await page.$eval(".qlist", el => el.textContent.includes("8:0") && el.textContent.includes("끊김")), "종료 화면 문답에 경과·끊김 표시");
  await page.waitForSelector("#openRecord:not([disabled])"); await page.click("#openRecord"); await page.waitForSelector("#recordsDrawer [data-fb-prompt]");
  const drawerKn = await page.evaluate(() => ({ qa: document.querySelector("#recordsDrawer .qlist").textContent, prompt: document.querySelector("#recordsDrawer [data-fb-prompt] pre").textContent }));
  check(drawerKn.qa.includes("끊김") && drawerKn.prompt.includes("면접 13분(기조발언 7분)") && drawerKn.prompt.includes("(기조발언 제한 7분, 실제 8분") && drawerKn.prompt.includes("면접관이 끊음)") && drawerKn.prompt.includes("시간 배분"), "기록 서랍: 끊김 표시, 피드백 입력에 기조발언 주석");
  await page.click("#rClose");

  await fresh("practice.html?set=korea-2019-A");
  await page.click('[data-mode="timed"]'); await page.waitForSelector("#startBtn");
  check((await tlState()).keynote === "5", "2019: 기조발언 5(책의 '5분 이상')");
  await page.click("#startBtn"); await page.waitForSelector("#toNext"); await page.click("#toNext"); await page.waitForSelector("#knClock");
  await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + (5 * 60 + 31) * 1000; Math.random = () => 0; });
  await page.waitForSelector("#again", { timeout: 5000 });
  kr = await latestRecord();
  check(kr && kr.history.length === 1 && kr.history[0].cut === true, "추가질문 복기가 없는 세트(2019)는 끊긴 뒤 면접 종료");

  await fresh("practice.html?set=korea-2023-A");
  await page.click('[data-mode="timed"]'); await page.waitForSelector('#step3 [data-tmbool="on"]');
  await domClick('#step3 [data-tmbool="on"]');
  tl = await tlState();
  check(tl.on === false && tl.keynote === "off:7" && !tl.help && tl.cap.startsWith("준비 15분 → 면접 13분고려대"), "제한 끄기: 분 입력 비활성·도움말·캡션 없음");
  await page.click("#pv summary");
  check(await page.$eval("#pv", el => el.textContent.includes("(아직 질문하지 않았다. 첫 질문은 문제지 문항에 대한 답변(기조 발언)을 요청한다.)") && !el.textContent.includes("기조발언 제한")), "제한 끄면 미리 보기는 기존 입력");
  await page.click("#startBtn"); await page.waitForSelector("#toNext"); await page.click("#toNext"); await page.waitForSelector("#qcard .qtext");
  check(await page.evaluate(() => document.querySelector("#qcard .qtext").textContent.startsWith("문제 1.") && !document.querySelector("#knClock")), "제한 끄면 기존 흐름: 첫 질문은 문제지 문항");
  await page.type("#answerText", "문항 답변"); await page.click("#nextBtn"); await sleep(400);
  kr = await latestRecord();
  check(kr && !("keynote" in kr.plan) && !("elapsed" in kr.history[0]) && !("cut" in kr.history[0]), "제한 끄면 기록에 기조발언 필드 없음");
  await page.click("#endBtn"); await page.waitForSelector("#again");

  console.log("고려대: 기조발언 판정(모의 AI 응답, 키 저장·외부 호출 없음)");
  const mockKeynoteAi = () => page.evaluate(() => {
    const mock = window.__knMock = { checks: [], pending: [], next: [] };
    const resolve = AIClient.resolve;
    AIClient.resolve = override => Object.assign({}, resolve(override), { configured: true });
    AIClient.keynoteCheck = (cs, answer, timing) => { mock.checks.push({ id: cs.id, answer, timing }); return new Promise(done => mock.pending.push(done)); };
    AIClient.nextQuestion = async (cs, history, difficulty, variation, ai, plan) => { mock.next.push({ first: Object.assign({}, history[0], { rec: undefined }), plan: Object.assign({}, plan) }); return { question: "모의 추가질문입니다.", focus: "1", why: "검증" }; };
    const real = Date.now.bind(Date); window.__warp = 0; Date.now = () => real() + window.__warp;
  });
  const startKeynote = async () => { await fresh("practice.html?set=korea-2023-A"); await mockKeynoteAi(); await page.click('[data-mode="timed"]'); await page.click("#startBtn"); await page.waitForSelector("#toNext"); await page.click("#toNext"); await page.waitForSelector("#knClock"); await page.type("#answerText", knAnswer); };
  await startKeynote();
  await page.evaluate(() => { window.__warp = (7 * 60 + 31) * 1000; }); await page.waitForFunction(() => __knMock.checks.length === 1);
  await page.click("#nextBtn"); await page.waitForFunction(() => __knMock.next.length === 1);
  await page.evaluate(async () => { __knMock.pending[0]({ cut: 100, reason: "반복", remark: "여기까지 듣겠습니다." }); await new Promise(done => setTimeout(done, 300)); });
  check(await page.evaluate(() => document.querySelector("#qcard .qtext").textContent === "모의 추가질문입니다." && !document.querySelector("#qcard .callout.warn") && !__knMock.next[0].first.cut && __knMock.next[0].first.elapsed >= 450), "답변을 끝낸 뒤 도착한 판정은 버림");
  await page.click("#endBtn"); await page.waitForSelector("#again");
  await startKeynote();
  await page.evaluate(() => { window.__warp = (7 * 60 + 31) * 1000; }); await page.waitForFunction(() => __knMock.checks.length === 1);
  const firstCheck = await page.evaluate(() => __knMock.checks[0]);
  check(firstCheck.id === "korea-2023-A" && firstCheck.answer === knAnswer && firstCheck.timing.limit === 7 && firstCheck.timing.round === 1 && firstCheck.timing.elapsed >= 450, "제한 + 30초: AI 판정에 답변 글·제한·경과·차수 전달");
  await page.evaluate(() => { window.__warp = (8 * 60 + 5) * 1000; }); await sleep(700);
  check(await page.evaluate(() => __knMock.checks.length === 1), "판정 중에는 다시 부르지 않음");
  await page.evaluate(() => __knMock.pending[0]({ cut: 0, reason: "다루지 않은 문항이 있다", remark: "계속하십시오." })); await page.waitForFunction(() => __knMock.checks.length === 2);
  check(await page.evaluate(() => document.querySelector("#qcard .qtext").textContent === "문제에 대한 답변을 시작하십시오." && __knMock.checks[1].timing.round === 2), "AI 확률 0이면 계속, 다음 판정은 2차");
  await page.evaluate(() => __knMock.pending[1]({ cut: 100, reason: "같은 말을 반복한다", remark: "여기까지 듣겠습니다." }));
  await page.waitForFunction(() => __knMock.next.length === 1);
  await page.waitForFunction(() => document.querySelector("#qcard .qtext").textContent === "모의 추가질문입니다.");
  const aiCut = await page.evaluate(() => ({ note: (document.querySelector("#qcard .callout.warn") || {}).textContent || "", next: __knMock.next[0] }));
  check(/^기조발언 8:0\d — 면접관이 끊음: 여기까지 듣겠습니다\.$/.test(aiCut.note) && aiCut.next.first.cut === true && aiCut.next.first.group === "기조발언" && aiCut.next.plan.keynote === 7, "AI 확률 100이면 끊고 끊는 말 표시, 다음 질문 호출에 끊긴 기조발언 전달 " + aiCut.note);
  await page.click("#endBtn"); await page.waitForSelector("#again");

  for (const [theme, answerMode] of [["light", "text"], ["dark", "voice"]]) {
    await setSettings(Object.assign({}, knSettings, { theme, fontScale: "xl", answerMode }));
    await page.setViewport({ width: 400, height: 820 });
    await fresh("practice.html?set=korea-2023-A"); await page.click('[data-mode="timed"]'); await page.waitForSelector("#step3 [data-tm]");
    check(await noOverflow(), `고려대 옵션 400px ${theme} 아주 크게`);
    await page.$eval('#step3 [data-tm="prep"]', el => { el.closest(".opt-group").scrollIntoView({ block: "start" }); window.scrollBy(0, -150); });
    await shot(`korea-step3-400-${theme}-xl`, 400, 820);
    await page.click("#startBtn"); await page.waitForSelector("#toNext"); await page.click("#toNext"); await page.waitForSelector("#knClock");
    check(await noOverflow() && await page.$eval("#qcard", el => el.scrollWidth <= el.clientWidth), `기조발언 질문 카드 400px ${theme} 아주 크게(${answerMode})`);
    await shot(`korea-keynote-400-${theme}-xl`, 400, 820);
    if (answerMode === "voice") {   // 음성: 녹음 시작부터 재고, 끊으면 녹음을 멈춰 저장한 뒤 다음 질문
      await page.click("#recStart"); await page.waitForSelector("#recStop"); await sleep(600);
      await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + (7 * 60 + 31) * 1000; Math.random = () => 0; });
      await page.waitForFunction(() => !document.querySelector("#knClock"), { timeout: 5000 }); await sleep(400);
      kr = await latestRecord();
      check(kr && kr.history[0].cut === true && kr.history[0].recFilename && !(await page.$("#recStop")) && await page.$eval("#qcard .callout.warn", el => el.textContent.includes("면접관이 끊음")), "음성 기조발언: 끊으면 녹음 저장 후 다음 질문");
    }
  }
  await page.setViewport({ width: 1280, height: 900 });
  await setSettings({}); await goto("index.html");

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

  console.log("기출DB: 녹음본 피드백");
  /* 첨부 파일은 tests/shots/(git 무시)에 만든다. 녹음은 내용 없는 바이트이고 전사·평가·후속 질문 응답은 지연 mock이다(키 저장·외부 호출 없음).
     AI 면접관 바와 해설 설정을 다르게 두어 평가가 면접관 바의 선택을 쓰는지 확인한다. 내려받기는 a.click을 가로채 파일 이름과 Blob 내용만 본다.
     끝에 설정·학습 캐시·화면 크기를 되돌리고 다시 불러온다. */
  const recSettings = await page.evaluate(() => localStorage.getItem("snu-iv-settings-v1"));
  const recStudy = await page.evaluate(() => localStorage.getItem("snu-db-study-v1"));
  const recFile = (name, content) => { const p = path.join(OUT, name); fs.writeFileSync(p, content); return p; };
  const recTxt = recFile("rec-qa.txt", "Q1: 네 제시문의 공통점은 무엇입니까?\r\nA1: 회귀검증 텍스트 답변입니다.\r\n");
  const recJson = recFile("rec-session.json", JSON.stringify({ history: [{ q: "회귀검증 세션 질문", a: "회귀검증 세션 답변" }] }));
  const recQ10 = recFile("rec_Q10.webm", Buffer.alloc(2048, 1)), recQ2 = recFile("rec_Q2.webm", Buffer.alloc(1024, 1)), recQ3 = recFile("rec_Q3.webm", Buffer.alloc(1536, 1)), recPdf = recFile("rec-note.pdf", "pdf");
  const recKey = JSON.stringify(["snu-2023-A", "kim"]);
  const recStored = id => page.evaluate(id => { const entries = (JSON.parse(localStorage.getItem("snu-db-study-v1") || "{}").entries) || {}; return entries[id] || { reviews: [], transcripts: {} }; }, id);
  const recRun = "#recResults details.run[open]";
  await setSettings({ variant: "kim", explanationProvider: "openai", explanationOpenaiModel: "gpt-6-luna" }); await fresh("db.html#snu-2023-A");
  check(await page.$eval("#recordingPanel", el => el.hidden) && await page.evaluate(() => { const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), button = document.querySelector("#recordingFeedback"); return after(document.querySelector("#passageExplanation"), button) && after(button, document.querySelector(".qgroup")); }), "녹음본 피드백 버튼: 제시문 해설 아래·복기 추가질문 위, 처음엔 닫힘");
  await clickVisible("#recordingFeedback");
  check(await page.$eval("#recordingPanel", el => !el.hidden) && await page.$eval("#recordingFeedback", el => el.getAttribute("aria-expanded") === "true") && await page.$("#recReview[disabled]") && !(await page.$("#recStt")) && await page.$eval("#recClear", el => el.hidden) && await page.$('[data-rec-copy="text"][disabled]'), "패널 열기: 문답 칸, [피드백 받기]·[복사] 비활성(문답 없음), 전사 줄 없음");
  await (await page.$("#recFiles")).uploadFile(recTxt, recJson, recPdf);
  await page.waitForFunction(() => document.querySelector("#recText").value.includes("회귀검증 세션 답변"));
  const recDraft = await page.$eval("#recText", el => el.value);
  check(recDraft === "Q1: 네 제시문의 공통점은 무엇입니까?\nA1: 회귀검증 텍스트 답변입니다.\n\nQ1: 회귀검증 세션 질문\nA1: 회귀검증 세션 답변", "텍스트·세션 JSON 첨부 → 문답 칸 채움(JSON은 Q/A로)");
  check(await page.$eval("#recStatus", el => el.textContent.includes("지원하지 않는 형식: rec-note.pdf")) && (await page.$$("#recList li")).length === 2, "지원하지 않는 형식은 한 줄 오류, 첨부 목록 2개");
  check(await page.$("#recReview[disabled]") && await page.$eval("#recForm", el => el.textContent.includes("API 키 없음") && !!el.querySelector("[data-study-settings]")), "키 없으면 [피드백 받기] 비활성 + API 키 없음 + 설정");
  await (await page.$("#recFiles")).uploadFile(recQ10, recQ2);
  await page.waitForSelector("#recStt");
  check(await page.$eval("#recStt", el => el.textContent.includes("전사(OpenAI)") && el.textContent.includes("OpenAI API 키 없음")) && await page.$("#recTranscribe[disabled]") && await page.$eval("#recModel", el => el.value === "gpt-transcribe" && el.options.length === 3), "녹음 첨부 → 전사(OpenAI) 줄과 전사 모델, OpenAI 키 없으면 [전사] 비활성");
  /* 면접관(Claude) 키만 있고 OpenAI 키는 없는 상태: 전사하지 않은 녹음이 있으면 [피드백 받기]도 막히고, [빼기]로 녹음을 빼면 글만으로 받을 수 있다. */
  await page.evaluate(() => { const resolve = AIClient.resolve; window.__recResolve = resolve; AIClient.resolve = o => Object.assign({}, resolve(o), { configured: (o && o.provider) !== "openai" }); SNU.save({}); });
  check(await page.$("#recReview[disabled]") && (await page.$$("#recList [data-rec-remove]")).length === 2, "OpenAI 키 없이 전사하지 않은 녹음이 있으면 [피드백 받기] 비활성, 녹음마다 [빼기]");
  await clickVisible('#recList [data-rec-remove="3"]'); await clickVisible('#recList [data-rec-remove="2"]');
  check((await page.$$("#recList li")).length === 2 && !(await page.$("#recStt")) && !(await page.$("#recReview[disabled]")) && await page.$eval("#recText", (el, draft) => el.value === draft, recDraft), "[빼기]로 녹음을 빼면 글만으로 [피드백 받기] 가능, 문답 칸 유지");
  await (await page.$("#recFiles")).uploadFile(recQ10, recQ2);
  await page.waitForSelector("#recStt");
  await page.evaluate(() => {
    const mock = window.__recMock = { transcribed: [], reviews: [], pending: [], asks: [], askPending: [] };
    AIClient.resolve = override => Object.assign({}, __recResolve(override), { configured: true });
    AIClient.transcribe = async (file, cs, model) => { mock.transcribed.push({ name: file.name, size: file.size, set: cs.id, model }); return "회귀검증 전사 " + file.name; };
    AIClient.reviewRecording = (cs, transcript, books, ai) => {
      mock.reviews.push({ id: cs.id, variant: cs.variant, transcript, books: books.length, ai });
      const units = AIClient.recordUnits(transcript).units.filter(u => !u.head).length;
      return new Promise(done => mock.pending.push(() => done({
        analysis: { overview: "회귀검증 문제 개관 " + mock.reviews.length, passages: cs.passages.map(p => ({ no: p.no, summary: "회귀검증 제시문 요약", keyPoints: ["회귀검증 논점"] })).reverse(), demands: ["회귀검증 요구"] },
        qa: [{ no: 2, from: units, to: units, question: "(추정) 회귀검증 질문 둘", answer: "회귀검증 답변 요지 둘", evaluation: "회귀검증 평가 <b>굵게</b>", improvement: "회귀검증 개선 둘" }, { no: 1, from: 1, to: 2, question: "회귀검증 질문 하나", answer: "회귀검증 답변 요지 하나", evaluation: "회귀검증 평가 하나", improvement: "회귀검증 개선 하나" }, { no: 3, from: 0, to: 0, question: "회귀검증 질문 셋", answer: "요지 셋", evaluation: "평가 셋", improvement: "개선 셋" }],
        evaluation: { summary: "회귀검증 종합 평가", strengths: [], gaps: ["회귀검증 부족한 점"] },
        improvements: ["회귀검증 개선 방안 하나", "회귀검증 개선 방안 둘"],
        probes: [{ question: "회귀검증 추가질문 하나 <u>밑줄</u>", basis: "회귀검증 추가질문 근거 하나" }, { question: "회귀검증 추가질문 둘", basis: "회귀검증 추가질문 근거 둘" }, { question: "회귀검증 추가질문 셋", basis: "회귀검증 추가질문 근거 셋" }],
        books: [{ id: books[0].id, reason: "회귀검증 추천 이유" }]
      })));
    };
    AIClient.recordingFollowup = (cs, run, books, ai) => { mock.asks.push({ id: cs.id, question: run.thread[run.thread.length - 1].text, n: run.thread.length, transcript: run.transcript, ai }); return new Promise((done, fail) => mock.askPending.push({ done: () => done({ reply: "회귀검증 후속 답 " + mock.asks.length + " <i>기울임</i>" }), fail: () => fail(new Error("모의 서버 오류")) })); };
    window.__downloads = []; window.__blobs = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { __blobs.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () { if (this.download) __downloads.push(this.download); };
    SNU.save({});
  });
  check(await page.$eval("#recText", (el, draft) => el.value === draft, recDraft) && (await page.$$("#recList li")).length === 4 && await page.evaluate(() => __recMock.transcribed.length === 0) && !(await page.$("#recReview[disabled]")) && !(await page.$("#recTranscribe[disabled]")), "다시 그려도 문답 칸·첨부 유지, 파일을 고른 것만으로는 전사하지 않음");
  const recAppend = async (selector, text) => { await page.focus(selector); await page.keyboard.down("Control"); await page.keyboard.press("End"); await page.keyboard.up("Control"); await page.keyboard.type(text); };   // 칸 끝에 이어 쓴다
  await recAppend("#recText", " 직접 고친 문장 ");
  await page.select("#recModel", "gpt-4o-mini-transcribe");
  await page.select("#dbInterviewerAi .modelsel select", "claude-opus-5-5");
  await setEffort("#db-effort", 2);
  await page.click("#toggleThemes"); await page.click("#toggleThemes");
  check(await page.$eval("#recText", el => el.value.includes("직접 고친 문장") && el.value.includes("회귀검증 세션 답변")) && (await page.$$("#recList li")).length === 4 && await page.evaluate(() => SNU.settings.transcriptionModel === "gpt-4o-mini-transcribe" && document.querySelector("#recModel").value === "gpt-4o-mini-transcribe"), "설정 변경(전사 모델·면접관 모델·주제 가림)으로 다시 그려도 문답 칸·첨부 유지, 전사 모델 저장");
  const recHeights = await page.$$eval("#recPick, #recClear, #recTranscribe, #recReview, [data-rec-copy='text'], [data-rec-save='text']", els => els.map(el => Math.round(el.getBoundingClientRect().height)));
  check(recHeights.length === 6 && recHeights.every(h => h === recHeights[0]), "패널 버튼 높이 동일 " + recHeights.join(","));
  await clickVisible('[data-rec-copy="text"]');
  await page.waitForFunction(() => /복사(함| 실패)/.test(document.querySelector('[data-copy-status="text"]').textContent));
  await clickVisible('[data-rec-save="text"]');
  check(await page.evaluate(async () => __downloads[0] && /^snu-2023-A_kim_transcript_\d{8}-\d{4}\.txt$/.test(__downloads[0]) && (await __blobs[0].text()).includes("직접 고친 문장") && __blobs[0].type.startsWith("text/plain")), "문답 칸 복사·내려받기(.txt, 세트·복기본·시각 이름)");
  /* [전사]: 둘째 녹음에서 실패하면 첫째까지만 붙고 멈추며, 다시 누르면 남은 것만 보낸다. */
  await page.evaluate(() => { const ok = AIClient.transcribe; __recMock.okTranscribe = ok; AIClient.transcribe = async (file, cs, model) => { if (file.name === "rec_Q10.webm") { __recMock.transcribed.push({ name: file.name, failed: true }); throw new Error("OpenAI: 호출 한도에 도달했다 (429)."); } return ok(file, cs, model); }; });
  await clickVisible("#recTranscribe");
  await page.waitForFunction(() => document.querySelector("#recStatus").textContent.includes("전사 실패(rec_Q10.webm)"));
  check(await page.$eval("#recText", el => el.value.includes("[녹음 1: rec_Q2.webm]\n회귀검증 전사 rec_Q2.webm") && !el.value.includes("[녹음 2")) && await page.$$eval("#recList li", li => li.filter(x => x.textContent.includes("전사됨 · GPT-4o mini Transcribe")).length === 1), "[전사] 중간 실패: 끝난 녹음까지만 붙고(전사 모델 표시) 멈춤");
  await page.evaluate(() => { AIClient.transcribe = __recMock.okTranscribe; });
  await clickVisible("#recTranscribe");
  await page.waitForFunction(() => document.querySelector("#recText").value.includes("[녹음 2: rec_Q10.webm]"));
  check(await page.evaluate(() => JSON.stringify(__recMock.transcribed.filter(t => !t.failed).map(t => t.name)) === JSON.stringify(["rec_Q2.webm", "rec_Q10.webm"]) && __recMock.transcribed.every(t => t.failed || (t.model === "gpt-4o-mini-transcribe" && t.set === "snu-2023-A"))) && await page.$("#recTranscribe[disabled]"), "다시 누르면 남은 녹음만 전사(이름 자연 정렬 Q2 → Q10, 고른 전사 모델)");
  await (await page.$("#recFiles")).uploadFile(recQ3);
  await page.waitForSelector("#recTranscribe:not([disabled])");
  await page.$eval("#recReview", b => { b.scrollIntoView({ block: "center" }); b.click(); b.click(); });
  await page.waitForFunction(() => __recMock.reviews.length === 1);
  check(await page.evaluate(() => __recMock.transcribed.filter(t => !t.failed).map(t => t.name).join() === "rec_Q2.webm,rec_Q10.webm,rec_Q3.webm"), "[피드백 받기]는 남은 녹음을 먼저 전사하고 평가(한 번의 클릭)");
  check(await page.evaluate(() => __recMock.reviews.length === 1) && await page.$("#recReview[disabled]") && await page.$("#recText[disabled]") && await page.$eval("#recStatus", el => el.textContent.includes("평가 중")) && await page.$eval("#recForm", el => el.getAttribute("aria-busy") === "true"), "요청 중 중복 클릭 막음·진행 표시·문답 칸 잠금");
  check(await page.evaluate(() => { const t = __recMock.reviews[0].transcript; return t.includes("회귀검증 텍스트 답변입니다.") && t.includes("직접 고친 문장") && t.indexOf("[녹음 1: rec_Q2.webm]") < t.indexOf("[녹음 2: rec_Q10.webm]") && t.indexOf("[녹음 2: rec_Q10.webm]") < t.indexOf("[녹음 3: rec_Q3.webm]") && __recMock.reviews[0].books > 50; }), "평가 입력 = 문답 칸의 글(텍스트 + 파일 경계를 표시한 전사 + 직접 고친 내용), 서가 후보 포함");
  check(await page.evaluate(() => { const ai = __recMock.reviews[0].ai; return ai.provider === "anthropic" && ai.model === "claude-opus-5-5" && ai.effort === "high" && SNU.settings.anthropicModel !== "claude-opus-5-5" && SNU.settings.explanationProvider === "openai"; }), "평가 모델 = AI 면접관 바의 선택(해설 설정·기본 설정이 아님)");
  await page.evaluate(() => __recMock.pending[0]());
  await page.waitForSelector(recRun);
  check(await page.$eval(recRun, d => JSON.stringify([...d.querySelectorAll("h3")].map(h => h.textContent)) === JSON.stringify(["문제 분석", "답변 평가", "개선 방안", "고민해볼 추가질문", "추천 도서", "후속 질문"])), "순서: 문제 분석 → 답변 평가 → 개선 방안 → 고민해볼 추가질문 → 추천 도서, 이어서 후속 질문");
  check(await page.$eval(recRun, d => JSON.stringify([...d.querySelectorAll(".study-passage h4")].map(h => h.textContent)) === JSON.stringify(["<제시문 1>", "<제시문 2>", "<제시문 3>", "<제시문 4>", "문제의 요구"]) && JSON.stringify([...d.querySelectorAll("[data-rec-qa] > summary")].map(s => s.textContent)) === JSON.stringify(["Q1. 회귀검증 질문 하나", "Q2. (추정) 회귀검증 질문 둘", "Q3. 회귀검증 질문 셋"]) && d.textContent.includes("원문 위치 없음 1")), "제시문별 분석·문제의 요구, 문답별 평가는 번호순 접는 목록(위치 못 찾은 수 표시)");
  check(await page.$eval(recRun, d => ["회귀검증 문제 개관 1", "회귀검증 종합 평가", "회귀검증 부족한 점", "회귀검증 개선 방안 둘", "회귀검증 추천 이유"].every(text => d.textContent.includes(text)) && d.querySelectorAll("ol.study-list:not([data-rec-probes]) li").length === 2 && !d.querySelector("[data-rec-qa] .study-notes")), "종합 평가·개선 방안(순서 목록)·추천 이유 표시, 문답 본문은 펼칠 때 채움");
  check(await page.$eval(recRun + " ol[data-rec-probes]", ol => { const li = [...ol.querySelectorAll("li")]; return li.length === 3 && li[0].firstChild.textContent === "회귀검증 추가질문 하나 <u>밑줄</u>" && !ol.querySelector("u") && li[0].querySelector("p.small.muted").textContent === "회귀검증 추가질문 근거 하나" && li[2].textContent.includes("회귀검증 추가질문 셋"); }), "고민해볼 추가질문: 질문과 근거를 순서 목록으로(HTML로 실행하지 않음)");
  await page.$eval(recRun + ' [data-rec-qa$=":1"] > summary', s => s.click());
  await page.waitForSelector(recRun + ' [data-rec-qa$=":1"] .study-notes');
  check(await page.$eval(recRun + ' [data-rec-qa$=":1"]', d => { const dt = [...d.querySelectorAll("dt")].map(x => x.textContent).join(), src = d.querySelector(".study-transcript").textContent; return dt === "원문,답변 요지,평가,개선" && src.startsWith("Q1: 네 제시문의 공통점은 무엇입니까?") && src.includes("A1: 회귀검증 텍스트 답변입니다.") && !src.includes("회귀검증 세션 질문") && d.textContent.includes("회귀검증 답변 요지 하나"); }), "문답을 펼치면 원문 구간(from·to)·답변 요지·평가·개선이 함께");
  await page.$eval(recRun + ' [data-rec-qa$=":2"] > summary', s => s.click());
  await page.waitForSelector(recRun + ' [data-rec-qa$=":2"] .study-notes');
  check(await page.$eval(recRun + ' [data-rec-qa$=":2"]', d => d.querySelector(".study-transcript").textContent === "회귀검증 전사 rec_Q3.webm" && d.textContent.includes("<b>굵게</b>") && !d.querySelector(".study-text b")) && await page.$eval(recRun + ' [data-rec-qa$=":3"]', d => !d.open), "녹음 하나의 원문, AI 평가는 HTML로 실행하지 않음");
  await page.$eval(recRun + ' [data-rec-qa$=":3"] > summary', s => s.click());
  await page.waitForSelector(recRun + ' [data-rec-qa$=":3"] .study-notes');
  check(await page.$eval(recRun + ' [data-rec-qa$=":3"]', d => d.textContent.includes("위치 없음")), "범위가 틀린 문답은 '위치 없음'");
  check(await page.$eval(recRun + ' a[href^="library.html#b"]', a => a.textContent.trim().length > 0 && !a.textContent.includes("회귀검증")), "추천 도서는 실제 서가 제목·내부 링크");
  await page.$eval(recRun + " [data-rec-full] > summary", s => s.click());
  await page.waitForSelector(recRun + " [data-rec-full] .study-transcript");
  check(await page.$eval(recRun + " [data-rec-full]", d => { const labels = [...d.querySelectorAll(".study-transcript > .small")].map(p => p.textContent); return labels.join() === "Q1,문답 밖,Q2" && d.textContent.includes("회귀검증 전사 rec_Q10.webm") && d.querySelector(".small").textContent.includes("rec_Q2.webm · 1KB · 녹음 · GPT-4o mini Transcribe"); }), "평가한 문답 전문: 문답 구간마다 Q 번호·'문답 밖', 첨부 이름·전사 모델");
  await clickVisible(recRun + ' [data-rec-save]:not([data-rec-save="text"])');
  check(await page.evaluate(async () => { const name = __downloads[__downloads.length - 1], md = await __blobs[__blobs.length - 1].text(); return /^snu-2023-A_kim_feedback_\d{8}-\d{4}\.md$/.test(name) && md.startsWith("# 2023학년도 서울대 A 녹음본 피드백") && md.includes("### Q1. 회귀검증 질문 하나") && md.includes("> Q1: 네 제시문의 공통점은 무엇입니까?") && md.includes("## 고민해볼 추가질문\n\n1. 회귀검증 추가질문 하나 <u>밑줄</u>\n   - 회귀검증 추가질문 근거 하나\n2. 회귀검증 추가질문 둘") && md.indexOf("## 개선 방안") < md.indexOf("## 고민해볼 추가질문") && md.indexOf("## 고민해볼 추가질문") < md.indexOf("## 추천 도서") && md.includes("## 평가한 문답") && md.includes("[녹음 3: rec_Q3.webm]") && !md.includes(SNU.settings.anthropicKey || "키없음"); }), "결과 내려받기(.md: 평가·문답별 원문·고민해볼 추가질문·평가한 문답 전문)");
  check(await page.evaluate(async id => { const e = JSON.parse(localStorage.getItem("snu-db-study-v1")).entries[id], r = e.reviews[0], t = e.transcripts[r.tx]; return e.reviews.length === 1 && t.includes("회귀검증 전사 rec_Q2.webm") && r.files.length === 5 && r.files.filter(f => f.kind === "audio").every(f => f.model === "GPT-4o mini Transcribe" && Object.keys(f).sort().join() === "kind,model,name,size") && r.spans.length === 2 && r.model.includes("Opus") && r.effort === "high"; }, recKey), "결과는 학습 캐시의 세트·복기본에 저장(전문은 지문으로 한 번, 녹음 파일은 저장하지 않음)");
  check(await page.$eval("#recText", el => !el.disabled && el.value.includes("직접 고친 문장")) && await page.$$eval("#recList li", li => li.length === 5 && li.filter(x => x.textContent.includes("전사됨")).length === 3), "평가 뒤에도 문답 칸·첨부 유지, 녹음은 '전사됨'");
  await page.$eval("#recForm", el => el.scrollIntoView({ block: "start" }));
  await shot("db-recording", 1280, 900);
  /* 후속 질문: 질문은 먼저 저장되고, 답을 기다리는 동안 그 결과는 지울 수 없으며, 답은 그 질문 뒤에 붙는다. */
  const recAt = await page.$eval(recRun, d => d.dataset.run);
  check(await page.$(`#rq-${recAt}`) && await page.$eval(`[data-rec-ask="${recAt}"]`, b => !b.disabled && b.textContent === "질문하기") && !(await page.$(`[data-rec-ask-clear="${recAt}"]`)), "후속 질문 칸과 [질문하기](스레드 없음)");
  await page.type(`#rq-${recAt}`, "제시문 2를 오독했다는 근거는?");
  await page.$eval(`[data-rec-ask="${recAt}"]`, b => { b.scrollIntoView({ block: "center" }); b.click(); b.click(); });
  await page.waitForFunction(() => __recMock.asks.length === 1);
  check(await page.evaluate(at => __recMock.asks.length === 1 && __recMock.asks[0].question === "제시문 2를 오독했다는 근거는?" && __recMock.asks[0].transcript.includes("[녹음 3: rec_Q3.webm]") && __recMock.asks[0].ai.model === "claude-opus-5-5" && document.querySelector(`[data-rec-thread="${at}"] .msg.user`).textContent.includes("제시문 2를 오독했다는 근거는?") && document.querySelector(`[data-rec-ask="${at}"]`).disabled && document.querySelector(`[data-run-del="${at}"]`).disabled && document.querySelector(`#rq-${at}`).value === "", recAt), "후속 질문: 질문을 먼저 보이고 저장, 답 대기 중 중복·삭제 막음, AI 면접관 모델로 전사·피드백과 함께 보냄");
  check((await recStored(recKey)).reviews[0].thread.length === 1, "질문은 답을 받기 전에 저장");
  await recAppend("#recText", " 대기 중 입력");
  await page.evaluate(() => __recMock.askPending[0].done());
  await page.waitForFunction(at => document.querySelector(`[data-rec-thread="${at}"] .msg.ai`), {}, recAt);
  check(await page.evaluate(at => { const box = document.querySelector(`[data-rec-thread="${at}"]`), ai = box.querySelector(".msg.ai"); return ai.querySelector(".who").textContent.includes("Opus") && ai.textContent.includes("<i>기울임</i>") && !ai.querySelector("i") && !document.querySelector(`[data-run-del="${at}"]`).disabled && document.querySelector("#recText").value.endsWith(" 대기 중 입력"); }, recAt), "답은 면접관 말풍선(모델 이름, 텍스트로), 답이 오면 삭제 다시 가능, 문답 칸 입력 유지");
  check(await page.evaluate(async id => { const t = JSON.parse(localStorage.getItem("snu-db-study-v1")).entries[id].reviews[0].thread; return t.length === 2 && t[1].role === "ai" && t[1].re === t[0].at; }, recKey), "후속 문답은 그 결과와 함께 저장(답은 질문을 가리킴)");
  await page.type(`#rq-${recAt}`, "실패할 질문");
  await clickVisible(`[data-rec-ask="${recAt}"]`);
  await page.waitForFunction(() => __recMock.asks.length === 2);
  await page.evaluate(() => __recMock.askPending[1].fail());
  await page.waitForFunction(at => document.querySelector(`[data-rec-thread="${at}"] .callout.warn`), {}, recAt);
  check(await page.evaluate(at => document.querySelector(`[data-rec-thread="${at}"]`).textContent.includes("AI 호출 실패: 모의 서버 오류") && document.querySelector(`[data-rec-ask="${at}"]`).textContent === "다시 묻기", recAt), "후속 질문 실패: 한 줄 오류, 질문은 남고 버튼은 [다시 묻기]");
  await clickVisible(`[data-rec-ask="${recAt}"]`);
  await page.waitForFunction(() => __recMock.asks.length === 3);
  await page.evaluate(() => __recMock.askPending[2].done());
  await page.waitForFunction(at => document.querySelectorAll(`[data-rec-thread="${at}"] .msg`).length === 4, {}, recAt);
  check(await page.evaluate(() => __recMock.asks[2].question === "실패할 질문" && __recMock.asks[2].n === 3), "[다시 묻기]는 새 질문 없이 같은 질문에 답을 받음");
  await page.$eval(`[data-rec-ask-prompt="${recAt}"] > summary`, s => s.click());
  await page.waitForFunction(at => document.querySelector(`[data-rec-ask-prompt="${at}"] pre`).textContent.includes("[이번 질문"), {}, recAt);
  check(await page.$eval(`[data-rec-ask-prompt="${recAt}"] pre`, pre => pre.textContent.includes("[system]") && pre.textContent.includes("<<<피드백 시작>>>") && pre.textContent.includes("지원자: 제시문 2를 오독했다는 근거는?") && pre.textContent.includes("(지금 적는 질문이 여기에 들어간다)")), "후속 질문 AI 입력 보기(피드백·앞선 문답·이번 질문 자리)");
  await clickVisible("#recReview");
  await page.waitForFunction(() => __recMock.reviews.length === 2);
  await page.evaluate(() => __recMock.pending[1]());
  await page.waitForFunction(() => document.querySelectorAll("#recResults details.run").length === 2);
  check(await page.evaluate(() => __recMock.transcribed.filter(t => !t.failed).length === 3) && await page.$$eval("#recResults details.run", d => d[0].open && !d[1].open && d[0].querySelector("summary b").textContent === "2차" && d[1].querySelector("summary b").textContent === "1차" && d[0].textContent.includes("회귀검증 문제 개관 2")), "다시 받으면 2차로 쌓임(이미 전사한 녹음은 다시 보내지 않음)");
  check(await page.evaluate(async id => { const e = JSON.parse(localStorage.getItem("snu-db-study-v1")).entries[id]; return e.reviews.length === 2 && Object.keys(e.transcripts).length === 2; }, recKey), "문답 글마다 전문 하나");
  await clickVisible("#recResults .runs > details.run:last-of-type > summary");
  await clickVisible(`[data-rec-ask-clear="${recAt}"]`);
  check(await page.$$eval(`[data-rec-thread="${recAt}"] .msg`, m => m.length === 0) && (await recStored(recKey)).reviews.find(r => String(r.at) === recAt).thread.length === 0, "[후속 질문 지우기]: 그 결과의 스레드만 비움");
  await clickVisible("#recResults .runs > details.run:last-of-type > .fold-b > .row [data-run-del]");
  await page.waitForFunction(() => document.querySelectorAll("#recResults details.run").length === 1);
  check((await recStored(recKey)).reviews.length === 1 && Object.keys((await recStored(recKey)).transcripts).length === 1 && await page.$eval("#recText", el => el.value.includes("직접 고친 문장")) && await page.$eval(recRun, d => d.textContent.includes("회귀검증 문제 개관 2")), "결과 하나 삭제(스레드·쓰지 않는 전문도 함께), 문답 칸 유지");
  await clickVisible("#recReview");
  await page.waitForFunction(() => __recMock.reviews.length === 3);
  await page.click('.dbside [data-set="snu-2021-A"]');
  check(await page.$("#recordingPanel[hidden]") && await page.$eval("#recText", el => el.value === "") && !(await page.$("#recList")), "다른 세트의 패널·문답 칸·첨부는 따로");
  await page.evaluate(() => __recMock.pending[2]());
  await page.waitForFunction(id => JSON.parse(localStorage.getItem("snu-db-study-v1")).entries[id].reviews.length === 2, {}, recKey);
  check(!(await page.$("#recResults details.run")) && (await recStored(JSON.stringify(["snu-2021-A", "kim"]))).reviews.length === 0, "요청 중 세트 이동: 늦은 결과를 현재 세트에 표시·저장하지 않음");
  await page.click('.dbside [data-set="snu-2023-A"]');
  check((await page.$$("#recResults details.run")).length === 2 && await page.$eval("#recordingPanel", el => !el.hidden) && await page.$eval("#recForm", el => el.getAttribute("aria-busy") === "false") && await page.$eval("#recText", el => el.value.includes("직접 고친 문장")) && (await page.$$("#recList li")).length === 5 && !(await page.$("#recReview[disabled]")), "원래 세트로 돌아오면 결과 2개, 문답 칸·첨부 그대로");
  await page.evaluate(() => SNU.save({ theme: "dark", fontScale: "xl" }));
  await page.setViewport({ width: 400, height: 820 }); await sleep(250);
  const recOpenRun = await page.$eval(recRun, d => d.dataset.run);
  await page.$eval(`#recResults details.run[data-run="${recOpenRun}"] [data-rec-qa$=":1"] > summary`, s => s.click());
  await page.$eval(`#recResults details.run[data-run="${recOpenRun}"] [data-rec-full] > summary`, s => s.click());
  await page.$eval("#recPrompt summary", s => s.click());
  await page.waitForFunction(() => document.querySelector("#recPrompt pre").textContent.includes("[user]"));
  check(await page.$eval("#recPrompt pre", pre => pre.textContent.includes("[system]") && pre.textContent.includes("<제시문 4>") && pre.textContent.includes("<<<기록 시작>>>") && pre.textContent.includes("[제시문 번호] 1 = <제시문 1>") && pre.textContent.includes("⟦1⟧ Q1: 네 제시문의 공통점은 무엇입니까?") && pre.textContent.includes("직접 고친 문장") && pre.textContent.includes("[서가 후보")), "AI 입력 보기 = 실제 system/user(제시문 전문 + 서가 후보 + 번호 붙은 문답 칸의 글)");
  check(await noOverflow() && await page.$eval("#recordingPanel", el => el.scrollWidth <= el.clientWidth), "녹음본 피드백 400px 어둠 아주 크게: 문답·전문·입력 보기를 펼쳐도 가로 넘침 없음");
  await page.$eval("#recForm", el => el.scrollIntoView({ block: "start" }));
  await shot("db-recording-400-dark-xl", 400, 820);
  await page.$eval("#recResults", el => el.scrollIntoView({ block: "start" }));
  await shot("db-recording-result-400-dark-xl", 400, 820);
  await page.evaluate(() => SNU.save({ theme: "light" }));
  await page.setViewport({ width: 1280, height: 900 }); await sleep(250);
  check(await noOverflow() && await page.$eval("#recPrompt", d => d.open) && await page.$eval(`#recResults details.run[data-run="${recOpenRun}"] [data-rec-full]`, d => d.open), "녹음본 피드백 1280px 밝음 아주 크게: 가로 넘침 없음, 펼친 상태 유지");
  await page.$eval("#recResults", el => el.scrollIntoView({ block: "start" }));
  await shot("db-recording-result-1280-light-xl", 1280, 900);
  await clickVisible("#recClear");
  check(await page.$eval("#recText", el => el.value === "") && !(await page.$("#recList")) && !(await page.$("#recStt")) && await page.$("#recReview[disabled]") && (await page.$$("#recResults details.run")).length === 2, "[비우기]: 첨부·문답을 비우고 결과는 유지");
  await page.type("#recText", "실패 경로 문답");
  await page.evaluate(() => { AIClient.reviewRecording = async () => { __recMock.reviews.push("실패"); throw new Error("모의 서버 오류"); }; });
  await clickVisible("#recReview");
  await page.waitForFunction(() => document.querySelector("#recStatus").textContent.includes("피드백 생성 실패: 모의 서버 오류"));
  check(await page.$eval("#recText", el => el.value === "실패 경로 문답") && !(await page.$("#recReview[disabled]")) && (await recStored(recKey)).reviews.length === 2, "평가 실패: 한 줄 오류, 문답 칸 유지, 저장된 결과 그대로");
  await page.$eval("#recText", el => { el.value = "가".repeat(60001); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await (await page.$("#recFiles")).uploadFile(recQ2);
  await page.waitForSelector("#recTranscribe:not([disabled])");
  const recBefore = await page.evaluate(() => __recMock.transcribed.length);
  await clickVisible("#recReview");
  await page.waitForFunction(() => document.querySelector("#recStatus").textContent.includes("6만 자"));
  check(await page.evaluate(n => __recMock.transcribed.length === n, recBefore), "6만 자를 넘는 문답은 녹음을 보내기 전에 멈춤");
  await fresh("db.html#snu-2023-A");
  await clickVisible("#recordingFeedback");
  await page.waitForSelector('#recResults details.run[open] a[href^="library.html#b"]');
  check((await page.$$("#recResults details.run")).length === 2 && await page.evaluate(() => !AIClient.resolve().configured) && await page.$eval("#recText", el => el.value === "") && await page.$('#recResults details.run[open] [data-rec-ask][disabled]'), "새로고침 후 키 없이 저장된 피드백 열람(서가 링크), 문답 칸·첨부는 남지 않음, 후속 질문은 비활성");
  await page.evaluate((settings, study) => { localStorage.setItem("snu-iv-settings-v1", settings); if (study === null) localStorage.removeItem("snu-db-study-v1"); else localStorage.setItem("snu-db-study-v1", study); }, recSettings, recStudy);
  await fresh("db.html#snu-2023-A");

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
