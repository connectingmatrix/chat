import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { Executor, prewarmNodeWorkerPool } from '@workflow/executor';
import { deleteLiveQueueTopics } from '@connectingmatrix/workflow-driver/services/workflow/queue/__tests__/workflow-webhook-live.runtime.fixture';
import { cleanupCreatedThroughGraphql } from './chat-giga-live.graphql-cleanup';
import { assertLiveDataPlaneReady, closeLiveSession, readLiveSession, LiveSession } from './chat-giga-live.fixture';
import { createdIds } from './chat-giga-live.ids';
import { LIVE_CHAT_EMAIL, LIVE_CHAT_PORT } from './chat-giga-live.queries';
import { sendChatFlow } from './chat-giga-live.requests';
import {
  appendPerformanceRow,
  appendResultRow,
  cellText,
  createProgress,
  errorDetails,
  excerpt,
  jsonLine,
  MatrixProgressTotals,
  MatrixResultRow,
  resetRunOutputSheets,
  workbookValue,
  writeProgressLog,
} from './chat-parity-matrix-artifacts';
import { applyMatrixCaseVariables, casesForSystem, ensureCaseSheetSchema, MatrixCase, readMatrixCases } from './chat-parity-matrix-cases';
import { readMatrixLaneManifest, writeMatrixLaneManifest } from './chat-parity-matrix-lanes';
import { ParitySystem, ParitySystemEnum } from './chat-parity-matrix.scope';
import { chatParityWorkflowFixtureHash, refreshPublishedParityWorkflows } from './chat-parity-workflow.fixture';

type Lane = {
  chatId: string;
  lane: number;
  scope: { id: string; organizationId: null; type: 'channel' };
  sessionMetadata: Record<string, unknown> | null;
  workflowFixtureHash?: string;
  workflowId: string;
};

const systemAliases: Record<string, ParitySystem> = {
  'ai agent workflow': ParitySystemEnum.WorkflowAIAgent,
  'chat-only': ParitySystemEnum.ChatOnly,
  querychat: ParitySystemEnum.ChatOnly,
  workflow: ParitySystemEnum.WorkflowAIAgent,
  'workflow-ai-agent': ParitySystemEnum.WorkflowAIAgent,
};
const configuredSystems = (process.env.CHAT_PARITY_SYSTEMS || '')
  .split(',')
  .map((entry) => systemAliases[entry.trim().toLowerCase()])
  .filter(Boolean);
const systems: ParitySystem[] = configuredSystems.length
  ? Array.from(new Set(configuredSystems))
  : [ParitySystemEnum.ChatOnly, ParitySystemEnum.WorkflowAIAgent];
const laneCountBySystem: Partial<Record<ParitySystem, number>> = {
  [ParitySystemEnum.ChatOnly]: Number(process.env.CHAT_PARITY_LANES_QUERY_CHAT || 40),
  [ParitySystemEnum.WorkflowAIAgent]: Number(process.env.CHAT_PARITY_LANES_WORKFLOW_AI_AGENT || 40),
};
const artifactsDir = `${process.cwd()}/packages/apps/chat/src/services/chat/__tests__/artifacts`;
const masterWorkbookFile = process.env.CHAT_PARITY_MASTER_XLSX || `${artifactsDir}/chat-parity-master.xlsx`;
const outputWorkbookFile = process.env.CHAT_PARITY_OUTPUT_XLSX || `${artifactsDir}/chat-parity-output.xlsx`;
const eventsJsonlFile = process.env.CHAT_PARITY_EVENTS_FILE || `${artifactsDir}/chat-parity-events.jsonl`;
const failuresJsonlFile = process.env.CHAT_PARITY_FAILURES_FILE || `${artifactsDir}/chat-parity-failures.jsonl`;
const failureHistoryJsonlFile = process.env.CHAT_PARITY_FAILURE_HISTORY_FILE || `${artifactsDir}/chat-parity-failure-history.jsonl`;
const progressLogFile = process.env.CHAT_PARITY_PROGRESS_FILE || `${artifactsDir}/progress.log`;
const SYNC_ONLY = process.env.CHAT_PARITY_SYNC_ONLY === '1';
const FAILED_ONLY = process.env.CHAT_PARITY_FAILED_ONLY === '1';
const ids = createdIds();
const casesSheetName = 'cases';
const runId = `run-${new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14)}`;
const queueSuffix = `${runId}-chat-${LIVE_CHAT_PORT + 8}`;
const matrixQueueBrokers = process.env.WORKFLOW_QUEUE_TEST_BROKERS || 'localhost:19092,localhost:29092,localhost:39092';
const matrixQueueEnv = {
  WORKFLOW_QUEUE_BROKERS: matrixQueueBrokers,
  WORKFLOW_QUEUE_SSL: 'false',
  WORKFLOW_QUEUE_USERNAME: '',
  WORKFLOW_QUEUE_PASSWORD: '',
  WORKFLOW_QUEUE_CLIENT_ID: `workflow-queue-${queueSuffix}`,
  WORKFLOW_QUEUE_EVENTS_TOPIC: `workflow-execution-events-${queueSuffix}`,
  WORKFLOW_QUEUE_EVENT_CONSUMER_GROUP_ID: `workflow-queue-events-${queueSuffix}`,
  WORKFLOW_QUEUE_REQUEST_CONSUMER_GROUP_ID: `workflow-queue-worker-${queueSuffix}`,
  WORKFLOW_QUEUE_REQUEST_TOPIC: `workflow-execution-requests-${queueSuffix}`,
};
const matrixQueueTopics = {
  eventsTopic: matrixQueueEnv.WORKFLOW_QUEUE_EVENTS_TOPIC,
  requestTopic: matrixQueueEnv.WORKFLOW_QUEUE_REQUEST_TOPIC,
};

let cases: MatrixCase[] = [];
let progress: MatrixProgressTotals = createProgress();
let session: LiveSession;
let workbook: ExcelJS.Workbook;
let workbookWriteQueue: Promise<void> = Promise.resolve();
let workbookWriteTimer: NodeJS.Timeout | null = null;
let failedOnlyCaseIds: Set<string> | null = null;
let finishedRun = false;

const laneCount = (system: ParitySystem) => laneCountBySystem[system] || 40;
const workflowPrewarmCount = () => (systems.includes(ParitySystemEnum.WorkflowAIAgent) ? laneCount(ParitySystemEnum.WorkflowAIAgent) : 0);
const caseTimeoutMs = (matrixCase: MatrixCase) => (matrixCase.timeoutSeconds ? matrixCase.timeoutSeconds * 1000 : undefined);
const slaLimitSeconds = (matrixCase: MatrixCase) => {
  if (matrixCase.timeoutSeconds) return matrixCase.timeoutSeconds;
  const difficulty = matrixCase.difficulty.toLowerCase();
  if (difficulty.includes('easy') || difficulty.includes('simple')) return 5;
  if (difficulty.includes('hard') || difficulty.includes('deep')) return 100;
  return 15;
};
const runtimeCaseVariables = (system: ParitySystem, lane: number, matrixCase: MatrixCase) => ({
  case_id: matrixCase.caseId,
  lane: String(lane),
  run_id: runId,
  run_suffix: runId.replace(/^run-/, '').slice(-8),
  system: system === ParitySystemEnum.ChatOnly ? 'chat' : 'agent',
});
const eventBase = (system: ParitySystem, lane: number, matrixCase: MatrixCase | null) => ({
  caseGroup: matrixCase?.caseGroup || null,
  caseId: matrixCase?.caseId || null,
  difficulty: matrixCase?.difficulty || null,
  lane,
  message: matrixCase?.message || null,
  runId,
  system,
  timestamp: new Date().toISOString(),
});

const scheduleWorkbookWrite = () => {
  if (workbookWriteTimer) return;
  workbookWriteTimer = setTimeout(() => {
    workbookWriteTimer = null;
    workbookWriteQueue = workbookWriteQueue.then(async () => workbook.xlsx.writeFile(masterWorkbookFile));
  }, Number(process.env.CHAT_PARITY_WORKBOOK_DEBOUNCE_MS || 1000));
};

const flushWorkbookWrites = async () => {
  if (workbookWriteTimer) {
    clearTimeout(workbookWriteTimer);
    workbookWriteTimer = null;
    workbookWriteQueue = workbookWriteQueue.then(async () => workbook.xlsx.writeFile(masterWorkbookFile));
  }
  await workbookWriteQueue;
};

const emitEvent = (event: Record<string, unknown>) => jsonLine(eventsJsonlFile, event);
const resetRunningProgress = () => {
  systems.forEach((system) => {
    progress[system].running = 0;
  });
  writeProgressLog(progressLogFile, progress);
};
const abortRun = (reason: string) => {
  resetRunningProgress();
  emitEvent({ event: 'run.abort', reason, runId, timestamp: new Date().toISOString(), type: 'event' });
};

const failureEvent = (entry: MatrixResultRow) => ({
  caseGroup: entry.caseGroup,
  actionTiming: entry.actionTiming,
  caseId: entry.caseId,
  chatId: entry.chatId,
  confirmationText: excerpt(entry.confirmPrompt),
  difficulty: entry.difficulty,
  error: { message: entry.error, name: entry.errorName, stack: entry.errorStack },
  finalOutputExcerpt: excerpt(entry.finalOutput),
  lane: entry.lane,
  message: entry.caseMessage,
  pendingWorkflowExecutionSeconds: entry.pendingWorkflowExecutionSeconds,
  pendingWorkflowQueueSeconds: entry.pendingWorkflowQueueSeconds,
  confirmationWorkflowExecutionSeconds: entry.confirmationWorkflowExecutionSeconds,
  confirmationWorkflowQueueSeconds: entry.confirmationWorkflowQueueSeconds,
  requestId: entry.requestId,
  runId: entry.runId,
  slaLimitSeconds: entry.slaLimitSeconds,
  slaStatus: entry.slaStatus,
  stage: entry.stage,
  system: entry.system,
  timeSeconds: entry.timeSeconds,
  timestamp: new Date().toISOString(),
  type: 'failure',
});

const emitFailure = (entry: MatrixResultRow) => {
  const event = failureEvent(entry);
  jsonLine(failuresJsonlFile, event);
  jsonLine(failureHistoryJsonlFile, event);
};

const markStart = (system: ParitySystem, lane: number, matrixCase: MatrixCase) => {
  progress[system].running += 1;
  writeProgressLog(progressLogFile, progress);
  emitEvent({ ...eventBase(system, lane, matrixCase), event: 'case.start', type: 'event' });
};

const markResult = (entry: MatrixResultRow) => {
  progress[entry.system].running = Math.max(progress[entry.system].running - 1, 0);
  progress[entry.system].ran += 1;
  progress[entry.system][entry.status === 'passed' ? 'passed' : 'failed'] += 1;
  writeProgressLog(progressLogFile, progress);
  appendResultRow(workbook, entry);
  appendPerformanceRow(workbook, entry);
  emitEvent({
    caseGroup: entry.caseGroup,
    actionTiming: entry.actionTiming,
    caseId: entry.caseId,
    chatId: entry.chatId,
    difficulty: entry.difficulty,
    error: entry.error,
    event: 'case.end',
    lane: entry.lane,
    pendingSeconds: entry.pendingSeconds,
    confirmationSeconds: entry.confirmationSeconds,
    pendingWorkflowExecutionSeconds: entry.pendingWorkflowExecutionSeconds,
    pendingWorkflowQueueSeconds: entry.pendingWorkflowQueueSeconds,
    confirmationWorkflowExecutionSeconds: entry.confirmationWorkflowExecutionSeconds,
    confirmationWorkflowQueueSeconds: entry.confirmationWorkflowQueueSeconds,
    requestId: entry.requestId,
    runId: entry.runId,
    slaLimitSeconds: entry.slaLimitSeconds,
    slaStatus: entry.slaStatus,
    stage: entry.stage,
    status: entry.status,
    system: entry.system,
    timeSeconds: entry.timeSeconds,
    timestamp: new Date().toISOString(),
    type: 'event',
  });
  if (entry.status === 'failed') emitFailure(entry);
  scheduleWorkbookWrite();
};

const activeMatrixPids = () => {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return match ? { command: match[3], pid: Number(match[1]), ppid: Number(match[2]) } : null;
    })
    .filter((entry): entry is { command: string; pid: number; ppid: number } => Boolean(entry));
  const rowByPid = new Map(rows.map((row) => [row.pid, row]));
  const ancestry = new Set<number>([process.pid]);
  for (let current = process.ppid; current && rowByPid.has(current); current = rowByPid.get(current)?.ppid || 0) ancestry.add(current);
  return rows.filter((row) => row.command.includes('chat-parity-matrix-live.integration.test.ts') && !ancestry.has(row.pid));
};

const guardStaleRuns = () => {
  const active = activeMatrixPids();
  if (!active.length) return;
  if (process.env.CHAT_PARITY_KILL_STALE === '1') {
    active.forEach((row) => process.kill(row.pid, 'SIGTERM'));
    return;
  }
  throw new Error(
    `Active chat parity matrix processes found: ${active
      .map((row) => `${row.pid}:${row.command}`)
      .join(' | ')}. Set CHAT_PARITY_KILL_STALE=1 to stop stale runs before retrying.`,
  );
};

const workflowExecutorNativeProbe = `
const path = require('node:path');
require(path.join(process.cwd(), 'node_modules', '@workflow', 'executor', 'node_modules', 'isolated-vm'));
`;

const ensureWorkflowExecutorNativeModule = () => {
  try {
    execFileSync(process.execPath, ['-e', workflowExecutorNativeProbe], { cwd: process.cwd(), stdio: 'ignore' });
    return;
  } catch {
    emitEvent({
      event: 'workflow.executor.native.rebuild.start',
      packagePath: 'node_modules/@workflow/executor',
      runId,
      timestamp: new Date().toISOString(),
      type: 'event',
    });
  }
  execFileSync('npm', ['rebuild', 'isolated-vm', '--prefix', 'node_modules/@workflow/executor'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  execFileSync(process.execPath, ['-e', workflowExecutorNativeProbe], { cwd: process.cwd(), stdio: 'ignore' });
  emitEvent({
    event: 'workflow.executor.native.rebuild.done',
    packagePath: 'node_modules/@workflow/executor',
    runId,
    timestamp: new Date().toISOString(),
    type: 'event',
  });
};

const createLanes = async (system: ParitySystem): Promise<Lane[]> => {
  const manifest = readMatrixLaneManifest();
  const lanes = (manifest.systems[system] || []).slice(0, laneCount(system));
  if (lanes.length < laneCount(system)) {
    throw new Error(
      `Lane manifest has ${lanes.length} ${system} lanes, but ${laneCount(system)} are required. Run yarn test chat:giga:provision first.`,
    );
  }
  if (system !== ParitySystemEnum.ChatOnly) {
    const fixtureSystem = system === ParitySystemEnum.WorkflowAIAgent ? 'ai-agent' : 'legacy';
    const fixtureHash = chatParityWorkflowFixtureHash(fixtureSystem);
    const staleLanes = lanes.filter((lane) => lane.workflowId && lane.workflowFixtureHash !== fixtureHash);
    if (staleLanes.length) {
      await refreshPublishedParityWorkflows(
        session,
        staleLanes.map((lane) => ({
          description: `${system} matrix scope.`,
          scopeId: lane.scope.id,
          system: fixtureSystem,
          workflowId: lane.workflowId,
        })),
      );
      staleLanes.forEach((lane) => {
        lane.workflowFixtureHash = fixtureHash;
        const manifestLane = (manifest.systems[system] || []).find(
          (entry) => entry.workflowId === lane.workflowId || entry.scope.id === lane.scope.id,
        );
        if (manifestLane) manifestLane.workflowFixtureHash = fixtureHash;
      });
      writeMatrixLaneManifest(manifest);
      emitEvent({
        event: 'workflow.fixture.refresh',
        refreshed: staleLanes.length,
        runId,
        system,
        timestamp: new Date().toISOString(),
        type: 'event',
      });
    }
  }
  lanes.forEach((lane) => {
    if (!lane.chatId) throw new Error(`Lane manifest is missing chatId for ${system} lane ${lane.lane}. Run yarn test chat:giga:provision first.`);
    emitEvent({ ...eventBase(system, lane.lane, null), chatId: lane.chatId, event: 'lane.ready', scopeId: lane.scope.id, type: 'event' });
  });
  return lanes.map((lane, index) => ({ ...lane, lane: index }));
};

const safeRegex = (value: string | null) => {
  if (!value) return null;
  try {
    return new RegExp(value, 'i');
  } catch {
    return null;
  }
};

const responseText = (response: unknown) => {
  const source = response as { agent?: { markdown?: unknown }; answer?: { text?: unknown }; messages?: { assistant?: { content?: unknown } } };
  const answer = typeof source.answer?.text === 'string' ? cellText(source.answer.text) : '';
  const assistant = typeof source.messages?.assistant?.content === 'string' ? cellText(source.messages.assistant.content) : '';
  const agent = typeof source.agent?.markdown === 'string' ? cellText(source.agent.markdown) : '';
  return answer || assistant || agent || cellText(source.answer?.text || source.messages?.assistant?.content || source.agent?.markdown || '');
};

const workflowQueueTiming = (response: unknown) => {
  const timing = (response as { debug?: { workflow_queue_timing?: { executionSeconds?: unknown; queueSeconds?: unknown } } })?.debug
    ?.workflow_queue_timing;
  const queueSeconds = Number(timing?.queueSeconds);
  const executionSeconds = Number(timing?.executionSeconds);
  return {
    queueSeconds: Number.isFinite(queueSeconds) ? queueSeconds : null,
    executionSeconds: Number.isFinite(executionSeconds) ? executionSeconds : null,
  };
};

type ActionTimingResponse = {
  agent?: { action_results?: Array<{ duration_ms?: number | null; error?: string | null; name?: string | null; status?: string | null }> };
};

const actionTiming = (response: ActionTimingResponse | null | undefined) =>
  (response?.agent?.action_results || [])
    .map((result) => {
      const durationMs = Number(result.duration_ms);
      const duration = Number.isFinite(durationMs) ? `${durationMs}ms` : 'n/a';
      const error = cellText(result.error);
      return [cellText(result.name), cellText(result.status), duration, error ? `error=${error}` : ''].filter(Boolean).join(':');
    })
    .join(' | ');

const actionFailure = (response: ActionTimingResponse | null | undefined, matrixCase: MatrixCase) => {
  const expectedFailure = /fail|error|unsupported|not found|not allowed|permission|access|root level/i.test(
    [matrixCase.expectedContains, matrixCase.expectedRegex].filter(Boolean).join(' '),
  );
  if (expectedFailure) return '';
  const failed = (response?.agent?.action_results || []).find(
    (result) => cellText(result.status).toLowerCase() === 'failed' || cellText(result.error),
  );
  return failed ? `Action failed: ${cellText(failed.name) || 'unknown'}${failed.error ? `: ${cellText(failed.error)}` : ''}` : '';
};

const casePass = (matrixCase: MatrixCase, pendingText: string, finalText: string, hadConfirmation: boolean): string | null => {
  if (matrixCase.expectConfirmation === true && !hadConfirmation) return 'Expected confirmation but none was requested.';
  if (matrixCase.expectConfirmation === false && hadConfirmation) return 'Unexpected confirmation request.';
  const outputText = [pendingText, finalText].join('\n');
  if (matrixCase.expectedContains && !outputText.toLowerCase().includes(matrixCase.expectedContains.toLowerCase()))
    return `Final output missing expected text: ${matrixCase.expectedContains}`;
  if (matrixCase.expectedConfirmationContains && !pendingText.toLowerCase().includes(matrixCase.expectedConfirmationContains.toLowerCase()))
    return `Confirmation prompt missing expected text: ${matrixCase.expectedConfirmationContains}`;
  const pattern = safeRegex(matrixCase.expectedRegex);
  if (pattern && !pattern.test(outputText)) return `Final output failed regex: ${matrixCase.expectedRegex}`;
  return null;
};

const runCase = async (system: ParitySystem, lane: Lane, matrixCase: MatrixCase): Promise<MatrixResultRow> => {
  const startedAt = Date.now();
  const requestId = `${runId}-${system}-${lane.lane + 1}-${matrixCase.caseId}`;
  const currentCase = applyMatrixCaseVariables(matrixCase, runtimeCaseVariables(system, lane.lane + 1, matrixCase));
  markStart(system, lane.lane + 1, currentCase);
  try {
    const response = await sendChatFlow({
      chatId: lane.chatId || undefined,
      confirmText: currentCase.confirmText || 'confirm',
      expectConfirmation: currentCase.expectConfirmation === null ? undefined : currentCase.expectConfirmation,
      ids,
      message: currentCase.message,
      requestId,
      scope: lane.scope,
      session,
      sessionMetadata: lane.sessionMetadata,
      system,
      timeoutMs: caseTimeoutMs(currentCase),
    });
    lane.chatId = cellText(response.final?.chat?.id || lane.chatId || '') || null;
    const pendingText = responseText(response.pending?.done?.data);
    const finalText = responseText(response.final);
    const hadConfirmation = response.pending?.done?.data?.agent?.requires_confirmation === true;
    const failed = casePass(currentCase, pendingText, finalText, hadConfirmation);
    const pendingWorkflowTiming = workflowQueueTiming(response.pending?.done?.data);
    const confirmationWorkflowTiming = workflowQueueTiming(response.final);
    const actionTimingText = actionTiming(response.final);
    const actionFailureText = actionFailure(response.final, currentCase);
    const timeSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    const maxSeconds = slaLimitSeconds(currentCase);
    const timingFailure =
      timeSeconds > maxSeconds ? `Timing SLA exceeded: ${timeSeconds}s > ${maxSeconds}s for ${currentCase.difficulty || 'medium'} case.` : '';
    const error = [failed, actionFailureText, timingFailure].filter(Boolean).join(' | ');
    const entry: MatrixResultRow = {
      caseGroup: currentCase.caseGroup,
      actionTiming: actionTimingText,
      caseId: currentCase.caseId,
      caseMessage: currentCase.message,
      chatId: lane.chatId || '',
      confirmPrompt: pendingText,
      confirmResponse: hadConfirmation ? finalText : '',
      confirmSent: hadConfirmation ? currentCase.confirmText || 'confirm' : '',
      confirmationSeconds: response.timings.confirmation_ms === null ? null : Number((response.timings.confirmation_ms / 1000).toFixed(3)),
      difficulty: currentCase.difficulty,
      error,
      errorName: error ? 'AssertionError' : '',
      errorStack: '',
      finalOutput: finalText,
      lane: lane.lane + 1,
      pendingSeconds: Number((response.timings.pending_ms / 1000).toFixed(3)),
      pendingWorkflowQueueSeconds: pendingWorkflowTiming.queueSeconds,
      pendingWorkflowExecutionSeconds: pendingWorkflowTiming.executionSeconds,
      confirmationWorkflowQueueSeconds: confirmationWorkflowTiming.queueSeconds,
      confirmationWorkflowExecutionSeconds: confirmationWorkflowTiming.executionSeconds,
      requestId,
      runId,
      slaLimitSeconds: maxSeconds,
      slaStatus: timingFailure ? 'failed' : 'passed',
      stage: error ? 'assertion' : 'completed',
      status: error ? 'failed' : 'passed',
      system,
      timeSeconds,
    };
    markResult(entry);
    return entry;
  } catch (error) {
    const details = errorDetails(error);
    const flowError = error as {
      pending?: { done?: { data?: { agent?: { requires_confirmation?: boolean }; chat?: { id?: string } } } };
      timings?: { confirmation_ms?: number | null; pending_ms?: number | null };
    };
    const pendingData = flowError.pending?.done?.data;
    const pendingText = pendingData ? responseText(pendingData) : '';
    const hadConfirmation = pendingData?.agent?.requires_confirmation === true;
    const pendingWorkflowTiming = workflowQueueTiming(pendingData);
    const timeSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    const maxSeconds = slaLimitSeconds(currentCase);
    const entry: MatrixResultRow = {
      caseGroup: currentCase.caseGroup,
      actionTiming: '',
      caseId: currentCase.caseId,
      caseMessage: currentCase.message,
      chatId: cellText(pendingData?.chat?.id || lane.chatId || '') || '',
      confirmPrompt: pendingText,
      confirmResponse: '',
      confirmSent: hadConfirmation ? currentCase.confirmText || 'confirm' : '',
      confirmationSeconds: flowError.timings?.confirmation_ms ? Number((flowError.timings.confirmation_ms / 1000).toFixed(3)) : null,
      difficulty: currentCase.difficulty,
      error: details.message,
      errorName: details.name,
      errorStack: details.stack,
      finalOutput: '',
      lane: lane.lane + 1,
      pendingSeconds: flowError.timings?.pending_ms ? Number((flowError.timings.pending_ms / 1000).toFixed(3)) : null,
      pendingWorkflowQueueSeconds: pendingWorkflowTiming.queueSeconds,
      pendingWorkflowExecutionSeconds: pendingWorkflowTiming.executionSeconds,
      confirmationWorkflowQueueSeconds: null,
      confirmationWorkflowExecutionSeconds: null,
      requestId,
      runId,
      slaLimitSeconds: maxSeconds,
      slaStatus: timeSeconds > maxSeconds ? 'failed' : 'passed',
      stage: details.message.includes('confirmation request') ? 'confirmation' : 'request',
      status: 'failed',
      system,
      timeSeconds,
    };
    markResult(entry);
    return entry;
  }
};

const distributeCases = (matrixCases: MatrixCase[], lanes: Lane[]) => {
  const buckets = lanes.map(() => [] as MatrixCase[]);
  const grouped = new Map<string, MatrixCase[]>();
  matrixCases.forEach((entry) => grouped.set(entry.caseGroup || entry.caseId, [...(grouped.get(entry.caseGroup || entry.caseId) || []), entry]));
  Array.from(grouped.values())
    .map((entries) => entries.sort((left, right) => left.sequenceOrder - right.sequenceOrder))
    .sort((left, right) => left[0].sequenceOrder - right[0].sequenceOrder)
    .forEach((entries, index) => buckets[index % lanes.length].push(...entries));
  return buckets;
};

const runSystem = async (system: ParitySystem, matrixCases: MatrixCase[]): Promise<MatrixResultRow[]> => {
  emitEvent({ event: 'system.start', runId, system, timestamp: new Date().toISOString(), total: matrixCases.length, type: 'event' });
  let lanes: Lane[];
  try {
    lanes = await createLanes(system);
  } catch (error) {
    const details = errorDetails(error);
    emitEvent({ error: details, event: 'system.setup.failed', runId, system, timestamp: new Date().toISOString(), type: 'event' });
    throw error;
  }
  const buckets = distributeCases(matrixCases, lanes);
  const results = await Promise.all(
    lanes.map(async (lane) => {
      const laneResults: MatrixResultRow[] = [];
      for (const matrixCase of buckets[lane.lane]) laneResults.push(await runCase(system, lane, matrixCase));
      return laneResults;
    }),
  );
  emitEvent({ event: 'system.end', runId, system, timestamp: new Date().toISOString(), type: 'event' });
  return results.flat();
};

const writeComparison = (sheet: ExcelJS.Worksheet, bySystem: Record<ParitySystem, MatrixResultRow[]>) => {
  if (sheet.rowCount === 0) {
    sheet.addRow([
      'Run Id',
      'Case Id',
      'Difficulty',
      'Case Message',
      'queryChat Seconds',
      'AI Agent Workflow Seconds',
      'Delta AI-Chat',
      'Status queryChat',
      'Status AI Agent Workflow',
    ]);
  }
  const mapByKey = (rows: MatrixResultRow[]) => new Map(rows.map((row) => [row.caseId, row]));
  const chat = mapByKey(bySystem[ParitySystemEnum.ChatOnly] || []);
  const ai = mapByKey(bySystem[ParitySystemEnum.WorkflowAIAgent] || []);
  const all = Array.from(new Set([...chat.keys(), ...ai.keys()]));
  const fills = ['FFC6EFCE', 'FFFFEB9C', 'FFFFC7CE'];
  all.forEach((caseId) => {
    const a = chat.get(caseId);
    const c = ai.get(caseId);
    const row = sheet.addRow(
      [
        runId,
        caseId,
        a?.difficulty || c?.difficulty || '',
        a?.caseMessage || c?.caseMessage || '',
        a?.timeSeconds ?? null,
        c?.timeSeconds ?? null,
        a && c ? Number((c.timeSeconds - a.timeSeconds).toFixed(3)) : null,
        a?.status || '',
        c?.status || '',
      ].map(workbookValue),
    );
    const timed = [row.getCell(5), row.getCell(6)]
      .map((cell) => ({ cell, value: Number(cell.value || NaN) }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((left, right) => left.value - right.value);
    timed.forEach((entry, index) => {
      entry.cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fills[Math.min(index, 2)] } };
    });
  });
  sheet.columns.forEach((column, index) => {
    column.width = index < 4 ? 42 : 22;
  });
};

const failedCaseIds = () => {
  const files = [failuresJsonlFile, failureHistoryJsonlFile].filter((file) => fs.existsSync(file));
  if (!files.length) return new Set<string>();
  const rows = files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { caseId?: string; runId?: string }),
  );
  const targetRunId = process.env.CHAT_PARITY_FAILED_RUN_ID || rows[rows.length - 1]?.runId || '';
  return new Set(rows.filter((row) => row.runId === targetRunId && row.caseId).map((row) => row.caseId as string));
};

const selectedCases = (source: MatrixCase[]) => {
  const explicit = new Set(
    (process.env.CHAT_PARITY_CASE_IDS || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const limited = process.env.CHAT_PARITY_CASE_LIMIT ? source.slice(0, Number(process.env.CHAT_PARITY_CASE_LIMIT)) : source;
  const selected = explicit.size ? limited.filter((entry) => explicit.has(entry.caseId)) : limited;
  if (!FAILED_ONLY) return selected;
  const failed = failedOnlyCaseIds || failedCaseIds();
  return selected.filter((entry) => failed.has(entry.caseId));
};

const prepareProgress = (matrixCases: MatrixCase[]) => {
  progress = createProgress();
  systems.forEach((system) => {
    progress[system].total = casesForSystem(matrixCases, system).length;
  });
  writeProgressLog(progressLogFile, progress);
};

describe('live direct queryChat parity matrix', () => {
  before(async () => {
    fs.mkdirSync(artifactsDir, { recursive: true });
    guardStaleRuns();
    failedOnlyCaseIds = FAILED_ONLY ? failedCaseIds() : null;
    if (process.env.CHAT_PARITY_APPEND_LOGS !== '1') {
      fs.writeFileSync(eventsJsonlFile, '', 'utf8');
      fs.writeFileSync(failuresJsonlFile, '', 'utf8');
    }
    workbook = new ExcelJS.Workbook();
    if (fs.existsSync(masterWorkbookFile)) await workbook.xlsx.readFile(masterWorkbookFile);
    const casesSheet = ensureCaseSheetSchema(workbook, casesSheetName);
    cases = selectedCases(readMatrixCases(casesSheet));
    resetRunOutputSheets(workbook);
    prepareProgress(cases);
    emitEvent({
      enabledCases: cases.length,
      event: 'run.start',
      failedOnly: FAILED_ONLY,
      runId,
      syncOnly: SYNC_ONLY,
      timestamp: new Date().toISOString(),
      type: 'event',
    });
    await workbook.xlsx.writeFile(masterWorkbookFile);
    await workbook.xlsx.writeFile(outputWorkbookFile);
    assert.equal(cases.length > 0, true, `No enabled cases found in sheet "${casesSheetName}" at ${masterWorkbookFile}.`);
    if (SYNC_ONLY) return;
    process.env.GIGA_DISABLE_API_WORKFLOW_QUEUE = '1';
    process.env.GIGA_WORKFLOW_QUEUE_SKIP_LOG_APPEND = process.env.GIGA_WORKFLOW_QUEUE_SKIP_LOG_APPEND || '1';
    process.env.CHAT_PARITY_SKIP_WORKFLOW_ARTIFACT_ATTACH = process.env.CHAT_PARITY_SKIP_WORKFLOW_ARTIFACT_ATTACH || '1';
    process.env.CHAT_PARITY_FAST_WORKFLOW_TRACKER = process.env.CHAT_PARITY_FAST_WORKFLOW_TRACKER || '1';
    process.env.CHAT_PARITY_FAST_AUTH = process.env.CHAT_PARITY_FAST_AUTH || '1';
    process.env.GIGA_SUPABASE_HTTP_CONCURRENCY = process.env.GIGA_SUPABASE_HTTP_CONCURRENCY || '12';
    process.env.GIGA_SUPABASE_HTTP_RETRIES = process.env.GIGA_SUPABASE_HTTP_RETRIES || '0';
    process.env.GIGA_SUPABASE_HTTP_TIMEOUT_MS = process.env.GIGA_SUPABASE_HTTP_TIMEOUT_MS || '12000';
    Object.assign(process.env, matrixQueueEnv);
    emitEvent({ event: 'live.session.start', port: LIVE_CHAT_PORT + 8, runId, timestamp: new Date().toISOString(), type: 'event' });
    session = await readLiveSession(LIVE_CHAT_PORT + 8, LIVE_CHAT_EMAIL, { queueEnv: matrixQueueEnv });
    emitEvent({ event: 'live.session.ready', port: LIVE_CHAT_PORT + 8, runId, timestamp: new Date().toISOString(), type: 'event' });
    emitEvent({ event: 'live.dataplane.preflight.start', runId, timestamp: new Date().toISOString(), type: 'event' });
    try {
      const preflight = await assertLiveDataPlaneReady(session);
      emitEvent({
        durationMs: preflight.durationMs,
        event: 'live.dataplane.preflight.ready',
        runId,
        timestamp: new Date().toISOString(),
        type: 'event',
      });
    } catch (error) {
      emitEvent({ error: errorDetails(error), event: 'live.dataplane.preflight.failed', runId, timestamp: new Date().toISOString(), type: 'event' });
      throw error;
    }
    ensureWorkflowExecutorNativeModule();
    await Executor.start();
    const prewarmCount = workflowPrewarmCount();
    if (prewarmCount > 0) {
      const startedAt = Date.now();
      const createdWorkers = await prewarmNodeWorkerPool(prewarmCount);
      emitEvent({
        createdWorkers,
        durationMs: Date.now() - startedAt,
        event: 'workflow.executor.sandbox.prewarm.done',
        requestedWorkers: prewarmCount,
        runId,
        timestamp: new Date().toISOString(),
        type: 'event',
      });
    }
  });

  after(async () => {
    await flushWorkbookWrites();
    try {
      if (session) await cleanupCreatedThroughGraphql(session, ids);
    } catch (error) {
      emitEvent({ error: errorDetails(error), event: 'cleanup.failed', runId, timestamp: new Date().toISOString(), type: 'event' });
    }
    await Executor.stop();
    if (session) await closeLiveSession(session);
    if (process.env.GIGA_DISABLE_API_WORKFLOW_QUEUE !== '1') await deleteLiveQueueTopics(matrixQueueTopics);
  });

  it('runs excel-driven matrix with parallel lanes and writes output to the master workbook', async () => {
    if (SYNC_ONLY) return;
    const bySystemEntries = await Promise.all(
      systems.map(async (system) => [system, await runSystem(system, casesForSystem(cases, system))] as const),
    );
    const resultMap = Object.fromEntries(bySystemEntries) as Record<ParitySystem, MatrixResultRow[]>;
    const comparisonSheet = workbook.getWorksheet('comparison') || workbook.addWorksheet('comparison');
    writeComparison(comparisonSheet, resultMap);
    await flushWorkbookWrites();
    await workbook.xlsx.writeFile(masterWorkbookFile);
    await workbook.xlsx.writeFile(outputWorkbookFile);
    finishedRun = true;
    emitEvent({ enabledCases: cases.length, event: 'run.end', runId, timestamp: new Date().toISOString(), type: 'event' });
    setImmediate(() => process.exit(0));
  });
});

process.once('SIGINT', () => {
  abortRun('SIGINT');
  process.exit(130);
});

process.once('SIGTERM', () => {
  abortRun('SIGTERM');
  process.exit(143);
});

process.once('exit', () => {
  if (!finishedRun && !SYNC_ONLY) resetRunningProgress();
});
