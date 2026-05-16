import { BadRequestError } from 'routing-controllers';
import { getScopedLogger } from '@connectingmatrix/logger/lib/logger';
import { buildPermissionContext, canReadScopedChat } from '@giga/permissions/services/auth/permission-context';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { ChatEntity, ChatMessageEntity, MessageChunkEntity, UsageEventEntity } from '@connectingmatrix/orm/repositories/entities';
import { pendingPlanStateFromMetadata } from '../actions/runtime/confirmation';
import { getLegacySessionScope, getSessionScope, getSessionSnapshotScope } from '../auth/scope';
import { agentActionDefaults, agentActionResultDefaults, agentPassDefaults, agentPlanDefaults, toChatSources } from '../io/query-chat-formatters';
import { executeChatConfirmation, type ChatConfirmationDecision } from './execute-for-chat';
import { observeChatSideEffect } from './side-effects';
import type { ChatSessionRecord, ResolvedChatScope } from '../contracts/types';

const logger = getScopedLogger('chat-confirmation-service');

function lightweightSessionScope(session: ChatSessionRecord): ResolvedChatScope {
  const legacyScope = getLegacySessionScope(session);
  if (legacyScope) return legacyScope;
  const snapshotScope = getSessionSnapshotScope(session);
  if (snapshotScope) return snapshotScope;
  const scope = getSessionScope(session);
  if (!scope) throw new Error('Chat session scope could not be resolved.');
  const subjectIds = scope.type === 'subject' ? [scope.id] : [];
  const postIds = scope.type === 'post' ? [scope.id] : [];
  return {
    scope,
    snapshot: { type: scope.type, id: scope.id, organizationId: scope.organizationId || null, subject_ids: subjectIds, post_ids: postIds },
    subject_ids: subjectIds,
    post_ids: postIds,
  };
}

export async function confirmChatAction(input: { chatId: string; decision: ChatConfirmationDecision; request: any; supabase: any; userId: string }) {
  if (input.decision !== 'confirm' && input.decision !== 'cancel') throw new BadRequestError('Invalid chat confirmation decision.');
  const session = await ChatEntity.getScopedSession({ userId: input.userId, chatId: input.chatId });
  if (!session) throw new BadRequestError('Chat session not found.');
  const sessionId = String(session.id || '');
  const sessionRow = session.payload as ChatSessionRecord;
  const resolvedScope = lightweightSessionScope(sessionRow);
  const effectiveScope = resolvedScope.scope;
  const permissions = buildPermissionContext(
    await readUserMatrixState(input.supabase, { organizationId: effectiveScope.organizationId || null, userId: input.userId }),
    false,
  );
  if (!canReadScopedChat(permissions, effectiveScope.type)) throw new BadRequestError(`Plan access does not allow ${effectiveScope.type}_chat read.`);
  const agentExecution = await executeChatConfirmation(
    {
      supabase: input.supabase,
      userId: input.userId,
      chatId: sessionId,
      message: input.decision,
      request: input.request,
      subjectIds: resolvedScope.subject_ids,
      postIds: resolvedScope.post_ids,
      topK: 10,
      scopeType: effectiveScope.type,
      scopeId: effectiveScope.id,
      scopeOrganizationId: effectiveScope.organizationId || null,
      scopeName: resolvedScope.snapshot.name || null,
      capabilities: permissions,
    },
    input.decision,
    { pendingState: pendingPlanStateFromMetadata(sessionRow.metadata || null) },
  );
  const sourceRefs = agentExecution.sources || [];
  const assistantMessage = await ChatMessageEntity.saveMessage({
    chatId: sessionId,
    userId: input.userId,
    role: 'assistant',
    content: agentExecution.markdown,
    sourceRefs: sourceRefs as Record<string, unknown>[],
  });
  if (agentExecution.retrieved_chunks.length) {
    await MessageChunkEntity.saveUsage({
      messageId: Number(assistantMessage.id || 0),
      chunks: agentExecution.retrieved_chunks as Array<{ chunk_id: number; rank?: number | null; similarity?: number | null }>,
    });
  }
  observeChatSideEffect(session.touch(), logger, 'chat.confirm.touch.failed', { chat_id: sessionId });
  observeChatSideEffect(
    UsageEventEntity.recordPolicyUsage({
      target: 'chat.confirm',
      metadata: { chatId: sessionId, decision: input.decision },
      organizationId: effectiveScope.organizationId || null,
      userId: input.userId,
    }),
    logger,
    'chat.confirm.policy_usage.failed',
    { chat_id: sessionId },
  );
  return {
    chat: { id: sessionId, created: false, scope: effectiveScope },
    messages: { user: null, assistant: assistantMessage.payload },
    answer: {
      text: agentExecution.markdown,
      weak_context: agentExecution.retrieved_chunks.length === 0 && !agentExecution.sources.some((source) => Boolean(source.url)),
    },
    sources: toChatSources(sourceRefs),
    agent: {
      intent: agentExecution.intent,
      plan: agentPlanDefaults(agentExecution.plan),
      action_results: (agentExecution.action_results || []).map(agentActionResultDefaults),
      response_format: agentExecution.response_format || null,
      requires_confirmation: agentExecution.requires_confirmation === true,
      pending_actions: agentExecution.pending_actions ? agentExecution.pending_actions.map(agentActionDefaults) : null,
      pipeline_passes: (agentExecution.pipeline_passes || []).map(agentPassDefaults),
      interaction: agentExecution.interaction || null,
      workflow_cypher: agentExecution.workflow_cypher || null,
      workflow_validation: agentExecution.workflow_validation || null,
      workflow_execution_output: agentExecution.workflow_execution_output ?? null,
    },
    debug: {
      execution_mode: 'agent_confirmation',
      workflow_source: null,
      workflow_id: null,
      execution_id: null,
      run_id: null,
      current_node: null,
      current_node_input: null,
      current_node_output: null,
      retrieved_chunks: agentExecution.retrieved_chunks.length,
      subject_ids: agentExecution.scope.subject_ids,
      post_ids: agentExecution.scope.post_ids,
      scope: effectiveScope,
    },
  };
}
