import { BadRequestError } from 'routing-controllers';
import { Executor } from '@workflow/executor';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { optionalText, recordInput, requiredText, requireCapability } from '../runtime/helpers';
import { GigaActionOutput, emptyActionArtifacts } from '../contracts/types';
import { attachWorkflowIfRequested } from '../runtime/workflow-attachment';
import { saveChatWorkflowState, workflowEditorUrl, workflowShape } from '../auth/workflow-session';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';
import type { WorkflowRow } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowEntity';

async function ensureWorkflow(runtime: AgentActionRuntime, id: string) {
  const row = await WorkflowEntity.readOwnedRow({
    workflowId: id,
    currentUserId: runtime.userId,
  });
  if (!row) throw new BadRequestError('Workflow not found.');
  return row;
}

function publicWorkflowRow(row: any) {
  const { webhook_secret: _ignored, ...publicRow } = row || {};
  return publicRow;
}

export async function runUpdateWorkflowFromCypher(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_UPDATE_WORKFLOW', 'workflow update');
  const id = requiredText(input, 'id');
  const existing = await ensureWorkflow(runtime, id);
  const name = optionalText(input, 'name') || existing.name || 'Workflow';
  const description = optionalText(input, 'description') || existing.description || '';
  const cypher = requiredText(input, 'cypher');
  const compiled = Executor.compileWorkflowCypher({
    cypher,
    name,
    description,
    executable: recordInput(input).executable !== false,
    metadata: { id, chat_id: runtime.chatId, message: runtime.message },
  });
  if (!compiled.validation.ok) throw new BadRequestError(compiled.validation.errors.join(' '));
  const metadata = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata : {};
  const status =
    optionalText(input, 'status') || (optionalText(input, 'attach_scope_type') || optionalText(input, 'attachScopeType') ? 'published' : '');
  const publishedPatch: Pick<WorkflowRow, 'published_at' | 'published_workflow'> | Record<string, never> =
    status === 'published' ? { published_at: new Date().toISOString(), published_workflow: compiled.workflow as unknown as WorkflowDefinition } : {};
  const updates: Partial<WorkflowRow> = {
    name,
    description,
    workflow: compiled.workflow as unknown as WorkflowDefinition,
    metadata: { ...metadata, ...recordInput(input.metadata), workflow_cypher: cypher },
    status: status || undefined,
    updated_at: new Date().toISOString(),
    ...publishedPatch,
  };
  if (!updates.status) delete updates.status;
  const data = await WorkflowEntity.updateOwnedRow({
    workflowId: id,
    currentUserId: runtime.userId,
    patch: updates,
  });
  const publicRow = publicWorkflowRow(data);
  const assignment = await attachWorkflowIfRequested(runtime, input, publicRow.id);
  const shape = workflowShape(publicRow.workflow as WorkflowDefinition);
  if (runtime.chatId) {
    await saveChatWorkflowState(runtime, {
      workflow_id: publicRow.id,
      workflow_name: publicRow.name,
      workflow: publicRow.workflow as WorkflowDefinition,
      cypher,
    });
  }
  return {
    summary: `Updated workflow "${name}" from validated Cypher${
      assignment ? ' and attached it to the requested scope' : ''
    }. [Open workflow](${workflowEditorUrl(publicRow.id)}).`,
    data: {
      workflow: { ...publicRow, editor_url: workflowEditorUrl(publicRow.id), workflowId: publicRow.id, ...shape },
      workflow_id: publicRow.id,
      assignment,
      validation: compiled.validation,
    },
    ...emptyActionArtifacts,
  };
}
