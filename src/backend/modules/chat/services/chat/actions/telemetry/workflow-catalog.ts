import { Executor } from '@workflow/executor';
import { AgentActionDefinition } from '@giga/shared/types/contracts/agent.types';

export const WORKFLOW_ACTION_CATALOG: AgentActionDefinition[] = Executor.readWorkflowActionCatalog() as AgentActionDefinition[];
