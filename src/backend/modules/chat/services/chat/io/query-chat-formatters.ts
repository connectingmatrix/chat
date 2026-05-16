import { parseRecordValue, parseStringValue, parseUnknownArray } from 'giga-ai-helper/workflow';
import { compactActionValue } from '@connectingmatrix/chat/services/chat/runtime/action-value';
import type {
  AgentActionResult,
  AgentExecutionPlan,
  AgentInteraction,
  AgentPipelinePass,
  AgentPlanAction,
  AgentResponseFormat,
} from '@giga/shared/types/contracts/agent.types';
import type { SourceReference } from '@giga/shared/types/contracts/graphql.types';

type WorkflowAgentDefaults = {
  intent: string;
  plan: AgentExecutionPlan;
  action_results: AgentActionResult[];
  response_format: AgentResponseFormat | null;
  requires_confirmation: boolean;
  pending_actions: AgentPlanAction[] | null;
  pipeline_passes: AgentPipelinePass[];
  interaction: AgentInteraction | null;
  workflow_cypher: string | null;
  workflow_validation: Record<string, unknown> | null;
  workflow_execution_output: unknown;
};

export function toChatSources(sources: SourceReference[]): SourceReference[] {
  return sources.map((source) => ({
    chunk_id: source.chunk_id || null,
    post_id: source.post_id || null,
    channel_id: source.channel_id || null,
    category_id: source.category_id || null,
    attachment_id: source.attachment_id || null,
    subject_id: source.subject_id || null,
    source_type: source.source_type || null,
    title: source.title || null,
    url: source.url || null,
    snippet: source.snippet || null,
    similarity: source.similarity ?? null,
    rank: source.rank ?? null,
  }));
}

export function agentActionDefaults(action: unknown): AgentPlanAction {
  const row = parseRecordValue(action);
  const dependsOnSource = row.depends_on || row.dependsOn;
  const dependsOn: string[] = [];
  for (const value of parseUnknownArray(dependsOnSource)) dependsOn.push(parseStringValue(value));
  const actionInput = parseRecordValue(compactActionValue(row.input || null));
  return {
    id: parseStringValue(row.id || ''),
    name: parseStringValue(row.name || row.tool || row.action || '') as AgentPlanAction['name'],
    reason: parseStringValue(row.reason || ''),
    depends_on: dependsOn,
    input: Object.keys(actionInput).length ? actionInput : undefined,
  };
}

export function agentActionResultDefaults(action: unknown): AgentActionResult {
  const row = parseRecordValue(action);
  const actionData = parseRecordValue(compactActionValue(row.data || null));
  return {
    id: parseStringValue(row.id || ''),
    name: parseStringValue(row.name || '') as AgentActionResult['name'],
    status: parseStringValue(row.status || '') as AgentActionResult['status'],
    reason: parseStringValue(row.reason || ''),
    summary: parseStringValue(row.summary || ''),
    error: parseStringValue(row.error || '').trim() || null,
    duration_ms: Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : 0,
    data: Object.keys(actionData).length ? actionData : null,
    sources: parseUnknownArray(row.sources) as SourceReference[],
  };
}

export function agentPlanDefaults(plan: unknown): AgentExecutionPlan {
  const row = parseRecordValue(plan);
  return {
    intent: parseStringValue(row.intent || ''),
    actions: parseUnknownArray(row.actions).map(agentActionDefaults),
  };
}

export function agentPassDefaults(pass: unknown): AgentPipelinePass {
  const row = parseRecordValue(pass);
  return {
    kind: parseStringValue(row.kind || '') as AgentPipelinePass['kind'],
    response_format: (row.response_format || null) as AgentResponseFormat | null,
    plan: agentPlanDefaults(row.plan || { intent: '', actions: [] }),
    action_results: parseUnknownArray(row.action_results).map(agentActionResultDefaults),
  };
}

function workflowAgentCandidate(payload: unknown): Record<string, unknown> | null {
  const row = parseRecordValue(payload);
  if (!Object.keys(row).length) return null;

  const status = parseStringValue(row.status).trim();
  if (status && (row.pendingPlan || row.plan)) return row;

  const agent = parseRecordValue(row.agent);
  if (Object.keys(agent).length) return agent;

  for (const key of ['input', 'input1', 'response', 'output', 'result', 'data']) {
    const candidate = workflowAgentCandidate(row[key]);
    if (candidate) return candidate;
  }
  for (const value of Object.values(row)) {
    const candidate = workflowAgentCandidate(value);
    if (candidate) return candidate;
  }
  if (row.status !== undefined) return row;
  if (row.pendingPlan !== undefined) return row;
  if (row.requiresConfirmation !== undefined) return row;
  if (row.requires_confirmation !== undefined) return row;
  if (row.pending_actions !== undefined) return row;
  if (row.action_results !== undefined) return row;
  if (row.plan !== undefined) return row;
  if (row.intent !== undefined) return row;
  return null;
}

export function workflowAgentDefaults(payload: unknown): WorkflowAgentDefaults | null {
  const agent = workflowAgentCandidate(payload);
  if (!agent) return null;
  const plan = agentPlanDefaults(agent.pendingPlan || agent.plan || { intent: agent.intent || '', actions: [] });
  const status = parseStringValue(agent.status || '').toLowerCase();
  const responseFormatSource = parseStringValue(agent.response_format || '');
  const responseFormat =
    responseFormatSource === 'plain_text' ||
    responseFormatSource === 'general' ||
    responseFormatSource === 'confirmation_request' ||
    responseFormatSource === 'action_summary' ||
    responseFormatSource === 'workflow_output' ||
    responseFormatSource === 'chart_output' ||
    responseFormatSource === 'planning_failure'
      ? (responseFormatSource as AgentResponseFormat)
      : null;
  const interactionValue = parseRecordValue(agent.interaction);
  const interactionKind = parseStringValue(interactionValue.kind || '');
  const interaction =
    (interactionKind === 'confirmation' || interactionKind === 'question' || interactionKind === 'choice') &&
    parseStringValue(interactionValue.title || '') &&
    parseStringValue(interactionValue.summary || '')
      ? (interactionValue as AgentInteraction)
      : null;
  const workflowValidation = parseRecordValue(agent.workflow_validation);
  const requiresConfirmation = agent.requires_confirmation === true || agent.requiresConfirmation === true || status === 'confirmation_required';
  const pendingActions = requiresConfirmation
    ? plan.actions
    : parseUnknownArray(agent.pending_actions).length
    ? parseUnknownArray(agent.pending_actions).map(agentActionDefaults)
    : null;
  return {
    intent: parseStringValue(agent.intent || plan.intent || ''),
    plan,
    action_results: parseUnknownArray(agent.action_results).map(agentActionResultDefaults),
    response_format: responseFormat,
    requires_confirmation: requiresConfirmation,
    pending_actions: pendingActions,
    pipeline_passes: parseUnknownArray(agent.pipeline_passes).length
      ? parseUnknownArray(agent.pipeline_passes).map(agentPassDefaults)
      : parseUnknownArray(agent.passes).length
      ? parseUnknownArray(agent.passes).map(agentPassDefaults)
      : [],
    interaction,
    workflow_cypher: parseStringValue(agent.workflow_cypher || '') || null,
    workflow_validation: Object.keys(workflowValidation).length ? workflowValidation : null,
    workflow_execution_output: agent.workflow_execution_output ?? null,
  };
}
