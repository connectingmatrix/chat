import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities';
import type { ResolvedChatWorkflow } from '@giga/shared/types/contracts/graphql.types';

export async function resolveExplicitChatWorkflow(workflowId: string, assignmentId: string): Promise<ResolvedChatWorkflow | null> {
  const workflow = await WorkflowEntity.find({ id: workflowId, is_active: true }).single();
  const definition = workflow?.published_workflow || workflow?.workflow || null;
  if (!workflow?.id || !definition) return null;
  const source = workflow.is_global ? 'global' : workflow.organization_id ? 'organization' : 'user';
  return { assignmentId, source, workflowId: workflow.id, workflow: definition } as ResolvedChatWorkflow;
}
