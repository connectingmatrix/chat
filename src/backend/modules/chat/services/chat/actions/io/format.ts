import { AgentActionResult, AgentExecutionPlan, AgentExecutionOutput } from '@giga/shared/types/contracts/agent.types';
import { isMutatingAction } from '../telemetry/catalog';

const deterministicWorkflowReadActions = new Set([
  'fetch_all_workflows',
  'fetch_workflow',
  'fetch_workflow_runs',
  'fetch_workflow_revisions',
  'fetch_workflow_node_catalog',
  'fetch_workflow_node_details',
  'validate_workflow_cypher',
]);

export function selectResponseFormat(plan: AgentExecutionPlan, results: AgentActionResult[]): AgentExecutionOutput['response_format'] {
  if (plan.actions.some((action) => action.name === 'execute_workflow' || action.name === 'get_workflow_output')) return 'workflow_output';
  if (plan.actions.some((action) => action.name === 'create_chart')) return 'chart_output';
  if (plan.actions.some((action) => isMutatingAction(action.name))) return 'action_summary';
  if (plan.actions.some((action) => deterministicWorkflowReadActions.has(action.name))) return 'action_summary';
  if (!results.length) return 'plain_text';
  return 'general';
}

export function chartOutputMarkdown(results: AgentActionResult[]) {
  const result = results.find((entry) => entry.name === 'create_chart');
  const markdown =
    typeof result?.data?.markup === 'string'
      ? result.data.markup.trim()
      : typeof result?.data?.markdown === 'string'
      ? result.data.markdown.trim()
      : '';
  if (!markdown) return 'Chart creation completed, but no chart markup was returned.';
  return markdown;
}

export function actionSummaryMarkdown(results: AgentActionResult[]) {
  const actionLabel = (name: string) =>
    String(name || 'action')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const statusLabel = (status: string) =>
    status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'skipped' ? 'Skipped' : 'Ran';
  const lines = ['## What I Did', ''];
  for (const result of results) {
    lines.push(`- **${statusLabel(result.status)}** ${actionLabel(result.name)}: ${result.summary}`);
    if (result.error) lines.push(`  Details: ${result.error}`);
  }
  return lines.join('\n');
}

export function workflowOutputMarkdown(results: AgentActionResult[]) {
  const result = results.find((entry) => entry.name === 'execute_workflow' || entry.name === 'get_workflow_output') || results[0];
  const output = result?.data?.output ?? result?.data?.execution ?? result?.data ?? null;
  const text = typeof result?.data?.text === 'string' && result.data.text.trim() ? result.data.text.trim() : null;
  const link = typeof result?.data?.editor_url === 'string' && result.data.editor_url ? result.data.editor_url : null;
  const lines = text ? ['## Workflow Output', '', text] : ['## Workflow Output', '', '```json', JSON.stringify(output, null, 2), '```'];
  if (link) lines.push('', `[Open workflow](${link})`);
  return lines.join('\n');
}

export function planningFailureMarkdown(message: string) {
  return [
    'I need a little more detail before I change Giga.',
    '',
    message || 'Please include the target channel, category, subject, post, or workflow details and I will prepare it for confirmation.',
  ].join('\n');
}
