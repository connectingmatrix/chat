import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowEntity';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowExecutionEntity';
import { WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowVersionEntity';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { GigaActionOutput, emptyActionArtifacts } from '../contracts/types';
import { optionalText, recordInput, requiredText, requireCapability } from '../runtime/helpers';
import { assertGlobalWorkflowRead, workflowExcerpt, workflowReadScope } from './workflow-read';

export async function runFetchWorkflowRuns(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow run read');
  await assertGlobalWorkflowRead(runtime, input);
  const workflowId = requiredText(input, 'workflow_id');
  const scope = workflowReadScope(input) === 'global' ? 'global' : workflowReadScope(input) === 'organization' ? 'organization' : 'user';
  const reference = await WorkflowEntity.resolveReference({
    workflowId,
    scope,
    currentUserId: runtime.userId,
    organizationId: optionalText(input, 'organization_id') || null,
  });
  if (!reference) throw new Error('Workflow not found for the requested scope.');
  const executions = await WorkflowExecutionEntity.findByWorkflowId(workflowId);
  const versions = await WorkflowVersionEntity.findByWorkflowId(workflowId);
  const versionById = versions.reduce((acc, row: any) => {
    const key = String(row.id || '').trim();
    if (key) acc[key] = Number(row.version_number || row.version || 1);
    return acc;
  }, {} as Record<string, number>);
  const { filter } = recordInput(input);
  const statusFilter = String(recordInput(filter).status || '')
    .trim()
    .toLowerCase();
  const rows = executions
    .filter((run: any) => {
      if (!statusFilter) return true;
      return (
        String(run.status || '')
          .trim()
          .toLowerCase() === statusFilter
      );
    })
    .map((run: any) => ({
      id: run.id,
      workflowId: run.workflow_id,
      workflowVersionLabel:
        run.workflow_version_id && versionById[String(run.workflow_version_id || '')]
          ? `v${versionById[String(run.workflow_version_id || '')]}`
          : null,
      status: run.status,
      runId: run.run_id || null,
      triggerType: run.trigger_type || null,
      errorMessage: run.error_message || null,
      createdAt: run.created_at || null,
      completedAt: run.completed_at || null,
      durationMs: Number.isFinite(Number(run.duration_ms)) ? Number(run.duration_ms) : null,
      output_excerpt: run.response_payload ? workflowExcerpt(run.response_payload) : null,
    }));
  return { summary: `Fetched ${rows.length} workflow run(s).`, data: { runs: rows }, ...emptyActionArtifacts };
}

export async function runFetchWorkflowRevisions(runtime: AgentActionRuntime, input: any): Promise<GigaActionOutput> {
  await requireCapability(runtime, 'CAN_READ_WORKFLOW', 'workflow revision read');
  await assertGlobalWorkflowRead(runtime, input);
  const workflowId = requiredText(input, 'workflow_id');
  const scope = workflowReadScope(input) === 'global' ? 'global' : workflowReadScope(input) === 'organization' ? 'organization' : 'user';
  const reference = await WorkflowEntity.resolveReference({
    workflowId,
    scope,
    currentUserId: runtime.userId,
    organizationId: optionalText(input, 'organization_id') || null,
  });
  if (!reference) throw new Error('Workflow not found for the requested scope.');
  const versions = await WorkflowVersionEntity.findByWorkflowId(workflowId);
  const executionRows = await WorkflowExecutionEntity.listVersionIdRows(versions.map((row: any) => String(row.id || '').trim()).filter(Boolean));
  const executionCountByVersionId = executionRows.reduce((acc, row: any) => {
    const key = String(row.workflow_version_id || '').trim();
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const rows = versions.map((row: any) => ({
    id: row.id,
    workflowId: row.workflow_id,
    label: row.workflow_name || null,
    versionNumber: Number(row.version_number || row.version || 1),
    isCurrent: row.is_current === true,
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    executionCount: executionCountByVersionId[String(row.id || '')] || 0,
    name: row.workflow_snapshot?.metadata?.name || null,
    description: row.workflow_snapshot?.metadata?.description || null,
  }));
  return { summary: `Fetched ${rows.length} workflow revision(s).`, data: { revisions: rows }, ...emptyActionArtifacts };
}
