export const meta = {
  name: 'ingest-themes',
  description: '기출 세트의 제시문별 주제어(themes)와 세트 태그(tags) 초안을 Sonnet이 세트당 1회 만든다(학교 공통). themes가 정해진 세트는 태그만 정한다',
  phases: [
    { title: 'Themes', detail: 'Sonnet 5.5 세트당 1회', model: 'sonnet' },
  ],
}

/* 주제어·태그(docs/INGEST.md §2-C·§8). 인자는 tools/ocr_args.py --themes 가 만든다:
   args = { root, school: "고려대", sets: [{ id, n, kim, hwang, labeled, themes? }] }
   결과 [{ id, themes, tags }] → tools/apply_themes.py */
const A = args || {}
if (!A.root || !Array.isArray(A.sets) || !A.sets.length) throw new Error('args.root와 args.sets가 필요하다(tools/ocr_args.py --themes)')
const TAGS = ['법철학', '정치·민주주의', '사회·공동체', '과학기술·AI', '윤리', '경제·시장', '역사', '언어·인식', '생명·환경', '문화·예술', '법·제도']

function schemaFor(n) {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      themes: { type: 'array', items: { type: 'string' }, minItems: n, maxItems: n },
      tags: { type: 'array', items: { type: 'string', enum: TAGS }, minItems: 2, maxItems: 4 },
    },
    required: ['id', 'themes', 'tags'],
  }
}

function prompt(s) {
  const dir = `${A.root}\\data\\sets\\${s.id}`
  const files = [`${dir}\\meta.json`].concat(s.kim !== false ? [`${dir}\\kim.json`] : []).concat(s.hwang ? [`${dir}\\hwang.json`] : [])
  const fixed = s.themes
    ? `- 이 세트는 themes가 이미 정해져 있다. themes에는 아래 값을 글자 하나 바꾸지 말고 그대로 돌려준다: ${JSON.stringify(s.themes)}`
    : `- themes: 기본 복기본(meta.json의 variant)의 제시문 ${s.n}개에 하나씩, 제시문 순서대로(no 1부터${s.labeled ? '. 제시문에 (가)·(A)·사례 같은 label이 붙어 있다' : ''}). 각 항목은 그 제시문의 중심 논점을 12자 안팎(대략 6~18자)의 명사구로 적는다. 문장·서술어·따옴표·마침표 없이. 저자·책 이름보다 논점을 쓰고, 필요하면 괄호로 핵심 사례·개념을 덧붙인다. 같은 세트 안에서 서로 구별되게 쓴다. 사례 목록 하나가 제시문 하나면 목록 전체의 공통 논점을 쓴다.
  예(다른 세트의 확정값): "클루지와 환경적 스캐폴딩", "세습 군주정과 선출", "지식의 원천", "원숭이 공정성 실험", "장애와 연대", "로봇과 명령 복종(네스터 10호)", "fides의 오해"`
  return `당신은 ${A.school} 로스쿨 면접 기출 세트 ${s.id}의 주제어와 태그를 정하는 편집자다.
Read 도구로 다음 파일을 한 번씩 읽는다(이것이 도구 호출의 전부다. 다른 파일·도구·재읽기 금지):
${files.map((f, i) => `${i + 1}) ${f}`).join('\n')}
그다음 곧바로 StructuredOutput으로 { id, themes, tags }를 낸다. id는 "${s.id}".

- kim.json은 김종수 복기본, hwang.json은 황변 복기본이다(있는 것만). 두 복기본의 제시문 수·순서가 다를 수 있으니 기본 복기본을 기준으로 센다. 한쪽 본문이 짧거나 요약이면 다른 쪽으로 판단한다. tasks(문제지 문항), passages[].notes(복기자 설명), followups(복기된 추가질문)도 참고한다.
${fixed}
- tags: 세트 전체(제시문·문항·추가질문)가 다루는 주제를 대표하는 태그 2~4개를 중요한 순서로. 다음 목록의 표기 그대로만 쓴다: ${TAGS.join(', ')}.`
}

async function run(s) {
  const r = await agent(prompt(s), { label: `themes:${s.id}`, phase: 'Themes', model: 'sonnet', schema: schemaFor(s.n) })
  if (!r) { log(`${s.id}: 결과 없음`); return null }
  const themes = s.themes ? s.themes.slice() : (r.themes || []).map(t => String(t).trim()).filter(Boolean)
  const tags = []
  for (const t of r.tags || []) { const v = String(t).trim(); if (TAGS.includes(v) && !tags.includes(v)) tags.push(v) }
  if (themes.length !== s.n) log(`${s.id}: themes ${themes.length}개 ≠ 제시문 ${s.n}개`)
  if (tags.length < 2) log(`${s.id}: 태그 ${tags.length}개`)
  log(`${s.id}: ${themes.join(' | ')}  [${tags.slice(0, 4).join(', ')}]`)
  return { id: s.id, themes, tags: tags.slice(0, 4) }
}

const out = await parallel(A.sets.map(s => () => run(s)))
log(`완료: ${out.filter(Boolean).length}/${A.sets.length}세트`)
return out
