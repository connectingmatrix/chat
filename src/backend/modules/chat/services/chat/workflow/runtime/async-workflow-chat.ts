import { ChatEntity, ChatMessageEntity, UsageEventEntity } from '@connectingmatrix/orm/repositories/entities';
import { startQueuedChatWorkflow, type QueuedChatWorkflowStart } from '../write/queued-workflow-chat';
import type { ChatScope, ResolvedChatScope, QueryChatDebugOptions } from '../../contracts/types';
import type { ResolvedChatWorkflow } from '@giga/shared/types/contracts/graphql.types';

export const workflowRealtimeText = (start: { executionId: string; realtime: any; runId: string; workflowId: string }) => {
  const events = Array.isArray(start.realtime?.events) ? start.realtime.events.join(', ') : 'workflow:execution:update, workflow:event';
  return [
    'Workflow queued for async execution.',
    `Execution id: ${start.executionId}`,
    `Run id: ${start.runId}`,
    `Workflow id: ${start.workflowId}`,
    `Realtime path: ${start.realtime?.path || '/ws/workflow'}`,
    `Events: ${events}`,
  ].join('\n');
};

export const startAsyncWorkflowChatResponse = async (params: {
  debug?: QueryChatDebugOptions | null;
  effectiveScope: ChatScope;
  input: { debug?: QueryChatDebugOptions | null; message: string; request?: any; supabase: any };
  requestPayload: Record<string, unknown>;
  resolvedScope: ResolvedChatScope;
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
  session: { id: string };
  systemPrompt: string | null;
  userId: string;
  userMessage: { id: string | number };
  workflowAttachment: ResolvedChatWorkflow;
}): Promise<{
  assistantMessage: Awaited<ReturnType<typeof ChatMessageEntity.saveMessage>>;
  text: string;
  workflowStart: QueuedChatWorkflowStart;
}> => {
  const workflowStart = await startQueuedChatWorkflow({
    supabase: params.input.supabase,
    request: params.input.request,
    userId: params.userId,
    chatId: params.session.id,
    chatMessageId: params.userMessage.id,
    debug: params.debug || null,
    requestId: params.input.debug?.requestId || null,
    scope: params.effectiveScope,
    scopeSnapshot: params.resolvedScope.snapshot,
    resolvedScope: params.resolvedScope,
    message: params.input.message,
    runtimeLimits: params.runtimeLimits,
    systemPrompt: params.systemPrompt,
    requestPayload: params.requestPayload,
    workflowAttachment: params.workflowAttachment,
  });
  const text = workflowRealtimeText(workflowStart);
  const now = new Date().toISOString();
  const assistantMessage = await ChatMessageEntity.saveMessage({
    chatId: params.session.id,
    userId: params.userId,
    role: 'assistant',
    content: text,
    sourceRefs: [],
  });
  const session = await ChatEntity.single(params.session.id);
  if (session) await session.update({ last_message_at: now, updated_at: now });
  await UsageEventEntity.recordPolicyUsage({
    target: 'chat.query.workflow.async',
    metadata: { chatId: params.session.id, executionId: workflowStart.executionId, runId: workflowStart.runId },
    organizationId: params.effectiveScope.organizationId || null,
    userId: params.userId,
  });
  return { assistantMessage, text, workflowStart };
};
