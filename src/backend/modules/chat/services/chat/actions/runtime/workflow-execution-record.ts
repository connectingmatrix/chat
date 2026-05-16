import { cloneJson } from 'giga-ai-helper';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function persistChatWorkflowExecution(
  runtime: AgentActionRuntime,
  input: {
    actionInput: unknown;
    error?: string | null;
    output?: unknown;
    result?: Record<string, unknown> | null;
    runId: string;
    startedAt: number;
    workflow: WorkflowDefinition;
    workflowId?: string | null;
  },
) {
  if (!input.workflowId) return null;
  const completedAt = new Date().toISOString();
  const scope = runtime.context.scope || { scope_type: null, scope_id: null };
  const responsePayload = input.error
    ? { error: input.error }
    : {
        terminal_payload: input.output ?? null,
        text: typeof input.output === 'string' ? input.output : JSON.stringify(input.output ?? null),
        workflow_editor_url: `/workflows/${input.workflowId}/edit`,
      };
  return WorkflowExecutionEntity.createFromChatRun({
    userId: runtime.userId,
    chatId: runtime.chatId,
    scopeType: scope.scope_type || null,
    scopeId: scope.scope_id || null,
    workflowId: input.workflowId,
    runId: input.runId,
    status: input.error ? 'failed' : 'completed',
    errorMessage: input.error || null,
    logs: cloneJson((recordValue(input.result).logs as unknown[]) || []),
    requestPayload: cloneJson({ action_input: input.actionInput || {}, run_id: input.runId }),
    responsePayload: cloneJson(responsePayload),
    workflowSnapshot: normalizeWorkflowSnapshotIdentity({
      workflow: input.workflow,
      workflowId: input.workflowId,
    }),
    durationMs: Date.now() - input.startedAt,
    completedAt,
  });
}
