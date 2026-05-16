import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nodeSourceShas from '@workflow/nodes/generated/node-source-shas.json';
import { buildWorkflowSearchText, createWorkflowSecret } from '@giga/general/services/graphql/resolvers/integration/base';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import { chatParityFixturePath, readChatParityFixture } from '@connectingmatrix/chat/services/chat/workflow/runtime/chat-parity-fixtures';
import { chatGraphql, LiveSession, liveSessionForUser } from './chat-giga-live.fixture';

const nodeSourceManifest = nodeSourceShas as { nodes?: Record<string, { sha?: string }> };

export async function attachPublishedParityWorkflow(input: {
  description: string;
  ids: { workflows: Set<string> };
  liveTest: string;
  scopeId: string;
  system: 'ai-agent' | 'legacy';
  userId: string;
}) {
  const workflows = await attachPublishedParityWorkflows(liveSessionForUser(input.userId), [input]);
  return { workflowId: workflows.get(input.scopeId) || '' };
}

export function chatParityWorkflowFixtureHash(system: 'ai-agent' | 'legacy') {
  return createHash('sha256')
    .update(readFileSync(chatParityFixturePath(system, 'cypher')))
    .update(JSON.stringify(nodeSourceManifest.nodes || {}))
    .digest('hex')
    .slice(0, 16);
}

const INSERT_WORKFLOWS = /* GraphQL */ `
  mutation InsertParityWorkflows($objects: [ai_workflowsInsertInput!]!) {
    insertIntoai_workflowsCollection(objects: $objects) {
      records {
        id
      }
    }
  }
`;
const INSERT_WORKFLOW_ASSIGNMENTS = /* GraphQL */ `
  mutation InsertParityWorkflowAssignments($objects: [ai_workflow_assignmentsInsertInput!]!) {
    insertIntoai_workflow_assignmentsCollection(objects: $objects) {
      records {
        id
        workflow_id
        scope_id
      }
    }
  }
`;
const UPDATE_WORKFLOW = /* GraphQL */ `
  mutation UpdateParityWorkflow($filter: ai_workflowsFilter, $set: ai_workflowsUpdateInput!) {
    updateai_workflowsCollection(filter: $filter, set: $set) {
      affectedCount
    }
  }
`;

export async function refreshPublishedParityWorkflows(
  session: LiveSession,
  inputs: Array<{ description: string; scopeId: string; system: 'ai-agent' | 'legacy'; workflowId: string }>,
) {
  const now = new Date().toISOString();
  await Promise.all(
    inputs.map(async (input) => {
      const fixture = readChatParityFixture(input.system);
      const workflowName = `${fixture.config.workflowName} Live ${input.scopeId.slice(0, 8)}`;
      const publishedWorkflow = normalizeWorkflowSnapshotIdentity({
        workflow: fixture.workflow,
        workflowId: input.workflowId,
        workflowName,
        workflowDescription: input.description,
        workflowScope: 'user',
      });
      await chatGraphql(session, UPDATE_WORKFLOW, {
        filter: { id: { eq: input.workflowId } },
        set: {
          description: input.description,
          metadata: {
            bootstrap_key: fixture.config.bootstrapKey,
            live_test: input.system,
            workflow_cypher: fixture.cypher,
            workflow_fixture_hash: chatParityWorkflowFixtureHash(input.system),
          },
          name: workflowName,
          published_at: now,
          published_workflow: publishedWorkflow,
          search_text: buildWorkflowSearchText(fixture.workflow, input.description),
          status: 'published',
          updated_at: now,
          workflow: fixture.workflow,
        },
      });
    }),
  );
}

export async function attachPublishedParityWorkflows(
  session: LiveSession,
  inputs: Array<{
    description: string;
    ids: { workflows: Set<string> };
    liveTest: string;
    scopeId: string;
    system: 'ai-agent' | 'legacy';
    userId: string;
  }>,
) {
  if (!inputs.length) return new Map<string, string>();
  const now = new Date().toISOString();
  const workflows = [];
  const assignments = [];
  const byScope = new Map<string, string>();
  for (const input of inputs) {
    const fixture = readChatParityFixture(input.system);
    const workflowId = randomUUID();
    const workflowName = `${fixture.config.workflowName} Live ${input.scopeId.slice(0, 8)}`;
    const publishedWorkflow = normalizeWorkflowSnapshotIdentity({
      workflow: fixture.workflow,
      workflowId,
      workflowName,
      workflowDescription: input.description,
      workflowScope: 'user',
    });
    input.ids.workflows.add(workflowId);
    byScope.set(input.scopeId, workflowId);
    workflows.push({
      id: workflowId,
      user_id: input.userId,
      name: workflowName,
      description: input.description,
      workflow: fixture.workflow,
      published_workflow: publishedWorkflow,
      published_at: now,
      metadata: {
        bootstrap_key: fixture.config.bootstrapKey,
        live_test: input.liveTest,
        workflow_cypher: fixture.cypher,
        workflow_fixture_hash: chatParityWorkflowFixtureHash(input.system),
      },
      status: 'published',
      search_text: buildWorkflowSearchText(fixture.workflow, input.description),
      webhook_secret: createWorkflowSecret(),
      is_active: true,
      created_at: now,
      updated_at: now,
    });
    assignments.push({
      id: randomUUID(),
      scope_type: 'CHANNEL',
      scope_id: input.scopeId,
      user_id: input.userId,
      organization_id: null,
      workflow_id: workflowId,
      metadata: { bootstrap_key: fixture.config.bootstrapKey, live_test: input.liveTest },
      created_at: now,
      updated_at: now,
    });
  }
  await chatGraphql(session, INSERT_WORKFLOWS, { objects: workflows });
  await chatGraphql(session, INSERT_WORKFLOW_ASSIGNMENTS, { objects: assignments });
  return byScope;
}
