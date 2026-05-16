import { randomUUID } from 'node:crypto';
import { BadRequestError } from 'routing-controllers';
import { Executor } from '@workflow/executor';
import { createWorkflowSecret, buildWorkflowSearchText } from '@giga/general/services/graphql/resolvers/integration/base';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { GigaActionOutput, emptyActionArtifacts } from '../contracts/types';
import { saveChatWorkflowState, workflowEditorUrl, workflowShape } from '../auth/workflow-session';
import { optionalText, recordInput, requiredText, requireCapability } from './helpers';
import { attachWorkflowIfRequested } from './workflow-attachment';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

function requestedModelIds(input: any) {
  const ids = recordInput(input).model_ids;
  return Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
}

function compiledFromInput(runtime: AgentActionRuntime, input: any) {
  const compiled = Executor.compileWorkflowCypher({
    cypher: requiredText(input, 'cypher'),
    name: optionalText(input, 'name') || 'Workflow',
    description: optionalText(input, 'description') || '',
    executable: recordInput(input).executable !== false,
    metadata: { chat_id: runtime.chatId, message: runtime.message },
  });
  if (!compiled.validation.ok) throw new BadRequestError(compiled.validation.errors.join(' '));
  return compiled;
}

function publicWorkflowRow(row: any) {
  const { webhook_secret: _ignored, ...publicRow } = row || {};
  return publicRow;
}

export async function runFetchWorkflowNodeCatalog(runtime: AgentActionRuntime): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow read');
  const catalog = Executor.readWorkflowNodeCatalog();
  return { summary: `Fetched ${catalog.length} workflow node definitions.`, data: { catalog }, ...emptyActionArtifacts };
}

export async function runFetchWorkflowNodeDetails(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow read');
  const details = Executor.readWorkflowNodeDetails(requestedModelIds(input));
  return { summary: `Fetched ${details.length} workflow node source bundle(s).`, data: { nodes: details }, ...emptyActionArtifacts };
}

export async function runValidateWorkflowCypher(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow read');
  const compiled = Executor.compileWorkflowCypher({
    cypher: requiredText(input, 'cypher'),
    name: optionalText(input, 'name') || 'Workflow',
    description: optionalText(input, 'description') || '',
    executable: recordInput(input).executable !== false,
    metadata: { chat_id: runtime.chatId, message: runtime.message },
  });
  return {
    summary: compiled.validation.ok ? 'Workflow Cypher is valid.' : 'Workflow Cypher has validation errors.',
    data: compiled,
    ...emptyActionArtifacts,
  };
}

export async function runCreateWorkflowFromCypher(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_CREATE_WORKFLOW', 'workflow create');
  const compiled = compiledFromInput(runtime, input);
  const name = optionalText(input, 'name') || compiled.workflow.metadata.name || 'Workflow';
  const description = optionalText(input, 'description') || '';
  const workflowId = optionalText(input, 'id') || randomUUID();
  const status =
    optionalText(input, 'status') || (optionalText(input, 'attach_scope_type') || optionalText(input, 'attachScopeType') ? 'published' : 'draft');
  const published = status === 'published';
  compiled.workflow.metadata = { ...compiled.workflow.metadata, id: workflowId };
  const row = {
    id: workflowId,
    user_id: runtime.userId,
    name,
    description,
    workflow: compiled.workflow,
    published_at: published ? new Date().toISOString() : null,
    published_workflow: published ? compiled.workflow : null,
    metadata: { ...recordInput(input.metadata), workflow_cypher: requiredText(input, 'cypher') },
    status,
    search_text: buildWorkflowSearchText(compiled.workflow as unknown as WorkflowDefinition, description),
    webhook_secret: createWorkflowSecret(),
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const data = await WorkflowEntity.create(row);
  const publicRow = publicWorkflowRow(data);
  const assignment = await attachWorkflowIfRequested(runtime, input, publicRow.id);
  const shape = workflowShape(publicRow.workflow as WorkflowDefinition);
  if (runtime.chatId) {
    await saveChatWorkflowState(runtime, {
      workflow_id: publicRow.id,
      workflow_name: publicRow.name,
      workflow: publicRow.workflow as WorkflowDefinition,
      cypher: requiredText(input, 'cypher'),
    });
  }
  return {
    summary: `Created workflow "${name}" from validated Cypher${
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
