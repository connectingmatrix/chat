import fs from 'node:fs';

type PromptRecord = {
  type: 'prompt';
  caseLabel: string;
  confirmMessageSent: string | null;
  confirmationResponseText: string | null;
  confirmationSeconds: number | null;
  finalResponseText: string;
  messageSent: string;
  pendingSeconds: number;
  postConfirmationText: string | null;
  promptIndexInCase: number;
  system: string;
  totalSeconds: number;
};

type CaseRecord = {
  type: 'case';
  caseLabel: string;
  durationSeconds: number;
  status: 'passed' | 'failed';
  system: string;
};

const reportFile = process.env.CHAT_PARITY_REPORT_FILE || '/tmp/chat-parity-matrix-report.jsonl';
const outputFile = process.env.CHAT_PARITY_COMPARISON_FILE || '/tmp/chat-parity-matrix-comparison.csv';
const lines = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8').split('\n').filter(Boolean) : [];
const records = lines.map((line) => JSON.parse(line) as PromptRecord | CaseRecord);
const prompts = records.filter((entry) => entry.type === 'prompt') as PromptRecord[];
const cases = records.filter((entry) => entry.type === 'case') as CaseRecord[];
const byCase = new Map(cases.map((entry) => [`${entry.system}::${entry.caseLabel}`, entry] as const));
const byPrompt = new Map(prompts.map((entry) => [`${entry.system}::${entry.caseLabel}::${entry.promptIndexInCase}`, entry] as const));
const keys = Array.from(new Set(prompts.map((entry) => `${entry.caseLabel}::${entry.promptIndexInCase}`))).sort((a, b) => a.localeCompare(b));
const clean = (value: string | null | undefined) =>
  `"${String(value || '')
    .replace(/"/g, '""')
    .replace(/\s+/g, ' ')
    .trim()}"`;
const rows = [
  'case_label,prompt_index,message_sent,confirm_message,chat_only_seconds,workflow_ai_agent_seconds,delta_seconds,chat_only_case_seconds,workflow_ai_agent_case_seconds,chat_only_case_status,workflow_ai_agent_case_status,chat_only_confirmation_text,workflow_ai_agent_confirmation_text,chat_only_post_confirmation,workflow_ai_agent_post_confirmation',
];
for (const key of keys) {
  const [caseLabel, promptIndexText] = key.split('::');
  const promptIndex = Number(promptIndexText);
  const chat = byPrompt.get(`chat-only::${caseLabel}::${promptIndex}`);
  const ai = byPrompt.get(`workflow-ai-agent::${caseLabel}::${promptIndex}`);
  const chatCase = byCase.get(`chat-only::${caseLabel}`);
  const aiCase = byCase.get(`workflow-ai-agent::${caseLabel}`);
  const delta = chat && ai ? Number((ai.totalSeconds - chat.totalSeconds).toFixed(3)) : '';
  rows.push(
    [
      clean(caseLabel),
      promptIndex,
      clean(chat?.messageSent || ai?.messageSent || ''),
      clean(chat?.confirmMessageSent || ai?.confirmMessageSent || ''),
      chat?.totalSeconds ?? '',
      ai?.totalSeconds ?? '',
      delta,
      chatCase?.durationSeconds ?? '',
      aiCase?.durationSeconds ?? '',
      clean(chatCase?.status || ''),
      clean(aiCase?.status || ''),
      clean(chat?.confirmationResponseText || ''),
      clean(ai?.confirmationResponseText || ''),
      clean(chat?.postConfirmationText || ''),
      clean(ai?.postConfirmationText || ''),
    ].join(','),
  );
}
fs.writeFileSync(outputFile, `${rows.join('\n')}\n`, 'utf8');
console.log(`comparison_rows=${rows.length - 1}`);
console.log(`comparison_file=${outputFile}`);
