import { safeJsonParse } from 'giga-ai-helper';
import { Executor } from '@workflow/executor';
import { createWorkflowAuthoringChatPlan, WorkflowAuthoringChatPlan } from '@workflow/nodes/nodes/ai-agent/workflow-authoring-chat';
import { hasWorkflowEditIntent, isWorkflowAuthoringMessage } from '@workflow/nodes/nodes/ai-agent/workflow-authoring';
import { AgentActionDefinition, AgentActionName, AgentConversationContext, AgentExecutionPlan } from '@giga/shared/types/contracts/agent.types';
import { openai } from '@giga/shared/services/common/openai-client';
import { openAIResponsesModelProfile } from '@connectingmatrix/ai-agents/services/ai-agents/io/model-profile';

export { hasWorkflowEditIntent, isWorkflowAuthoringMessage };

const adaptWorkflowPlan = (plan: WorkflowAuthoringChatPlan): AgentExecutionPlan => ({
  intent: plan.intent,
  actions: plan.actions.map((action) => ({ ...action, name: action.name as AgentActionName, depends_on: action.depends_on || [] })),
});

export async function createWorkflowAuthoringPlan(input: {
  message: string;
  context?: AgentConversationContext;
  availableActions: AgentActionDefinition[];
}): Promise<AgentExecutionPlan> {
  const plan = await createWorkflowAuthoringChatPlan({
    message: input.message,
    context: input.context,
    availableActions: input.availableActions,
    plannerContext: Executor.readWorkflowPlannerContext(input.message),
    requestJson: async (prompt, repairReason) => {
      const response = await openai.responses.create({
        ...openAIResponsesModelProfile(),
        temperature: repairReason ? 0 : 0.05,
        instructions: 'Return strict JSON only. Do not use markdown fences. Do not use create_workflow or raw workflow JSON.',
        input: prompt,
      });
      return safeJsonParse(String(response.output_text || ''));
    },
  });
  return adaptWorkflowPlan(plan);
}
