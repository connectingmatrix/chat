import { executeBackendAgentCommand } from '@giga/execute-backend/services/agent/execute-backend/execute-backend';
import { listAgentEntityCapabilities } from '@connectingmatrix/ai-agents/services/agent/capabilities/entity-capability-registry';
import { parseSlashCommand, stripCommandPrefix, type ParsedSlashCommand } from './slash-command-parser';

export type SlashCommandHint = {
  command: string;
  title: string;
  description: string;
  argsSchema?: Record<string, unknown>;
  examples: string[];
  capabilityId: string;
  group: 'workflow' | 'node' | 'tree' | 'entity' | 'chart' | 'agent';
};

export type SlashExecuteResult = {
  markdown?: string | null;
  terminal?: string | null;
  artifacts?: unknown[];
  effects?: unknown[];
  confirmation?: unknown | null;
  raw?: unknown;
  status: 'completed' | 'failed' | 'confirmation_required';
  error?: string | null;
};

const hint = (input: Omit<SlashCommandHint, 'examples'> & { examples?: string[] }): SlashCommandHint => ({
  ...input,
  examples: input.examples || [],
});

export const STATIC_SLASH_COMMANDS: SlashCommandHint[] = [
  hint({
    command: '/workflow list',
    title: 'Workflow catalog',
    description: 'List accessible workflows.',
    capabilityId: 'agent.workflow.workflow.list',
    group: 'workflow',
    examples: ['/workflow list'],
  }),
  hint({
    command: '/workflow running',
    title: 'Running workflows',
    description: 'Show currently running workflow executions.',
    capabilityId: 'agent.workflow.workflow.running',
    group: 'workflow',
    examples: ['/workflow running'],
  }),
  hint({
    command: '/workflow logs {RUN_ID}',
    title: 'Workflow logs',
    description: 'Fetch workflow execution logs.',
    capabilityId: 'agent.workflow.workflow.logs',
    group: 'workflow',
    examples: ['/workflow logs run_123'],
  }),
  hint({
    command: '/workflow live {RUN_ID}',
    title: 'Workflow live logs',
    description: 'Prepare live log/event subscription payload.',
    capabilityId: 'agent.workflow.workflow.live_logs',
    group: 'workflow',
    examples: ['/workflow live run_123'],
  }),
  hint({
    command: '/workflow stop {RUN_ID}',
    title: 'Stop workflow',
    description: 'Stop a running workflow execution.',
    capabilityId: 'agent.workflow.workflow.stop',
    group: 'workflow',
    examples: ['/workflow stop run_123'],
  }),
  hint({
    command: '/workflow publish {ID}',
    title: 'Publish workflow',
    description: 'Publish a workflow.',
    capabilityId: 'agent.workflow.workflow.publish',
    group: 'workflow',
    examples: ['/workflow publish wf_123'],
  }),
  hint({
    command: '/workflow run {ID}',
    title: 'Run workflow',
    description: 'Execute a workflow.',
    capabilityId: 'agent.workflow.workflow.execute',
    group: 'workflow',
    examples: ['/workflow run wf_123'],
  }),
  hint({
    command: '/workflow ai create "PROMPT"',
    title: 'Create workflow with AI',
    description: 'Compile a workflow from the prompt.',
    capabilityId: 'agent.workflow.workflow.create',
    group: 'workflow',
    examples: ['/workflow ai create "Create nested RCM channels"'],
  }),
  hint({
    command: '/workflow debug "PROMPT"',
    title: 'Debug workflow with AI',
    description: 'Send chat context and logs to the AI workflow debugger.',
    capabilityId: 'agent.workflow.workflow.debug',
    group: 'workflow',
    examples: ['/workflow debug "why did the last run fail"'],
  }),
  hint({
    command: '/node help',
    title: 'Node help',
    description: 'Show node command help.',
    capabilityId: 'agent.workflow.node.help',
    group: 'node',
    examples: ['/node help'],
  }),
  hint({
    command: '/node list',
    title: 'Node catalog',
    description: 'List workflow node capabilities.',
    capabilityId: 'agent.workflow.node.list',
    group: 'node',
    examples: ['/node list'],
  }),
  hint({
    command: '/node {NODE_NAME} options',
    title: 'Node options',
    description: 'Show options for a node.',
    capabilityId: 'agent.workflow.node.options',
    group: 'node',
    examples: ['/node Chart options'],
  }),
  hint({
    command: '/node create "PROMPT"',
    title: 'Create node',
    description: 'Create a validated .node package from a prompt.',
    capabilityId: 'agent.workflow.node.create',
    group: 'node',
    examples: ['/node create "a DuckDB loader node"'],
  }),
  hint({
    command: '/tree',
    title: 'Tree commands',
    description: 'Show tree operation hints.',
    capabilityId: 'tree.operation.help',
    group: 'tree',
    examples: ['/tree'],
  }),
  hint({
    command: '/channel',
    title: 'Channel commands',
    description: 'Show Channel entity actions.',
    capabilityId: 'entity.Channel.*',
    group: 'entity',
    examples: ['/channel'],
  }),
  hint({
    command: '/categories',
    title: 'Category commands',
    description: 'Show Category entity actions.',
    capabilityId: 'entity.Category.*',
    group: 'entity',
    examples: ['/categories'],
  }),
  hint({
    command: '/chart',
    title: 'Chart commands',
    description: 'Show chart and GIS commands.',
    capabilityId: 'chart.*',
    group: 'chart',
    examples: ['/chart'],
  }),
];

const normalizeResult = (raw: unknown): SlashExecuteResult => {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const output = rec.output && typeof rec.output === 'object' ? (rec.output as Record<string, unknown>) : rec;
  const statusText = String(rec.status || output.status || '').toLowerCase();
  const error = String(rec.error || output.error || '').trim();
  const markdown =
    typeof output.markdown === 'string'
      ? output.markdown
      : typeof output.text === 'string'
      ? output.text
      : typeof output.summary === 'string'
      ? output.summary
      : null;
  const confirmation = output.confirmation || output.interaction || (statusText.includes('confirmation') ? output : null);
  return {
    markdown,
    terminal: typeof output.terminal === 'string' ? output.terminal : null,
    artifacts: Array.isArray(output.artifacts) ? output.artifacts : Array.isArray(output.files) ? output.files : [],
    effects: Array.isArray(output.effects) ? output.effects : Array.isArray(output.refetch) ? output.refetch : [],
    confirmation,
    raw,
    status: error ? 'failed' : confirmation ? 'confirmation_required' : 'completed',
    error: error || null,
  };
};

const idAt = (parsed: ParsedSlashCommand, index: number) => (parsed.args[index] ? String(parsed.args[index]).trim() : '');
const promptAfter = (parsed: ParsedSlashCommand, pattern: RegExp) => parsed.quoted[0] || stripCommandPrefix(parsed.raw, pattern);

async function executeTool(tool: string, input: Record<string, unknown>): Promise<SlashExecuteResult> {
  return normalizeResult(await executeBackendAgentCommand({ tool, input }));
}

export async function createSlashHints(input: Record<string, unknown> = {}): Promise<{ summary: string; hints: SlashCommandHint[] }> {
  const query = String(input.query || input.prefix || input.text || '')
    .trim()
    .toLowerCase();
  const entityHints = listAgentEntityCapabilities()
    .slice(0, 400)
    .map(
      (capability): SlashCommandHint => ({
        command: `/${capability.entity} ${capability.operation}`,
        title: capability.name,
        description: capability.description,
        argsSchema: capability.inputSchema,
        examples: capability.examples.map((example) => example.message),
        capabilityId: capability.id || `entity.${capability.entity}.${capability.operation}`,
        group: 'entity',
      }),
    );
  const hints = [...STATIC_SLASH_COMMANDS, ...entityHints].filter((item) => {
    if (!query || query === '/') return true;
    return `${item.command} ${item.title} ${item.description} ${item.group}`.toLowerCase().includes(query.replace(/^\//, ''));
  });
  return { summary: `Fetched ${hints.length} slash command hint(s).`, hints };
}

export async function executeSlashCommand(input: Record<string, unknown> = {}): Promise<SlashExecuteResult> {
  const parsed = parseSlashCommand(input.command || input.raw || input.text || input.message || '');
  const lower = parsed.canonical;
  const base = { ...input, raw: parsed.raw, command: parsed.command, args: parsed.args, quoted: parsed.quoted };
  if (!parsed.raw) return { status: 'failed', error: 'Slash command is required.', artifacts: [], effects: [] };

  if (lower.startsWith('/workflow list')) return executeTool('agent.workflow', { ...base, operation: 'workflow.list' });
  if (lower.startsWith('/workflow running')) return executeTool('agent.workflow', { ...base, operation: 'workflow.running' });
  if (lower.startsWith('/workflow logs'))
    return executeTool('agent.workflow', { ...base, operation: 'workflow.logs', executionId: idAt(parsed, 1) || idAt(parsed, 0) });
  if (lower.startsWith('/workflow live'))
    return executeTool('agent.workflow', { ...base, operation: 'workflow.live_logs', executionId: idAt(parsed, 1) || idAt(parsed, 0) });
  if (lower.startsWith('/workflow stop'))
    return executeTool('agent.workflow', {
      ...base,
      operation: 'workflow.stop',
      executionId: idAt(parsed, 1) || idAt(parsed, 0),
      runId: idAt(parsed, 1) || idAt(parsed, 0),
    });
  if (lower.startsWith('/workflow publish'))
    return executeTool('agent.workflow', { ...base, operation: 'workflow.publish', workflowId: idAt(parsed, 1) || idAt(parsed, 0) });
  if (lower.startsWith('/workflow run'))
    return executeTool('agent.workflow', { ...base, operation: 'workflow.execute', workflowId: idAt(parsed, 1) || idAt(parsed, 0) });
  if (lower.startsWith('/workflow ai create'))
    return executeTool('agent.workflow', {
      ...base,
      operation: 'workflow.create',
      prompt: promptAfter(parsed, /^\/workflow\s+ai\s+create/i),
      includeChatContext: true,
    });
  if (lower.startsWith('/workflow debug'))
    return executeTool('agent.workflow', {
      ...base,
      operation: 'workflow.debug',
      prompt: promptAfter(parsed, /^\/workflow\s+debug/i),
      includeChatContext: true,
    });

  if (lower.startsWith('/node list')) return executeTool('agent.workflow', { ...base, operation: 'node.list' });
  if (lower.startsWith('/node help')) return executeTool('agent.workflow', { ...base, operation: 'node.help' });
  if (lower.startsWith('/node create'))
    return executeTool('agent.workflow', { ...base, operation: 'node.create', prompt: promptAfter(parsed, /^\/node\s+create/i) });
  if (lower.startsWith('/node ') && lower.endsWith(' options'))
    return executeTool('agent.workflow', { ...base, operation: 'node.options', nodeName: parsed.args.slice(0, -1).join(' ') });

  if (lower.startsWith('/tree')) return executeTool('tree.operation', { ...base, operation: 'help' });
  if (lower.startsWith('/channel')) return normalizeResult(await createSlashHints({ query: 'Channel' }));
  if (lower.startsWith('/categories') || lower.startsWith('/category')) return normalizeResult(await createSlashHints({ query: 'Category' }));
  if (lower.startsWith('/chart')) return executeTool('chart.capabilities', { ...base, operation: 'help' });

  return { status: 'failed', error: `Unknown slash command: ${parsed.raw}`, artifacts: [], effects: [] };
}
