import fs from 'node:fs';
import ExcelJS from 'exceljs';

type PromptRecord = {
  type: 'prompt';
  caseLabel: string;
  confirmMessageSent: string | null;
  confirmationResponseText: string | null;
  finalResponseText: string;
  messageSent: string;
  postConfirmationText: string | null;
  promptIndexInCase: number;
  system: string;
  totalSeconds: number;
};
type CaseRecord = { type: 'case'; caseLabel: string; durationSeconds: number; status: 'passed' | 'failed'; system: string };

async function main() {
  const reportFile = process.env.CHAT_PARITY_REPORT_FILE || '/tmp/chat-parity-matrix-report.jsonl';
  const outputFile = process.env.CHAT_PARITY_WORKBOOK_FILE || '/tmp/chat-parity-matrix-report.xlsx';
  const lines = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8').split('\n').filter(Boolean) : [];
  const records = lines.map((line) => JSON.parse(line) as PromptRecord | CaseRecord);
  const prompts = records.filter((value) => value.type === 'prompt') as PromptRecord[];
  const cases = records.filter((value) => value.type === 'case') as CaseRecord[];
  const byCase = new Map(cases.map((value) => [`${value.system}::${value.caseLabel}`, value] as const));
  const byPrompt = new Map(prompts.map((value) => [`${value.system}::${value.caseLabel}::${value.promptIndexInCase}`, value] as const));
  const systems = [
    { key: 'chat-only', sheet: 'queryChat' },
    { key: 'workflow-ai-agent', sheet: 'AI Agent Workflow' },
  ];
  const workbook = new ExcelJS.Workbook();
  for (const system of systems) {
    const sheet = workbook.addWorksheet(system.sheet);
    sheet.addRow([
      'Case (message we sent)',
      'Confirm Prompt We Recieved',
      'Confirmation We Sent',
      'Confrimation Response',
      'Final Chat Message Output',
      'Status Pass/ Fail',
      'Time taken by the case (seconds)',
    ]);
    for (const prompt of prompts.filter((value) => value.system === system.key)) {
      const caseRow = byCase.get(`${system.key}::${prompt.caseLabel}`);
      sheet.addRow([
        prompt.messageSent,
        prompt.confirmationResponseText || '',
        prompt.confirmMessageSent || '',
        prompt.postConfirmationText || '',
        prompt.finalResponseText,
        caseRow?.status || '',
        caseRow?.durationSeconds || prompt.totalSeconds,
      ]);
    }
    sheet.columns.forEach((column) => {
      column.width = 36;
    });
  }
  const comparison = workbook.addWorksheet('comparison');
  comparison.addRow([
    'Case',
    'Prompt Index',
    'queryChat Seconds',
    'AI Agent Workflow Seconds',
    'Delta AI-Chat',
    'queryChat Status',
    'AI Agent Workflow Status',
  ]);
  const keys = Array.from(new Set(prompts.map((entry) => `${entry.caseLabel}::${entry.promptIndexInCase}`))).sort((left, right) =>
    left.localeCompare(right),
  );
  const fillByRank = [
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
  ];
  for (const key of keys) {
    const [caseLabel, promptIndexText] = key.split('::');
    const promptIndex = Number(promptIndexText);
    const chat = byPrompt.get(`chat-only::${caseLabel}::${promptIndex}`);
    const ai = byPrompt.get(`workflow-ai-agent::${caseLabel}::${promptIndex}`);
    const chatCase = byCase.get(`chat-only::${caseLabel}`);
    const aiCase = byCase.get(`workflow-ai-agent::${caseLabel}`);
    const row = comparison.addRow([
      chat?.messageSent || ai?.messageSent || caseLabel,
      promptIndex,
      chat?.totalSeconds ?? null,
      ai?.totalSeconds ?? null,
      chat && ai ? Number((ai.totalSeconds - chat.totalSeconds).toFixed(3)) : null,
      chatCase?.status || '',
      aiCase?.status || '',
    ]);
    const timed = [row.getCell(3), row.getCell(4)]
      .map((cell) => ({ cell, value: Number(cell.value || NaN) }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((left, right) => left.value - right.value);
    timed.forEach((entry, index) => {
      entry.cell.fill = fillByRank[Math.min(index, 2)] as ExcelJS.FillPattern;
    });
  }
  comparison.columns.forEach((column, index) => {
    column.width = index === 0 ? 52 : 20;
  });
  await workbook.xlsx.writeFile(outputFile);
  // eslint-disable-next-line no-console
  console.log(`workbook_file=${outputFile}`);
  // eslint-disable-next-line no-console
  console.log(`rows_prompt=${prompts.length}`);
  // eslint-disable-next-line no-console
  console.log(`rows_case=${cases.length}`);
}

void main();
