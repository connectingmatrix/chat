import { Executor } from '@workflow/executor';
import {
  AgentActionResult,
  AgentConversationContext,
  AgentExecutionInput,
  AgentExecutionOutput,
  AgentExecutionPlan,
} from '@giga/shared/types/contracts/agent.types';
import { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';
import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { SubjectEntity } from '@connectingmatrix/orm/repositories/entities';
import { EnvLoader } from '@giga/shared/lib/env';
import { buildAgentContext } from '@connectingmatrix/chat/services/chat/runtime/context';
import { getActionCatalog, executeAction } from '@connectingmatrix/chat/services/chat/runtime/action';
import { createPlan } from '@connectingmatrix/chat/services/chat/runtime/planner';
import { finalizeAgentResponse } from '@connectingmatrix/chat/services/chat/final-response/orchestrate';
import {
  clearPendingPlanFromMetadata,
  confirmationMarkdown,
  isCancelMessage,
  isConfirmationMessage,
  loadPendingPlanState,
  normalizePendingPlan,
  pendingPlanStateFromMetadata,
  storePendingPlan,
} from '../actions/runtime/confirmation';
import { buildConfirmationInteraction } from '../actions/runtime/interaction';
import { actionSummaryMarkdown, planningFailureMarkdown, selectResponseFormat, workflowOutputMarkdown } from '../actions/io/format';
import { isGigaAction, isMutatingAction } from '../actions';
import { readActionCapabilities } from '../actions/runtime/helpers';
import { createChatTelemetry } from '../telemetry/chat-telemetry';
import { hasWorkflowEditIntent } from './workflow-plan';
import { enrichChatSourceLinks, scopeSourceLink } from './source-links';
import { executeForChatWithSharedAgentRuntime } from './execute-for-chat-shared-agent';

const logger = getScopedLogger('agent-service');

function normalizeIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));
}

function buildFallbackPlan() {
  return {
    intent: 'No actions were selected. Provide a conservative response.',
    actions: [] as AgentExecutionPlan['actions'],
  };
}

function scopeFromInput(input: AgentExecutionInput) {
  return {
    scope_id: input.scopeId || null,
    scope_type: input.scopeType || null,
    subject_ids: normalizeIds([input.subjectId, ...(input.subjectIds || [])]),
    post_ids: normalizeIds([input.postId, ...(input.postIds || [])]),
    tag_slugs: normalizeIds((input.tagSlugs || []).map((value) => value.toLowerCase())),
  };
}

function normalizeScopeType(value: string | null | undefined): 'channel' | 'category' | 'subject' | 'post' | null {
  if (value === 'channel' || value === 'category' || value === 'subject' || value === 'post') return value;
  return null;
}

function minimalAgentContext(input: AgentExecutionInput): AgentConversationContext {
  return {
    scope: scopeFromInput(input),
    chat_agent_state: null,
    subjects: [],
    posts: [],
    recent_chat_messages: [],
  };
}

function uniqueSources(sources: SourceReference[]) {
  const byKey = new Map<string, SourceReference>();
  sources.forEach((source) => {
    const key =
      source.url ||
      (source.chunk_id !== null && source.chunk_id !== undefined
        ? `chunk:${source.chunk_id}`
        : `${source.source_type || 'unknown'}:${source.title || ''}`);
    byKey.set(key, source);
  });
  return Array.from(byKey.values());
}

function enrichPlanExecution(
  input: AgentExecutionInput,
  context: AgentConversationContext,
  execution: { orderedResults: AgentActionResult[]; mergedSources: SourceReference[]; mergedRetrievedChunks: RetrievedChunk[] },
) {
  const scopeType = normalizeScopeType(input.scopeType || null);
  const scopeSource = scopeSourceLink({
    type: scopeType,
    id: input.scopeId || null,
    name: input.scopeName || null,
    organizationId: input.scopeOrganizationId || null,
  });
  const sources = scopeSource ? [scopeSource, ...execution.mergedSources] : execution.mergedSources;
  return {
    ...execution,
    mergedSources: enrichChatSourceLinks(uniqueSources(sources), context, {
      organizationId: input.scopeOrganizationId || null,
      type: scopeType,
      id: input.scopeId || null,
      name: input.scopeName || null,
    }),
  };
}

function hasMutationIntent(message: string) {
  const text = String(message || '').toLowerCase();
  return (
    /\b(create|update|delete|link|move|execute|run)\b.*\b(channel|category|subject|post|workflow|structure)\b/.test(text) ||
    /\b(channel|category|subject|post|workflow)\b.*\b(create|update|delete|link|move|execute|run)\b/.test(text) ||
    /\borganis(e|z).*\b(channel|category|subject|post|workflow|structure)\b/.test(text)
  );
}

function hasPostLinkIntent(message: string) {
  const text = String(message || '').toLowerCase();
  const hasPost = /\bpost\b/.test(text);
  const hasLinkVerb = /\b(link|unlink|attach|detach)\b/.test(text);
  return hasPost && hasLinkVerb;
}

function actionInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string } | null | undefined)?.message || fallback);
}

function actionDependencyIds(action: AgentExecutionPlan['actions'][number]): string[] {
  const input = actionInput(action.input);
  const workflowActionId = String(input.workflow_action_id || input.workflowActionId || '').trim();
  const dependencies = [...(action.depends_on || []), workflowActionId].filter(Boolean);
  return Array.from(new Set(dependencies));
}

function workflowCypherAction(plan: AgentExecutionPlan) {
  return plan.actions.find((action) => action.name === 'create_workflow_from_cypher' || action.name === 'update_workflow_from_cypher') || null;
}

function workflowValidation(plan: AgentExecutionPlan) {
  const action = workflowCypherAction(plan);
  const input = actionInput(action?.input);
  const cypher = String(input.cypher || '').trim();
  if (!action) return { cypher: null as string | null, validation: null as Record<string, unknown> | null };
  if (!cypher) {
    return {
      cypher: null as string | null,
      validation: { ok: false, errors: [`${action.name} input.cypher is required before confirmation.`] } as Record<string, unknown>,
    };
  }
  try {
    const compiled = Executor.compileWorkflowCypher({
      cypher,
      name: String(input.name || 'Workflow'),
      description: String(input.description || ''),
      executable: input.executable !== false,
    });
    return { cypher, validation: compiled.validation as Record<string, unknown> };
  } catch (error) {
    return { cypher, validation: { ok: false, errors: [errorMessage(error, 'Workflow Cypher validation failed.')] } };
  }
}

function workflowExecutionOutput(results: AgentActionResult[]) {
  const result = results.find((entry) => entry.name === 'execute_workflow');
  return result?.data?.output ?? result?.data?.text ?? null;
}

function workflowRunFollowup(message: string, context: AgentConversationContext): AgentExecutionPlan | null {
  const state = context.chat_agent_state || {};
  const workflowId = String(state.last_workflow_id || '').trim();
  const text = String(message || '').toLowerCase();
  if (/\b(do not|don't|dont)\s+execute\b/.test(text)) return null;
  if (hasWorkflowEditIntent(message)) return null;
  if (/\b(create|build|make|update|delete|cypher|named)\b/.test(text)) return null;
  if (!workflowId || !/\b(run|execute)\b/.test(text) || !/\b(it|that|workflow)\b/.test(text)) return null;
  return {
    intent: `Execute workflow ${state.last_workflow_name || workflowId}.`,
    actions: [
      {
        id: 'a1',
        name: 'execute_workflow',
        reason: 'Run the workflow previously created or discussed in this chat.',
        input: { workflow_id: workflowId },
      },
    ],
  };
}

function workflowExecuteIntent(message: string) {
  const text = String(message || '').toLowerCase();
  return /\b(run|execute)\b/.test(text) && /\bworkflow\b/.test(text);
}

function ensureWorkflowRunPlan(plan: AgentExecutionPlan): AgentExecutionPlan {
  if (String(plan.intent || '').trim() !== 'create_and_run_workflow') return plan;
  if (plan.actions.some((action) => action.name === 'execute_workflow' || action.name === 'get_workflow_output')) return plan;
  const createAction =
    plan.actions.find(
      (action) => String(action.name || '').trim() === 'workflow.operation' && String(actionInput(action.input).operation || '').trim() === 'create',
    ) || null;
  if (!createAction) return plan;
  return {
    ...plan,
    actions: [
      ...plan.actions,
      {
        id: `${createAction.id}-execute`,
        name: 'execute_workflow',
        reason: 'Run the workflow that was just created and return its output.',
        input: { workflow_action_id: createAction.id },
        depends_on: [createAction.id],
      },
    ],
  };
}

async function confirmationOutput(input: AgentExecutionInput, context: AgentConversationContext, plan: AgentExecutionPlan, message: string) {
  const pendingPlan = normalizePendingPlan(plan);
  await storePendingPlan(input.supabase, {
    chatId: input.chatId,
    currentMetadata: input.sessionMetadata || null,
    userId: input.userId,
    plan: pendingPlan,
    message,
  });
  return {
    markdown: confirmationMarkdown(pendingPlan),
    intent: pendingPlan.intent,
    scope: context.scope,
    plan: pendingPlan,
    action_results: [],
    sources: [],
    retrieved_chunks: [],
    response_format: 'confirmation_request' as const,
    requires_confirmation: true,
    pending_actions: pendingPlan.actions,
    pipeline_passes: [{ kind: 'initial' as const, plan: pendingPlan, action_results: [], response_format: 'confirmation_request' as const }],
    interaction: buildConfirmationInteraction(pendingPlan),
    workflow_cypher: null,
    workflow_validation: null,
    workflow_execution_output: null,
  };
}

async function runPlanActions(params: {
  context: AgentConversationContext;
  emitDebug: (stage: string, status: 'started' | 'progress' | 'completed' | 'failed', message: string, meta?: Record<string, unknown>) => void;
  input: AgentExecutionInput;
  plan: AgentExecutionPlan;
  topK: number;
}) {
  const actionMap = new Map(params.plan.actions.map((action) => [action.id, action]));
  const pendingIds = new Set(params.plan.actions.map((action) => action.id));
  const completedIds = new Set<string>();
  const resultsById = new Map<string, AgentActionResult>();
  const retrievedChunksById = new Map<string, RetrievedChunk[]>();
  const capabilities = params.input.capabilities || (await readActionCapabilities({ supabase: params.input.supabase, userId: params.input.userId }));

  while (pendingIds.size > 0) {
    const readyIds = Array.from(pendingIds).filter((actionId) => {
      const action = actionMap.get(actionId);
      if (!action) return false;
      return actionDependencyIds(action).every((dependencyId) => completedIds.has(dependencyId));
    });

    if (!readyIds.length) {
      for (const actionId of Array.from(pendingIds)) {
        const action = actionMap.get(actionId);
        if (!action) continue;
        resultsById.set(action.id, {
          id: action.id,
          name: action.name,
          status: 'failed',
          reason: action.reason,
          summary: 'Skipped due to unresolved dependencies in plan.',
          data: null,
          sources: [],
          error: 'Unresolved dependencies.',
          duration_ms: 0,
        });
        completedIds.add(action.id);
        pendingIds.delete(action.id);
      }
      break;
    }

    params.emitDebug('agent.actions.batch', 'progress', 'Executing action batch.', { ready_action_ids: readyIds });
    const batchResults = await Promise.all(
      readyIds.map(async (actionId) => {
        const action = actionMap.get(actionId);
        if (!action) return null;
        params.emitDebug('agent.action', 'started', `Action started: ${action.name}`, {
          action_id: action.id,
          action_name: action.name,
          depends_on: action.depends_on || [],
        });
        return executeAction(action, {
          supabase: params.input.supabase,
          userId: params.input.userId,
          chatId: params.input.chatId,
          message: params.input.message,
          request: params.input.request,
          context: params.context,
          capabilities,
          topK: params.topK,
          resultsById: Object.fromEntries(Array.from(resultsById.entries())),
          currentAction: { id: action.id, depends_on: action.depends_on || [] },
          scopeId: params.input.scopeId || null,
          scopeType: params.input.scopeType || null,
        });
      }),
    );

    readyIds.forEach((actionId, index) => {
      const action = actionMap.get(actionId);
      const execution = batchResults[index];
      if (!action || !execution) return;
      resultsById.set(action.id, execution.result);
      retrievedChunksById.set(action.id, execution.retrievedChunks || []);
      params.emitDebug(
        'agent.action',
        execution.result.status === 'failed' ? 'failed' : 'completed',
        `Action ${execution.result.status}: ${action.name}`,
        {
          action_id: action.id,
          action_name: action.name,
          summary: execution.result.summary,
          error: execution.result.error || null,
          duration_ms: execution.result.duration_ms,
        },
      );
      completedIds.add(action.id);
      pendingIds.delete(action.id);
    });
  }

  const orderedResults: AgentActionResult[] = params.plan.actions.map(
    (action) =>
      resultsById.get(action.id) || {
        id: action.id,
        name: action.name,
        status: 'skipped',
        reason: action.reason,
        summary: 'Action was not executed.',
        data: null,
        sources: [],
        error: null,
        duration_ms: 0,
      },
  );
  const mergedSources = uniqueSources(orderedResults.flatMap((result) => result.sources || []));
  const mergedRetrievedChunks = normalizeIds(params.plan.actions.map((action) => action.id))
    .flatMap((actionId) => retrievedChunksById.get(actionId) || [])
    .filter((chunk, index, self) => self.findIndex((candidate) => candidate.chunk_id === chunk.chunk_id) === index)
    .slice(0, 200);

  return { orderedResults, mergedSources, mergedRetrievedChunks };
}

export type ChatConfirmationDecision = 'confirm' | 'cancel';

export async function executeChatConfirmation(
  input: AgentExecutionInput,
  decision: ChatConfirmationDecision,
  options: { allowWorkflowFollowup?: boolean; pendingState?: { metadata: Record<string, unknown>; plan: AgentExecutionPlan | null } } = {},
): Promise<AgentExecutionOutput> {
  const telemetry = createChatTelemetry({
    chatId: input.chatId,
    debug: { emit: input.debug?.emit || null },
    logger,
    requestId: null,
  });
  const topK = Math.max(1, input.topK || 10);
  const emitDebug = (stage: string, status: 'started' | 'progress' | 'completed' | 'failed', message: string, meta?: Record<string, unknown>) => {
    // prettier-ignore
    telemetry.emit({ chatId: input.chatId, eventName: `agent.confirmation.${stage}.${status}`, level: status === 'failed' ? 'error' : status === 'started' ? 'debug' : 'info', message, meta, stage, status, });
  };
  const pendingState = options.pendingState || (await loadPendingPlanState(input.supabase, input.chatId, input.userId));
  const pendingPlan = pendingState.plan;
  const fallbackScope = scopeFromInput(input);
  if (decision === 'cancel') {
    if (pendingPlan) await clearPendingPlanFromMetadata(input.supabase, input.chatId, input.userId, pendingState.metadata);
    return {
      markdown: pendingPlan ? 'Pending Giga actions were canceled. I did not run any changes.' : 'There are no pending Giga actions to cancel.',
      intent: pendingPlan ? 'Canceled pending confirmation.' : 'No pending confirmation.',
      scope: fallbackScope,
      plan: buildFallbackPlan(),
      action_results: [],
      sources: [],
      retrieved_chunks: [],
      response_format: 'plain_text',
      requires_confirmation: false,
      pending_actions: null,
      pipeline_passes: [],
      workflow_cypher: null,
      workflow_validation: null,
      workflow_execution_output: null,
    };
  }
  if (!pendingPlan && options.allowWorkflowFollowup !== true) {
    return {
      markdown: 'There are no pending Giga actions to confirm.',
      intent: 'No pending confirmation.',
      scope: fallbackScope,
      plan: buildFallbackPlan(),
      action_results: [],
      sources: [],
      retrieved_chunks: [],
      response_format: 'plain_text',
      requires_confirmation: false,
      pending_actions: null,
      pipeline_passes: [],
      workflow_cypher: null,
      workflow_validation: null,
      workflow_execution_output: null,
    };
  }

  if (!pendingPlan) {
    const context = await buildAgentContext({
      supabase: input.supabase,
      userId: input.userId,
      chatId: input.chatId,
      scopeType: input.scopeType || null,
      scopeId: input.scopeId || null,
      subjectIds: fallbackScope.subject_ids,
      postIds: fallbackScope.post_ids,
      tagSlugs: fallbackScope.tag_slugs,
    });
    const runPlan = options.allowWorkflowFollowup ? workflowRunFollowup(input.message, context) : null;
    if (runPlan) return confirmationOutput(input, context, runPlan, input.message);
    return {
      markdown: 'There are no pending Giga actions to confirm.',
      intent: 'No pending confirmation.',
      scope: context.scope,
      plan: buildFallbackPlan(),
      action_results: [],
      sources: [],
      retrieved_chunks: [],
      response_format: 'plain_text',
      requires_confirmation: false,
      pending_actions: null,
      pipeline_passes: [],
      workflow_cypher: null,
      workflow_validation: null,
      workflow_execution_output: null,
    };
  }
  const executablePlan = ensureWorkflowRunPlan(pendingPlan);

  const context = executablePlan.actions.every((action) => isGigaAction(action.name))
    ? minimalAgentContext(input)
    : await buildAgentContext({
        supabase: input.supabase,
        userId: input.userId,
        chatId: input.chatId,
        scopeType: input.scopeType || null,
        scopeId: input.scopeId || null,
        subjectIds: fallbackScope.subject_ids,
        postIds: fallbackScope.post_ids,
        tagSlugs: fallbackScope.tag_slugs,
      });
  emitDebug('execute', 'started', 'Executing confirmed pending actions.', { actions: executablePlan.actions.map((action) => action.name) });
  const executed = enrichPlanExecution(input, context, await runPlanActions({ context, emitDebug, input, plan: executablePlan, topK }));
  await clearPendingPlanFromMetadata(input.supabase, input.chatId, input.userId, pendingState.metadata);
  const responseFormat = selectResponseFormat(executablePlan, executed.orderedResults);
  const markdown =
    responseFormat === 'workflow_output' ? workflowOutputMarkdown(executed.orderedResults) : actionSummaryMarkdown(executed.orderedResults);
  const workflow = workflowValidation(executablePlan);
  return {
    markdown,
    intent: executablePlan.intent,
    scope: context.scope,
    plan: executablePlan,
    action_results: executed.orderedResults,
    sources: executed.mergedSources,
    retrieved_chunks: executed.mergedRetrievedChunks,
    response_format: responseFormat,
    requires_confirmation: false,
    pending_actions: null,
    pipeline_passes: [
      { kind: 'confirmation_execution', plan: executablePlan, action_results: executed.orderedResults, response_format: responseFormat },
    ],
    workflow_cypher: workflow.cypher,
    workflow_validation: workflow.validation,
    workflow_execution_output: workflowExecutionOutput(executed.orderedResults),
  };
}

export async function executeForChat(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
  const pendingStateFromMetadata = input.sessionMetadata === undefined ? null : pendingPlanStateFromMetadata(input.sessionMetadata);
  let pendingState = pendingStateFromMetadata || (await loadPendingPlanState(input.supabase, input.chatId, input.userId));
  if (isCancelMessage(input.message)) return executeChatConfirmation(input, 'cancel', { pendingState });
  if (isConfirmationMessage(input.message)) return executeChatConfirmation(input, 'confirm', { allowWorkflowFollowup: true, pendingState });
  if (EnvLoader.get('CHAT_AGENT_USE_LEGACY_PLANNER') !== '1') {
    if (pendingState?.plan) {
      const currentMessage = String(input.message || '').trim();
      const pendingMessage = String(
        (pendingState.metadata.pending_agent_actions as Record<string, unknown> | null | undefined)?.requested_message || '',
      ).trim();
      if (currentMessage && pendingMessage && currentMessage !== pendingMessage) {
        await clearPendingPlanFromMetadata(input.supabase, input.chatId, input.userId, pendingState.metadata);
        const metadata = { ...pendingState.metadata };
        delete metadata.pending_agent_actions;
        pendingState = {
          metadata,
          plan: null,
        };
      }
    }
    if (pendingState?.plan) {
      const pendingPlan = pendingState.plan;
      const workflow = workflowValidation(pendingPlan);
      return {
        markdown: `${confirmationMarkdown(
          pendingPlan,
        )}\n\nYou already have pending Giga actions. Reply with confirm to execute or cancel to discard.`,
        intent: 'Pending confirmation is required before new actions.',
        scope: scopeFromInput(input),
        plan: pendingPlan,
        action_results: [],
        sources: [],
        retrieved_chunks: [],
        response_format: 'confirmation_request',
        requires_confirmation: true,
        pending_actions: pendingPlan.actions,
        pipeline_passes: [{ kind: 'initial', plan: pendingPlan, action_results: [], response_format: 'confirmation_request' }],
        interaction: buildConfirmationInteraction(pendingPlan, {
          workflowCypher: workflow.cypher,
          workflowValidation: workflow.validation,
        }),
        workflow_cypher: workflow.cypher,
        workflow_validation: workflow.validation,
        workflow_execution_output: null,
      };
    }
    const output = await executeForChatWithSharedAgentRuntime(input);
    if (output.requires_confirmation && output.pending_actions?.length) {
      const sharedPendingPlan = ensureWorkflowRunPlan({
        intent: output.plan.intent,
        actions: output.pending_actions.map((action) => ({
          id: String((action as Record<string, unknown>).id || (action as Record<string, unknown>).action_id || '').trim(),
          name: String(
            (action as Record<string, unknown>).name || (action as Record<string, unknown>).action || '',
          ).trim() as AgentExecutionPlan['actions'][number]['name'],
          reason: String((action as Record<string, unknown>).reason || '').trim(),
          input: actionInput((action as Record<string, unknown>).input),
          depends_on: Array.isArray((action as Record<string, unknown>).depends_on)
            ? ((action as Record<string, unknown>).depends_on as string[])
            : [],
        })),
      });
      await storePendingPlan(input.supabase, {
        chatId: input.chatId,
        currentMetadata: pendingState.metadata,
        message: input.message,
        plan: sharedPendingPlan,
        userId: input.userId,
      });
    }
    return output;
  }
  const startedAt = Date.now();
  const telemetry = createChatTelemetry({
    chatId: input.chatId,
    debug: { emit: input.debug?.emit || null },
    logger,
    requestId: null,
  });
  const normalizedPostIds = normalizeIds([input.postId, ...(input.postIds || [])]);
  const requestedSubjectIds = normalizeIds([input.subjectId, ...(input.subjectIds || [])]);
  const normalizedTags = normalizeIds((input.tagSlugs || []).map((value) => value.toLowerCase()));
  const topK = Math.max(1, input.topK || 10);
  const emitDebug = (stage: string, status: 'started' | 'progress' | 'completed' | 'failed', message: string, meta?: Record<string, unknown>) => {
    // prettier-ignore
    telemetry.emit({ chatId: input.chatId, eventName: `agent.execute.${stage}.${status}`, level: status === 'failed' ? 'error' : status === 'started' ? 'debug' : 'info', message, meta, stage, status, });
  };

  // prettier-ignore
  telemetry.emit({ eventName: 'agent.execute.started', level: 'debug', message: 'Agent orchestration started.', meta: { chat_id: input.chatId, post_ids_count: normalizedPostIds.length, subject_ids_count: requestedSubjectIds.length, tag_slugs_count: normalizedTags.length, top_k: topK, user_id: input.userId, }, stage: 'agent.execute', status: 'started', });
  emitDebug('agent.execute', 'started', 'Agent orchestration started.', {
    subject_ids_count: requestedSubjectIds.length,
    post_ids_count: normalizedPostIds.length,
    tag_slugs_count: normalizedTags.length,
  });

  try {
    emitDebug('agent.subject_filter', 'started', 'Resolving subject filters.');
    const resolvedFilter = await SubjectEntity.resolveIds({
      supabase: input.supabase,
      subjectIds: requestedSubjectIds,
      tagSlugs: normalizedTags,
      subjectQuery: input.subjectQuery,
    });
    emitDebug('agent.subject_filter', 'completed', 'Subject filters resolved.', {
      filter_applied: resolvedFilter.filterApplied,
      subject_ids_count: resolvedFilter.subjectIds?.length || 0,
    });

    const effectiveSubjectIds = resolvedFilter.filterApplied ? resolvedFilter.subjectIds || [] : requestedSubjectIds;

    emitDebug('agent.context', 'started', 'Collecting context for planner.');
    const context = await buildAgentContext({
      supabase: input.supabase,
      userId: input.userId,
      chatId: input.chatId,
      scopeType: input.scopeType || null,
      scopeId: input.scopeId || null,
      subjectIds: effectiveSubjectIds,
      postIds: normalizedPostIds,
      tagSlugs: normalizedTags,
    });
    emitDebug('agent.context', 'completed', 'Context collected.', {
      subjects: context.subjects.length,
      posts: context.posts.length,
      messages: context.recent_chat_messages.length,
    });

    const runFollowupPlan = workflowRunFollowup(input.message, context);
    if (runFollowupPlan) return confirmationOutput(input, context, runFollowupPlan, input.message);
    if (workflowExecuteIntent(input.message) && !String(context.chat_agent_state?.last_workflow_id || '').trim()) {
      const plan = buildFallbackPlan();
      return {
        markdown: planningFailureMarkdown('No workflow is linked in this chat yet. Create or select a workflow first, then ask me to execute it.'),
        intent: 'Workflow execution needs a known workflow id in chat context.',
        scope: context.scope,
        plan,
        action_results: [],
        sources: [],
        retrieved_chunks: [],
        response_format: 'planning_failure',
        requires_confirmation: false,
        pending_actions: null,
        pipeline_passes: [{ kind: 'initial', plan, action_results: [], response_format: 'planning_failure' }],
        workflow_cypher: null,
        workflow_validation: null,
        workflow_execution_output: null,
      };
    }

    if (hasPostLinkIntent(input.message)) {
      const plan = buildFallbackPlan();
      return {
        markdown: planningFailureMarkdown('Posts support create, read, update, and delete only. Link or unlink post operations are unsupported.'),
        intent: 'Post link/unlink operations are unsupported.',
        scope: context.scope,
        plan,
        action_results: [],
        sources: [],
        retrieved_chunks: [],
        response_format: 'planning_failure',
        requires_confirmation: false,
        pending_actions: null,
        pipeline_passes: [{ kind: 'initial', plan, action_results: [], response_format: 'planning_failure' }],
        workflow_cypher: null,
        workflow_validation: null,
        workflow_execution_output: null,
      };
    }

    const availableActions = getActionCatalog();
    emitDebug('agent.plan', 'started', 'Planning next actions with AI.', {
      available_actions: availableActions.map((action) => action.name),
    });
    const plan = normalizePendingPlan(
      (await createPlan({
        message: input.message,
        context,
        availableActions,
        systemPrompt: input.systemPrompt || null,
      })) || buildFallbackPlan(),
    );
    emitDebug('agent.plan', 'completed', 'Execution plan created.', {
      intent: plan.intent,
      actions: plan.actions.map((action) => ({
        id: action.id,
        name: action.name,
        depends_on: action.depends_on || [],
      })),
    });

    if (plan.actions.some((action) => isMutatingAction(action.name))) {
      const workflow = workflowValidation(plan);
      if (workflow.validation && (workflow.validation as { ok?: boolean }).ok !== true) {
        return {
          markdown: planningFailureMarkdown(
            `Workflow Cypher validation failed: ${JSON.stringify((workflow.validation as { errors?: unknown[] }).errors || [])}`,
          ),
          intent: 'Workflow planning failed validation.',
          scope: context.scope,
          plan,
          action_results: [],
          sources: [],
          retrieved_chunks: [],
          response_format: 'planning_failure',
          requires_confirmation: false,
          pending_actions: null,
          pipeline_passes: [{ kind: 'initial', plan, action_results: [], response_format: 'planning_failure' }],
          workflow_cypher: workflow.cypher,
          workflow_validation: workflow.validation,
          workflow_execution_output: null,
        };
      }
      await storePendingPlan(input.supabase, {
        chatId: input.chatId,
        currentMetadata: input.sessionMetadata || null,
        userId: input.userId,
        plan,
        message: input.message,
      });
      return {
        markdown: confirmationMarkdown(plan),
        intent: plan.intent,
        scope: context.scope,
        plan,
        action_results: [],
        sources: [],
        retrieved_chunks: [],
        response_format: 'confirmation_request',
        requires_confirmation: true,
        pending_actions: plan.actions,
        pipeline_passes: [{ kind: 'initial', plan, action_results: [], response_format: 'confirmation_request' }],
        interaction: buildConfirmationInteraction(plan, {
          workflowCypher: workflow.cypher,
          workflowValidation: workflow.validation,
        }),
        workflow_cypher: workflow.cypher,
        workflow_validation: workflow.validation,
        workflow_execution_output: null,
      };
    }

    const { orderedResults, mergedSources, mergedRetrievedChunks } = enrichPlanExecution(
      input,
      context,
      await runPlanActions({ context, emitDebug, input, plan, topK }),
    );
    const responseFormat = selectResponseFormat(plan, orderedResults);
    const response: AgentExecutionOutput = await finalizeAgentResponse({
      availableActions,
      context,
      emitDebug,
      input,
      initial: { orderedResults, mergedSources, mergedRetrievedChunks },
      passes: [{ kind: 'initial', plan, action_results: orderedResults, response_format: responseFormat }],
      plan,
      runPlan: async (nextPlan) => enrichPlanExecution(input, context, await runPlanActions({ context, emitDebug, input, plan: nextPlan, topK })),
      topK,
    });
    emitDebug('agent.synthesis', 'completed', 'Final markdown response synthesized.', {
      markdown_chars: response.markdown.length,
      pipeline_passes: response.pipeline_passes?.length || 0,
    });

    // prettier-ignore
    telemetry.emit({ eventName: 'agent.execute.completed', message: 'Agent orchestration completed.', meta: { actions: orderedResults.length, chat_id: input.chatId, completed: orderedResults.filter((result) => result.status === 'completed').length, duration_ms: Date.now() - startedAt, failed: orderedResults.filter((result) => result.status === 'failed').length, retrieved_chunks: mergedRetrievedChunks.length, sources: mergedSources.length, }, stage: 'agent.execute', status: 'completed', });
    emitDebug('agent.execute', 'completed', 'Agent orchestration completed.', {
      actions: orderedResults.length,
      completed: orderedResults.filter((result) => result.status === 'completed').length,
      failed: orderedResults.filter((result) => result.status === 'failed').length,
      sources: mergedSources.length,
      retrieved_chunks: mergedRetrievedChunks.length,
    });

    return response;
  } catch (error) {
    // prettier-ignore
    telemetry.emit({ eventName: 'agent.execute.failed', level: 'error', message: error instanceof Error ? error.message : 'Agent orchestration failed.', meta: { chat_id: input.chatId, duration_ms: Date.now() - startedAt, error: toErrorMeta(error) }, stage: 'agent.execute', status: 'failed', });
    emitDebug('agent.execute', 'failed', 'Agent orchestration failed.', {
      error: errorMessage(error, 'Unknown error'),
    });
    throw error;
  }
}
