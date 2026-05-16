import { runStoredAIAgent } from '@connectingmatrix/ai-agents/services/ai-agents/runtime/agent-service';
import type { QueryChatInput, ResolvedChatScope } from '@connectingmatrix/chat/services/chat/contracts/types';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => String(value ?? '').trim();

export function resolveSelectedAIAgentId(input: QueryChatInput & { agentId?: string | null; agent_id?: string | null }): string | null {
  const meta = record(input.sessionMetadata);
  const candidates = [input.agentId, input.agent_id, meta.agentId, meta.agent_id, meta.selectedAgentId, meta.selected_agent_id];
  for (const candidate of candidates) {
    const id = text(candidate);
    if (id) return id;
  }
  return null;
}

export async function runSavedAIAgentForChat(input: {
  agentId: string;
  message: string;
  chatId: string;
  sessionId?: string | null;
  attachments?: Array<Record<string, unknown>> | null;
  systemPrompt?: string | null;
  resolvedScope: ResolvedChatScope;
  variables?: Record<string, unknown>;
}) {
  return runStoredAIAgent({
    agentId: input.agentId,
    message: input.message,
    chatId: input.chatId,
    sessionId: input.sessionId || undefined,
    attachments: input.attachments || [],
    customPrompt: input.systemPrompt || undefined,
    scope: {
      type:
        input.resolvedScope.scope.type === 'channel' ||
        input.resolvedScope.scope.type === 'category' ||
        input.resolvedScope.scope.type === 'subject' ||
        input.resolvedScope.scope.type === 'post'
          ? 'user'
          : 'user',
      id: input.resolvedScope.scope.id,
      organizationId: input.resolvedScope.scope.organizationId || null,
    },
    variables: {
      subjectIds: input.resolvedScope.subject_ids,
      postIds: input.resolvedScope.post_ids,
      scope: input.resolvedScope.scope,
    },
  });
}
