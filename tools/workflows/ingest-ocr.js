export const meta = {
  name: 'ingest-ocr',
  description: '교재 쪽 이미지와 ABBYY 텍스트층을 블록 JSON으로 정제한다(학교 공통). Haiku 정제, 결정적 점검에 걸리면 Haiku 재시도, 마지막 1회는 Sonnet. args.verify면 Sonnet 이미지 대조 검증(파일럿)',
  phases: [
    { title: 'Refine', detail: 'Haiku 5.5 쪽 단위 정제(미흡하면 재시도, 마지막은 Sonnet 5.5)', model: 'haiku' },
    { title: 'Verify', detail: '파일럿만: Sonnet 5.5 이미지 대조 검증', model: 'sonnet' },
  ],
}

/* 교재 수록 OCR 정제(docs/INGEST.md §2-B·§8). 인자는 tools/ocr_args.py가 만든다:
   args = { root, school, short, notes: { kim, hwang }, pages: [{ book, page, abbyy }], verify?: false, plan?: [모델…] }
   결과 [{ book, page, attempts, result: { book, page, blocks }, verdict, model, ok }] → tools/ocr_collect.py */
const A = args || {}
if (!A.root || !Array.isArray(A.pages) || !A.pages.length) throw new Error('args.root와 args.pages가 필요하다(tools/ocr_args.py)')
const PLAN = A.plan || ['haiku', 'haiku', 'haiku', 'sonnet']
const NOTES = A.notes || {}

const BOOK = {
  kim: `책: 해커스 김종수 『로스쿨 면접 200주제』 3권 기출편(2026), Part 6 면접 기출문제&해설(2025~2019). 학교마다 문제(2025→2019) → 해설 → 광고 쪽 순서.
쪽 구조: 학교 구간 첫 쪽의 제목('○○대 로스쿨 (2025~2019)')과 해설 안내문('*문제에 대한 해설은 p.148에서 확인할 수 있습니다.')은 skip. 연도 머리(큰 띠 '2025 문제') → 진행 방식 한 줄('① 교수:학생 = 3:1 ② 면접 준비 14분, 면접 시간 11분 ③ 메모 허용 ④ 추가질문 있음') → 2025에는 면접 정보 표(메모 및 휴대 여부, 대기실 특징, 문제풀이실 특징, 면접고사장 특징, 기타 특이사항) → 세트 머리(연도 작은 상자 + '고려 A 문제', '성균관A문제', '성균관 인성 문제') → 지시문('※ 다음 제시문을 읽고, 문제에 답하시오.') → 제시문 머리('<제시문 1>', '(가)', '<사례>' 등. 머리 없이 본문이 바로 오기도 한다) → 본문 → 쪽 아래 원문자 각주 → 문제지 문항('Q1.', 'Q1-1.' — 추가질문 머리 앞에 있다) → 추가질문 머리(띠 '추가질문' 또는 그림 배지 'A학생 추가질문') → 'Q1.', 'Q2-1.' 번호 질문. 해설 쪽: '해설' 머리, 연도, '고려 A 해설' 세트 머리 아래 'Q1.' 질문(q)과 해설 문단(para)이 번갈아 나온다. 한 쪽에 두 세트가 걸치는 쪽이 많다.
반드시 skip: 세로 옆탭('Part 6 면접 기출문제 & 해설' 조각과 잡문자), 꼬리말('132 한 번에 합격, 해커스로스쿨 lawschool.Hackers.com', '고려대 로스쿨 (2025-2019) 135'), QR 코드와 캡션, 광고('추가 학습이 가능한 2018~2016 기출문제&해설!', '더 많은 기출문제와 해설 바로확인하기').
텍스트층의 흔한 오인식: Q1→Ql/QI, Q10→Q1O, 추가→幸가/孝가, 제시문→쩨시문, ※→宗/乂/凶/洪, 학생→학샘, Q3-2→Q3~2, ③→©, 그림 배지 글자가 잡문자로 남음. 배지의 학생 글자(A/B/C)는 반드시 이미지에서 읽는다.`,
  hwang: `책: 『황변과 함께하는 로스쿨 면접 Q』 1권(2026), PART 04 대학별 면접장 스케치 및 최근 5개년 기출문제. 학교마다 면접장 스케치(표: 면접방식, 문제풀이 시간/장소, 면접시간, 답안작성/휴대, 면접장 내 문제 비치, 주요 인성 질문)와 '합격생이 전하는 현장메모' 글머리 → 연도별 기출문제(2025→2021).
쪽 구조: 연도 띠('2025학년도 기출문제') → (학교에 따라) 세션 글머리('• 오전', '• 오후', '• 특별전형' 등. 없는 학교도 있다) → 제시문 머리('제시문 1〉', '제시문〉', '[1]', '（가）', '[사례 1]'. '제시 문2〉', '제시문 1）'처럼 변형되기도 한다) → 본문 → '(A4 1/2 분량)', '(출처: …)' → '문제 1>', '문제〉' 문항(task) → '추가질문' 또는 '질문〉' 머리 아래 '•' 글머리 질문 → 때로 '참고〉'. 한 쪽에 두 세트가 걸치기도 한다.
반드시 skip: 꼬리말('286 황변과 함께하는 로스쿨 면접 Q', 'Part 04 대학별 면접장 스케치 및 최근 5개년 기출문제 chapter 01 … 287'), 학교 번호 탭('05', '05r' 같은 조각).
텍스트층은 단어 사이 공백이 많이 빠져 있다("진실을모르고", "받을수"). 띄어쓰기는 이미지를 보고 복원한다. 머리 번호가 텍스트층에서 빠진 쪽이 있으니 이미지로 확인한다.`,
}

const CONTEXT = `## 작업 맥락
이 쪽은 사용자가 가진 교재 PDF의 스캔 이미지이고, 같은 쪽의 ABBYY 텍스트층(2번 파일)에 본문 전체가 이미 들어 있다. 할 일은 그 OCR 텍스트를 사용자 본인의 면접 연습용 기출 DB에 넣을 수 있게 이미지로 오인식을 바로잡고 블록으로 나누는 것이다. 모든 블록의 text에 이미지의 글자를 그대로 적는다. "[미전사]"·"[본문 생략]" 같은 자리표시, 요약, 요지만 적기는 허용되지 않는다.`

const RULES = `## 도구 호출 규칙(반드시 지킬 것)
Read로 쪽 PNG를 한 번, Read로 텍스트층 txt를 한 번 읽은 뒤 곧바로 StructuredOutput으로 결과를 낸다. 도구 호출은 이 세 번이 전부다. 이미지를 다시 읽거나 확대하거나, Grep·Bash·다른 파일 Read를 하지 않는다. 한 번 본 이미지로 충분히 옮길 수 있다.

## 출력 형식
StructuredOutput 도구로 JSON 하나만 낸다: { book, page, blocks: [ { type, text, label?, marker?, cont?, note? } ] }. 블록은 이미지에서 읽는 순서(위→아래, 왼쪽→오른쪽)대로. 텍스트층의 순서가 이미지와 다르면 이미지 순서를 따른다.

## 블록 유형(type)
- year-head: 연도 머리("2025 문제", "2025학년도 기출문제", 해설 쪽의 "2025"). text는 보이는 대로.
- format: 진행 방식 한 줄·면접 정보 표, 면접장 스케치 표·주요 인성 질문·현장메모. text는 "항목: 내용" 줄들을 \\n으로 이은 것. 현장메모·인성 질문 글머리는 한 줄에 하나.
- set-head: 세트 머리("고려 A 문제", "성균관B문제", "성균관 인성 문제", "연세 A 해설", "• 오전", "• 특별전형"). text는 보이는 대로(연도 상자가 붙어 있으면 "2025 고려 A 문제").
- instruction: 지시문. text에는 "※"와 대괄호 태그를 뺀 본문만("다음 제시문을 읽고, 문제에 답하시오."). label에는 태그("가군 오전" 등; 없으면 ""). 괄호 부기는 본문에 그대로 둔다.
- passage-head: 책이 제시문 단위로 매긴 머리. text는 보이는 대로("<제시문 1>", "제시문 2〉", "[3]", "(가)", "<사례>", "[사례 1]", "＜에피소드＞"), label은 정규화("1", "2", "가", "A", "사례", "사례 1", "에피소드"). 머리줄에 출처·분량이 병기되어 있으면 머리 다음에 source·length 블록을 따로 둔다. "제시문〉"처럼 번호 없는 머리 하나 아래 "[1]"~"[4]"가 이어지면 각 "[n]"을 passage-head(label n)로 적고 번호 없는 머리는 label ""로 둔다. 한 제시문 안의 하위 소제목(큰 머리 '<제시문 1>' 아래의 '(가)', '(나)', '(A)', '(B)')은 passage-head가 아니라 본문(para)이다 — 학교 주석이 따로 정하면 그것을 따른다.
- para: 본문 한 문단 = 블록 하나(이미지에서 들여쓰기·빈 줄로 문단이 나뉘면 나눈다. 대화체는 발화 하나가 문단 하나. 한 줄짜리 목록 '（가） …'은 줄마다 하나). 줄 끝에서 갈라진 단어는 이어 붙인다(줄바꿈 때문에 생긴 공백은 넣지 않는다). 글자로 된 표는 행마다 para 하나, 칸 사이는 " | ". 문단 끝 원문자 각주 기호(①)는 text에서 빼고 marker에 "①"로 둔다. 쪽 첫 블록이 앞 쪽에서 이어지는 문단(문장 중간에서 시작)이면 cont: true.
- figure: 막대·선 그래프, 그림, 사진. text에는 그림 안에 보이는 글자(제목·범례·축 이름·눈금·수치·말풍선)만 " / "로 이어 적는다. 보이지 않는 내용은 지어내지 않는다. label은 "도표" | "그림" | "사진".
- footnote: 쪽 아래 각주. text는 원문자 뒤 내용, marker는 "①" 등. 옆탭 잡문자와 구분: 각주는 쪽 번호 바로 위, 원문자로 시작, 서지 사항이다.
- source: 출처 표기("(출처: 유발 하라리의 〈넥서스〉)", "유발 하라리, <넥서스>"). text 보이는 대로.
- length: 분량 표기("(A4 1/2 분량)", "(약 0.7 페이지 분량)", "(명제 및 사례 합쳐서 A4 1페이지 분량)"). text 보이는 대로.
- meta: 복기자가 원문을 설명하는 문장·괄호("…에 대한 제시문.", "(… 조항 일부 제시)", "(첫 문단 중심내용 요약)"). 원문 자체는 para다.
- ellipsis: "…(중략)…", "(...)" 같은 생략 표시.
- task: 문제지에 실린 문항(면접 전에 받는 문제). 황변의 "문제 1>", "문제 1-1>", "문제〉 …". text는 머리를 뺀 문장, label은 번호("1", "1-1"; 번호 없으면 ""). 김종수 책은 문제지 문항도 "Q1."로 적혀 있으니 q로 적는다(조립 단계가 추가질문 머리 앞의 Q를 문제로 분류한다).
- q-group: 추가질문 묶음 머리. text는 머리·배지 글자("A학생 추가질문", "추가질문", "질문〉"), label은 학생 글자("A"/"B"/"C", 없으면 ""). 배지는 그림이므로 이미지에서 읽는다. 추가질문 머리·배지가 보이면 반드시 q-group 블록을 낸다.
- q: 질문 하나. text는 번호·글머리를 뺀 문장, label은 정규화 번호("Q1", "Q2-1", "Q3-2"; 황변 글머리는 ""). 번호 오인식(Ql, QI, Q1O, Q3~2)은 label에서 바로잡는다. 질문 안 괄호 주석(복기자가 덧붙인 설명 괄호. 맨 앞의 제시문 항목 참조 "(가)에서"·"견해(3)"은 괄호 주석이 아니다)과 "/"로 병기된 두 질문은 text에 원문 그대로 두고 note에 "괄호 주석" 또는 "병기"라고 적는다. 쪽 머리에 q-group 없이 질문이 이어지면 그냥 q로 적는다. 질문 문장 자체가 앞 쪽에서 이어지면 cont: true. 해설 쪽의 "Q1." 줄도 q다.
- ref: "참고〉" 보충 설명. text 보이는 대로.
- skip: 머리말·꼬리말·옆탭·쪽 번호·QR 캡션·광고·안내문. text에는 건너뛴 내용을 짧게.

## 글자 규칙
- 이미지에 있는 글자를 그대로 적는다. 요약·바꿔 쓰기·오탈자 교정 금지(책에 오탈자가 있으면 그대로). 텍스트층은 참고일 뿐이고 오인식이 많다. 최종 판단은 이미지다.
- 따옴표·괄호·꺾쇠는 이미지의 모양대로(‘ ’ “ ” 〈 〉 『 』 ＜ ＞ < > 등). HTML 엔티티(&lt; 등)는 쓰지 않는다. 숫자·영문·한자도 그대로.
- 줄 안 띄어쓰기는 이미지대로. 텍스트층에 공백이 빠져 있어도 이미지에 띄어 있으면 띄운다.
- 모든 블록의 text는 빈 문자열이 아니어야 한다(skip 포함).`

const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    book: { type: 'string' },
    page: { type: 'integer' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['year-head', 'format', 'set-head', 'instruction', 'passage-head', 'para', 'figure', 'footnote', 'source', 'length', 'meta', 'ellipsis', 'task', 'q-group', 'q', 'ref', 'skip'] },
          text: { type: 'string' },
          label: { type: 'string' },
          marker: { type: 'string' },
          cont: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['type', 'text'],
      },
    },
  },
  required: ['book', 'page', 'blocks'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { block: { type: 'integer' }, kind: { type: 'string' }, expected: { type: 'string' }, got: { type: 'string' } },
        required: ['block', 'kind', 'expected', 'got'],
      },
    },
    skipped: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['ok', 'issues', 'summary'],
}

const pad = n => String(n).padStart(4, '0')
const png = p => `${A.root}\\work\\books\\${p.book}\\pages\\p${pad(p.page)}.png`
const txt = p => `${A.root}\\work\\books\\${p.book}\\pages\\p${pad(p.page)}.txt`
const bookNotes = p => `${BOOK[p.book]}${NOTES[p.book] ? `\n\n## 학교 주석(${A.short || A.school})\n${NOTES[p.book]}` : ''}`

function refinePrompt(p, hints) {
  const h = hints && hints.length ? `\n\n## 이전 시도에서 지적된 문제(반드시 고칠 것)\n${hints.map(i => `- 블록 ${i.block} [${i.kind}] 기대: ${i.expected} / 실제: ${i.got}`).join('\n')}` : ''
  return `당신은 스캔 교재의 한 쪽을 글자 그대로 구조화해 옮기는 전사자다.

${CONTEXT}

1) Read 도구로 쪽 이미지를 연다: ${png(p)}
2) Read 도구로 같은 쪽의 ABBYY OCR 텍스트층을 읽는다(참고용, 오인식 많음): ${txt(p)}
3) 이미지를 기준으로 아래 규칙대로 블록 JSON을 만들어 StructuredOutput으로 낸다. book은 "${p.book}", page는 ${p.page}.

${bookNotes(p)}

${RULES}${h}`
}

function verifyPrompt(p, result) {
  return `당신은 전사 검증자다. 다른 모델이 스캔 교재 한 쪽을 블록 JSON으로 옮겼다. Read 도구로 쪽 이미지 ${png(p)} 를 한 번 열어 아래 JSON과 한 줄 한 줄 대조하라. 필요하면 텍스트층 ${txt(p)} 을 한 번 더 Read할 수 있다(오인식 많음, 이미지가 기준). 도구 호출은 그 둘이 전부이고, 그다음 곧바로 StructuredOutput으로 결과를 낸다. 확대·재읽기·다른 도구는 쓰지 않는다.

${bookNotes(p)}

## 찾아야 할 문제(issues)
- 누락: 이미지에 있는 문장·질문·문항·각주·출처·분량 표기·그림 글자가 JSON에 없음(kind "누락").
- 변조: 단어·숫자·고유명사·한자어가 이미지와 다름, 요약이나 바꿔 쓰기(kind "변조").
- 띄어쓰기: 줄 안에서 이미지와 다르게 붙이거나 띄움(kind "띄어쓰기"). 줄 끝 이음은 어절이 자연스러우면 문제 삼지 않는다.
- 구조: 블록 유형이 틀림(본문을 meta로, 각주를 para로, 문항을 q로·질문을 task로, 질문 번호 label 오류, 학생 배지 글자 오류, passage-head label 오류, 하위 소제목을 passage-head로, 추가질문 머리 누락, 문단 경계 오류, 순서 오류)(kind "구조").
- 과잉 skip: 본문·질문·각주를 skip으로 처리함(kind "과잉skip").
무시할 것: 따옴표·괄호·꺾쇠의 전각/반각 모양 차이, 원문자 각주 기호의 위치(text 대신 marker에 있는 것은 맞음), 번호 없는 "제시문〉" 머리를 label ""로 둔 것, 김종수 책의 문제지 문항을 q로 적은 것.

## 출력
StructuredOutput으로 { ok, issues:[{block(0부터 블록 인덱스), kind, expected(이미지의 글자), got(JSON의 글자)}], skipped:[skip 블록들의 text], summary(한 문장) }. 누락·변조·구조·과잉skip이 하나라도 있으면 ok=false. 사소한 띄어쓰기 1~2곳만 있고 나머지가 정확하면 issues에 적되 ok=true로 둔다.

## 검증 대상 JSON
${JSON.stringify(result, null, 1)}`
}

/* 결정적 점검(모델 없음): 자리표시·전사 거부 블록, 빈 블록, 정제 글자 수가 텍스트층의 60% 미만이면 미흡 */
const PLACEHOLDER = /미전사|전사\s*(생략|보류)|본문\s*(생략|미전사)|원문\s*(생략|미전사)|요지만/
const REFUSAL = /저작권|옮기지\s*않|전사하지\s*않|생략했/
const PUNCT = /[\s　.,;:!?'"‘’“”「」『』〈〉《》<>＜＞()（）\[\]［］{}【】·•・…—–\-~～_/\|*※①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸]+/g
function measure(r) {
  const blocks = (r && r.blocks) || []
  const bad = [], empty = []
  let chars = 0
  blocks.forEach((b, i) => {
    const t = b.text || ''
    if (!t.trim()) empty.push(i)
    if (PLACEHOLDER.test(t) || PLACEHOLDER.test(b.note || '') || REFUSAL.test(b.note || '') || (b.type === 'skip' && REFUSAL.test(t))) bad.push(i)
    if (b.type !== 'skip') chars += t.replace(PUNCT, '').length
  })
  return { bad, empty, chars }
}

async function processPage(p) {
  let hints = null, best = null, bestScore = -1, bestModel = null, attempts = 0, ok = false, verdict = null
  for (let i = 0; i < PLAN.length; i++) {
    attempts = i + 1
    const model = PLAN[i]
    const r = await agent(refinePrompt(p, hints), { label: `refine:${p.book}-${p.page}#${attempts}:${model}`, phase: 'Refine', model, schema: PAGE_SCHEMA })
    if (!r) continue
    const m = measure(r)
    let pass = !m.bad.length && !m.empty.length && m.chars >= 0.6 * (p.abbyy || 0)
    const score = (m.bad.length || m.empty.length ? 0 : 1e6) + m.chars
    if (score > bestScore) { best = r; bestScore = score; bestModel = model }
    if (!pass) {
      hints = m.bad.map(b => ({ block: b, kind: '미전사', expected: '이미지에 보이는 글자를 그대로 옮긴 본문', got: (r.blocks[b].text || '').slice(0, 40) }))
        .concat(m.empty.map(b => ({ block: b, kind: '빈 블록', expected: '이미지의 글자', got: '' })))
      if (!hints.length) hints = [{ block: 0, kind: '누락', expected: `이 쪽의 본문 전체(텍스트층 기준 약 ${p.abbyy}자)`, got: `${m.chars}자만 옮김` }]
      log(`${p.book} p${p.page}: ${attempts}회 ${model} 미흡(자리표시 ${m.bad.length}, 빈 블록 ${m.empty.length}, ${m.chars}/${p.abbyy}자) → 재시도`)
      continue
    }
    if (A.verify) {
      const v = await agent(verifyPrompt(p, r), { label: `verify:${p.book}-${p.page}#${attempts}`, phase: 'Verify', model: 'sonnet', schema: VERDICT_SCHEMA })
      verdict = v
      if (v && !v.ok) { hints = v.issues; best = r; bestModel = model; log(`${p.book} p${p.page}: ${attempts}회 검증 issues ${v.issues.length} → 재시도`); continue }
    }
    ok = true; best = r; bestModel = model
    break
  }
  log(`${p.book} p${p.page}: ${attempts}회, ${ok ? '통과' : '미흡(최선 결과 유지)'} (${bestModel || '결과 없음'})`)
  return { book: p.book, page: p.page, attempts, result: best, verdict, model: bestModel, ok }
}

const out = await parallel(A.pages.map(p => () => processPage(p)))
const done = out.filter(Boolean)
log(`완료: ${done.length}/${A.pages.length}쪽, 통과 ${done.filter(o => o.ok).length}, Sonnet 결과 ${done.filter(o => o.model === 'sonnet').length}`)
return out
