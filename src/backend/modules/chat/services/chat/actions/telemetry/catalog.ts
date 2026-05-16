import { AgentActionName } from '@giga/shared/types/contracts/agent.types';
import { TREE_ACTION_CATALOG, TREE_MUTATING_ACTION_NAMES, TREE_READ_ACTION_NAMES } from '@giga/tree/services/giga/tree/integration/mcp';
import { WORKFLOW_ACTION_CATALOG } from './workflow-catalog';

export const READ_GIGA_ACTIONS = new Set<AgentActionName>([
  ...TREE_READ_ACTION_NAMES,
  'fetch_all_workflows',
  'fetch_workflow',
  'fetch_workflow_runs',
  'fetch_workflow_revisions',
  'fetch_workflow_node_catalog',
  'fetch_workflow_node_details',
  'validate_workflow_cypher',
  'get_workflow_output',
]);

export const MUTATING_GIGA_ACTIONS = new Set<AgentActionName>([
  ...TREE_MUTATING_ACTION_NAMES,
  'create_workflow_from_cypher',
  'update_workflow_from_cypher',
  'create_workflow',
  'update_workflow',
  'delete_workflow',
  'execute_workflow',
]);

export const GIGA_ACTION_NAMES = new Set<AgentActionName>([...Array.from(READ_GIGA_ACTIONS), ...Array.from(MUTATING_GIGA_ACTIONS)]);

export function isGigaAction(name: AgentActionName) {
  return GIGA_ACTION_NAMES.has(name);
}

export function isMutatingAction(name: AgentActionName) {
  return MUTATING_GIGA_ACTIONS.has(name);
}

export function getReadOnlyGigaActionCatalog() {
  return GIGA_ACTION_CATALOG.filter((action) => !isMutatingAction(action.name));
}

export const GIGA_ACTION_CATALOG = [...TREE_ACTION_CATALOG, ...WORKFLOW_ACTION_CATALOG];
