/* ============================================================
   AI 모델 목록 — 설정 서랍·모의면접 옵션 창·기출DB의 모델 선택 목록.
   id는 API에 보내는 문자열, label은 화면 표시명. 상위 모델부터 적고, 같은 등급은 새 버전을 위에 둔다.
   기본값은 목록 순서가 아니라 assets/app.js DEFAULTS. 새 모델이 나오면 등급 자리에 한 줄 추가하고
   effort를 보낼 모델이면 assets/app.js SNU.models.effortOptions에도 id를 넣는다.
   출처(2026-11-24 확인): Anthropic 모델 개요(platform.claude.com/docs/en/models/overview),
                         OpenAI 모델 목록(developers.openai.com/api/docs/models)·가격표(developers.openai.com/api/docs/pricing).
   ============================================================ */
window.MODEL_CATALOG = {
  anthropic: [
    { id: "claude-fable-5-2",  label: "Fable 5.2",  note: "최상위. 트리 생성 같은 오프라인 작업용" },
    { id: "claude-fable-5-1",  label: "Fable 5.1",  note: "이전 최상위" },
    { id: "claude-opus-5-5",   label: "Opus 5.5",   note: "정교. 느리고 비쌈" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "기본. 속도·품질 균형" },
    { id: "claude-haiku-5-5",  label: "Haiku 5.5",  note: "가장 빠름. 분기 분류에 알맞음" }
  ],
  openai: [
    { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", note: "최상위. 비쌈" },
    { id: "gpt-6-astra",   label: "GPT-6 Astra",   note: "이전 Astra" },
    { id: "gpt-6.2-sol",   label: "GPT-6.2 Sol",   note: "속도·품질 균형" },
    { id: "gpt-6.1-sol",   label: "GPT-6.1 Sol",   note: "기본. 이전 Sol" },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", note: "저렴" },
    { id: "gpt-6-luna",    label: "GPT-6 Luna",    note: "가장 저렴·빠름. 분기 분류에 알맞음" }
  ],
  /* 녹음 전사(build 단계, docs/TRANSCRIPTION.md). Claude API는 오디오 입력이 없어 OpenAI 쪽만 있다.
     파일 전사(v1/audio/transcriptions) 모델만 둔다. gpt-4o 계열은 2027-02-26 지원 종료 예정. */
  transcription: [
    { id: "gpt-transcribe",         label: "GPT Transcribe",         note: "기본. $0.0045/분" },
    { id: "gpt-4o-transcribe",      label: "GPT-4o Transcribe",      note: "$0.006/분" },
    { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", note: "$0.003/분" }
  ]
};
