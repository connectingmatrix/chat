import { getScopedLogger } from '@connectingmatrix/logger/lib/logger';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities';
import { emitChatRoomEventIfAvailable } from '@connectingmatrix/sockets/chat/telemetry/event-bus';
import { buildWorkflowChatDebugState } from '../runtime/chat-debug-state';
import type { ChatDebugEvent } from '@giga/shared/types/contracts/chat.types';
import type { WorkflowQueueEvent } from '@workflow/executor';

type ChatWorkflowDebugContext = { chatId: string; requestId: string | null; workflowSource: string | null };
type ChatWorkflowDebugListener = (event: ChatDebugEvent) => void;

const contextByExecutionId = new Map<string, ChatWorkflowDebugContext>();
const listenersByExecutionId = new Map<string, Set<ChatWorkflowDebugListener>>();
const logger = getScopedLogger('chat-workflow-debug');
const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const textValue = (value: unknown): string => String(value || '').trim();
const workflowSource = (scope: string): string => (scope === 'global' ? 'globalDefault' : scope === 'organization' ? 'organization' : 'user');

const readContext = async (_supabase: any, executionId: string) => {
  try {
    const data = await WorkflowExecutionEntity.readChatDebugContextRowById(executionId);
    if (!textValue(data?.chat_session_id)) return null;
    const requestPayload = recordValue(data.request_payload);
    return {
      chatId: textValue(data.chat_session_id),
      requestId: textValue(requestPayload.request_id) || null,
      workflowSource: textValue(data.workflow_source) || null,
    };
  } catch {
    return null;
  }
};

const notify = (executionId: string, event: ChatDebugEvent) => {
  for (const listener of listenersByExecutionId.get(executionId) || []) {
    try {
      listener(event);
    } catch (error: any) {
      logger.error('chat.workflow.debug.listener_failed', { execution_id: executionId, message: error?.message || 'Unknown listener failure.' });
    }
  }
};

const chatDebugEvent = (context: ChatWorkflowDebugContext, event: WorkflowQueueEvent): ChatDebugEvent => {
  const workflow = event.type === 'completed' ? event.result.workflow : event.type === 'failed' ? event.workflow : null;
  const logs = event.type === 'completed' ? event.result.logs : event.type === 'failed' ? event.logs : event.type === 'log' ? [event.log] : [];
  const meta = buildWorkflowChatDebugState({
    executionId: event.executionId,
    logs,
    runId: event.runId,
    workflow: workflow as any,
    workflowId: event.workflowId,
    workflowSource: context.workflowSource || workflowSource(event.workflowReference.scope),
  });
  const status =
    event.type === 'failed'
      ? 'failed'
      : event.type === 'completed'
      ? 'completed'
      : event.type === 'started'
      ? 'started'
      : String(meta.current_node_status || '').toLowerCase() === 'failed'
      ? 'failed'
      : 'progress';
  const stage =
    event.type === 'started'
      ? 'chat.workflow.execution'
      : event.type === 'completed' || event.type === 'failed'
      ? 'chat.workflow.execute'
      : 'chat.workflow.node';
  const message =
    event.type === 'started'
      ? 'Workflow execution started.'
      : event.type === 'failed'
      ? event.errorMessage
      : event.type === 'completed'
      ? 'Workflow response generated and persisted.'
      : textValue(meta.current_node_name || meta.current_node_id)
      ? `${textValue(meta.current_node_name || meta.current_node_id)} updated.`
      : textValue(event.log.message) || 'Workflow node updated.';
  return {
    chat_id: context.chatId,
    request_id: context.requestId,
    stage,
    status,
    emit: true,
    emit_room: context.chatId,
    message,
    timestamp: event.timestamp,
    meta: { ...meta, execution_mode: 'workflow', workflow_event: event.type, log_event: event.type === 'log' ? event.log.event : null },
  };
};

export const registerChatWorkflowDebugExecution = (params: {
  chatId: string;
  emit?: ((event: ChatDebugEvent) => void) | null;
  executionId: string;
  requestId?: string | null;
  workflowSource?: string | null;
}) => {
  contextByExecutionId.set(params.executionId, {
    chatId: params.chatId,
    requestId: params.requestId || null,
    workflowSource: params.workflowSource || null,
  });
  if (params.emit) {
    let listeners = listenersByExecutionId.get(params.executionId);
    if (!listeners) {
      listeners = new Set();
      listenersByExecutionId.set(params.executionId, listeners);
    }
    listeners.add(params.emit);
  }
  return () => {
    contextByExecutionId.delete(params.executionId);
    const listeners = listenersByExecutionId.get(params.executionId);
    if (!listeners || !params.emit) return;
    listeners.delete(params.emit);
    if (!listeners.size) listenersByExecutionId.delete(params.executionId);
  };
};

export const forwardWorkflowQueueEventToChatDebug = async (params: { event: WorkflowQueueEvent; supabase: any }) => {
  if (params.event.triggerType !== 'chat') return;
  const cachedContext = contextByExecutionId.get(params.event.executionId) || null;
  const context =
    cachedContext ||
    (!params.supabase || typeof params.supabase.from !== 'function' ? null : await readContext(params.supabase, params.event.executionId));
  if (!context?.chatId) return;
  contextByExecutionId.set(params.event.executionId, context);
  const event = chatDebugEvent(context, params.event);
  notify(params.event.executionId, event);
  emitChatRoomEventIfAvailable(context.chatId, 'chat:debug', {
    request_id: event.request_id || null,
    chat_id: context.chatId,
    stage: event.stage,
    status: event.status,
    emit: event.emit === true,
    emit_room: event.emit_room || context.chatId,
    message: event.message,
    timestamp: event.timestamp,
    meta: event.meta || {},
  });
  if (params.event.type !== 'completed' && params.event.type !== 'failed') return;
  contextByExecutionId.delete(params.event.executionId);
  listenersByExecutionId.delete(params.event.executionId);
};
