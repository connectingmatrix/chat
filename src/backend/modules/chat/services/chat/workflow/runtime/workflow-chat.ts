import { createWorkflowExecutionTimeoutController } from '@workflow/executor';
import { cloneJson } from 'giga-ai-helper';
import { createRunId } from 'giga-ai-helper/workflow';
import { EnvLoader } from '@giga/shared/lib/env';
import { executeWorkflow } from '@connectingmatrix/workflows/services/workflow';
import { createWorkflowReferenceHostContext } from '@connectingmatrix/workflows/services/workflow/contracts/execution-reference';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import { WorkflowAssignmentEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowAssignmentEntity';
import { OrganisationEntity } from '@connectingmatrix/orm/repositories/entities/runtime/OrganisationEntity';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowEntity';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowExecutionEntity';
import { WorkflowLogEntity } from '@connectingmatrix/orm/repositories/entities/telemetry/WorkflowLogEntity';
import { WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowVersionEntity';
import {
  WorkflowAuthModeEnum,
  WorkflowDefinition,
  WorkflowExecutionRequestContext,
  WorkflowLogLevelEnum,
  WorkflowRunLogEvent,
  WorkflowRuntimeSettings,
} from '@connectingmatrix/workflows/services/workflow/contracts/types';
import { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';
import { ChatScope, ChatScopeSnapshot, ResolvedChatScope } from '../../contracts/types';
import { buildWorkflowChatDebugState } from './chat-debug-state';
import type { ResolvedChatWorkflow, WorkflowExecutionArtifacts, WorkflowSource } from '@giga/shared/types/contracts/graphql.types';
import type { WorkflowExecutionTracker, WorkflowReference } from '@giga/shared/types/contracts/workflow.types';

function isMissingRelationError(error: any) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

const toRecordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const toTextValue = (value: unknown): string => String(value || '').trim();
const toStringList = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => toTextValue(entry)).filter(Boolean) : []);

const flattenStartEnvelope = (value: unknown): unknown => {
  const record = toRecordValue(value);
  if (!Object.keys(record).length || Object.prototype.hasOwnProperty.call(record, 'request')) {
    return value;
  }

  const nestedStartEntry = Object.entries(record).find(([, entry]) => {
    const nested = toRecordValue(entry);
    return Object.prototype.hasOwnProperty.call(nested, 'request') && Object.prototype.hasOwnProperty.call(nested, 'input');
  });

  if (!nestedStartEntry) {
    return value;
  }

  const [, nestedStartValue] = nestedStartEntry;
  const nestedStartRecord = toRecordValue(nestedStartValue);

  return {
    ...record,
    ...Object.fromEntries(
      Object.entries(nestedStartRecord).filter(([key]) => key === 'request' || key === 'input' || key === 'started' || key === 'startedAt'),
    ),
  };
};

function resolveBaseUrl(request: any): string {
  const origin = String(request?.headers?.origin || '').trim();
  if (origin) return origin.replace(/\/+$/g, '');

  const host = String(request?.headers?.['x-forwarded-host'] || request?.headers?.host || '').trim();
  if (!host) {
    return String(EnvLoader.get('BASE_URL') || 'http://localhost:4000').replace(/\/+$/g, '');
  }

  const protocol =
    String(
      request?.headers?.['x-forwarded-proto'] ||
        request?.protocol ||
        (String(request?.headers?.origin || '').startsWith('https://') ? 'https' : 'http'),
    ).trim() || 'http';

  return `${protocol}://${host}`.replace(/\/+$/g, '');
}

export function resolveWorkflowSettings(
  request: any,
  workflow: WorkflowDefinition,
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number },
): WorkflowRuntimeSettings {
  const metadataSettings =
    workflow?.metadata?.runtime?.settings && typeof workflow.metadata.runtime.settings === 'object'
      ? (workflow.metadata.runtime.settings as Partial<WorkflowRuntimeSettings>)
      : {};
  const baseUrl = resolveBaseUrl(request);

  return {
    graphqlUrl: String(metadataSettings.graphqlUrl || '').trim() || `${baseUrl}/api/v2/graphql`,
    httpBaseUrl: String(metadataSettings.httpBaseUrl || '').trim() || `${baseUrl}/api/v2`,
    authMode: metadataSettings.authMode || WorkflowAuthModeEnum.AutoFromCurrentSession,
    manualHeaders: metadataSettings.manualHeaders || {},
    maxConcurrentExecutionsPerUser: Number(runtimeLimits?.maxConcurrentExecutionsPerUser) || undefined,
    maxExecutionSeconds: Math.min(
      Number(metadataSettings.maxExecutionSeconds) || Number(runtimeLimits?.maxExecutionSeconds) || 300,
      Number(runtimeLimits?.maxExecutionSeconds) || 300,
    ),
  };
}

export function normalizeChatSources(value: unknown): SourceReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, any>;
      return {
        chunk_id: row.chunk_id ?? null,
        post_id: row.post_id ?? null,
        attachment_id: row.attachment_id ?? null,
        subject_id: row.subject_id ?? null,
        similarity: row.similarity ?? null,
        rank: row.rank ?? null,
        source_type: row.source_type || row.type || null,
        title: row.title || null,
        url: row.url || null,
        snippet: row.snippet || null,
      } as SourceReference;
    })
    .filter(Boolean) as SourceReference[];
}

export function normalizeRetrievedChunks(value: unknown): RetrievedChunk[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, any>;
      const chunkId = Number(row.chunk_id);
      if (!Number.isFinite(chunkId)) return null;
      return {
        chunk_id: chunkId,
        subject_id: typeof row.subject_id === 'string' ? row.subject_id : null,
        post_id: typeof row.post_id === 'string' ? row.post_id : null,
        attachment_id: typeof row.attachment_id === 'string' ? row.attachment_id : null,
        source_kind: row.source_kind === 'attachment' ? 'attachment' : 'post',
        chunk_index: Number.isFinite(Number(row.chunk_index)) ? Number(row.chunk_index) : 0,
        content: typeof row.content === 'string' ? row.content : '',
        token_count: Number.isFinite(Number(row.token_count)) ? Number(row.token_count) : null,
        metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
        similarity: Number.isFinite(Number(row.similarity)) ? Number(row.similarity) : null,
        rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : index + 1,
      } as RetrievedChunk;
    })
    .filter(Boolean) as RetrievedChunk[];
}

export function extractTerminalPayload(workflow: WorkflowDefinition): unknown {
  const endNodes = (workflow.nodes || []).filter((node) => node.modelId === 'respond-end');
  const endNode = endNodes[endNodes.length - 1];
  const output =
    endNode?.ports?.out && Object.prototype.hasOwnProperty.call(endNode.ports.out, 'output') ? endNode.ports.out.output : endNode?.output;

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, any>;
    const payloadKeys = Object.keys(record).filter((key) => key !== '__workflow');
    if (payloadKeys.length === 1 && payloadKeys[0] === 'input') {
      return record.input;
    }
  }

  return flattenStartEnvelope(output);
}

export function normalizeWorkflowText(payload: unknown): string {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return text && text !== '[object Object]' ? text : 'Workflow completed with no output.';
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, any>;
    const candidates = [record.markdown, record.text, record.value, record.output];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() && candidate.trim() !== '[object Object]') {
        return candidate.trim();
      }
    }
    for (const key of ['input', 'input1', 'response', 'result', 'data', 'agent']) {
      const nested = normalizeWorkflowText(record[key]);
      if (nested !== 'Workflow completed with no output.') return nested;
    }
    for (const [key, value] of Object.entries(record)) {
      if (['__activeOutputs', '__workflow', 'plan'].includes(key)) continue;
      const nested = normalizeWorkflowText(value);
      if (nested !== 'Workflow completed with no output.') return nested;
    }
  }

  const text = JSON.stringify(payload, null, 2);
  return text && text !== 'null' ? text : 'Workflow completed with no output.';
}

export function resolveWorkflowFailureMessage(logs: WorkflowRunLogEvent[] | null | undefined, payload: unknown): string {
  if (payload !== null && typeof payload !== 'undefined') {
    return '';
  }
  const failure = (Array.isArray(logs) ? logs : []).find(
    (entry) => entry?.event === 'node.failed' || (entry?.level === WorkflowLogLevelEnum.Error && String(entry?.message || '').trim()),
  );
  return String(failure?.message || '').trim();
}

export function hydrateWorkflowDefinition(params: {
  workflow: WorkflowDefinition;
  chatId: string;
  scope: ChatScope;
  scopeSnapshot: ChatScopeSnapshot | null;
  resolvedScope: ResolvedChatScope;
  message: string;
  requestPayload?: Record<string, unknown> | null;
}): WorkflowDefinition {
  const workflow = cloneJson(params.workflow || ({} as WorkflowDefinition));
  const metadata = workflow.metadata || ({ id: '', name: 'Workflow' } as WorkflowDefinition['metadata']);
  const scope =
    params.scope.type === 'channel' || params.scope.type === 'category' || params.scope.type === 'subject' || params.scope.type === 'post'
      ? { type: params.scope.type, id: params.scope.id }
      : null;
  const requestPayload = toRecordValue(params.requestPayload);
  const tagSlugs = toStringList(requestPayload.tag_slugs);
  const subjectQuery = toTextValue(requestPayload.subject_query) || null;
  const topK = Number(requestPayload.top_k);
  const systemPrompt = toTextValue(requestPayload.system_prompt) || null;
  const attachments = Array.isArray(requestPayload.attachments) ? requestPayload.attachments : [];
  const chatExecutionMode = toTextValue(requestPayload.chat_execution_mode || requestPayload.chatExecutionMode) || null;
  const pendingPlan = toRecordValue(requestPayload.pendingPlan || requestPayload.pending_plan);
  const confirmed = requestPayload.confirmed === true || toTextValue(requestPayload.confirmed).toLowerCase() === 'true';

  workflow.metadata = {
    ...metadata,
    chatId: params.chatId,
    message: params.message,
    scope,
    channelId: params.scope.type === 'channel' ? params.scope.id : metadata.channelId,
    categoryId: params.scope.type === 'category' ? params.scope.id : metadata.categoryId,
    subjectIds: params.resolvedScope.subject_ids,
    postIds: params.resolvedScope.post_ids,
    tagSlugs,
    subjectQuery,
    topK: Number.isFinite(topK) ? topK : null,
    systemPrompt,
    attachments,
    chatExecutionMode,
    confirmed,
    pendingPlan: Object.keys(pendingPlan).length ? pendingPlan : null,
    scopeSnapshot: params.scopeSnapshot,
  };
  workflow.input = {
    ...(toRecordValue(workflow.input) as WorkflowDefinition['input']),
    chatId: params.chatId,
    message: params.message,
    scope,
    subjectIds: params.resolvedScope.subject_ids,
    postIds: params.resolvedScope.post_ids,
    tagSlugs,
    subjectQuery,
    topK: Number.isFinite(topK) ? topK : null,
    systemPrompt,
    attachments,
    chatExecutionMode,
    confirmed,
    pendingPlan: Object.keys(pendingPlan).length ? pendingPlan : null,
  } as WorkflowDefinition['input'];

  return workflow;
}

async function loadWorkflowRecord(
  supabase: any,
  params: {
    workflowId: string;
    scope: 'user' | 'organization' | 'default';
    userId?: string | null;
    organizationId?: string | null;
  },
): Promise<WorkflowDefinition | null> {
  const data =
    params.scope === 'user'
      ? params.userId
        ? await WorkflowEntity.readActivePersonalById(
            params.workflowId,
            params.userId,
            'id,workflow,published_workflow,status,is_active,user_id,organization_id,is_global',
          )
        : null
      : params.scope === 'organization'
      ? params.organizationId
        ? await WorkflowEntity.readActiveOrganizationById(
            params.workflowId,
            params.organizationId,
            'id,workflow,published_workflow,status,is_active,user_id,organization_id,is_global',
          )
        : null
      : await WorkflowEntity.readActiveGlobalById(
          params.workflowId,
          'id,workflow,published_workflow,status,is_active,user_id,organization_id,is_global',
        );

  if (!data || data.is_active === false) return null;
  const normalizedStatus = String((data as any).status || '')
    .trim()
    .toLowerCase();
  if (normalizedStatus !== 'published') return null;
  return ((data as any).published_workflow || null) as WorkflowDefinition | null;
}

async function loadWorkflowAssignmentSlot(
  supabase: any,
  params: {
    scopeType: string;
    scopeId: string | null;
    userId: string | null;
    organizationId: string | null;
  },
) {
  const data = await WorkflowAssignmentEntity.readLatestSlot({
    scopeType: params.scopeType,
    scopeId: params.scopeId,
    userId: params.userId,
    organizationId: params.organizationId,
  });

  if (!data?.workflow_id) return null;
  return data;
}

export async function resolveChatWorkflow(supabase: any, userId: string, scope: ChatScope): Promise<ResolvedChatWorkflow | null> {
  try {
    const organizationId = typeof scope.organizationId === 'string' ? scope.organizationId.trim() : '';
    if (organizationId && !(await OrganisationEntity.isActive(organizationId))) {
      return null;
    }
    const workflowScopeType = String(scope.type || '')
      .trim()
      .toUpperCase();

    const slots: Array<{
      source: WorkflowSource;
      recordScope: 'user' | 'organization' | 'default';
      slot: {
        scopeType: string;
        scopeId: string | null;
        userId: string | null;
        organizationId: string | null;
      };
    }> = [
      {
        source: 'user',
        recordScope: 'user',
        slot: {
          scopeType: workflowScopeType,
          scopeId: scope.id,
          userId,
          organizationId: null,
        },
      },
    ];

    if (organizationId) {
      slots.push({
        source: 'organization',
        recordScope: 'organization',
        slot: {
          scopeType: workflowScopeType,
          scopeId: scope.id,
          userId: null,
          organizationId,
        },
      });
      slots.push({
        source: 'organizationDefault',
        recordScope: 'organization',
        slot: {
          scopeType: workflowScopeType,
          scopeId: null,
          userId: null,
          organizationId,
        },
      });
    }

    slots.push({
      source: 'globalDefault',
      recordScope: 'default',
      slot: {
        scopeType: workflowScopeType,
        scopeId: null,
        userId: null,
        organizationId: null,
      },
    });

    for (const candidate of slots) {
      const assignment = await loadWorkflowAssignmentSlot(supabase, candidate.slot);
      if (!assignment?.workflow_id) continue;

      const workflow = await loadWorkflowRecord(supabase, {
        workflowId: String(assignment.workflow_id),
        scope: candidate.recordScope,
        userId: candidate.recordScope === 'user' ? userId : null,
        organizationId: candidate.recordScope === 'organization' ? organizationId : null,
      });

      if (!workflow) continue;

      return {
        source: candidate.source,
        assignmentId: String(assignment.id),
        workflowId: String(assignment.workflow_id),
        workflow,
      };
    }

    return null;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function createWorkflowChatTracker(params: {
  workflowReference: WorkflowReference;
  workflowVersionId: string | null;
  runId: string;
  userId: string;
  chatId: string;
  scope: ChatScope;
  requestPayload: Record<string, unknown>;
  workflowSource: WorkflowSource;
  workflowSnapshot: WorkflowDefinition;
}): Promise<WorkflowExecutionTracker> {
  const startedAt = new Date().toISOString();
  const execution = await WorkflowExecutionEntity.create({
    workflow_id: params.workflowReference.workflowId,
    workflow_version_id: params.workflowVersionId || null,
    status: 'running',
    run_id: params.runId,
    trigger_type: 'chat',
    user_id: params.userId,
    chat_session_id: params.chatId,
    scope_type: params.scope.type,
    scope_id: params.scope.id,
    workflow_source: params.workflowSource,
    request_payload: params.requestPayload,
    response_payload: null,
    workflow_snapshot: normalizeWorkflowSnapshotIdentity({
      workflow: params.workflowSnapshot,
      workflowId: params.workflowReference.workflowId,
      workflowScope: params.workflowReference.scope,
    }),
    started_at: startedAt,
    created_at: startedAt,
    updated_at: startedAt,
  } as any);
  const executionId = String(execution.id || '').trim();
  const entries: WorkflowRunLogEvent[] = [];
  const pendingWrites = new Set<Promise<void>>();
  return {
    id: executionId,
    recordEvent: (event: WorkflowRunLogEvent) => {
      entries.push(cloneJson(event));
      const writePromise = WorkflowLogEntity.append({
        executionId,
        level: String(event.level || WorkflowLogLevelEnum.Info),
        message: String(event.message || event.event || 'workflow event'),
        data: event as unknown as Record<string, unknown>,
      })
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => pendingWrites.delete(writePromise));
      pendingWrites.add(writePromise);
      void writePromise;
    },
    finalize: async ({ status, errorMessage, responsePayload, workflowSnapshot, extraFields }) => {
      await Promise.allSettled(Array.from(pendingWrites));
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      await WorkflowExecutionEntity.updateRecord({
        id: executionId,
        patch: {
          ...(extraFields || {}),
          status,
          error_message: errorMessage || null,
          response_payload: responsePayload || null,
          workflow_snapshot: normalizeWorkflowSnapshotIdentity({
            workflow: workflowSnapshot || params.workflowSnapshot,
            workflowId: params.workflowReference.workflowId,
            workflowScope: params.workflowReference.scope,
          }),
          logs: cloneJson(entries),
          duration_ms: durationMs,
          completed_at: completedAt,
          updated_at: completedAt,
        },
      });
    },
  };
}

export async function executeChatWorkflow(params: {
  supabase: any;
  request: any;
  userId: string;
  chatId: string;
  requestId?: string | null;
  requestPayload?: Record<string, unknown> | null;
  scope: ChatScope;
  scopeSnapshot: ChatScopeSnapshot | null;
  resolvedScope: ResolvedChatScope;
  message: string;
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
  systemPrompt?: string | null;
  workflowAttachment: ResolvedChatWorkflow;
}): Promise<WorkflowExecutionArtifacts> {
  const workflow = hydrateWorkflowDefinition({
    workflow: params.workflowAttachment.workflow,
    chatId: params.chatId,
    scope: params.scope,
    scopeSnapshot: params.scopeSnapshot,
    resolvedScope: params.resolvedScope,
    message: params.message,
    requestPayload: params.requestPayload,
  });
  const runId = createRunId('run');
  const executionStartedAt = new Date();
  const keepDurableTracker = process.env.GIGA_DISABLE_API_WORKFLOW_QUEUE !== '1';
  const workflowReference: WorkflowReference = {
    workflowId: params.workflowAttachment.workflowId,
    scope:
      params.workflowAttachment.source === 'globalDefault'
        ? 'global'
        : params.workflowAttachment.source === 'organization' || params.workflowAttachment.source === 'organizationDefault'
        ? 'organization'
        : 'user',
    organizationId: params.scope.organizationId || null,
    ownerUserId: params.workflowAttachment.source === 'user' ? params.userId : null,
  };
  const workflowVersionId = keepDurableTracker
    ? await WorkflowVersionEntity.resolveCurrentId({ workflowId: workflowReference.workflowId }).catch(() => null)
    : null;
  const tracker = keepDurableTracker
    ? await createWorkflowChatTracker({
        workflowReference,
        workflowVersionId,
        runId,
        userId: params.userId,
        workflowSource: params.workflowAttachment.source,
        chatId: params.chatId,
        scope: params.scope,
        requestPayload: {
          ...(params.requestPayload || {}),
          message: params.message,
          request_id: params.requestId || null,
          system_prompt: params.systemPrompt || null,
        },
        workflowSnapshot: workflow,
      }).catch(() => null)
    : null;

  const logger = {
    entries: [] as WorkflowRunLogEvent[],
    push: (event: any) => {
      const normalizedEvent = {
        timestamp: new Date().toISOString(),
        level: event.level || WorkflowLogLevelEnum.Info,
        ...event,
      };
      logger.entries.push(normalizedEvent);
      tracker?.recordEvent(normalizedEvent);
    },
  };

  const requestContext: WorkflowExecutionRequestContext = {
    request: (params.request || { headers: {} }) as any,
    supabase: params.supabase,
    userId: params.userId,
  };

  let workflowResult;
  const timeoutController = createWorkflowExecutionTimeoutController({
    settings: resolveWorkflowSettings(params.request, workflow),
    label: 'Workflow chat execution',
  });
  try {
    workflowResult = await executeWorkflow(workflow, {
      runId,
      signal: timeoutController.signal,
      settings: resolveWorkflowSettings(params.request, workflow),
      hostContext: createWorkflowReferenceHostContext(requestContext),
      logger,
      requestContext,
    });
  } catch (error: any) {
    await tracker?.finalize({
      status: 'failed',
      errorMessage: error?.message || 'Workflow execution failed.',
      workflowSnapshot: workflow,
    });
    throw error;
  } finally {
    timeoutController.cleanup();
  }

  const terminalPayload = extractTerminalPayload(workflowResult.workflow);
  const workflowError = resolveWorkflowFailureMessage(workflowResult.logs || [], terminalPayload);
  if (workflowError) {
    await tracker?.finalize({
      status: 'failed',
      errorMessage: workflowError,
      workflowSnapshot: workflowResult.workflow || workflow,
    });
    throw new Error(workflowError);
  }
  const sourceRefs = normalizeChatSources(
    terminalPayload && typeof terminalPayload === 'object' && !Array.isArray(terminalPayload)
      ? (terminalPayload as Record<string, any>).sources || (terminalPayload as Record<string, any>).source_refs
      : null,
  );
  const retrievedChunks = normalizeRetrievedChunks(
    terminalPayload && typeof terminalPayload === 'object' && !Array.isArray(terminalPayload)
      ? (terminalPayload as Record<string, any>).retrievedChunks || (terminalPayload as Record<string, any>).retrieved_chunks
      : null,
  );
  const completedAt = new Date();
  const totalSeconds = Math.max(0, (completedAt.getTime() - executionStartedAt.getTime()) / 1000);
  const debugState = buildWorkflowChatDebugState({
    executionId: tracker?.id || '',
    logs: workflowResult.logs || [],
    runId: workflowResult.runId || runId,
    workflow: workflowResult.workflow || workflow,
    workflowId: params.workflowAttachment.workflowId,
    workflowSource: params.workflowAttachment.source,
  });

  return {
    executionId: tracker?.id || null,
    source: params.workflowAttachment.source,
    workflowId: params.workflowAttachment.workflowId,
    assignmentId: params.workflowAttachment.assignmentId,
    workflow,
    workflowResult,
    runId: workflowResult.runId || runId,
    debugState: {
      ...(debugState || {}),
      workflow_queue_timing: {
        queuedAt: executionStartedAt.toISOString(),
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        queueSeconds: 0,
        executionSeconds: totalSeconds,
        totalSeconds,
      },
    },
    terminalPayload,
    text: normalizeWorkflowText(terminalPayload),
    sourceRefs,
    retrievedChunks,
    tracker,
  };
}

export async function persistWorkflowExecution(params: {
  supabase: any;
  userId: string;
  chatSessionId: string;
  chatMessageId: string;
  assistantMessageId?: string | null;
  scope: ChatScope;
  execution: WorkflowExecutionArtifacts;
  requestPayload: Record<string, any>;
  error?: string | null;
}) {
  try {
    const debugState =
      params.execution.debugState ||
      buildWorkflowChatDebugState({
        executionId: params.execution.executionId || '',
        logs: params.execution.workflowResult.logs || [],
        runId: params.execution.runId || params.execution.workflowResult.runId,
        workflow: (params.execution.workflowResult.workflow || params.execution.workflow) as any,
        workflowId: params.execution.workflowId,
        workflowSource: params.execution.source,
      });
    if (params.execution.tracker) {
      await params.execution.tracker.finalize({
        status: params.error ? 'failed' : 'completed',
        errorMessage: params.error || null,
        workflowSnapshot: params.execution.workflowResult.workflow || params.execution.workflow,
        responsePayload: {
          execution_id: params.execution.executionId || null,
          run_id: params.execution.runId || params.execution.workflowResult.runId,
          text: params.execution.text,
          terminal_payload: params.execution.terminalPayload,
          source_refs: params.execution.sourceRefs,
          retrieved_chunks: params.execution.retrievedChunks,
          workflow_debug: debugState,
          workflow_id: params.execution.workflowId,
          workflow_source: params.execution.source,
        },
        extraFields: {
          assistant_message_id: params.assistantMessageId || null,
        },
      });
      return;
    }

    const row = {
      user_id: params.userId,
      chat_session_id: params.chatSessionId,
      chat_message_id: params.chatMessageId,
      assistant_message_id: params.assistantMessageId || null,
      scope_type: params.scope.type,
      scope_id: params.scope.id,
      workflow_source: params.execution.source,
      workflow_id: params.execution.workflowId,
      status: params.error ? 'failed' : 'completed',
      error_message: params.error || null,
      logs: params.execution.workflowResult.logs || [],
      request_payload: params.requestPayload,
      response_payload: {
        execution_id: params.execution.executionId || null,
        run_id: params.execution.runId || params.execution.workflowResult.runId,
        text: params.execution.text,
        terminal_payload: params.execution.terminalPayload,
        source_refs: params.execution.sourceRefs,
        retrieved_chunks: params.execution.retrievedChunks,
        workflow_debug: debugState,
        workflow_id: params.execution.workflowId,
        workflow_source: params.execution.source,
      },
      workflow_snapshot: normalizeWorkflowSnapshotIdentity({
        workflow: (params.execution.workflowResult.workflow || params.execution.workflow) as any,
        workflowId: params.execution.workflowId,
        workflowScope: params.execution.source,
      }),
      completed_at: new Date().toISOString(),
    };

    await WorkflowExecutionEntity.create(row as any);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
}
