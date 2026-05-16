import { AIAgentEntity, AIAgentRoutingRuleEntity, AIChatAgentWorkflowEntity } from '@connectingmatrix/orm/repositories/entities';

export type ChatAgentMode = 'DEFAULT' | 'AGENT' | 'WORKFLOW' | 'SWARM';
export type ChatAgentRoute =
  | { kind: 'default' }
  | { kind: 'agent'; agentId: string; source: 'explicit' | 'user_rule' | 'chat_attachment' | 'internal_rule' }
  | { kind: 'workflow'; workflowId: string; source: 'explicit' | 'chat_attachment' }
  | { kind: 'swarm'; swarmId?: string | null; source: 'explicit' };

export type ChatAgentRouteInput = {
  mode?: ChatAgentMode | null;
  message: string;
  userId: string;
  organizationId?: string | null;
  chatId?: string | null;
  agentId?: string | null;
  workflowId?: string | null;
  swarmId?: string | null;
};

type CandidateRule = {
  agent_id: string | null;
  visibility: string | null;
  match_kind: string | null;
  match_value: string | null;
  is_internal: boolean | null;
};

const routedByRule = (message: string, rule: CandidateRule): boolean => {
  if (rule.match_kind === 'keyword') return message.includes((rule.match_value || '').toLowerCase());
  if (rule.match_kind === 'skill') return message.includes((rule.match_value || '').replace('.builder.v1', '').replace('-', ' '));
  return false;
};

async function visibleAgentIds(input: ChatAgentRouteInput): Promise<Set<string>> {
  const agents = await AIAgentEntity.find({ is_active: true }).many();
  const ids = new Set<string>();
  for (const agent of agents) {
    if (agent.scope_type === 'user' && agent.user_id === input.userId && agent.id) ids.add(agent.id);
    if (agent.scope_type === 'organization' && agent.organization_id === input.organizationId && agent.id) ids.add(agent.id);
    if ((agent.scope_type === 'global' || agent.scope_type === 'root' || agent.owner_type === 'system') && agent.id) ids.add(agent.id);
  }
  return ids;
}

async function attachedRoute(chatId: string | null | undefined): Promise<ChatAgentRoute | null> {
  if (!chatId) return null;
  const rows = await AIChatAgentWorkflowEntity.find({ chat_id: chatId, is_default: true }).orderBy('created_at', 'desc').limit(1).many();
  const attachment = rows[0];
  if (!attachment) return null;
  if (attachment.agent_id) return { kind: 'agent', agentId: attachment.agent_id, source: 'chat_attachment' };
  if (attachment.workflow_id) return { kind: 'workflow', workflowId: attachment.workflow_id, source: 'chat_attachment' };
  return null;
}

export async function resolveChatAgentRoute(input: ChatAgentRouteInput): Promise<ChatAgentRoute> {
  const mode = input.mode || 'DEFAULT';
  if (mode === 'AGENT') return input.agentId ? { kind: 'agent', agentId: input.agentId, source: 'explicit' } : { kind: 'default' };
  if (mode === 'WORKFLOW') return input.workflowId ? { kind: 'workflow', workflowId: input.workflowId, source: 'explicit' } : { kind: 'default' };
  if (mode === 'SWARM') return { kind: 'swarm', swarmId: input.swarmId || null, source: 'explicit' };
  if (mode !== 'DEFAULT') return { kind: 'default' };
  if (input.agentId || input.workflowId || input.swarmId) return { kind: 'default' };

  const visibleIds = await visibleAgentIds(input);
  const message = input.message.toLowerCase();
  const rules = await AIAgentRoutingRuleEntity.find({ enabled: true, mode: 'DEFAULT' }).orderBy('priority', 'asc').many();
  for (const rule of rules) {
    if (!rule.agent_id || !visibleIds.has(rule.agent_id) || rule.is_internal || !routedByRule(message, rule)) continue;
    return { kind: 'agent', agentId: rule.agent_id, source: 'user_rule' };
  }

  const attachment = await attachedRoute(input.chatId);
  if (attachment) return attachment;

  for (const rule of rules) {
    if (!rule.agent_id || !visibleIds.has(rule.agent_id) || !rule.is_internal || !routedByRule(message, rule)) continue;
    return { kind: 'agent', agentId: rule.agent_id, source: 'internal_rule' };
  }
  return { kind: 'default' };
}
