import { createRunId } from 'giga-ai-helper/workflow';
import { Executor, type WorkflowQueueRequest, type WorkflowQueueTerminalEvent } from '@workflow/executor';
import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { OrganisationEntity } from '@connectingmatrix/orm/repositories/entities';
import { applyWorkflowQueueEvent } from '@connectingmatrix/workflow-driver/services/workflow/queue/write/applyWorkflowQueueEvent';
import { executeQueuedWorkflowRequest } from '@connectingmatrix/workflow-driver/services/workflow/queue/write/executeQueuedWorkflowRequest';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflow-driver/services/workflow/runtime/workflow-identity';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowExecutionEntity';
import { WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowVersionEntity';
import '@connectingmatrix/workflow-driver/services/workflow/runtime/setupWorkflowExecutor';
import {
  extractTerminalPayload,
  hydrateWorkflowDefinition,
  normalizeChatSources,
  normalizeRetrievedChunks,
  normalizeWorkflowText,
  resolveWorkflowFailureMessage,
  resolveWorkflowSettings,
} from '../runtime/workflow-chat';
import { buildWorkflowChatDebugState } from '../runtime/chat-debug-state';
import { registerChatWorkflowDebugExecution } from '../integration/chat-debug-bridge';
import type { ChatScope, ChatScopeSnapshot, QueryChatDebugOptions, ResolvedChatScope } from '../../contracts/types';
import type { ResolvedChatWorkflow } from '@giga/shared/types/contracts/graphql.types';
import type { WorkflowExecutionArtifacts, WorkflowReference } from '@giga/shared/types/contracts/workflow.types';
import type { WorkflowQueueEvent } from '@workflow/executor';

type QueuedChatWorkflowParams = {
  supabase: any;
  request: any;
  userId: string;
  chatId: string;
  chatMessageId: string | number;
  debug?: QueryChatDebugOptions | null;
  requestId?: string | null;
  requestPayload?: Record<string, unknown> | null;
  scope: ChatScope;
  scopeSnapshot: ChatScopeSnapshot | null;
  resolvedScope: ResolvedChatScope;
  message: string;
  systemPrompt?: string | null;
  workflowAttachment: ResolvedChatWorkflow;
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
};

export type QueuedChatWorkflowStart = {
  assignmentId?: string | null;
  executionId: string;
  realtime: {
    events: string[];
    path: string;
    subscriptions: {
      catalog: { event: string; payload: Record<string, unknown> };
      execution: { event: string; payload: Record<string, unknown> };
    };
  };
  runId: string;
  workflowId: string;
  workflowSource: string;
};

const buildQueueRequest = (params: {
  chatId: string;
  message: string;
  request: any;
  requestPayload?: Record<string, unknown> | null;
  supabase: any;
  resolvedScope: ResolvedChatScope;
  scope: ChatScope;
  scopeSnapshot: ChatScopeSnapshot | null;
  systemPrompt?: string | null;
  userId: string;
  workflowAttachment: ResolvedChatWorkflow;
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
}): WorkflowQueueRequest => {
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
  const workflowScope =
    params.workflowAttachment.source === 'globalDefault'
      ? 'global'
      : params.workflowAttachment.source === 'organization' || params.workflowAttachment.source === 'organizationDefault'
      ? 'organization'
      : 'user';

  return {
    executionId: '',
    runId,
    queueKey: `${params.userId}:chat:${params.chatId}`,
    userId: params.userId,
    broadcastId: params.userId,
    broadcastChannelName: 'workflow-socket',
    triggerType: 'chat',
    workflowReference: {
      workflowId: params.workflowAttachment.workflowId,
      scope: workflowScope,
      organizationId: params.scope.organizationId || null,
      ownerUserId: params.workflowAttachment.source === 'user' ? params.userId : null,
    },
    workflowVersionId: null,
    workflow: Executor.normalizeWorkflowQueueDefinition(workflow as any),
    settings: resolveWorkflowSettings(params.request, workflow, params.runtimeLimits),
    requestContext: Executor.createWorkflowQueueRequestContextSnapshot({
      mode: 'user',
      request: params.request || { headers: {} },
      userId: params.userId,
      authorization:
        (params.request as any)?.headers?.authorization ||
        ((params.supabase as any)?.__access_token ? `Bearer ${(params.supabase as any).__access_token}` : null),
    }),
    metadata: {
      chatSessionId: params.chatId,
      scopeType: params.scope.type,
      scopeId: params.scope.id,
      workflowSource: params.workflowAttachment.source,
      requestPayload: params.requestPayload || {
        message: params.message,
        system_prompt: params.systemPrompt || null,
      },
    },
  };
};

const workflowEventDetails = (event: WorkflowQueueTerminalEvent) => {
  if (event.type === 'completed') return '';
  const logs = Array.isArray(event.logs)
    ? event.logs
        .map((entry: any) => String(entry?.message || entry?.event || entry?.error || '').trim())
        .filter(Boolean)
        .slice(-3)
        .join(' | ')
    : '';
  return [event.errorMessage, logs].filter(Boolean).join(' | ');
};

const waitForQueuedExecutionCompletion = async (params: {
  completion: Promise<WorkflowQueueTerminalEvent>;
  controller: AbortController;
  executionId: string;
  maxWaitMs: number;
  queuedAt: string;
}) => {
  const timeout = setTimeout(() => params.controller.abort(), params.maxWaitMs);
  try {
    const event = await params.completion;
    if (event.type === 'completed') {
      const startedPayload = Executor.withWorkflowQueueExecutionStarted(Executor.createWorkflowQueueTimingPayload(params.queuedAt), params.queuedAt);
      return {
        status: 'completed',
        error_message: null,
        workflow_snapshot: event.result.workflow,
        response_payload: Executor.mergeWorkflowQueueTimingPayload(event.result.responsePayload ?? null, startedPayload, params.queuedAt),
        logs: event.result.logs,
        created_at: params.queuedAt,
        completed_at: event.timestamp,
      };
    }
    throw new Error(workflowEventDetails(event) || `Chat workflow execution ${params.executionId} failed.`);
  } catch (error) {
    if (params.controller.signal.aborted) throw new Error(`Timed out waiting for chat workflow execution ${params.executionId}.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const realtimeBinding = (userId: string, workflowId: string) => ({
  path: '/ws/workflow',
  subscriptions: {
    catalog: {
      event: 'workflow:catalog:subscribe',
      payload: { broadcast_id: userId, channel_name: 'workflow-socket' },
    },
    execution: {
      event: 'workflow:execution:subscribe',
      payload: { broadcast_id: userId, workflow_id: workflowId },
    },
  },
  events: ['workflow:catalog:status', 'workflow:execution:update', 'workflow:event'],
});

const isTerminalWorkflowEvent = (event: WorkflowQueueEvent): event is WorkflowQueueTerminalEvent =>
  event.type === 'completed' || event.type === 'failed';

const publishLocalWorkflowEvent = async (event: WorkflowQueueEvent, options: { nonBlocking?: boolean } = {}): Promise<void> => {
  if (isTerminalWorkflowEvent(event)) Executor.resolveWorkflowQueueCompletion(event);
  if (options.nonBlocking) {
    void applyWorkflowQueueEvent(SupabaseClientAdmin(), event).catch(() => undefined);
    return;
  }
  await applyWorkflowQueueEvent(SupabaseClientAdmin(), event);
};

const executeLocalQueuedWorkflow = (
  queueRequest: WorkflowQueueRequest,
  options: { nonBlockingEvents?: boolean; skipStartedEvent?: boolean } = {},
): void => {
  const controller = new AbortController();
  void executeQueuedWorkflowRequest(queueRequest, {
    publishEvent: (event) =>
      options.skipStartedEvent && event.type === 'started'
        ? Promise.resolve()
        : publishLocalWorkflowEvent(event, { nonBlocking: options.nonBlockingEvents }),
    signal: controller.signal,
  }).finally(() => controller.abort());
};

const enqueueQueuedChatWorkflow = async (
  params: QueuedChatWorkflowParams,
  options: { transport?: 'local' | 'pubsub'; waitForCompletion?: boolean } = {},
) => {
  const queueRequest = buildQueueRequest(params);
  const workflowReference = queueRequest.workflowReference as WorkflowReference;
  const effectiveRoot = await isCurrentUserRootUser(params.supabase).catch(() => false);
  const organization = workflowReference.organizationId ? (OrganisationEntity.load(workflowReference.organizationId) as OrganisationEntity) : null;
  const sharedDrive = organization
    ? await organization.sharedSpace.workflowDrive({
        request: params.request,
        supabase: params.supabase,
        userId: params.userId,
        effectiveRoot,
      })
    : null;
  queueRequest.settings = { ...(queueRequest.settings as any), sharedDrive };
  const workflowVersionId = await WorkflowVersionEntity.resolveCurrentId({ workflowId: workflowReference.workflowId }).catch(() => null);
  const queuedAt = new Date().toISOString();
  const localSync = options.transport === 'local' && options.waitForCompletion === true;
  const requestId = String(params.requestId || params.requestPayload?.request_id || '').trim() || null;
  const tracker = await WorkflowExecutionEntity.create({
    workflow_id: workflowReference.workflowId,
    workflow_version_id: workflowVersionId,
    status: localSync ? 'running' : 'queued',
    user_id: params.userId,
    chat_session_id: params.chatId,
    chat_message_id: String(params.chatMessageId),
    scope_type: params.scope.type,
    scope_id: params.scope.id,
    workflow_source: params.workflowAttachment.source,
    run_id: queueRequest.runId,
    trigger_type: 'chat',
    request_payload: {
      ...(params.requestPayload || {}),
      message: params.message,
      request_id: requestId,
      system_prompt: params.systemPrompt || null,
    },
    response_payload: localSync
      ? Executor.withWorkflowQueueExecutionStarted(Executor.createWorkflowQueueTimingPayload(queuedAt), queuedAt)
      : Executor.createWorkflowQueueTimingPayload(queuedAt),
    workflow_snapshot: queueRequest.workflow as any,
    created_at: queuedAt,
    updated_at: queuedAt,
  } as any);
  const trackerId = String(tracker.id || '').trim();
  queueRequest.executionId = trackerId;
  queueRequest.workflowVersionId = workflowVersionId;
  const completionController = options.waitForCompletion ? new AbortController() : null;
  const completion = completionController ? Executor.waitForWorkflowQueueCompletion(trackerId, completionController.signal) : null;
  const unregisterDebug = registerChatWorkflowDebugExecution({
    chatId: params.chatId,
    emit: params.debug?.emit || null,
    executionId: trackerId,
    requestId,
    workflowSource: params.workflowAttachment.source,
  });

  try {
    if (options.transport === 'local') {
      executeLocalQueuedWorkflow(queueRequest, { nonBlockingEvents: localSync, skipStartedEvent: localSync });
    } else {
      await Executor.enqueue(queueRequest.queueKey, { request: queueRequest }, queueRequest.workflow as any);
    }
  } catch (error: any) {
    completionController?.abort();
    void completion?.catch(() => undefined);
    unregisterDebug();
    await WorkflowExecutionEntity.updateRecord({
      id: trackerId,
      patch: {
        status: 'failed',
        error_message: error?.message || 'Failed to enqueue chat workflow execution.',
        response_payload: Executor.createWorkflowQueueTimingPayload(queuedAt),
        workflow_snapshot: normalizeWorkflowSnapshotIdentity({
          workflow: queueRequest.workflow as any,
          workflowId: workflowReference.workflowId,
          workflowScope: workflowReference.scope,
        }),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    throw error;
  }

  return { completion, completionController, queueRequest, queuedAt, tracker, unregisterDebug, workflowReference };
};

export const startQueuedChatWorkflow = async (params: QueuedChatWorkflowParams): Promise<QueuedChatWorkflowStart> => {
  const { queueRequest, tracker, unregisterDebug } = await enqueueQueuedChatWorkflow(params);
  unregisterDebug();
  return {
    assignmentId: params.workflowAttachment.assignmentId || null,
    executionId: tracker.id,
    realtime: realtimeBinding(params.userId, params.workflowAttachment.workflowId),
    runId: queueRequest.runId,
    workflowId: params.workflowAttachment.workflowId,
    workflowSource: params.workflowAttachment.source,
  };
};

export const executeQueuedChatWorkflow = async (
  params: QueuedChatWorkflowParams,
): Promise<{ executionId: string; execution: WorkflowExecutionArtifacts }> => {
  const { completion, completionController, queueRequest, queuedAt, tracker, unregisterDebug } = await enqueueQueuedChatWorkflow(params, {
    transport: 'local',
    waitForCompletion: true,
  });

  try {
    if (!completion || !completionController) throw new Error('Workflow queue completion listener was not registered.');
    const completedRecord = await waitForQueuedExecutionCompletion({
      completion,
      controller: completionController,
      executionId: tracker.id,
      maxWaitMs: (Number(params.runtimeLimits?.maxExecutionSeconds) || 300) * 1000 + 15_000,
      queuedAt,
    });
    const responsePayload =
      completedRecord?.response_payload && typeof completedRecord.response_payload === 'object' && !Array.isArray(completedRecord.response_payload)
        ? (completedRecord.response_payload as Record<string, any>)
        : {};
    const workflowSnapshot = completedRecord?.workflow_snapshot || queueRequest.workflow;
    const terminalPayload = Object.prototype.hasOwnProperty.call(responsePayload, 'terminal_payload')
      ? responsePayload.terminal_payload
      : extractTerminalPayload(workflowSnapshot as any);
    const logs = Array.isArray(completedRecord?.logs) ? (completedRecord.logs as any) : [];
    const workflowError = resolveWorkflowFailureMessage(logs, terminalPayload);
    if (workflowError) throw new Error(workflowError);
    const payloadText =
      typeof responsePayload.text === 'string' && responsePayload.text.trim() !== '[object Object]' ? responsePayload.text.trim() : '';
    const queueTiming = Executor.resolveWorkflowQueueTiming({
      completedAt: completedRecord?.completed_at || null,
      createdAt: completedRecord?.created_at || null,
      responsePayload,
    });
    const workflowQueueTiming = {
      queuedAt: queueTiming.queuedAt,
      executionStartedAt: queueTiming.executionStartedAt,
      queueSeconds: queueTiming.timeElapsed - queueTiming.executionTime,
      executionSeconds: queueTiming.executionTime,
      totalSeconds: queueTiming.timeElapsed,
    };
    const debugState = buildWorkflowChatDebugState({
      executionId: tracker.id,
      logs,
      runId: queueRequest.runId,
      workflow: workflowSnapshot as any,
      workflowId: params.workflowAttachment.workflowId,
      workflowSource: params.workflowAttachment.source,
    });

    return {
      executionId: tracker.id,
      execution: {
        executionId: tracker.id,
        source: params.workflowAttachment.source,
        workflowId: params.workflowAttachment.workflowId,
        assignmentId: params.workflowAttachment.assignmentId,
        workflow: queueRequest.workflow as any,
        workflowResult: { workflow: workflowSnapshot as any, logs, stopped: false, runId: queueRequest.runId },
        runId: queueRequest.runId,
        debugState: { ...(debugState || {}), workflow_queue_timing: workflowQueueTiming },
        terminalPayload,
        text: payloadText || normalizeWorkflowText(terminalPayload),
        sourceRefs: normalizeChatSources(
          responsePayload.source_refs ||
            (terminalPayload && typeof terminalPayload === 'object' && !Array.isArray(terminalPayload)
              ? (terminalPayload as Record<string, any>).sources || (terminalPayload as Record<string, any>).source_refs
              : null),
        ),
        retrievedChunks: normalizeRetrievedChunks(
          responsePayload.retrieved_chunks ||
            (terminalPayload && typeof terminalPayload === 'object' && !Array.isArray(terminalPayload)
              ? (terminalPayload as Record<string, any>).retrievedChunks || (terminalPayload as Record<string, any>).retrieved_chunks
              : null),
        ),
        tracker: null,
      },
    };
  } finally {
    unregisterDebug();
  }
};

export const attachQueuedChatWorkflowExecutionArtifacts = async (params: {
  assistantMessageId: string | number;
  execution: WorkflowExecutionArtifacts;
  executionId: string;
  supabase: any;
}): Promise<void> => {
  void params.supabase;
  const currentRecord = await WorkflowExecutionEntity.readResponsePayloadRowById(params.executionId);
  await WorkflowExecutionEntity.updateRecord({
    id: params.executionId,
    patch: {
      assistant_message_id: String(params.assistantMessageId),
      response_payload: Executor.mergeWorkflowQueueTimingPayload(
        {
          text: params.execution.text,
          terminal_payload: params.execution.terminalPayload,
          source_refs: params.execution.sourceRefs,
          retrieved_chunks: params.execution.retrievedChunks,
          workflow_debug: params.execution.debugState || null,
          execution_id: params.execution.executionId || params.executionId,
          run_id: params.execution.runId || null,
          workflow_id: params.execution.workflowId,
          workflow_source: params.execution.source,
          workflow_queue_timing: params.execution.debugState?.workflow_queue_timing || null,
        },
        currentRecord?.response_payload || null,
      ),
      workflow_snapshot: normalizeWorkflowSnapshotIdentity({
        workflow: (params.execution.workflowResult.workflow || params.execution.workflow) as any,
        workflowId: params.execution.workflowId,
        workflowScope: params.execution.source,
      }),
      updated_at: new Date().toISOString(),
    },
  });
};
