import fs from 'node:fs';
import { inspect } from 'node:util';
import ExcelJS from 'exceljs';
import { ParitySystem, ParitySystemEnum } from './chat-parity-matrix.scope';

export type MatrixProgressSystem = ParitySystemEnum.ChatOnly | ParitySystemEnum.WorkflowAIAgent;
export type MatrixProgressTotals = Record<MatrixProgressSystem, { failed: number; passed: number; ran: number; running: number; total: number }>;

export type MatrixResultRow = {
  actionTiming: string;
  caseGroup: string;
  caseId: string;
  caseMessage: string;
  chatId: string;
  confirmPrompt: string;
  confirmResponse: string;
  confirmSent: string;
  difficulty: string;
  error: string;
  errorName: string;
  errorStack: string;
  finalOutput: string;
  lane: number;
  pendingSeconds: number | null;
  confirmationSeconds: number | null;
  pendingWorkflowQueueSeconds: number | null;
  pendingWorkflowExecutionSeconds: number | null;
  confirmationWorkflowQueueSeconds: number | null;
  confirmationWorkflowExecutionSeconds: number | null;
  requestId: string;
  runId: string;
  slaLimitSeconds: number | null;
  slaStatus: 'passed' | 'failed';
  stage: string;
  status: 'passed' | 'failed';
  system: ParitySystem;
  timeSeconds: number;
};

const systemLabels: Record<ParitySystem, string> = {
  [ParitySystemEnum.ChatOnly]: 'queryChat',
  [ParitySystemEnum.WorkflowAIAgent]: 'AI Agent Workflow',
  [ParitySystemEnum.WorkflowLegacy]: 'Workflow Legacy',
};
const progressSystems: MatrixProgressSystem[] = [ParitySystemEnum.ChatOnly, ParitySystemEnum.WorkflowAIAgent];

const green = '\u001b[32m';
const red = '\u001b[31m';
const yellow = '\u001b[33m';
const cyan = '\u001b[36m';
const reset = '\u001b[0m';

export const outputSheetName = (system: ParitySystem) => systemLabels[system] || system;
const outputSheetNames = [...progressSystems.map(outputSheetName), 'queryChatNode', 'comparison', 'performance'];

export const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim() === '[object Object]' ? '' : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`.trim();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value
      .map((entry) => cellText(entry))
      .filter(Boolean)
      .join(', ')
      .trim();
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'object') {
    const candidate = value as { hyperlink?: unknown; result?: unknown; richText?: { text?: unknown }[]; text?: unknown };
    if (candidate.richText)
      return candidate.richText
        .map((entry) => cellText(entry.text))
        .join('')
        .trim();
    if (candidate.text) return cellText(candidate.text);
    if (candidate.result) return cellText(candidate.result);
    if (candidate.hyperlink && candidate.text) return cellText(candidate.text);
    try {
      return JSON.stringify(value);
    } catch {
      return inspect(value, { breakLength: 180, depth: 6 });
    }
  }
  const fallback = `${value}`.trim();
  return fallback === '[object Object]' ? inspect(value, { breakLength: 180, depth: 6 }) : fallback;
};

export const workbookValue = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  const serialized = cellText(value);
  return serialized || '';
};

export const errorDetails = (error: unknown) => {
  if (error instanceof Error) return { message: error.message, name: error.name, stack: error.stack || '' };
  return { message: cellText(error), name: 'Error', stack: '' };
};

export const jsonLine = (file: string, value: Record<string, unknown>) => {
  fs.appendFileSync(file, `${JSON.stringify(value, (_key, entry) => (entry instanceof Error ? errorDetails(entry) : entry))}\n`, 'utf8');
};

export const excerpt = (value: string, length = 2000) => (value.length > length ? `${value.slice(0, length)}...` : value);

export const createProgress = (): MatrixProgressTotals => ({
  [ParitySystemEnum.ChatOnly]: { failed: 0, passed: 0, ran: 0, running: 0, total: 0 },
  [ParitySystemEnum.WorkflowAIAgent]: { failed: 0, passed: 0, ran: 0, running: 0, total: 0 },
});

export const writeProgressLog = (file: string, totals: MatrixProgressTotals) => {
  const header = `${cyan}${'Matrix Name'.padEnd(24)} ${'Running'.padStart(7)} ${'Ran'.padStart(7)} ${'Total'.padStart(7)} ${'Passed'.padStart(
    7,
  )} ${'Failed'.padStart(7)}${reset}`;
  const rows = progressSystems.map((system) => {
    const entry = totals[system];
    const color = entry.failed ? red : entry.running ? yellow : green;
    return `${color}${outputSheetName(system).padEnd(24)} ${String(entry.running).padStart(7)} ${String(entry.ran).padStart(7)} ${String(
      entry.total,
    ).padStart(7)} ${String(entry.passed).padStart(7)} ${String(entry.failed).padStart(7)}${reset}`;
  });
  fs.writeFileSync(file, `${header}\n${rows.join('\n')}\n`, 'utf8');
};

export const ensureHeaders = (sheet: ExcelJS.Worksheet, headers: string[]) => {
  if (sheet.rowCount > 0) return;
  sheet.addRow(headers);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
};

export const resetRunOutputSheets = (workbook: ExcelJS.Workbook) => {
  for (const sheetName of outputSheetNames) {
    const sheet = workbook.getWorksheet(sheetName);
    if (sheet) workbook.removeWorksheet(sheet.id);
  }
};

export const resultHeaders = [
  'Run Id',
  'Case Id',
  'Case Group',
  'Difficulty',
  'Case Message',
  'Confirm Prompt We Received',
  'Confirmation We Sent',
  'Confirmation Response',
  'Final Chat Message Output',
  'Status Pass/Fail',
  'Time Seconds',
  'Pending Seconds',
  'Confirmation Seconds',
  'Pending Workflow Queue Seconds',
  'Pending Workflow Execution Seconds',
  'Confirmation Workflow Queue Seconds',
  'Confirmation Workflow Execution Seconds',
  'Lane',
  'Chat Id',
  'Request Id',
  'Error',
  'Error Name',
  'Error Stack',
  'Stage',
  'SLA Status',
  'SLA Limit Seconds',
  'Action Timing',
];

export const appendResultRow = (workbook: ExcelJS.Workbook, entry: MatrixResultRow) => {
  const sheet = workbook.getWorksheet(outputSheetName(entry.system)) || workbook.addWorksheet(outputSheetName(entry.system));
  ensureHeaders(sheet, resultHeaders);
  sheet.addRow(
    [
      entry.runId,
      entry.caseId,
      entry.caseGroup,
      entry.difficulty,
      entry.caseMessage,
      entry.confirmPrompt,
      entry.confirmSent,
      entry.confirmResponse,
      entry.finalOutput,
      entry.status,
      entry.timeSeconds,
      entry.pendingSeconds,
      entry.confirmationSeconds,
      entry.pendingWorkflowQueueSeconds,
      entry.pendingWorkflowExecutionSeconds,
      entry.confirmationWorkflowQueueSeconds,
      entry.confirmationWorkflowExecutionSeconds,
      entry.lane,
      entry.chatId,
      entry.requestId,
      entry.error,
      entry.errorName,
      entry.errorStack,
      entry.stage,
      entry.slaStatus,
      entry.slaLimitSeconds,
      entry.actionTiming,
    ].map(workbookValue),
  );
};

export const appendPerformanceRow = (workbook: ExcelJS.Workbook, entry: MatrixResultRow) => {
  const sheet = workbook.getWorksheet('performance') || workbook.addWorksheet('performance');
  ensureHeaders(sheet, [
    'Case Message',
    'queryChat',
    'AI Agent Workflow',
    'queryChat- Status',
    'AI Agent Workflow - Status',
    'queryChat SLA',
    'AI Agent Workflow SLA',
  ]);
  const row =
    (sheet.getRows(2, Math.max(sheet.rowCount - 1, 0)) || []).find((candidate) => cellText(candidate.getCell(1).value) === entry.caseMessage) ||
    sheet.addRow([entry.caseMessage, '', '', '', '', '', '']);
  const timingColumn = entry.system === ParitySystemEnum.ChatOnly ? 2 : 3;
  const statusColumn = entry.system === ParitySystemEnum.ChatOnly ? 4 : 5;
  const slaColumn = entry.system === ParitySystemEnum.ChatOnly ? 6 : 7;
  row.getCell(timingColumn).value = `${entry.timeSeconds}s`;
  row.getCell(statusColumn).value =
    entry.status === 'passed' ? 'Pass' : entry.stage === 'request' && /timed out/i.test(entry.error) ? 'Timeout' : 'Fail';
  row.getCell(slaColumn).value = entry.slaStatus === 'passed' ? 'Pass' : `Fail > ${entry.slaLimitSeconds}s`;
};
