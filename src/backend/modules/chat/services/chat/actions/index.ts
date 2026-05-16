import { chatActionMcpTools } from '@giga/mcp/services/mcp/tools/chat-actions';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { isTreeAction } from '@giga/tree/services/giga/tree/integration/mcp';
import { AgentActionName, AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { GigaActionOutput } from './contracts/types';

export { GIGA_ACTION_CATALOG, getReadOnlyGigaActionCatalog, isGigaAction, isMutatingAction } from './telemetry/catalog';

const WORKFLOW_ACTIONS = new Set<AgentActionName>([
  'fetch_workflow_node_catalog',
  'fetch_workflow_node_details',
  'validate_workflow_cypher',
  'create_workflow_from_cypher',
  'update_workflow_from_cypher',
  'create_workflow',
  'update_workflow',
  'delete_workflow',
  'execute_workflow',
  'get_workflow_output',
  'fetch_all_workflows',
  'fetch_workflow',
  'fetch_workflow_runs',
  'fetch_workflow_revisions',
]);

const mcpRequest = (runtime: AgentActionRuntime) => runtime.request || { body: {}, headers: {} };

async function mcpDispatch(runtime: AgentActionRuntime, action: AgentActionName, input?: Record<string, any>) {
  const request = mcpRequest(runtime);
  const effectiveRoot = await isCurrentUserRootUser(runtime.supabase).catch(() => false);
  return chatActionMcpTools.handlers['giga.chat_run_action'](
    {
      request: request as any,
      supabase: runtime.supabase as any,
      body: ((request as any).body || {}) as any,
      graphqlContext: ((request as any).context || null) as any,
      userId: runtime.userId,
      effectiveRoot,
    },
    {
      action,
      chatId: runtime.chatId,
      input: input || {},
      message: runtime.message,
      resultsById: runtime.resultsById || {},
      scopeId: runtime.scopeId || null,
      scopeType: runtime.scopeType || null,
      topK: runtime.topK,
    },
  ) as Promise<GigaActionOutput>;
}

export async function executeGigaAction(name: AgentActionName, runtime: AgentActionRuntime, input?: Record<string, any>): Promise<GigaActionOutput> {
  if (WORKFLOW_ACTIONS.has(name)) return mcpDispatch(runtime, name, input);
  if (isTreeAction(name)) return mcpDispatch(runtime, name, input);
  throw new Error(`Unsupported Giga action ${name}.`);
}
