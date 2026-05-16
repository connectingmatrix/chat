import { BadRequestError } from 'routing-controllers';
import { Executor } from '@workflow/executor';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { OrganisationEntity, WorkflowEntity, WorkflowExecutionEntity, WorkflowRow } from '@connectingmatrix/orm/repositories/entities';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { GigaActionOutput, emptyActionArtifacts } from '../contracts/types';
import { optionalText, recordInput, requireCapability } from '../runtime/helpers';
import { loadChatWorkflowState, saveChatWorkflowState, workflowEditorUrl, workflowShape } from '../auth/workflow-session';

const MAX_EXCERPT = 1200;
const WORKFLOW_LIST_COLUMNS = 'id,name,description,organization_id,is_global,status,is_active,created_at,updated_at';

export function workflowExcerpt(value: unknown, limit = MAX_EXCERPT) {
  return Executor.readWorkflowExcerpt(value, limit);
}

export function workflowReadScope(input: any) {
  return optionalText(input, 'scope') || (optionalText(input, 'organization_id') ? 'organization' : 'user');
}

function workflowRow(row: any) {
  return {
    id: row.id,
    name: row.name || null,
    description: row.description || null,
    scope: row.organization_id ? 'organization' : row.is_global ? 'global' : 'user',
    organization_id: row.organization_id || null,
    status: row.status || null,
    is_active: row.is_active !== false,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function assertOrganizationAccess(runtime: AgentActionRuntime, organizationId?: string) {
  if (!organizationId) return;
  await OrganisationEntity.requireAccess({ userId: runtime.userId, organizationId });
}

async function workflowQuery(runtime: AgentActionRuntime, input: any) {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow read');
  const organizationId = optionalText(input, 'organization_id');
  await assertOrganizationAccess(runtime, organizationId);
  const scope = workflowReadScope(input);
  if (workflowReadScope(input) === 'global') {
    if (!(await isCurrentUserRootUser(runtime.supabase))) throw new BadRequestError('Global workflow reads require root access.');
  }
  const id = optionalText(input, 'id');
  const name =
    optionalText(input, 'name') || optionalText(input, 'workflow_name') || optionalText(input, 'workflowName') || optionalText(input, 'query');
  return WorkflowEntity.listReadableRows({
    scope: scope as 'global' | 'organization' | 'user',
    userId: runtime.userId,
    organizationId,
  }).then((rows) => {
    if (id) return rows.filter((row) => String(row.id || '') === id);
    if (!name) return rows;
    const pattern = name.toLowerCase();
    return rows.filter((row) =>
      String(row.name || '')
        .toLowerCase()
        .includes(pattern),
    );
  });
}

async function workflowListQuery(runtime: AgentActionRuntime, input: any) {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow read');
  const organizationId = optionalText(input, 'organization_id');
  await assertOrganizationAccess(runtime, organizationId);
  const scope = workflowReadScope(input);
  if (workflowReadScope(input) === 'global') {
    if (!(await isCurrentUserRootUser(runtime.supabase))) throw new BadRequestError('Global workflow reads require root access.');
  }
  return WorkflowEntity.listReadableRows({
    scope: scope as 'global' | 'organization' | 'user',
    userId: runtime.userId,
    organizationId,
    select: WORKFLOW_LIST_COLUMNS,
  });
}

export async function assertGlobalWorkflowRead(runtime: AgentActionRuntime, input: any) {
  if (workflowReadScope(input) !== 'global') return;
  if (await isCurrentUserRootUser(runtime.supabase)) return;
  throw new BadRequestError('Global workflow reads require root access.');
}

export async function runFetchAllWorkflows(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  const rows = await workflowListQuery(runtime, input);
  const workflows = rows.map((row) => workflowRow(row.extract() as WorkflowRow));
  if (recordInput(input).include_global === true && (await isCurrentUserRootUser(runtime.supabase))) {
    const globalRows = await WorkflowEntity.listReadableRows({
      scope: 'global',
      userId: runtime.userId,
      select: WORKFLOW_LIST_COLUMNS,
    });
    workflows.push(...globalRows.map((row) => workflowRow(row.extract() as WorkflowRow)));
  }
  return { summary: `Fetched ${workflows.length} workflow(s).`, data: { workflows }, ...emptyActionArtifacts };
}

export async function runFetchWorkflow(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  const explicitId = optionalText(input, 'id');
  const query =
    optionalText(input, 'query') || optionalText(input, 'name') || optionalText(input, 'workflow_name') || optionalText(input, 'workflowName');
  const state = explicitId || query ? {} : await loadChatWorkflowState(runtime.supabase, runtime.chatId, runtime.userId);
  const id = explicitId || String(state.last_workflow_id || '').trim();
  if (!id && !query) throw new BadRequestError('Workflow id or workflow query is required because this chat has no previous workflow context.');
  const source = id ? { ...recordInput(input), id } : { ...recordInput(input), name: query };
  const rows = await workflowQuery(runtime, source);
  const row = (rows[0]?.extract() as WorkflowRow | undefined) || null;
  if (!row) throw new BadRequestError('Workflow not found.');
  const workflowDefinition = row.published_workflow || row.workflow;
  const shape = workflowShape(workflowDefinition);
  const latestRun = await WorkflowExecutionEntity.latestByWorkflowAndChat(String(row.id || ''), runtime.chatId || null);
  const workflow = {
    ...workflowRow(row),
    editor_url: workflowEditorUrl(row.id),
    ...shape,
    metadata: row.metadata || {},
    workflow_excerpt: workflowExcerpt(row.workflow),
    published_workflow_excerpt: row.published_workflow ? workflowExcerpt(row.published_workflow) : null,
    published_at: row.published_at || null,
    latest_run: latestRun,
  };
  if (runtime.chatId) {
    await saveChatWorkflowState(runtime, {
      workflow_id: row.id,
      workflow_name: row.name,
      workflow: workflowDefinition,
      execution_id: latestRun?.id || null,
      run_id: latestRun?.run_id || null,
      output: latestRun?.response_payload ? (latestRun.response_payload as any).terminal_payload : undefined,
      cypher: String((row.metadata as Record<string, unknown> | null | undefined)?.workflow_cypher || '') || null,
    });
  }
  return {
    summary: `Fetched workflow "${workflow.name || workflow.id}" with ${workflow.node_count} node(s). [Open workflow](${workflow.editor_url}).`,
    data: { workflow },
    ...emptyActionArtifacts,
  };
}
