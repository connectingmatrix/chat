import { parseRecordValue, parseStringValue, parseUnknownArray } from 'giga-ai-helper/workflow';
import { runStoredAIAgent } from '@connectingmatrix/ai-agents/services/ai-agents';
import type { AgentExecutionInput, AgentExecutionOutput } from '@giga/shared/types/contracts/agent.types';
import type { QueryChatInput, ResolvedChatScope } from '@connectingmatrix/chat/services/chat/contracts/types';

const text = (value: unknown): string => parseStringValue(value).trim();

export type SelectedAgentResolution = {
  agentId: string | null;
  source: 'payload' | 'session_metadata' | 'none';
};

export function resolveSelectedAgentId(input: Pick<QueryChatInput, 'agentId' | 'agent_id' | 'sessionMetadata'>): SelectedAgentResolution {
  const fromPayload = text(input.agentId || input.agent_id);
  if (fromPayload) return { agentId: fromPayload, source: 'payload' };

  const meta = parseRecordValue(input.sessionMetadata);
  const fromMeta = text(meta.agentId || meta.agent_id || meta.selectedAgentId || meta.selected_agent_id);
  if (fromMeta) return { agentId: fromMeta, source: 'session_metadata' };

  return { agentId: null, source: 'none' };
}

export function shouldUseSavedAgent(input: QueryChatInput): boolean {
  return Boolean(resolveSelectedAgentId(input).agentId);
}

export async function executeSelectedAgentForChat(params: {
  agentExecutionInput: AgentExecutionInput;
  effectiveScope: ResolvedChatScope['scope'];
  input: QueryChatInput;
  selectedAgentId: string;
}): Promise<AgentExecutionOutput> {
  const sessionMetadata = parseRecordValue(params.input.sessionMetadata);
  const attachments: Array<Record<string, unknown>> = [];
  for (const value of parseUnknownArray(params.input.attachments)) attachments.push(parseRecordValue(value));
  const output = await runStoredAIAgent({
    agentId: params.selectedAgentId,
    chatId: params.agentExecutionInput.chatId,
    sessionId: text(sessionMetadata.agentSessionId || sessionMetadata.agent_session_id) || undefined,
    message: params.input.message,
    customPrompt: params.input.systemPrompt || undefined,
    attachments,
    variables: {
      scope: params.effectiveScope,
      subjectIds: params.agentExecutionInput.subjectIds || [],
      postIds: params.agentExecutionInput.postIds || [],
      tagSlugs: params.agentExecutionInput.tagSlugs || [],
    },
    scope: {
      type: 'user',
      id: params.agentExecutionInput.userId,
      organizationId: params.effectiveScope.organizationId || null,
    },
  });

  const trace = Array.isArray(output.trace) ? output.trace : [];
  const artifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  const plan = {
    intent: 'Run selected saved AI agent.',
    actions: [
      {
        id: 'selected-agent-run',
        name: 'agent.run' as const,
        reason: 'The user selected a saved AI agent in the chat UI.',
        input: { agent_id: params.selectedAgentId, chat_id: params.agentExecutionInput.chatId },
      },
    ],
  };
  const actionResult = {
    id: 'selected-agent-run',
    name: 'agent.run' as const,
    status: 'completed' as const,
    reason: 'The user selected a saved AI agent in the chat UI.',
    summary: 'Selected AI agent completed.',
    data: { agent_id: params.selectedAgentId, run_id: output.runId || null, session_id: output.sessionId || null, artifacts, trace },
    sources: [],
    duration_ms: 0,
  };

  return {
    markdown: output.text || 'The selected AI agent completed the request.',
    intent: 'Run selected saved AI agent.',
    scope: {
      scope_id: params.agentExecutionInput.scopeId || null,
      scope_type: params.agentExecutionInput.scopeType || null,
      subject_ids: params.agentExecutionInput.subjectIds || [],
      post_ids: params.agentExecutionInput.postIds || [],
      tag_slugs: params.agentExecutionInput.tagSlugs || [],
    },
    plan,
    action_results: [actionResult],
    sources: [],
    retrieved_chunks: [],
    response_format: 'agent_ui_chat',
    requires_confirmation: false,
    pending_actions: null,
    pipeline_passes: [
      {
        kind: 'selected_agent',
        plan,
        action_results: [actionResult],
        response_format: 'agent_ui_chat',
      },
    ],
    interaction: null,
    workflow_cypher: null,
    workflow_validation: null,
    workflow_execution_output: null,
  } as AgentExecutionOutput;
}
