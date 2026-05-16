import type { AgentExecutionPlan } from '@giga/shared/types/contracts/agent.types';

export type ChatOrchestrationMode = 'DEFAULT' | 'SWARM';

export type ChatRouteDecision =
  | 'direct_llm_plan'
  | 'entity_operation'
  | 'workflow_operation'
  | 'project_operation'
  | 'node_operation'
  | 'advanced_agent'
  | 'advanced_swarm';

export type ChatPlannerSession = {
  id: string;
  kind: 'research' | 'planner' | 'confirmation' | 'routing' | 'execution';
  status: 'queued' | 'running' | 'completed' | 'blocked';
  title: string;
  summary: string;
};

export type ChatDefaultOrchestrationPlan = {
  mode: ChatOrchestrationMode;
  initialSubagents: number;
  initialSubagentRange: string;
  downstreamSwarmAgents: number;
  downstreamSwarmRange: string;
  routeDecision: ChatRouteDecision;
  requiresConfirmation: boolean;
  confirmationReason: string | null;
  plannerSessions: ChatPlannerSession[];
  decisionChainMermaid: string;
  markdown: string;
  recommendedActions: AgentExecutionPlan['actions'];
  limits: {
    maxDefaultSubagents: number;
    maxSwarmSize: number;
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const contains = (message: string, words: string[]) => words.some((word) => message.includes(word));

const mutatingWords = ['create', 'update', 'delete', 'remove', 'publish', 'deploy', 'build', 'alter', 'write', 'edit', 'run', 'execute', 'launch', 'implement', 'fix', 'train', 'ship'];
const workflowWords = ['workflow', 'automation', 'graph', 'node chain', 'publish workflow'];
const projectWords = ['project', 'repository', 'repo', 'app', 'software', 'build', 'deploy', 'database viewer'];
const nodeWords = ['node', '.node', 'node designer', 'custom node'];
const entityWords = ['channel', 'category', 'subject', 'post', 'tree', 'permission', 'role', 'plan policy', 'drive', 'folder', 'file'];
const advancedWords = ['advanced agent', 'ai agent', 'agent', 'subagent', 'software builder', 'data analyst', 'decision tree', 'neural net', 'sentiment', 'churn', 'complex', 'swarm'];

function inferDefaultSubagents(message: string, maxDefaultSubagents: number, requested?: number | null) {
  if (requested) return clamp(Math.floor(requested), 1, maxDefaultSubagents);
  let score = 1;
  if (contains(message, ['research', 'analyze', 'compare', 'audit'])) score += 1;
  if (contains(message, workflowWords) || contains(message, projectWords) || contains(message, nodeWords)) score += 1;
  if (contains(message, advancedWords)) score += 1;
  if (message.length > 1000) score += 1;
  return clamp(score, 1, maxDefaultSubagents);
}

function inferSwarmAgents(message: string, requested: number | null, maxSwarmSize: number) {
  if (maxSwarmSize < 10) return 0;
  if (requested) return clamp(Math.floor(requested), 10, maxSwarmSize);
  let score = 10;
  if (message.length > 1200) score += 10;
  if (contains(message, ['across all repos', 'e2e', 'full implementation', 'large system'])) score += 10;
  if (contains(message, ['test', 'lint', 'deploy', 'publish'])) score += 10;
  return clamp(score, 10, maxSwarmSize);
}

function inferRoute(message: string, explicitRouteKind?: string | null): ChatRouteDecision {
  if (explicitRouteKind === 'agent') return 'advanced_agent';
  if (explicitRouteKind === 'workflow') return 'workflow_operation';
  if (explicitRouteKind === 'swarm') return 'advanced_swarm';
  if (contains(message, advancedWords) && contains(message, ['implement', 'code', 'build', 'fix', 'ship'])) return 'advanced_swarm';
  if (contains(message, advancedWords)) return 'advanced_agent';
  if (contains(message, projectWords)) return 'project_operation';
  if (contains(message, workflowWords)) return 'workflow_operation';
  if (contains(message, nodeWords)) return 'node_operation';
  if (contains(message, entityWords)) return 'entity_operation';
  return 'direct_llm_plan';
}

function needsConfirmation(message: string, decision: ChatRouteDecision, confirmed?: boolean | null, mode?: ChatOrchestrationMode) {
  if (confirmed) return false;
  if (mode === 'SWARM') return true;
  if (decision === 'direct_llm_plan') return false;
  return contains(message, mutatingWords);
}
function routeActions(decision: ChatRouteDecision, message: string, mode: ChatOrchestrationMode, downstreamSwarmAgents: number): AgentExecutionPlan['actions'] {
  const shared = { message, surface: 'chat', chat_mode: mode, requested_agents: downstreamSwarmAgents };
  if (decision === 'advanced_swarm') {
    return [
      {
        id: 'advanced-swarm-plan-run',
        name: 'agent.swarm.v2' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Use the Advanced AI Agent swarm to decompose and implement this complex request.',
        input: { ...shared, operation: 'swarm.plan_and_run', requestedAgents: downstreamSwarmAgents, confirmed: true },
      },
    ];
  }
  if (decision === 'project_operation') {
    return [
      {
        id: 'software-builder-plan',
        name: 'agent.software.development_process.v1' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Create a visible software-build plan using project files, UI-kit context, build, preview, and deployment checks.',
        input: { ...shared, operation: 'plan', confirmed: true },
      },
      {
        id: 'software-builder-implement',
        name: 'agent.software.create.v2' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Create or update the AI-Agent Project after plan approval.',
        input: { ...shared, operation: 'create_or_update_project', confirmed: true },
        depends_on: ['software-builder-plan'],
      },
    ];
  }
  if (decision === 'workflow_operation') {
    return [
      {
        id: 'workflow-advanced-agent',
        name: 'agent.workflow' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Create, update, validate, run, or debug a workflow through the workflow advanced agent.',
        input: { ...shared, operation: 'workflow.plan', confirmed: true },
      },
    ];
  }
  if (decision === 'node_operation') {
    return [
      {
        id: 'node-designer-agent',
        name: 'dynamic-node.operation' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Build, validate, or run a .node package and make it available to workflows.',
        input: { ...shared, operation: 'compile', confirmed: true },
      },
    ];
  }
  if (decision === 'advanced_agent') {
    return [
      {
        id: 'advanced-agent-audit',
        name: 'agent.gaps' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Inspect the requested AI Agent capability, tool policy, ingestion, skills, manifests, and advanced-agent gaps.',
        input: { ...shared, operation: contains(message.toLowerCase(), ['create', 'update', 'delete', 'skills', 'manifest', 'ingestion']) ? 'agent.create_update_or_configure' : 'agent.audit_or_run', confirmed: true },
      },
    ];
  }
  if (decision === 'entity_operation') {
    return [
      {
        id: 'entity-operation-plan',
        name: 'entity.operation' as AgentExecutionPlan['actions'][number]['name'],
        reason: 'Read or prepare scoped entity/tree operations through the backend entity layer.',
        input: { ...shared, operation: 'read_or_plan', confirmed: true },
      },
    ];
  }
  return [];
}


function session(id: string, kind: ChatPlannerSession['kind'], title: string, summary: string, status: ChatPlannerSession['status'] = 'completed') {
  return { id, kind, status, summary, title };
}

function buildMermaid(plan: Omit<ChatDefaultOrchestrationPlan, 'decisionChainMermaid' | 'markdown' | 'recommendedActions'>) {
  const modeLabel = plan.mode === 'SWARM' ? 'Swarm mode 10-100 advanced-capable workers' : 'Default mode 1-5 planning subagents';
  const confirmation = plan.requiresConfirmation ? 'Confirmation required before mutation' : 'No confirmation gate required';
  const lines = [
    'flowchart TD',
    '  User[User message] --> Router[Chat mode router]',
    `  Router --> Mode[${modeLabel}]`,
    `  Mode --> Fanout[Initial fan-out: ${plan.initialSubagents} subagent${plan.initialSubagents === 1 ? '' : 's'}]`,
    '  Fanout --> Research[Research/context subagent]',
    '  Fanout --> Planner[Planner session]',
    '  Fanout --> Permissions[Permission and plan-policy check]',
    `  Planner --> Decision[Decision: ${plan.routeDecision.replace(/_/g, ' ')}]`,
    `  Decision --> Gate[${confirmation}]`,
  ];
  if (plan.routeDecision === 'advanced_swarm') {
    lines.push(`  Gate --> Advanced[Advanced AI Agent] --> Swarm[Implementation swarm: ${plan.downstreamSwarmAgents} workers]`);
    lines.push('  Swarm --> Monitor[Process Monitor logs + scope tracking]');
  } else {
    lines.push('  Gate --> Execute[Execute selected entity/workflow/project/node/agent path]');
    lines.push('  Execute --> Monitor[Process Monitor logs + scope tracking]');
  }
  lines.push('  Monitor --> Output[Markdown answer + preview blocks + audit diagram]');
  return lines.join('\n');
}

function buildMarkdown(plan: ChatDefaultOrchestrationPlan) {
  const rows = plan.plannerSessions
    .map((item) => `| ${item.kind} | ${item.status} | ${item.title} | ${item.summary} |`)
    .join('\n');
  return [
    '### Chat routing audit',
    '',
    `Mode: **${plan.mode}**`,
    `Initial subagent range: **${plan.initialSubagentRange}**`,
    `Selected initial subagents: **${plan.initialSubagents}**`,
    `Decision: **${plan.routeDecision.replace(/_/g, ' ')}**`,
    `Downstream swarm range: **${plan.downstreamSwarmRange}**`,
    `Downstream swarm size: **${plan.downstreamSwarmAgents}**`,
    plan.requiresConfirmation ? `Confirmation: **required** — ${plan.confirmationReason}` : 'Confirmation: **not required**',
    '',
    '| Session | Status | Checkpoint | Summary |',
    '|---|---:|---|---|',
    rows,
    '',
    '```mermaid',
    plan.decisionChainMermaid,
    '```',
  ].join('\n');
}

export function planChatDefaultOrSwarmOrchestration(input: {
  confirmed?: boolean | null;
  explicitRouteKind?: string | null;
  limits?: { maxDefaultSubagents?: number | null; maxSwarmSize?: number | null } | null;
  message: string;
  mode: ChatOrchestrationMode;
  requestedDefaultSubagents?: number | null;
  requestedSwarmAgents?: number | null;
}): ChatDefaultOrchestrationPlan {
  const text = input.message.toLowerCase();
  const maxDefaultSubagents = clamp(Number(input.limits?.maxDefaultSubagents || 5), 1, 5);
  const rawSwarmSize = input.limits?.maxSwarmSize === null || input.limits?.maxSwarmSize === undefined ? 100 : Number(input.limits.maxSwarmSize);
  const maxSwarmSize = Number.isFinite(rawSwarmSize) ? Math.max(0, Math.min(100, Math.floor(rawSwarmSize))) : 100;
  const initialSubagents = input.mode === 'SWARM' ? inferSwarmAgents(text, input.requestedSwarmAgents || null, maxSwarmSize) : inferDefaultSubagents(text, maxDefaultSubagents, input.requestedDefaultSubagents || null);
  const downstreamSwarmAgents = inferSwarmAgents(text, input.requestedSwarmAgents || null, maxSwarmSize);
  const rawRouteDecision = input.mode === 'SWARM' ? 'advanced_swarm' : inferRoute(text, input.explicitRouteKind);
  const routeDecision: ChatRouteDecision = rawRouteDecision === 'advanced_swarm' && input.mode === 'DEFAULT' && maxSwarmSize < 10 ? 'advanced_agent' : rawRouteDecision;
  const requiresConfirmation = needsConfirmation(text, routeDecision, input.confirmed, input.mode);
  const base: Omit<ChatDefaultOrchestrationPlan, 'decisionChainMermaid' | 'markdown'> = {
    confirmationReason: requiresConfirmation ? 'The request can mutate Giga entities, workflows, nodes, projects, or drives.' : null,
    downstreamSwarmAgents,
    downstreamSwarmRange: maxSwarmSize >= 10 ? `10-${maxSwarmSize}` : 'disabled',
    initialSubagentRange: input.mode === 'SWARM' ? (maxSwarmSize >= 10 ? `10-${maxSwarmSize}` : 'disabled') : `1-${maxDefaultSubagents}`,
    initialSubagents,
    limits: { maxDefaultSubagents, maxSwarmSize },
    mode: input.mode,
    recommendedActions: routeActions(routeDecision, input.message, input.mode, downstreamSwarmAgents),
    plannerSessions: [
      session('research', 'research', 'Context and artifact research', 'Collect scope, permissions, existing attachments, drive/tree context, and relevant project/workflow/node state.'),
      session('planner', 'planner', 'Long planner session', 'Break the request into auditable actions and decide whether a normal LLM plan, entity operation, workflow, project, node, advanced agent, or swarm is required.'),
      session('policy', 'routing', 'Policy and access gate', 'Apply entity permissions, plan limits, drive boundary rules, and workflow/node/project ownership rules.'),
      session('confirm', 'confirmation', 'Confirmation gate', requiresConfirmation ? 'Blocked until user confirmation because execution can mutate data.' : 'No confirmation required for a read-only or plan-only answer.', requiresConfirmation ? 'blocked' : 'completed'),
      session('execute', 'execution', 'Execution handoff', 'Execute the selected route and stream scope-aware process-monitor events when work starts.'),
    ],
    requiresConfirmation,
    routeDecision,
  };
  const decisionChainMermaid = buildMermaid(base);
  const plan = { ...base, decisionChainMermaid, markdown: '' };
  return { ...plan, markdown: buildMarkdown({ ...plan, decisionChainMermaid }) };
}

export function appendChatOrchestrationAudit(markdown: string, plan: ChatDefaultOrchestrationPlan) {
  const text = String(markdown || '').trim();
  return `${text}${text ? '\n\n---\n\n' : ''}${plan.markdown}`;
}

export function shouldUseAdvancedSwarmForDefault(plan: ChatDefaultOrchestrationPlan) {
  return plan.mode === 'DEFAULT' && plan.routeDecision === 'advanced_swarm' && !plan.requiresConfirmation && plan.downstreamSwarmAgents >= 10;
}
