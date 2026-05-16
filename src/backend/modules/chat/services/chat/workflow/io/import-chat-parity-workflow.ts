import { randomUUID } from 'node:crypto';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities';
import { buildWorkflowSearchText, createWorkflowSecret } from '@giga/general/services/graphql/resolvers/integration/base';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import { readChatParityFixture } from '../runtime/chat-parity-fixtures';

export async function importLatestChatParityAiAgentWorkflow(userId: string): Promise<{ workflowId: string; name: string; description: string }> {
  const fixture = readChatParityFixture('ai-agent');
  const workflowId = randomUUID();
  const now = new Date().toISOString();
  const name = `${fixture.config.workflowName} Cypress ${Date.now().toString(36)}`;
  const description = `${fixture.config.workflowName} fixture.`;
  const workflow = normalizeWorkflowSnapshotIdentity({
    workflow: fixture.workflow,
    workflowId,
    workflowName: name,
    workflowDescription: description,
    workflowScope: 'user',
  });
  if (!workflow) throw new Error('Could not prepare the latest AI Agent workflow fixture.');
  await WorkflowEntity.create({
    id: workflowId,
    user_id: userId,
    name,
    description,
    workflow,
    published_workflow: workflow,
    published_at: now,
    metadata: { bootstrap_key: fixture.config.bootstrapKey, workflow_cypher: fixture.cypher, source: 'workflow-fixture-import' },
    status: 'published',
    search_text: buildWorkflowSearchText(workflow, description),
    webhook_secret: createWorkflowSecret(),
    is_active: true,
    created_at: now,
    updated_at: now,
  });
  return { workflowId, name, description };
}
