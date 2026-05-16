import { BadRequestError } from 'routing-controllers';
import { readWorkflowRuntimeLimitsDirect } from '@giga/plan-policy/services/plan-policy/runtime/enforcement';
import { recordAIPolicyUsageDirect } from '@giga/plan-policy/services/plan-policy/runtime/usage';
import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { buildPermissionContext, canReadScopedChat } from '@giga/permissions/services/auth/permission-context';
import { SourceReference } from '@giga/shared/types/contracts/graphql.types';
import { createLifecycleState, markLifecycle } from '@connectingmatrix/logger/lifecycle-jsonl';
import { launchAdvancedSwarm } from '@connectingmatrix/ai-agents/services/ai-agents/advanced/runtime/swarm-v2';
import { executeForChat } from '@connectingmatrix/chat/services/chat/runtime/execute-for-chat';
import { resolveChatAgentRoute } from '@connectingmatrix/chat/services/chat/runtime/agent-router';
import { executeSelectedAgentForChat, resolveSelectedAgentId } from '@connectingmatrix/chat/services/chat/integration/agent-ui-chat-bridge';
import { createChatTelemetry } from '@connectingmatrix/chat/services/chat/telemetry/chat-telemetry';
import {
  getCurrentUserId,
  ensureSession,
  saveMessage,
  saveMessageChunkUsage,
  touchSession,
  updateSession,
} from '@connectingmatrix/chat/services/chat/runtime/persistence';
import { attachQueuedChatWorkflowExecutionArtifacts, executeQueuedChatWorkflow } from '@connectingmatrix/chat/services/chat/workflow/write/queued-workflow-chat';
import {
  buildChatSessionMetadata,
  buildWorkflowChatRequestPayload,
  chatAttachmentInputs,
  resolveChatExecutionMode,
} from '@connectingmatrix/chat/services/chat/read/query-chat-inputs';
import { ChatExecutionModeEnum, ChatRuntimeEngineEnum, ChatSessionMetadata } from '@connectingmatrix/chat/services/chat/read/query-chat-engine';
import { startAsyncWorkflowChatResponse } from '@connectingmatrix/chat/services/chat/workflow/runtime/async-workflow-chat';
import {
  getLegacySessionScope,
  getSessionScope,
  getSessionSnapshotScope,
  normalizeChatScopeInput,
  resolveChatScopeContext,
} from '@connectingmatrix/chat/services/chat/auth/scope';
import { resolveChatWorkflow } from '@connectingmatrix/chat/services/chat/workflow/runtime/workflow-chat';
import { resolveExplicitChatWorkflow } from '@connectingmatrix/chat/services/chat/workflow/runtime/explicit-workflow-route';
import { observeChatSideEffect } from '@connectingmatrix/chat/services/chat/runtime/side-effects';
import { isConfirmationMessage, pendingPlanStateFromMetadata, storePendingPlan } from '@connectingmatrix/chat/services/chat/actions/runtime/confirmation';
import { readRecentSessionScope } from '@connectingmatrix/chat/services/chat/auth/session-scope';
import {
  agentActionDefaults,
  agentActionResultDefaults,
  agentPassDefaults,
  agentPlanDefaults,
  toChatSources,
  workflowAgentDefaults,
} from '@connectingmatrix/chat/services/chat/io/query-chat-formatters';
import { compactActionValue } from '@connectingmatrix/chat/services/chat/runtime/action-value';
import { ChatScope, QueryChatInput, ResolvedChatScope } from '@connectingmatrix/chat/services/chat/contracts/types';
import type { AgentExecutionOutput } from '@giga/shared/types/contracts/agent.types';
import type { ResolvedChatWorkflow } from '@giga/shared/types/contracts/graphql.types';
import { buildFastDefaultChatExecution } from '@connectingmatrix/chat/services/chat/runtime/fast-default-chat';

const logger = getScopedLogger('ai-chat-service');

export async function resolveSessionScope(params: {
  supabase: any;
  userId: string;
  session: {
    id: string;
    scope_snapshot?: Record<string, any> | null;
    metadata?: Record<string, any> | null;
    scope_type?: string | null;
    scope_id?: string | null;
  };
  requestedScope: ChatScope | null;
  requestedResolvedScope: ResolvedChatScope | null;
}): Promise<ResolvedChatScope> {
  const legacyScope = getLegacySessionScope(params.session as any);
  if (legacyScope) {
    return legacyScope;
  }

  const sessionScope = getSessionScope(params.session as any);
  if (!sessionScope) {
    throw new Error('Chat session scope could not be resolved.');
  }

  if (
    params.requestedResolvedScope &&
    params.requestedScope &&
    params.requestedScope.type === sessionScope.type &&
    params.requestedScope.id === sessionScope.id &&
    (params.requestedScope.organizationId || null) === (sessionScope.organizationId || null)
  ) {
    return params.requestedResolvedScope;
  }

  const snapshotScope = getSessionSnapshotScope(params.session as any);
  if (snapshotScope && !params.requestedScope) {
    return snapshotScope;
  }

  return resolveChatScopeContext(params.supabase, params.userId, sessionScope);
}

export async function queryChat(input: QueryChatInput) {
  const { supabase } = input;
  if (!supabase) throw new BadRequestError('Supabase client is required for chat query.');
  input.supabase = supabase;
  const startedAt = Date.now();
  const lifecycleState = createLifecycleState(input.debug?.requestId || `chat-${Date.now()}`);
  const telemetry = createChatTelemetry({
    chatId: input.chatId || null,
    debug: input.debug || null,
    logger,
    requestId: input.debug?.requestId || null,
  });
  markLifecycle(lifecycleState, { layer: 'chat.query', event: 'query_chat', phase: 'start', transport: 'socket' });
  const emitDebug = (
    stage: string,
    status: 'started' | 'progress' | 'completed' | 'failed',
    message: string,
    meta?: Record<string, any>,
    chatId?: string | null,
    emit?: boolean,
    emitRoom?: string | null,
  ) => {
    // prettier-ignore
    telemetry.emit({ chatId: chatId || input.chatId || null, eventName: `chat.query.${stage}.${status}`, emit, emitRoom, level: status === 'failed' ? 'error' : status === 'started' ? 'debug' : 'info', message, meta, stage, status, });
  };
  emitDebug('chat.query', 'started', 'Chat query received by backend.', {
    has_chat_id: Boolean(input.chatId),
    scope_type: input.scope?.type || null,
    scope_id: input.scope?.id || null,
  });

  try {
    emitDebug('chat.auth', 'started', 'Resolving authenticated user.');
    markLifecycle(lifecycleState, { layer: 'chat.query', event: 'auth', phase: 'start', transport: 'socket' });
    const requestUserId = (input.request as { userId?: string } | undefined)?.userId?.trim() || '';
    if (requestUserId) (input.supabase as { __auth_user_id?: string }).__auth_user_id = requestUserId;
    const userId = requestUserId || (await getCurrentUserId(input.supabase));
    markLifecycle(lifecycleState, { layer: 'chat.query', event: 'auth', phase: 'end', transport: 'socket', status: 'passed' });
    emitDebug('chat.auth', 'completed', 'Authenticated user resolved.', {
      user_id: userId,
    });

    const parsedScope = normalizeChatScopeInput({
      scope: input.scope,
      subjectId: input.subjectId,
      subjectIds: input.subjectIds,
      postId: input.postId,
      allowEmpty: true,
    });
    const recentScope = !parsedScope && !input.chatId ? await readRecentSessionScope(userId) : null;
    const requestedScope = parsedScope || recentScope || (input.chatId ? null : { type: 'temporary' as const, id: userId });

    emitDebug('chat.session', 'started', 'Ensuring chat session.');
    markLifecycle(lifecycleState, { layer: 'chat.query', event: 'session', phase: 'start', transport: 'socket' });
    const attachments = chatAttachmentInputs(input);
    const requestedChatExecutionMode = resolveChatExecutionMode(input, input.sessionMetadata as ChatSessionMetadata | null);
    const sessionMetadata = buildChatSessionMetadata({ attachments, input, requestedChatExecutionMode });
    const ensured = await ensureSession(input.supabase, {
      userId,
      chatId: input.chatId,
      scope: requestedScope,
      titleFromMessage: input.message,
      systemPrompt: input.systemPrompt || null,
      metadata: Object.keys(sessionMetadata).length ? sessionMetadata : null,
      scopeSnapshot: null,
    });
    if (Object.keys(sessionMetadata).length && !ensured.created) {
      ensured.session.metadata = { ...((ensured.session.metadata || {}) as Record<string, any>), ...sessionMetadata };
      await updateSession(input.supabase, ensured.session.id, { metadata: ensured.session.metadata });
    }

    let requestedResolvedScope: ResolvedChatScope | null = null;
    if (requestedScope) {
      emitDebug('chat.scope', 'started', 'Resolving requested chat scope.', {
        scope_type: requestedScope.type,
        scope_id: requestedScope.id,
      });
      requestedResolvedScope = await resolveChatScopeContext(input.supabase, userId, requestedScope);
      if (!ensured.session.scope_snapshot) {
        ensured.session.scope_snapshot = requestedResolvedScope.snapshot;
        await updateSession(input.supabase, ensured.session.id, { scope_snapshot: requestedResolvedScope.snapshot });
      }
      emitDebug('chat.scope', 'completed', 'Requested chat scope resolved.', {
        scope_type: requestedResolvedScope.scope.type,
        scope_id: requestedResolvedScope.scope.id,
        subject_ids_count: requestedResolvedScope.subject_ids.length,
        post_ids_count: requestedResolvedScope.post_ids.length,
      });
    }

    const resolvedScope = await resolveSessionScope({
      supabase: input.supabase,
      userId,
      session: ensured.session,
      requestedScope,
      requestedResolvedScope,
    });
    const effectiveScope = resolvedScope.scope;
    const permissions = buildPermissionContext(
      await readUserMatrixState(input.supabase, { organizationId: effectiveScope.organizationId || null, userId }),
      false,
    );
    if (!canReadScopedChat(permissions, effectiveScope.type)) {
      throw new BadRequestError(`Plan access does not allow ${effectiveScope.type}_chat read.`);
    }
    const isLegacyScope = Boolean(resolvedScope.snapshot?.legacy);

    // prettier-ignore
    logger.info('chat.query.session.ready', { chat_id: ensured.session.id, created: ensured.created, scope_type: effectiveScope.type, scope_id: effectiveScope.id, legacy_scope: isLegacyScope, subject_ids_count: resolvedScope.subject_ids.length, post_ids_count: resolvedScope.post_ids.length, });
    emitDebug(
      'chat.session',
      'completed',
      'Chat session ready.',
      {
        created: ensured.created,
        scope_type: effectiveScope.type,
        scope_id: effectiveScope.id,
        legacy_scope: isLegacyScope,
        subject_ids_count: resolvedScope.subject_ids.length,
        post_ids_count: resolvedScope.post_ids.length,
      },
      ensured.session.id,
    );
    markLifecycle(lifecycleState, { layer: 'chat.query', event: 'session', phase: 'end', transport: 'socket', status: 'passed' });

    const userMessage = await saveMessage(input.supabase, {
      chatId: ensured.session.id,
      userId,
      role: 'user',
      content: input.message,
    });
    emitDebug(
      'chat.message',
      'completed',
      'User message persisted.',
      {
        message_id: userMessage.id,
        role: 'user',
      },
      ensured.session.id,
    );

    const agentExecutionInput = {
      supabase: input.supabase,
      userId,
      chatId: ensured.session.id,
      message: input.message,
      request: input.request,
      sessionMetadata: ensured.session.metadata || null,
      subjectIds: resolvedScope.subject_ids,
      postIds: resolvedScope.post_ids,
      tagSlugs: input.tagSlugs,
      subjectQuery: input.subjectQuery,
      topK: input.topK,
      systemPrompt: ensured.session.system_prompt || input.systemPrompt || null,
      scopeType: effectiveScope.type,
      scopeId: effectiveScope.id,
      scopeOrganizationId: effectiveScope.organizationId || null,
      scopeName: resolvedScope.snapshot.name || null,
      debug: {
        emit: (event) => {
          emitDebug(event.stage, event.status, event.message, event.meta, event.chat_id || ensured.session.id, event.emit, event.emit_room);
        },
      },
    };
    const pendingState = pendingPlanStateFromMetadata((ensured.session.metadata || null) as Record<string, any> | null);
    const requestedMode = String(input.chatMode || input.chat_mode || 'DEFAULT')
      .trim()
      .toUpperCase() as 'DEFAULT' | 'AGENT' | 'WORKFLOW' | 'SWARM';
    if (requestedMode !== 'DEFAULT' && requestedMode !== 'AGENT' && requestedMode !== 'WORKFLOW' && requestedMode !== 'SWARM') {
      throw new BadRequestError('Invalid chat mode.');
    }
    const selectedAgent = resolveSelectedAgentId({
      agentId: input.agentId,
      agent_id: input.agent_id,
      sessionMetadata: ensured.session.metadata || null,
    });
    const selectedWorkflowId = String(input.workflowId || input.workflow_id || '').trim() || null;
    if (requestedMode === 'AGENT' && !selectedAgent.agentId) throw new BadRequestError('Agent mode requires agent_id.');
    if (requestedMode === 'WORKFLOW' && !selectedWorkflowId) throw new BadRequestError('Workflow mode requires workflow_id.');
    const routedAgent = await resolveChatAgentRoute({
      agentId: selectedAgent.agentId,
      chatId: ensured.session.id,
      message: input.message,
      mode: requestedMode,
      organizationId: effectiveScope.organizationId || null,
      swarmId: input.swarmId || input.swarm_id || null,
      userId,
      workflowId: selectedWorkflowId,
    });
    let workflowAttachment: ResolvedChatWorkflow | null = null;
    if (routedAgent.kind === 'workflow') {
      workflowAttachment = await resolveExplicitChatWorkflow(routedAgent.workflowId, routedAgent.source);
      if (!workflowAttachment) throw new BadRequestError(`Workflow ${routedAgent.workflowId} is not available for chat routing.`);
    }
    if (!workflowAttachment && requestedMode !== 'DEFAULT' && requestedMode !== 'SWARM' && routedAgent.kind !== 'agent' && !isLegacyScope) {
      emitDebug(
        'chat.workflow',
        'started',
        'Checking workflow assignments for the chat scope.',
        {
          scope_type: effectiveScope.type,
          scope_id: effectiveScope.id,
        },
        ensured.session.id,
      );
      workflowAttachment = (await resolveChatWorkflow(input.supabase, userId, effectiveScope)) as ResolvedChatWorkflow | null;
      emitDebug(
        'chat.workflow',
        'completed',
        workflowAttachment ? 'Workflow assignment resolved for this chat.' : 'No workflow assignment found. Falling back to agent execution.',
        {
          attached: Boolean(workflowAttachment),
          workflow_source: workflowAttachment?.source || null,
          workflow_id: workflowAttachment?.workflowId || null,
        },
        ensured.session.id,
      );
    }

    if (workflowAttachment) {
      emitDebug(
        'chat.workflow.execute',
        'started',
        'Executing workflow-backed chat response.',
        {
          workflow_source: workflowAttachment.source,
          workflow_id: workflowAttachment.workflowId,
        },
        ensured.session.id,
      );

      try {
        const runtimeLimits = await readWorkflowRuntimeLimitsDirect(input.supabase, {
          organizationId: effectiveScope.organizationId || null,
          userId,
        });
        const systemPrompt = ensured.session.system_prompt || input.systemPrompt || null;
        const requestPayload = buildWorkflowChatRequestPayload({ attachments, input, requestedChatExecutionMode, systemPrompt }) as Record<
          string,
          unknown
        >;
        if (pendingState.plan) requestPayload.pendingPlan = pendingState.plan;
        if (isConfirmationMessage(input.message)) requestPayload.confirmed = true;
        if (requestedChatExecutionMode === ChatExecutionModeEnum.Async) {
          const asyncWorkflowResponse = await startAsyncWorkflowChatResponse({
            debug: input.debug || null,
            effectiveScope,
            input,
            requestPayload,
            resolvedScope,
            runtimeLimits,
            session: ensured.session,
            systemPrompt,
            userId,
            userMessage,
            workflowAttachment,
          });
          const { assistantMessage, text: asyncText, workflowStart } = asyncWorkflowResponse;
          markLifecycle(lifecycleState, {
            layer: 'chat.query',
            event: 'query_chat',
            phase: 'end',
            transport: 'socket',
            status: 'passed',
            meta: { elapsed_ms: Date.now() - startedAt },
          });
          // prettier-ignore
          telemetry.emit({ eventName: 'chat.query.completed', message: 'Chat query completed.', meta: { assistant_message_id: assistantMessage.id, chat_id: ensured.session.id, duration_ms: Date.now() - startedAt, execution_mode: 'workflow_async', user_message_id: userMessage.id, workflow_source: workflowStart.workflowSource, }, stage: 'chat.query', status: 'completed', });
          return {
            chat: { id: ensured.session.id, created: ensured.created, scope: effectiveScope },
            messages: { user: userMessage, assistant: assistantMessage },
            answer: { text: asyncText, weak_context: false },
            sources: [],
            agent: null,
            debug: {
              execution_mode: 'workflow_async',
              workflow_source: workflowStart.workflowSource,
              workflow_id: workflowStart.workflowId,
              execution_id: workflowStart.executionId,
              run_id: workflowStart.runId,
              realtime: workflowStart.realtime,
              current_node: null,
              current_node_input: null,
              current_node_output: null,
              retrieved_chunks: 0,
              subject_ids: resolvedScope.subject_ids,
              post_ids: resolvedScope.post_ids,
              scope: effectiveScope,
            },
          };
        }

        const { executionId, execution: workflowExecution } = await executeQueuedChatWorkflow({
          supabase: input.supabase,
          request: input.request,
          userId,
          chatId: ensured.session.id,
          chatMessageId: userMessage.id,
          debug: input.debug || null,
          requestId: input.debug?.requestId || null,
          scope: effectiveScope,
          scopeSnapshot: resolvedScope.snapshot,
          resolvedScope,
          message: input.message,
          runtimeLimits,
          systemPrompt: ensured.session.system_prompt || input.systemPrompt || null,
          requestPayload,
          workflowAttachment,
        });
        const assistantMessage = await saveMessage(input.supabase, {
          chatId: ensured.session.id,
          userId,
          role: 'assistant',
          content: workflowExecution.text,
          sourceRefs: workflowExecution.sourceRefs,
          promptTokens: null,
          completionTokens: null,
        });
        const workflowAgent = workflowAgentDefaults(workflowExecution.terminalPayload);
        if (workflowAgent?.requires_confirmation && workflowAgent.pending_actions?.length) {
          await storePendingPlan(input.supabase, {
            chatId: ensured.session.id,
            currentMetadata: (ensured.session.metadata || null) as Record<string, any> | null,
            message: input.message,
            plan: { intent: workflowAgent.plan.intent, actions: workflowAgent.pending_actions },
            userId,
          });
        }

        if (workflowExecution.retrievedChunks.length)
          await saveMessageChunkUsage(input.supabase, assistantMessage.id, workflowExecution.retrievedChunks);
        observeChatSideEffect(touchSession(input.supabase, ensured.session.id), logger, 'chat.query.workflow.touch.failed', {
          chat_id: ensured.session.id,
        });
        if (executionId && process.env.CHAT_PARITY_SKIP_WORKFLOW_ARTIFACT_ATTACH !== '1') {
          void attachQueuedChatWorkflowExecutionArtifacts({
            supabase: input.supabase,
            execution: workflowExecution,
            executionId,
            assistantMessageId: assistantMessage.id,
          }).catch((error) => {
            emitDebug('chat.workflow.artifacts', 'failed', error instanceof Error ? error.message : 'Workflow artifact attachment failed.', {
              execution_id: executionId,
            });
          });
        }

        emitDebug(
          'chat.workflow.persist',
          'completed',
          'Workflow response generated and persisted.',
          {
            assistant_message_id: assistantMessage.id,
            workflow_source: workflowExecution.source,
            workflow_id: workflowExecution.workflowId,
            execution_id: workflowExecution.executionId || executionId,
            run_id: workflowExecution.runId || null,
            current_node: workflowExecution.debugState?.current_node || null,
            current_node_input: workflowExecution.debugState?.current_node_input ?? null,
            current_node_output: workflowExecution.debugState?.current_node_output ?? null,
            retrieved_chunks: workflowExecution.retrievedChunks.length,
            sources: workflowExecution.sourceRefs.length,
          },
          ensured.session.id,
        );

        const response = {
          chat: {
            id: ensured.session.id,
            created: ensured.created,
            scope: effectiveScope,
          },
          messages: {
            user: userMessage,
            assistant: assistantMessage,
          },
          answer: {
            text: workflowExecution.text,
            weak_context: workflowExecution.retrievedChunks.length === 0 && !workflowExecution.sourceRefs.some((source) => Boolean(source.url)),
          },
          sources: toChatSources(workflowExecution.sourceRefs),
          agent: workflowAgent,
          debug: {
            execution_mode: 'workflow',
            ...(workflowExecution.debugState || {}),
            workflow_source: workflowExecution.source,
            workflow_id: workflowExecution.workflowId,
            execution_id: workflowExecution.executionId || executionId,
            run_id: workflowExecution.runId || null,
            retrieved_chunks: workflowExecution.retrievedChunks.length,
            subject_ids: resolvedScope.subject_ids,
            post_ids: resolvedScope.post_ids,
            scope: effectiveScope,
          },
        };

        // prettier-ignore
        telemetry.emit({ eventName: 'chat.query.completed', message: 'Chat query completed.', meta: { assistant_message_id: assistantMessage.id, chat_id: ensured.session.id, duration_ms: Date.now() - startedAt, execution_mode: 'workflow', user_message_id: userMessage.id, workflow_source: workflowExecution.source, }, stage: 'chat.query', status: 'completed', });
        observeChatSideEffect(
          recordAIPolicyUsageDirect(input.supabase, {
            eventType: 'chat.query.workflow',
            metadata: {
              chatId: ensured.session.id,
            },
            organizationId: effectiveScope.organizationId || null,
            userId,
          }),
          logger,
          'chat.query.workflow.policy_usage.failed',
          { chat_id: ensured.session.id },
        );

        markLifecycle(lifecycleState, {
          layer: 'chat.query',
          event: 'query_chat',
          phase: 'end',
          transport: 'socket',
          status: 'passed',
          meta: { elapsed_ms: Date.now() - startedAt },
        });
        return response;
      } catch (error: unknown) {
        emitDebug(
          'chat.workflow.execute',
          'failed',
          error instanceof Error ? error.message : 'Workflow execution failed.',
          {
            workflow_source: workflowAttachment.source,
            workflow_id: workflowAttachment.workflowId,
          },
          ensured.session.id,
        );

        throw error;
      }
    }

    emitDebug(
      'agent.execute',
      'started',
      'Agent execution started.',
      {
        subject_ids_count: resolvedScope.subject_ids.length,
        post_ids_count: resolvedScope.post_ids.length,
      },
      ensured.session.id,
    );
    const selectedAgentId = routedAgent.kind === 'agent' ? routedAgent.agentId : null;
    let agentExecution: AgentExecutionOutput;
    if (routedAgent.kind === 'swarm') {
      const swarm = await launchAdvancedSwarm({
        chatId: ensured.session.id,
        confirmed: true,
        goal: input.message,
        message: input.message,
        organizationId: effectiveScope.organizationId || null,
        ownerId: userId,
        ownerType: effectiveScope.organizationId ? 'organization' : 'user',
        userId,
      });
      agentExecution = {
        action_results: [
          {
            data: swarm as unknown as Record<string, unknown>,
            duration_ms: 0,
            id: 'swarm-launch',
            name: 'agent.run',
            reason: 'The user selected swarm mode.',
            sources: [],
            status: 'completed',
            summary: 'Swarm launched.',
          },
        ],
        intent: 'Launch AI agent swarm.',
        markdown: `Swarm launched for this request. Process Monitor will stream worker activity as the swarm plans and runs.`,
        plan: { actions: [], intent: 'Launch AI agent swarm.' },
        retrieved_chunks: [],
        scope: {
          post_ids: agentExecutionInput.postIds || [],
          scope_id: agentExecutionInput.scopeId || null,
          scope_type: agentExecutionInput.scopeType || null,
          subject_ids: agentExecutionInput.subjectIds || [],
          tag_slugs: agentExecutionInput.tagSlugs || [],
        },
        sources: [],
      };
    } else if (!selectedAgentId && requestedMode === 'DEFAULT') {
      agentExecution = await buildFastDefaultChatExecution({
        attachments,
        input,
        scope: effectiveScope,
        resolvedScope,
      });
    } else {
      agentExecution = selectedAgentId
        ? await executeSelectedAgentForChat({
            agentExecutionInput,
            effectiveScope,
            input,
            selectedAgentId,
          })
        : await executeForChat(agentExecutionInput);
    }
    const executionMode = ChatRuntimeEngineEnum.Agent;
    emitDebug(
      'agent.execute',
      'completed',
      'Agent execution completed.',
      {
        planned_actions: agentExecution.plan.actions.length,
        action_results: agentExecution.action_results.length,
        sources: agentExecution.sources.length,
        retrieved_chunks: agentExecution.retrieved_chunks.length,
      },
      ensured.session.id,
    );

    const sourceRefs: SourceReference[] = agentExecution.sources || [];
    const assistantMessage = await saveMessage(input.supabase, {
      chatId: ensured.session.id,
      userId,
      role: 'assistant',
      content: agentExecution.markdown,
      sourceRefs,
      promptTokens: null,
      completionTokens: null,
    });

    if (agentExecution.retrieved_chunks.length) {
      await saveMessageChunkUsage(
        input.supabase,
        assistantMessage.id,
        agentExecution.retrieved_chunks.map((chunk, index) => ({
          ...chunk,
          rank: chunk.rank || index + 1,
          similarity: chunk.similarity ?? null,
        })),
      );
    }
    const policyUsage = recordAIPolicyUsageDirect(input.supabase, {
      eventType: 'chat.query.agent',
      metadata: {
        chatId: ensured.session.id,
      },
      organizationId: effectiveScope.organizationId || null,
      userId,
    });
    const sessionTouch = touchSession(input.supabase, ensured.session.id);
    observeChatSideEffect(policyUsage, logger, 'chat.query.agent.policy_usage.failed', { chat_id: ensured.session.id });
    observeChatSideEffect(sessionTouch, logger, 'chat.query.agent.touch.failed', { chat_id: ensured.session.id });

    const response = {
      chat: {
        id: ensured.session.id,
        created: ensured.created,
        scope: effectiveScope,
      },
      messages: {
        user: userMessage,
        assistant: assistantMessage,
      },
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
        interaction: compactActionValue(agentExecution.interaction || null),
        workflow_cypher: agentExecution.workflow_cypher || null,
        workflow_validation: compactActionValue(agentExecution.workflow_validation || null),
        workflow_execution_output: compactActionValue(agentExecution.workflow_execution_output ?? null),
      },
      debug: {
        execution_mode: executionMode,
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

    // prettier-ignore
    telemetry.emit({ eventName: 'chat.query.completed', message: 'Chat query completed.', meta: { actions_count: agentExecution.action_results.length, assistant_message_id: assistantMessage.id, chat_id: ensured.session.id, chunks_count: agentExecution.retrieved_chunks.length, duration_ms: Date.now() - startedAt, execution_mode: executionMode, user_message_id: userMessage.id, }, stage: 'chat.query', status: 'completed', });
    emitDebug(
      'chat.query',
      'completed',
      'Chat query completed.',
      {
        execution_mode: executionMode,
        user_message_id: userMessage.id,
        assistant_message_id: assistantMessage.id,
        actions_count: agentExecution.action_results.length,
        duration_ms: Date.now() - startedAt,
      },
      ensured.session.id,
    );

    markLifecycle(lifecycleState, {
      layer: 'chat.query',
      event: 'query_chat',
      phase: 'end',
      transport: 'socket',
      status: 'passed',
      meta: { elapsed_ms: Date.now() - startedAt },
    });
    return response;
  } catch (error: unknown) {
    markLifecycle(lifecycleState, {
      layer: 'chat.query',
      event: 'query_chat',
      phase: 'error',
      transport: 'socket',
      status: 'failed',
      meta: { elapsed_ms: Date.now() - startedAt },
    });
    // prettier-ignore
    telemetry.emit({ eventName: 'chat.query.failed', level: 'error', message: error instanceof Error ? error.message : 'Chat query failed.', meta: { chat_id: input.chatId || null, duration_ms: Date.now() - startedAt, error: toErrorMeta(error) as Record<string, unknown> }, stage: 'chat.query', status: 'failed', });
    emitDebug(
      'chat.query',
      'failed',
      error instanceof Error ? error.message : 'Chat query failed.',
      {
        duration_ms: Date.now() - startedAt,
      },
      input.chatId || null,
    );
    throw error;
  }
}
