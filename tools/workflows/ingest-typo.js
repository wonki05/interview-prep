export const meta = {
  name: 'ingest-typo',
  description: '정제된 쪽 블록(work/ocr)을 쪽 이미지와 대조해 글자 단위 전사 오류(오인식·삽입·잡문자·띄어쓰기·짧은 누락)만 찾는 간단한 오탈자 검수. Sonnet 쪽당 1회',
  phases: [
    { title: 'Typo', detail: 'Sonnet 5.5 쪽 단위 오탈자 검수', model: 'sonnet' },
  ],
}

/* 간단한 오탈자 검수(docs/INGEST.md §8). 인자는 tools/ocr_args.py --have-ocr 가 만든다:
   args = { root, school, short, notes: { kim, hwang }, pages: [{ book, page }] }
   결과 [{ book, page, fixes: [{ block, from, to, kind, reason }], bookTypos, longGaps, summary }] → tools/apply_fixes.py */
const A = args || {}
if (!A.root || !Array.isArray(A.pages) || !A.pages.length) throw new Error('args.root와 args.pages가 필요하다(tools/ocr_args.py --have-ocr)')
const NOTES = A.notes || {}

const SCHEMA = {
  type: 'object',
  properties: {
    book: { type: 'string' },
    page: { type: 'integer' },
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          block: { type: 'integer' },
          from: { type: 'string' },
          to: { type: 'string' },
          kind: { type: 'string', enum: ['오인식', '삽입', '잡문자', '띄어쓰기', '짧은누락'] },
          reason: { type: 'string' },
        },
        required: ['block', 'from', 'to', 'kind'],
      },
    },
    bookTypos: {
      type: 'array',
      items: { type: 'object', properties: { block: { type: 'integer' }, text: { type: 'string' }, reason: { type: 'string' } }, required: ['block', 'text'] },
    },
    longGaps: {
      type: 'array',
      items: { type: 'object', properties: { block: { type: 'integer' }, note: { type: 'string' } }, required: ['block', 'note'] },
    },
    summary: { type: 'string' },
  },
  required: ['book', 'page', 'fixes', 'summary'],
}

const pad = n => String(n).padStart(4, '0')
const png = p => `${A.root}\\work\\books\\${p.book}\\pages\\p${pad(p.page)}.png`
const ocr = p => `${A.root}\\work\\ocr\\${p.book}\\p${pad(p.page)}.json`

function prompt(p) {
  return `당신은 스캔 교재 전사의 교정자다. 다른 모델이 이 쪽을 블록 JSON으로 옮겨 두었다. 글자 단위 전사 오류만 찾는다.
1) Read 도구로 쪽 이미지를 연다: ${png(p)}
2) Read 도구로 전사 JSON을 연다: ${ocr(p)}  (blocks 배열. 인덱스는 0부터)
3) 곧바로 StructuredOutput으로 결과를 낸다. 도구 호출은 이 세 번이 전부다(재읽기·확대·다른 도구 금지). book은 "${p.book}", page는 ${p.page}.
${NOTES[p.book] ? `\n## 학교 주석(${A.short || A.school})\n${NOTES[p.book]}\n` : ''}
## 찾을 것(fixes) — type이 skip인 블록은 보지 않는다
- 오인식: 이미지와 다른 글자(예: 서물→서울, 幸가→추가, 학샘→학생, 비슷한 한자·숫자·영문 오인식).
- 삽입: 이미지에 없는 낱말·구절이 text에 끼어듦(to는 그것을 뺀 문자열).
- 잡문자: 이미지의 그 자리에 없는 기호·글자(옆탭·배지 조각 등)가 text에 섞임.
- 띄어쓰기: 줄 안에서 이미지와 다르게 붙거나 띄어진 곳. 줄 끝에서 갈라진 어절을 이은 자리는 문제 삼지 않는다.
- 짧은누락: 이미지에 있는데 text에서 빠진 한 줄 이하의 글자. 한 줄보다 긴 누락은 고치지 말고 longGaps에 적는다.

## 고치지 않을 것
- 책 자체의 오탈자(이미지에 그렇게 인쇄됨): bookTypos에 { block, text(그 글자), reason }으로만 적는다.
- 따옴표·괄호·꺾쇠의 전각/반각 모양, 블록 유형·순서·문단 나눔·label·marker, 문장 다듬기. 의미가 같아도 이미지와 글자가 다르면 오인식이다.

## fixes 쓰는 법
{ block, from, to, kind, reason }. from은 그 블록 text에 실제로 있는 문자열을 그대로 복사한다(그 블록 안에서 한 번만 나오도록 앞뒤 2~6자를 포함). to는 from을 이미지대로 고친 문자열. 고칠 곳이 없으면 fixes는 [].
summary는 한 문장(예: "오인식 2곳, 띄어쓰기 1곳").`
}

const out = await parallel(A.pages.map(p => async () => {
  const r = await agent(prompt(p), { label: `typo:${p.book}-${p.page}`, phase: 'Typo', model: 'sonnet', schema: SCHEMA })
  if (!r) { log(`${p.book} p${p.page}: 결과 없음`); return null }
  log(`${p.book} p${p.page}: 수정 ${r.fixes.length}, 책 오탈자 ${(r.bookTypos || []).length}, 긴 누락 ${(r.longGaps || []).length}`)
  return { book: p.book, page: p.page, fixes: r.fixes, bookTypos: r.bookTypos || [], longGaps: r.longGaps || [], summary: r.summary }
}))
const done = out.filter(Boolean)
log(`완료: ${done.length}/${A.pages.length}쪽, 수정 ${done.reduce((n, o) => n + o.fixes.length, 0)}곳`)
return out
