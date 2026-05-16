import { requireWorkflowScopeType } from '@giga/general/services/graphql/resolvers/integration/base';
import { WorkflowAssignmentEntity } from '@connectingmatrix/orm/repositories/entities';
import { RESOURCE_TYPES } from '@giga/shared/types/contracts/graph.types';
import { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import { optionalText, recordInput, resolvePostId, resolveTreeNodeId } from './helpers';

const attachScopeType = (input: any) => {
  const requested = optionalText(input, 'attach_scope_type') || optionalText(input, 'attachScopeType');
  return requested ? requireWorkflowScopeType(requested) : null;
};

const treeNodeType = (scopeType: 'CHANNEL' | 'CATEGORY' | 'SUBJECT') => {
  if (scopeType === 'CHANNEL') return RESOURCE_TYPES.channel;
  if (scopeType === 'CATEGORY') return RESOURCE_TYPES.category;
  return RESOURCE_TYPES.subject;
};

const attachScopeId = async (runtime: AgentActionRuntime, input: any, scopeType: 'CHANNEL' | 'CATEGORY' | 'SUBJECT' | 'POST') => {
  const scopeId =
    optionalText(input, 'attach_scope_id') ||
    optionalText(input, 'attachScopeId') ||
    optionalText(input, 'scope_id') ||
    optionalText(input, 'scopeId');
  if (scopeId) return scopeId;
  const scopeName =
    optionalText(input, 'attach_scope_name') ||
    optionalText(input, 'attachScopeName') ||
    optionalText(input, 'scope_name') ||
    optionalText(input, 'scopeName');
  if (scopeType === 'POST') {
    return resolvePostId(
      runtime,
      { ...recordInput(input), title: scopeName },
      {
        idKeys: ['attach_scope_id', 'attachScopeId', 'scope_id', 'scopeId', 'post_id'],
        titleKeys: ['attach_scope_name', 'attachScopeName', 'scope_name', 'scopeName', 'post_title', 'title'],
      },
    );
  }
  return resolveTreeNodeId(
    runtime,
    { ...recordInput(input), name: scopeName },
    {
      idKey: 'attach_scope_id',
      label: scopeType.toLowerCase(),
      nameKeys: ['attach_scope_name', 'attachScopeName', 'scope_name', 'scopeName', 'name'],
      nodeType: treeNodeType(scopeType),
      preferScopedRoot: true,
    },
  );
};

export const publishWorkflowPatch = (workflow: unknown, status: string) => {
  if (status !== 'published') return {};
  const now = new Date().toISOString();
  return { published_at: now, published_workflow: workflow };
};

export const attachWorkflowIfRequested = async (runtime: AgentActionRuntime, input: any, workflowId: string) => {
  const scopeType = attachScopeType(input);
  if (!scopeType) return null;
  const scopeId = await attachScopeId(runtime, input, scopeType);
  const organizationId = optionalText(input, 'organization_id') || optionalText(input, 'organizationId') || null;
  const ownerUserId = organizationId ? null : runtime.userId;
  return WorkflowAssignmentEntity.upsertScopedWorkflow({
    workflowId,
    scopeType,
    scopeId,
    userId: ownerUserId,
    organizationId,
    metadata: recordInput(input.metadata),
  });
};
