/* ============================================================
   AI 클라이언트 — 모의면접(practice.js)과 기출DB(db.js)가 함께 쓴다.
   · 제공사: Anthropic Messages API / OpenAI Chat Completions, 브라우저에서 직접 호출(서버 없음)
   · 모든 호출의 입력에는 해당 세트의 제시문 전문과 복기 질문 전체가 들어간다(setContext).
   · build*Input 함수는 실제로 보내는 system/user 문자열을 그대로 돌려주므로 화면에서 '보내는 입력 보기'로 확인할 수 있다.
   ============================================================ */
(function () {
  "use strict";
  const S = () => window.SNU.settings;
  const LV = () => window.INTERVIEW_DB.levels;

  /* 세션 단위 재정의(override: {provider, model})가 있으면 그것을, 없으면 설정의 기본값을 쓴다. */
  function resolve(override) {
    const s = S();
    const provider = (override && override.provider) || s.provider;
    const model = (override && override.model) || (provider === "anthropic" ? s.anthropicModel : s.openaiModel);
    const key = provider === "anthropic" ? s.anthropicKey : s.openaiKey;
    const M = window.SNU.models;
    return { provider, model, key, configured: !!key, label: M.providerLabel(provider) + " " + M.label(provider, model), modelLabel: M.label(provider, model) };
  }

  async function chat(system, user, opts) {
    const ai = resolve(opts && opts.ai), maxTokens = (opts && opts.maxTokens) || 600;
    if (!ai.configured) throw new Error("API 키가 없다. 설정에서 입력한다.");
    if (ai.provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ai.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] })
      });
      if (!r.ok) throw new Error("Anthropic API " + r.status + ": " + (await r.text()).slice(0, 200));
      const j = await r.json(); return (j.content || []).map(c => c.text || "").join("");
    }
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + ai.key },
      body: JSON.stringify({ model: ai.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] })
    });
    if (!r.ok) throw new Error("OpenAI API " + r.status + ": " + (await r.text()).slice(0, 200));
    const j = await r.json(); return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  }
  function parseJson(text) { const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/); if (!m) throw new Error("응답에 JSON이 없다: " + text.slice(0, 80)); return JSON.parse(m[0]); }

  /* ---------- 세트 헬퍼 ---------- */
  function bank(set) {
    const out = [];
    set.followups.forEach(f => f.items.forEach((q, i) => out.push({ q, group: f.label, student: f.student, idx: i + 1, key: f.student + "-" + (i + 1) })));
    (set.common || []).forEach(c => c.items.forEach((q, i) => out.push({ q, group: c.label, student: "공통", idx: i + 1, key: "common-" + c.label + "-" + (i + 1) })));
    return out;
  }
  function passagesText(set) { return set.passages.map(p => `<제시문 ${p.no}>${p.length ? " (" + p.length + ")" : ""}\n${p.text}`).join("\n\n"); }
  function setContext(set) {
    return `[면접 세트] ${set.year}학년도 ${set.name} (${set.session})\n[지시문] ${set.instruction}\n\n[제시문 전문]\n${passagesText(set)}\n\n[복기된 실제 추가질문 전체]\n${bank(set).map((q, i) => `${i + 1}. (${q.group}) ${q.q}`).join("\n")}`;
  }

  /* ---------- 모의면접: 다음 질문 ---------- */
  function schoolOf(set) { return (window.INTERVIEW_DB.schools || []).find(s => s.id === set.school) || { name: "법학전문대학원" }; }
  function interviewerSystem(set, difficulty, variation, plan) {
    const lv = LV(), sc = schoolOf(set), prep = (plan && plan.prep) || set.format.prep || 20, dur = plan && plan.interview > 0 ? plan.interview + "분간" : (plan ? "시간 제한 없이" : (set.format.duration || 15) + "분간");
    return `당신은 ${sc.name} 법학전문대학원 ${set.year}학년도 면접관이다. 교수 세 명이 지원자 한 명을 ${dur} 면접한다. 지원자는 아래 제시문을 ${prep}분간 읽고 메모했다.
난이도 지침(${lv.difficulty[difficulty].label}): ${lv.difficulty[difficulty].desc}
변형도 지침(${lv.variation[variation].label}): ${lv.variation[variation].desc}
규칙: 한 번에 질문 하나만 낸다. 질문은 세 문장 이내의 구어체 존댓말로 쓴다("~입니까?", "~해 보십시오"). 지원자의 직전 답변을 반영해 꼬리질문을 하되, 같은 소재에 세 번 이상 머물렀으면 다른 제시문으로 옮긴다. 답변이 비어 있거나 전사가 깨졌으면 같은 질문을 더 짧게 다시 묻는다. 제시문 내용은 바꾸거나 지어내지 않는다. 지원자를 평가하는 말은 하지 않는다.
출력은 JSON 하나만: {"question": "질문", "focus": "제시문 번호 또는 '종합'", "why": "출제 의도 한 문장"}`;
  }
  function buildNextQuestionInput(set, history, difficulty, variation, plan) {
    const hist = history.length ? history.map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a || "(답변 없음)"}`).join("\n\n") : "(아직 질문하지 않았다. 첫 질문은 보통 제시문 요약이나 공통 주제에서 시작한다.)";
    return { system: interviewerSystem(set, difficulty, variation, plan), user: `${setContext(set)}\n\n[지금까지의 문답]\n${hist}\n\n다음 질문을 JSON으로 만들어라.` };
  }
  async function nextQuestion(set, history, difficulty, variation, ai, plan) {
    const inp = buildNextQuestionInput(set, history, difficulty, variation, plan);
    return parseJson(await chat(inp.system, inp.user, { ai, maxTokens: 500 }));
  }
  async function classify(answer, branches, ai) {
    const out = await chat("지원자의 답변을 읽고 아래 분류 가운데 가장 맞는 것의 번호만 출력한다. 다른 말은 쓰지 않는다.",
      `[답변]\n${answer || "(답변 없음)"}\n\n[분류]\n${branches.map((b, i) => `${i + 1}. ${b.when}`).join("\n")}`, { ai, maxTokens: 10 });
    const n = parseInt((out.match(/\d+/) || ["1"])[0], 10); return Math.min(branches.length, Math.max(1, n)) - 1;
  }

  /* ---------- 기출DB: 개별 질문 문답 ---------- */
  function dbSystem(set) {
    return `당신은 ${schoolOf(set).name} 법학전문대학원 ${set.year}학년도 면접관이다. 지원자가 복기된 기출 질문 하나에 답한다. 아래 제시문 전문을 근거로 답변을 검토한다.
역할: (1) 답변에서 제시문을 정확히 읽었는지, 논증의 구조(주장–근거–반론 처리)가 서 있는지 두세 문장으로 짚는다. 칭찬보다 빠진 것을 말한다. (2) 그 답변을 겨냥한 꼬리질문을 하나 낸다. 구어체 존댓말, 세 문장 이내. 제시문 내용은 바꾸거나 지어내지 않는다.
출력은 JSON 하나만: {"feedback": "검토 두세 문장", "followup": "꼬리질문 하나"}`;
  }
  function buildDbInput(set, question, thread) {
    const t = thread.length ? thread.map(m => m.role === "user" ? "지원자: " + m.text : "면접관(검토): " + m.text + (m.followup ? "\n면접관(꼬리질문): " + m.followup : "")).join("\n\n") : "(아직 답변이 없다)";
    return { system: dbSystem(set), user: `${setContext(set)}\n\n[이번에 다루는 질문]\n${question}\n\n[문답 기록]\n${t}\n\n마지막 지원자 답변을 검토하고 꼬리질문을 JSON으로 내라.` };
  }
  async function respond(set, question, thread, ai) {
    const inp = buildDbInput(set, question, thread);
    return parseJson(await chat(inp.system, inp.user, { ai, maxTokens: 600 }));
  }

  window.AIClient = { resolve, chat, parseJson, bank, passagesText, setContext, interviewerSystem, buildNextQuestionInput, nextQuestion, classify, buildDbInput, respond };
})();
