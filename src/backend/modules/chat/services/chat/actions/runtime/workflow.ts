import { randomUUID } from 'node:crypto';
import { BadRequestError } from 'routing-controllers';
import { createWorkflowSecret, buildWorkflowSearchText } from '@giga/general/services/graphql/resolvers/integration/base';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { GigaActionOutput, emptyActionArtifacts } from '../contracts/types';
import { loadChatWorkflowState, workflowEditorUrl, workflowShape } from '../auth/workflow-session';
import { optionalText, recordInput, requiredText, requireCapability, resolveActionReference, resultId } from './helpers';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

const blankWorkflow = (name: string): WorkflowDefinition => ({ metadata: { id: randomUUID(), name }, nodes: [], connections: [] });

async function loadWorkflow(runtime: AgentActionRuntime, id: string) {
  const row = await WorkflowEntity.readOwnedRow({
    workflowId: id,
    currentUserId: runtime.userId,
  });
  if (!row) throw new BadRequestError('Workflow not found.');
  return row;
}

export async function workflowFromInput(runtime: AgentActionRuntime, input: any) {
  return (await workflowRecordFromInput(runtime, input)).workflow;
}

export async function workflowRecordFromInput(runtime: AgentActionRuntime, input: any) {
  const workflowId = resolveActionReference(runtime, optionalText(input, 'workflow_id') || '');
  const workflowActionId = optionalText(input, 'workflow_action_id');
  if (workflowActionId) {
    const result = runtime.resultsById?.[workflowActionId];
    const resultData = recordInput(result?.data);
    const workflowRow = resultData.workflow as any;
    const workflow = workflowRow?.workflow || workflowRow;
    const resultWorkflowId = optionalText(workflowRow, 'id') || optionalText(resultData, 'workflow_id');
    if (workflow && Array.isArray(workflow.nodes) && Array.isArray(workflow.connections)) {
      return {
        id: resultWorkflowId || optionalText(input, 'workflow_id') || null,
        name: optionalText(workflowRow, 'name') || optionalText(input, 'name') || workflow?.metadata?.name || null,
        row: workflowRow,
        workflow: workflow as WorkflowDefinition,
      };
    }
    if (resultWorkflowId) {
      const row = await loadWorkflow(runtime, resultWorkflowId);
      const resolvedWorkflow = (row.published_workflow || row.workflow) as WorkflowDefinition;
      return { id: row.id, name: row.name || resolvedWorkflow.metadata?.name || null, row, workflow: resolvedWorkflow };
    }
  }
  const state = !workflowId ? await loadChatWorkflowState(runtime.supabase, runtime.chatId, runtime.userId) : {};
  const resolvedWorkflowId = workflowId || String(state.last_workflow_id || '').trim();
  if (!resolvedWorkflowId) {
    const created = Object.values(runtime.resultsById || {})
      .filter((result) => result.name === 'create_workflow_from_cypher' && result.status === 'completed')
      .pop();
    const workflowRow = recordInput(created?.data).workflow as any;
    const workflow = workflowRow?.workflow || workflowRow || recordInput(input).workflow;
    if (workflow) {
      return {
        id: optionalText(workflowRow, 'id') || null,
        name: optionalText(workflowRow, 'name') || workflow?.metadata?.name || null,
        row: workflowRow,
        workflow: workflow as WorkflowDefinition,
      };
    }
    throw new BadRequestError('workflow_id or workflow_action_id is required.');
  }
  const row = await loadWorkflow(runtime, resolvedWorkflowId);
  const workflow = (row.published_workflow || row.workflow) as WorkflowDefinition;
  return { id: row.id, name: row.name || workflow.metadata?.name || null, row, workflow };
}

export async function runCreateWorkflow(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_CREATE_WORKFLOW', 'workflow create');
  const name = requiredText(input, 'name');
  const description = optionalText(input, 'description') || '';
  const workflow = (recordInput(input).workflow || blankWorkflow(name)) as WorkflowDefinition;
  const workflowId = optionalText(input, 'id') || randomUUID();
  workflow.metadata = { ...(workflow.metadata || {}), id: workflowId, name, description };
  const row = {
    id: workflowId,
    user_id: runtime.userId,
    name,
    description,
    workflow,
    metadata: recordInput(input.metadata),
    status: optionalText(input, 'status') || 'draft',
    search_text: buildWorkflowSearchText(workflow, description),
    webhook_secret: createWorkflowSecret(),
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const data = await WorkflowEntity.create(row);
  const created = data.extract() as Record<string, unknown>;
  const shape = workflowShape(created.workflow as WorkflowDefinition);
  return {
    summary: `Created workflow "${name}". [Open workflow](${workflowEditorUrl(data.id)}).`,
    data: { workflow: { ...created, editor_url: workflowEditorUrl(String(created.id || data.id || '')), ...shape } },
    ...emptyActionArtifacts,
  };
}

export async function runUpdateWorkflow(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_UPDATE_WORKFLOW', 'workflow update');
  const id = requiredText(input, 'id');
  const existing = await loadWorkflow(runtime, id);
  const updates = { ...recordInput(input), updated_at: new Date().toISOString() };
  if (recordInput(updates.workflow).metadata || updates.workflow) {
    const workflow = (recordInput(updates.workflow) || existing.workflow) as WorkflowDefinition;
    workflow.metadata = {
      ...(workflow.metadata || {}),
      id,
      name: optionalText(input, 'name') || existing.name || workflow.metadata?.name || 'Workflow',
      description: optionalText(input, 'description') || existing.description || workflow.metadata?.description || '',
    };
    updates.workflow = workflow;
  }
  delete updates.id;
  const data = await WorkflowEntity.updateOwnedRow({
    workflowId: id,
    currentUserId: runtime.userId,
    patch: updates,
  });
  return { summary: `Updated workflow ${id}.`, data: { workflow: data.extract() as Record<string, unknown> }, ...emptyActionArtifacts };
}

export async function runDeleteWorkflow(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_DELETE_WORKFLOW', 'workflow delete');
  const inputId = optionalText(input, 'id') || optionalText(input, 'workflow_id') || '';
  const actionId = runtime.resultsById?.[inputId] ? inputId : optionalText(input, 'workflow_action_id') || '';
  const id = actionId ? resultId(runtime, actionId) : resolveActionReference(runtime, inputId);
  if (!id) throw new BadRequestError('workflow id or workflow_action_id is required.');
  await loadWorkflow(runtime, id);
  await WorkflowEntity.deleteOwnedRow({
    workflowId: id,
    currentUserId: runtime.userId,
  });
  return { summary: 'Deleted 1 workflow row(s).', data: { deleted: [id] }, ...emptyActionArtifacts };
}
