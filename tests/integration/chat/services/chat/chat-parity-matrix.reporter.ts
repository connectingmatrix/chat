import fs from 'node:fs';

type CaseTimingRecord = {
  type: 'case';
  caseLabel: string;
  durationSeconds: number;
  endedAt: string;
  startedAt: string;
  status: 'passed' | 'failed';
  system: string;
  errorMessage: string | null;
};

type PromptTimingRecord = {
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

const counters = new Map<string, number>();

const reportFile = () =>
  process.env.CHAT_PARITY_REPORT_FILE || `${process.cwd()}/packages/apps/chat/src/services/chat/__tests__/artifacts/chat-parity-matrix-report.jsonl`;

const append = (value: PromptTimingRecord | CaseTimingRecord) => {
  fs.appendFileSync(reportFile(), `${JSON.stringify(value)}\n`, 'utf8');
};

export const resetParityReportFile = () => {
  fs.writeFileSync(reportFile(), '', 'utf8');
};

export const logCaseTiming = (value: Omit<CaseTimingRecord, 'type'>) => append({ type: 'case', ...value });

export const logPromptTiming = (value: Omit<PromptTimingRecord, 'type' | 'promptIndexInCase'>) => {
  const key = `${value.system}::${value.caseLabel}`;
  const next = (counters.get(key) || 0) + 1;
  counters.set(key, next);
  append({ type: 'prompt', promptIndexInCase: next, ...value });
};
