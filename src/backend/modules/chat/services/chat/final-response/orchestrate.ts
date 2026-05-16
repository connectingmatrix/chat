import { createPlan } from '@connectingmatrix/chat/services/chat/runtime/planner';
import { getReadOnlyGigaActionCatalog, isMutatingAction } from '@connectingmatrix/chat/services/chat/actions';
import { confirmationMarkdown, normalizePendingPlan, storePendingPlan } from '@connectingmatrix/chat/services/chat/actions/runtime/confirmation';
import { buildConfirmationInteraction } from '@connectingmatrix/chat/services/chat/actions/runtime/interaction';
import { selectResponseFormat } from '@connectingmatrix/chat/services/chat/actions/io/format';
import { compactFinalContext } from './compact';
import { decideFinalResponse } from './decision';
import { FinalizeInput, FinalizeOutput } from './types';
import { compose, failure, gigaRelated, mergeExecution, mutationPlan } from './response';

function errorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const value = (error as { message?: unknown }).message;
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export async function finalizeAgentResponse(input: FinalizeInput): Promise<FinalizeOutput> {
  let executed = input.initial;
  const passes = [...input.passes];
  const initialFormat = selectResponseFormat(input.plan, executed.orderedResults);
  if (initialFormat === 'workflow_output' || initialFormat === 'chart_output' || initialFormat === 'action_summary')
    return compose(input, input.plan, executed, passes);
  if (!gigaRelated(input.input.message, passes)) return compose(input, input.plan, executed, passes);
  const compacted = compactFinalContext({ context: input.context, message: input.input.message, passes });
  if (compacted.exceeded) return failure(input, input.plan, executed, passes, 'Compacted context exceeded the finalizer input limit.');
  let firstDecision;
  try {
    firstDecision = await decideFinalResponse({ allowedModes: ['final', 'read_pass'], compactedContext: compacted.text });
  } catch (error) {
    return failure(input, input.plan, executed, passes, errorMessage(error, 'Final response decider failed.'));
  }
  input.emitDebug('agent.finalizer', 'completed', 'Finalizer first decision completed.', { mode: firstDecision.mode, reason: firstDecision.reason });
  if (firstDecision.mode === 'final') return compose(input, input.plan, executed, passes);

  const readPlan = await createPlan({
    message: input.input.message,
    context: input.context,
    availableActions: getReadOnlyGigaActionCatalog(),
    systemPrompt: input.input.systemPrompt || null,
    executionContext: compacted.text,
    strict: true,
  });
  if (!readPlan.actions.length) return failure(input, readPlan, executed, passes, 'The read-only recursive planner did not return valid actions.');
  const readExecuted = await input.runPlan(readPlan);
  const readFormat = selectResponseFormat(readPlan, readExecuted.orderedResults);
  passes.push({ kind: 'read_pass', plan: readPlan, action_results: readExecuted.orderedResults, response_format: readFormat });
  executed = mergeExecution(executed, readExecuted);

  const afterRead = compactFinalContext({ context: input.context, message: input.input.message, passes });
  if (afterRead.exceeded) return failure(input, readPlan, executed, passes, 'Compacted context exceeded the finalizer input limit after read pass.');
  let secondDecision;
  try {
    secondDecision = await decideFinalResponse({ allowedModes: ['final', 'full_gated_pass'], compactedContext: afterRead.text });
  } catch (error) {
    return failure(input, readPlan, executed, passes, errorMessage(error, 'Final response decider failed after read pass.'));
  }
  input.emitDebug('agent.finalizer', 'completed', 'Finalizer second decision completed.', {
    mode: secondDecision.mode,
    reason: secondDecision.reason,
  });
  if (secondDecision.mode === 'final') return compose(input, readPlan, executed, passes);

  const fullPlan = await createPlan({
    message: input.input.message,
    context: input.context,
    availableActions: input.availableActions,
    systemPrompt: input.input.systemPrompt || null,
    executionContext: afterRead.text,
    strict: true,
  });
  if (!fullPlan.actions.length) return failure(input, fullPlan, executed, passes, 'The full recursive planner did not return valid actions.');
  if (fullPlan.actions.some((action) => isMutatingAction(action.name))) {
    const pendingPlan = normalizePendingPlan(mutationPlan(fullPlan));
    await storePendingPlan(input.input.supabase, {
      chatId: input.input.chatId,
      currentMetadata: input.input.sessionMetadata || null,
      userId: input.input.userId,
      plan: pendingPlan,
      message: input.input.message,
    });
    passes.push({ kind: 'full_gated_pass', plan: pendingPlan, action_results: [], response_format: 'confirmation_request' });
    return {
      markdown: confirmationMarkdown(pendingPlan),
      intent: pendingPlan.intent,
      scope: input.context.scope,
      plan: pendingPlan,
      action_results: executed.orderedResults,
      sources: executed.mergedSources,
      retrieved_chunks: executed.mergedRetrievedChunks,
      response_format: 'confirmation_request',
      requires_confirmation: true,
      pending_actions: pendingPlan.actions,
      pipeline_passes: passes,
      interaction: buildConfirmationInteraction(pendingPlan),
    };
  }
  const fullExecuted = await input.runPlan(fullPlan);
  const fullFormat = selectResponseFormat(fullPlan, fullExecuted.orderedResults);
  passes.push({ kind: 'full_gated_pass', plan: fullPlan, action_results: fullExecuted.orderedResults, response_format: fullFormat });
  return compose(input, fullPlan, mergeExecution(executed, fullExecuted), passes);
}
