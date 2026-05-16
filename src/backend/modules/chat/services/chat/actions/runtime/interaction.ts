import { AgentExecutionPlan, AgentInteraction } from '@giga/shared/types/contracts/agent.types';
import { actionDisplayLabel, actionReasonText, normalizePendingPlan } from './confirmation';

function actionLines(plan: AgentExecutionPlan) {
  const lines: string[] = [];
  for (const action of normalizePendingPlan(plan).actions) {
    lines.push(`- ${actionDisplayLabel(action)}: ${actionReasonText(action)}`);
  }
  return lines.join('\n');
}

function jsonContent(value: Record<string, unknown> | null | undefined) {
  if (!value) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function workflowCypher(plan: AgentExecutionPlan, cypher?: string | null) {
  if (cypher) return cypher;
  for (const action of plan.actions) {
    const plannedCypher = String((action.input as any)?.cypher || '').trim();
    if (plannedCypher) return plannedCypher;
  }
  return '';
}

export function buildConfirmationInteraction(
  plan: AgentExecutionPlan,
  input: { workflowCypher?: string | null; workflowValidation?: Record<string, unknown> | null } = {},
): AgentInteraction {
  const normalizedPlan = normalizePendingPlan(plan);
  const plannedCypher = workflowCypher(plan, input.workflowCypher);
  const validation = jsonContent(input.workflowValidation);
  const sections: NonNullable<AgentInteraction['sections']> = [
    {
      id: 'planned-actions',
      title: 'Planned actions',
      content_type: 'markdown' as const,
      content: actionLines(plan),
      default_collapsed: false,
    },
  ];

  if (plannedCypher) {
    sections.push({
      id: 'workflow-cypher',
      title: 'Workflow Cypher',
      content_type: 'cypher',
      content: plannedCypher,
      default_collapsed: true,
    });
  }
  if (validation) {
    sections.push({
      id: 'workflow-validation',
      title: 'Workflow validation',
      content_type: 'json',
      content: validation,
      default_collapsed: true,
    });
  }

  return {
    kind: 'confirmation',
    title: 'Review and confirm',
    summary: `I need your approval before changing Giga. I will run ${normalizedPlan.actions.length} planned action${
      normalizedPlan.actions.length === 1 ? '' : 's'
    }.`,
    selection: {
      mode: 'multi',
      key: 'pending_actions',
      label: 'Pending actions',
      options: normalizedPlan.actions.map((action) => ({
        id: String(action.id || action.name || 'action'),
        label: actionDisplayLabel(action),
        description: actionReasonText(action),
        value: String(action.id || action.name || 'action'),
      })),
      value: normalizedPlan.actions.map((action) => String(action.id || action.name || 'action')),
    },
    options: [
      {
        id: 'confirm',
        label: 'Confirm',
        description: 'Execute the pending actions.',
        message: 'confirm',
        style: 'primary',
      },
      {
        id: 'cancel',
        label: 'Cancel',
        description: 'Discard the pending actions.',
        message: 'cancel',
        style: 'secondary',
      },
    ],
    free_text: null,
    sections,
  };
}
