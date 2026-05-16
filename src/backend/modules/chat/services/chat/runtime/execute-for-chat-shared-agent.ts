import { queryChatWithSharedNodeAgent } from '@connectingmatrix/chat/services/chat/runtime/shared-node-agent';
import type { AgentExecutionInput, AgentExecutionOutput } from '@giga/shared/types/contracts/agent.types';
import type { QueryChatInput } from '@connectingmatrix/chat/services/chat/contracts/types';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => String(value ?? '').trim();

const actionResultFromRuntime = (result: unknown) => {
  const row = record(result);
  const action = record(row.action);
  const output = record(row.output);
  return {
    action_id: text(action.id),
    action_name: text(action.tool),
    summary: text(output.summary || output.message || output.text || row.error || action.reason),
    status: row.status === 'failed' ? 'failed' : row.status === 'skipped' ? 'skipped' : 'completed',
    data: row.output || null,
    error: text(row.error) || null,
  } as never;
};

export const executeForChatWithSharedAgentRuntime = async (input: AgentExecutionInput): Promise<AgentExecutionOutput> => {
  const output = await queryChatWithSharedNodeAgent({
    attachments: [],
    chatId: input.chatId,
    debug: input.debug ? { emit: input.debug.emit } : undefined,
    message: input.message,
    postId: input.postId || null,
    postIds: input.postIds || null,
    request: input.request,
    scope: input.scopeType && input.scopeId ? { type: input.scopeType, id: input.scopeId, organizationId: input.scopeOrganizationId || null } : null,
    sessionMetadata: input.sessionMetadata || null,
    subjectId: input.subjectId || null,
    subjectIds: input.subjectIds || null,
    supabase: input.supabase,
    systemPrompt: input.systemPrompt || null,
    tagSlugs: input.tagSlugs || null,
    topK: input.topK || null,
  } as QueryChatInput);
  return {
    action_results: output.actionResults.map(actionResultFromRuntime),
    intent: output.plan.intent,
    markdown: output.markdown,
    pending_actions:
      output.status === 'confirmation_required'
        ? (output.plan.actions.map((action) => ({ action: action.tool, action_id: action.id, input: action.input, reason: action.reason })) as never)
        : null,
    pipeline_passes: output.passes.map((pass) => ({
      action_results: pass.toolResults.map(actionResultFromRuntime),
      kind: 'shared_node_agent_pass',
      plan: {
        intent: pass.plan.intent,
        actions: pass.plan.actions.map((action) => ({ id: action.id, name: action.tool, reason: action.reason, input: action.input })),
      },
    })) as never,
    plan: {
      actions: output.plan.actions.map((action) => ({
        id: action.id,
        name: action.tool,
        reason: action.reason,
        input: action.input,
        depends_on: action.depends_on,
      })),
      intent: output.plan.intent,
    } as never,
    requires_confirmation: output.status === 'confirmation_required',
    retrieved_chunks: [],
    response_format: undefined,
    scope: {
      scope_id: input.scopeId || null,
      scope_type: input.scopeType || null,
      subject_ids: input.subjectIds || [],
      post_ids: input.postIds || [],
      tag_slugs: input.tagSlugs || [],
    } as never,
    sources: [],
    workflow_execution_output: { files: output.files, logs: output.logs },
  };
};
