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

  /* 세션 단위 재정의(override: {provider, model, effort})가 있으면 그것을, 없으면 설정의 기본값을 쓴다. */
  function resolve(override) {
    const s = S();
    const provider = (override && override.provider) || s.provider;
    const model = (override && override.model) || (provider === "anthropic" ? s.anthropicModel : s.openaiModel);
    const key = String((provider === "anthropic" ? s.anthropicKey : s.openaiKey) || "").trim();
    const M = window.SNU.models;
    const value = override && override.effort !== undefined ? override.effort : (provider === "anthropic" ? s.anthropicEffort : s.openaiEffort);
    const effort = M.normalizeEffort(provider, model, value);
    return { provider, model, effort, key, configured: !!key, label: M.providerLabel(provider) + " " + M.label(provider, model), modelLabel: M.label(provider, model) };
  }

  function responseError(message, retryable, truncated) {
    const error = new Error(message);
    error.retryable = !!retryable;
    error.truncated = !!truncated;
    return error;
  }
  function schemaFor(fields) {
    return { type: "object", properties: Object.fromEntries(fields.map(name => [name, { type: "string" }])), required: fields, additionalProperties: false };
  }
  const QUESTION_SCHEMA = schemaFor(["question", "focus", "why"]);
  const RESPONSE_SCHEMA = schemaFor(["feedback", "followup"]);

  /* 추론 토큰도 출력 한도에 포함되므로 화면에 보일 답변 길이와 분리해 예산을 잡는다. */
  function tokenLimit(ai, requested) {
    const budgets = { none: 2048, minimal: 4096, low: 4096, medium: 8192, high: 16384, xhigh: 24576, max: 32768 };
    return Math.max(requested || 0, budgets[ai.effort] || 2048);
  }
  function requestBody(ai, system, user, maxTokens, opts) {
    const structured = window.SNU.models.list(ai.provider).some(model => model.id === ai.model);
    if (ai.provider === "anthropic") {
      const body = { model: ai.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
      const output = {};
      if (ai.effort) output.effort = ai.effort;
      if (opts.schema && structured) output.format = { type: "json_schema", schema: opts.schema };
      if (Object.keys(output).length) body.output_config = output;
      return body;
    }
    const body = { model: ai.model, max_completion_tokens: maxTokens, store: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    if (ai.effort) body.reasoning_effort = ai.effort;
    if (opts.schema && structured) body.response_format = { type: "json_schema", json_schema: { name: opts.schemaName || "interview_response", strict: true, schema: opts.schema } };
    return body;
  }
  function responseText(data, provider) {
    if (!data || typeof data !== "object") throw responseError("API 응답 형식이 올바르지 않다. 다시 시도한다.", true);
    let text = "";
    if (provider === "anthropic") {
      if (data.stop_reason === "refusal") throw responseError("모델이 응답을 거절했다.");
      if (data.stop_reason === "max_tokens") throw responseError("출력 한도에 도달했다. 추론 강도를 낮춰 다시 시도한다.", true, true);
      if (data.stop_reason === "model_context_window_exceeded") throw responseError("대화가 모델의 입력 한도를 넘었다.");
      text = (Array.isArray(data.content) ? data.content : []).filter(c => c.type === "text").map(c => c.text || "").join("");
    } else {
      const choice = data.choices && data.choices[0], message = choice && choice.message;
      if (message && message.refusal || choice && choice.finish_reason === "content_filter") throw responseError("모델이 응답을 거절했다.");
      if (choice && choice.finish_reason === "length") throw responseError("출력 한도에 도달했다. 추론 강도를 낮춰 다시 시도한다.", true, true);
      const content = message && message.content;
      text = typeof content === "string" ? content : (Array.isArray(content) ? content.filter(c => c.type === "text").map(c => c.text || "").join("") : "");
    }
    if (!text.trim()) throw responseError("모델의 답변이 비어 있다. 다시 시도한다.", true);
    return text;
  }
  async function apiError(response, provider) {
    let type = "";
    try { const data = await response.json(); type = (data.error && (data.error.code || data.error.type)) || ""; } catch (_) { /* 원문 오류는 키·입력을 포함할 수 있어 표시하지 않는다. */ }
    const label = provider === "anthropic" ? "Anthropic" : "OpenAI";
    if (response.status === 401) return new Error(label + ": API 키를 확인한다 (401).");
    if (response.status === 403) return new Error(label + ": 모델 접근 권한을 확인한다 (403).");
    if (type === "insufficient_quota" || type === "billing_error" || response.status === 402) return new Error(label + ": API 잔액·결제 한도를 확인한다.");
    if (response.status === 429) return new Error(label + ": 호출 한도에 도달했다 (429).");
    if (response.status >= 500) return new Error(label + ": 서버 오류. 잠시 뒤 다시 시도한다 (" + response.status + ").");
    return new Error(label + ": 모델·요청 설정을 확인한다 (" + response.status + ").");
  }
  async function chat(system, user, opts) {
    opts = opts || {};
    const ai = resolve(opts.ai);
    if (!ai.configured) throw new Error("API 키가 없다. 설정에서 입력한다.");
    let maxTokens = tokenLimit(ai, opts.maxTokens);
    const anthropic = ai.provider === "anthropic";
    const url = anthropic ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/chat/completions";
    const headers = anthropic
      ? { "content-type": "application/json", "x-api-key": ai.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
      : { "content-type": "application/json", "authorization": "Bearer " + ai.key };
    /* 잘림·빈 답변·형식 오류만 한 번 재시도한다. 인증·과금·거부 오류는 반복하지 않는다. */
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try { response = await fetch(url, { method: "POST", headers, body: JSON.stringify(requestBody(ai, system, user, maxTokens, opts)) }); }
      catch (_) { throw new Error("API에 연결하지 못했다. 네트워크를 확인한다."); }
      if (!response.ok) throw await apiError(response, ai.provider);
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error("API 응답 형식을 읽지 못했다."); }
      try {
        const text = responseText(data, ai.provider);
        if (opts.schema) validateJson(parseJson(text), opts.schema);
        return text;
      } catch (error) {
        if (!error.retryable || attempt) throw error;
        if (error.truncated) maxTokens = Math.min(maxTokens * 2, 65536);
      }
    }
  }
  function parseJson(text) {
    if (typeof text !== "string" || !text.trim()) throw responseError("모델의 답변이 비어 있다. 다시 시도한다.", true);
    const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let value;
    try { value = JSON.parse(clean); }
    catch (_) { throw responseError("모델의 JSON 응답 형식이 올바르지 않다. 다시 시도한다.", true); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw responseError("모델의 JSON 응답 형식이 올바르지 않다. 다시 시도한다.", true);
    return value;
  }
  function validateJson(value, schema) {
    if (schema.required.some(name => typeof value[name] !== "string" || !value[name].trim()) || Object.keys(value).some(name => !Object.prototype.hasOwnProperty.call(schema.properties, name))) {
      throw responseError("모델 답변의 필수 항목이 없거나 형식이 다르다. 다시 시도한다.", true);
    }
    return value;
  }

  /* ---------- 세트 헬퍼 ---------- */
  function bank(set) {
    const out = [];
    set.followups.forEach(f => f.items.forEach((q, i) => out.push({ q, group: f.label, student: f.student, idx: i + 1, key: f.student + "-" + (i + 1) })));
    (set.common || []).forEach(c => c.items.forEach((q, i) => out.push({ q, group: c.label, student: "공통", idx: i + 1, key: "common-" + c.label + "-" + (i + 1) })));
    return out;
  }
  /* 제시문 머리: 책의 원표기(label)가 있으면 함께 적는다. 한 글자((가)·(A))는 번호 뒤에, 낱말(사례·사례 1·에피소드)은 그대로 머리로. */
  function passageHead(p) { return p.label && p.label.length > 1 ? `<${p.label}>` : `<제시문 ${p.no}>${p.label ? ` (${p.label})` : ""}`; }
  function passagesText(set) { return set.passages.map(p => `${passageHead(p)}${p.length ? " (" + p.length + ")" : ""}\n${p.text}`).join("\n\n"); }
  /* 문제지 문항(tasks): 면접 전에 받는 문제(고려대·연세대 등). 서울대 세트에는 없다. */
  function taskHead(t) { return t.label ? `문제 ${t.label}` : "문제"; }
  function tasksText(set) { return (set.tasks || []).map(t => `${taskHead(t)}. ${t.text}`).join("\n"); }
  function setContext(set) {
    const tasks = (set.tasks || []).length ? `\n[문제]\n${tasksText(set)}` : "";
    return `[면접 세트] ${set.year}학년도 ${set.name} (${set.session})${set.variantLabel ? ` · 복기본: ${set.variantLabel}` : ""}\n[지시문] ${set.instruction}${tasks}\n\n[제시문 전문]\n${passagesText(set)}\n\n[복기된 실제 추가질문 전체]\n${bank(set).map((q, i) => `${i + 1}. (${q.group}) ${q.q}`).join("\n")}`;
  }

  /* ---------- 모의면접: 다음 질문 ---------- */
  function schoolOf(set) { return (window.INTERVIEW_DB.schools || []).find(s => s.id === set.school) || { name: "법학전문대학원" }; }
  function interviewerSystem(set, difficulty, variation, plan) {
    const lv = LV(), sc = schoolOf(set), prep = (plan && plan.prep) || set.format.prep || 20, dur = plan && plan.interview > 0 ? plan.interview + "분간" : (plan ? "시간 제한 없이" : (set.format.duration || 15) + "분간");
    const nProf = parseInt(String(set.format.ratio || "3:1"), 10) || 3, profs = (["", "한", "두", "세", "네", "다섯"][nProf] || nProf) + " 명";   // format.ratio "2:1" → 두 명
    return `당신은 ${sc.name} 법학전문대학원 ${set.year}학년도 면접관이다. 교수 ${profs}이 지원자 한 명을 ${dur} 면접한다. 지원자는 아래 제시문을 ${prep}분간 읽고 메모했다.
난이도 지침(${lv.difficulty[difficulty].label}): ${lv.difficulty[difficulty].desc}
변형도 지침(${lv.variation[variation].label}): ${lv.variation[variation].desc}
규칙: 한 번에 질문 하나만 낸다. 질문은 세 문장 이내의 구어체 존댓말로 쓴다("~입니까?", "~해 보십시오"). 지원자의 직전 답변을 반영해 꼬리질문을 하되, 같은 소재에 세 번 이상 머물렀으면 다른 제시문으로 옮긴다. 답변이 비어 있거나 전사가 깨졌으면 같은 질문을 더 짧게 다시 묻는다. 제시문 내용은 바꾸거나 지어내지 않는다. 지원자를 평가하는 말은 하지 않는다.
출력은 JSON 하나만: {"question": "질문", "focus": "제시문 번호 또는 '종합'", "why": "출제 의도 한 문장"}`;
  }
  function buildNextQuestionInput(set, history, difficulty, variation, plan) {
    const first = (set.tasks || []).length ? "(아직 질문하지 않았다. 첫 질문은 문제지 문항에 대한 답변(기조 발언)을 요청한다.)" : "(아직 질문하지 않았다. 첫 질문은 보통 제시문 요약이나 공통 주제에서 시작한다.)";
    const hist = history.length ? history.map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a || "(답변 없음)"}`).join("\n\n") : first;
    return { system: interviewerSystem(set, difficulty, variation, plan), user: `${setContext(set)}\n\n[지금까지의 문답]\n${hist}\n\n다음 질문을 JSON으로 만들어라.` };
  }
  async function nextQuestion(set, history, difficulty, variation, ai, plan) {
    const inp = buildNextQuestionInput(set, history, difficulty, variation, plan);
    return parseJson(await chat(inp.system, inp.user, { ai, maxTokens: 2048, schema: QUESTION_SCHEMA, schemaName: "interview_question" }));
  }
  async function classify(answer, branches, ai) {
    const out = await chat("지원자의 답변을 읽고 아래 분류 가운데 가장 맞는 것의 번호만 출력한다. 다른 말은 쓰지 않는다.",
      `[답변]\n${answer || "(답변 없음)"}\n\n[분류]\n${branches.map((b, i) => `${i + 1}. ${b.when}`).join("\n")}`, { ai, maxTokens: 10 });
    const n = /^\d+$/.test(out.trim()) ? Number(out.trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > branches.length) throw new Error("분류 응답이 올바르지 않다. 분기를 직접 선택한다.");
    return n - 1;
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
    return parseJson(await chat(inp.system, inp.user, { ai, maxTokens: 2048, schema: RESPONSE_SCHEMA, schemaName: "interview_feedback" }));
  }

  window.AIClient = { resolve, chat, parseJson, bank, passageHead, passagesText, taskHead, tasksText, setContext, interviewerSystem, buildNextQuestionInput, nextQuestion, classify, buildDbInput, respond };
})();
