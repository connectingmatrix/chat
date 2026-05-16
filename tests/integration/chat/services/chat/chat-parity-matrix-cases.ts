import ExcelJS from 'exceljs';
import { cellText } from './chat-parity-matrix-artifacts';
import { ParitySystem, ParitySystemEnum } from './chat-parity-matrix.scope';

export type MatrixCase = {
  caseGroup: string;
  caseId: string;
  confirmText: string | null;
  difficulty: string;
  enabled: boolean;
  expectConfirmation: boolean | null;
  expectedConfirmationContains: string | null;
  expectedContains: string | null;
  expectedRegex: string | null;
  message: string;
  sequenceOrder: number;
  systems: ParitySystem[];
  timeoutSeconds: number | null;
  variables: Record<string, string>;
};

const caseHeaders = [
  'case_id',
  'case_group',
  'sequence_order',
  'difficulty',
  'timeout_seconds',
  'systems',
  'enabled',
  'case_message',
  'variables_json',
  'expect_confirmation',
  'confirm_text',
  'expected_contains',
  'expected_confirmation_contains',
  'expected_regex',
];

const systemAliases: Record<string, ParitySystem> = {
  'ai agent workflow': ParitySystemEnum.WorkflowAIAgent,
  'chat-only': ParitySystemEnum.ChatOnly,
  querychat: ParitySystemEnum.ChatOnly,
  workflow: ParitySystemEnum.WorkflowAIAgent,
  'workflow-ai-agent': ParitySystemEnum.WorkflowAIAgent,
};

const allSystems = [ParitySystemEnum.ChatOnly, ParitySystemEnum.WorkflowAIAgent];

const bool = (value: unknown) => ['1', 'true', 'yes', 'y'].includes(cellText(value).toLowerCase());

const numberCell = (value: unknown): number | null => {
  const parsed = Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const variablesJson = (value: unknown): Record<string, string> => {
  const source = cellText(value);
  if (!source) return {};
  try {
    const parsed = JSON.parse(source) as Record<string, string>;
    return parsed || {};
  } catch {
    return {};
  }
};

const systemsCell = (value: unknown): ParitySystem[] => {
  const source = cellText(value);
  if (!source) return allSystems;
  const selected = source
    .split(',')
    .map((entry) => systemAliases[entry.trim().toLowerCase()])
    .filter(Boolean);
  return selected.length ? selected : allSystems;
};

const headersByName = (sheet: ExcelJS.Worksheet) => {
  const headerValues = Array.from({ length: 40 }, (_entry, index) => cellText(sheet.getRow(1).getCell(index + 1).value));
  return Object.fromEntries(caseHeaders.map((name, index) => [name, Math.max(headerValues.indexOf(name) + 1, index + 1)])) as Record<string, number>;
};

const variablesApplied = (value: string | null, variables: Record<string, string>) =>
  value ? value.replace(/\{\{([^}]+)\}\}/g, (full, key) => variables[cellText(key)] || full) : value;

export const applyMatrixCaseVariables = (entry: MatrixCase, variables: Record<string, string>): MatrixCase => ({
  ...entry,
  confirmText: variablesApplied(entry.confirmText, variables),
  expectedConfirmationContains: variablesApplied(entry.expectedConfirmationContains, variables),
  expectedContains: variablesApplied(entry.expectedContains, variables),
  expectedRegex: variablesApplied(entry.expectedRegex, variables),
  message: variablesApplied(entry.message, variables) || entry.message,
  variables: { ...entry.variables, ...variables },
});

export const ensureCaseSheetSchema = (workbook: ExcelJS.Workbook, sheetName: string): ExcelJS.Worksheet => {
  const sheet = workbook.getWorksheet(sheetName) || workbook.addWorksheet(sheetName);
  if (sheet.rowCount === 0) {
    sheet.addRow(caseHeaders);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return sheet;
  }

  const currentHeaders = Array.from({ length: 40 }, (_entry, index) => cellText(sheet.getRow(1).getCell(index + 1).value)).filter(Boolean);
  const alreadyCurrent = caseHeaders.every((header, index) => currentHeaders[index] === header);
  if (alreadyCurrent) {
    for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      if (!cellText(row.getCell(3).value)) row.getCell(3).value = rowIndex - 1;
      if (!cellText(row.getCell(4).value)) row.getCell(4).value = 'medium';
    }
    return sheet;
  }

  const currentHeaderIndex = Object.fromEntries(currentHeaders.map((header, index) => [header, index + 1]));
  const rowCount = Math.max(sheet.rowCount - 1, 0);
  const rowsByCaseId = new Map<string, Record<string, string>>();
  let sequence = 1;
  for (const row of sheet.getRows(2, rowCount) || []) {
    const values = Object.fromEntries(
      caseHeaders.map((header) => [header, currentHeaderIndex[header] ? cellText(row.getCell(currentHeaderIndex[header]).value) : '']),
    ) as Record<string, string>;
    const caseId = values.case_id;
    if (caseId && caseId !== 'case_id' && !rowsByCaseId.has(caseId)) {
      values.sequence_order = values.sequence_order || String(sequence);
      values.difficulty = values.difficulty || 'medium';
      rowsByCaseId.set(caseId, values);
      sequence += 1;
    }
  }

  workbook.removeWorksheet(sheet.id);
  const next = workbook.addWorksheet(sheetName);
  next.addRow(caseHeaders);
  rowsByCaseId.forEach((row) => {
    next.addRow(caseHeaders.map((header) => row[header]));
  });
  next.views = [{ state: 'frozen', ySplit: 1 }];
  return next;
};

export const readMatrixCases = (sheet: ExcelJS.Worksheet): MatrixCase[] => {
  const header = headersByName(sheet);
  return (sheet.getRows(2, Math.max((sheet.rowCount || 1) - 1, 0)) || [])
    .map((row, index) => {
      const variables = variablesJson(row.getCell(header.variables_json).value);
      const caseId = cellText(row.getCell(header.case_id).value);
      const confirmText = variablesApplied(cellText(row.getCell(header.confirm_text).value) || null, variables);
      return {
        caseGroup: cellText(row.getCell(header.case_group).value),
        caseId,
        confirmText,
        difficulty: cellText(row.getCell(header.difficulty).value) || 'medium',
        enabled: bool(row.getCell(header.enabled).value),
        expectConfirmation: cellText(row.getCell(header.expect_confirmation).value) ? bool(row.getCell(header.expect_confirmation).value) : null,
        expectedConfirmationContains: variablesApplied(cellText(row.getCell(header.expected_confirmation_contains).value) || null, variables),
        expectedContains: variablesApplied(cellText(row.getCell(header.expected_contains).value) || null, variables),
        expectedRegex: variablesApplied(cellText(row.getCell(header.expected_regex).value) || null, variables),
        message: variablesApplied(cellText(row.getCell(header.case_message).value), variables) || '',
        sequenceOrder: numberCell(row.getCell(header.sequence_order).value) || index + 1,
        systems: systemsCell(row.getCell(header.systems).value),
        timeoutSeconds: numberCell(row.getCell(header.timeout_seconds).value),
        variables,
      };
    })
    .filter((entry) => entry.enabled && entry.caseId && entry.message);
};

export const casesForSystem = (matrixCases: MatrixCase[], system: ParitySystem) => matrixCases.filter((entry) => entry.systems.includes(system));
