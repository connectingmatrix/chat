import { AgentExecutionPlan, AgentPipelinePass } from '@giga/shared/types/contracts/agent.types';
import { synthesizeMarkdown } from '@connectingmatrix/chat/services/chat/runtime/planner';
import { isGigaAction, isMutatingAction } from '@connectingmatrix/chat/services/chat/actions';
import {
  actionSummaryMarkdown,
  chartOutputMarkdown,
  planningFailureMarkdown,
  selectResponseFormat,
  workflowOutputMarkdown,
} from '@connectingmatrix/chat/services/chat/actions/io/format';
import { FinalizeInput, FinalizeOutput, PlanExecution } from './types';

export function gigaRelated(message: string, passes: AgentPipelinePass[]) {
  if (/\b(channel|category|subject|post|workflow|attachment|giga)\b/i.test(message)) return true;
  return passes.some((pass) => pass.plan.actions.some((action) => isGigaAction(action.name)));
}

export function mergeExecution(left: PlanExecution, right: PlanExecution): PlanExecution {
  return {
    orderedResults: [...left.orderedResults, ...right.orderedResults],
    mergedSources: [...left.mergedSources, ...right.mergedSources],
    mergedRetrievedChunks: [...left.mergedRetrievedChunks, ...right.mergedRetrievedChunks],
  };
}

export function mutationPlan(plan: AgentExecutionPlan): AgentExecutionPlan {
  const ids = new Set(plan.actions.filter((action) => isMutatingAction(action.name)).map((action) => action.id));
  return {
    intent: plan.intent,
    actions: plan.actions
      .filter((action) => ids.has(action.id))
      .map((action) => ({ ...action, depends_on: (action.depends_on || []).filter((id) => ids.has(id)) })),
  };
}

function workflowResultOutput(executed: PlanExecution) {
  const result = executed.orderedResults.find((entry) => entry.name === 'execute_workflow' || entry.name === 'get_workflow_output');
  return result?.data?.output ?? result?.data?.text ?? null;
}

export async function compose(input: FinalizeInput, plan: AgentExecutionPlan, executed: PlanExecution, passes: AgentPipelinePass[]) {
  const responseFormat = selectResponseFormat(plan, executed.orderedResults);
  const markdown =
    responseFormat === 'workflow_output'
      ? workflowOutputMarkdown(executed.orderedResults)
      : responseFormat === 'chart_output'
      ? chartOutputMarkdown(executed.orderedResults)
      : responseFormat === 'action_summary'
      ? actionSummaryMarkdown(executed.orderedResults)
      : await synthesizeMarkdown({
          message: input.input.message,
          intent: plan.intent,
          context: input.context,
          actionResults: executed.orderedResults,
          sources: executed.mergedSources,
          systemPrompt: input.input.systemPrompt || null,
        });
  return {
    markdown,
    intent: plan.intent,
    scope: input.context.scope,
    plan,
    action_results: executed.orderedResults,
    sources: executed.mergedSources,
    retrieved_chunks: executed.mergedRetrievedChunks,
    response_format: responseFormat,
    requires_confirmation: false,
    pending_actions: null,
    pipeline_passes: passes,
    workflow_execution_output: workflowResultOutput(executed),
  };
}

export function failure(
  input: FinalizeInput,
  plan: AgentExecutionPlan,
  executed: PlanExecution,
  passes: AgentPipelinePass[],
  message: string,
): FinalizeOutput {
  return {
    markdown: planningFailureMarkdown(message),
    intent: 'Final response planning failed.',
    scope: input.context.scope,
    plan,
    action_results: executed.orderedResults,
    sources: executed.mergedSources,
    retrieved_chunks: executed.mergedRetrievedChunks,
    response_format: 'planning_failure',
    requires_confirmation: false,
    pending_actions: null,
    pipeline_passes: passes,
  };
}
