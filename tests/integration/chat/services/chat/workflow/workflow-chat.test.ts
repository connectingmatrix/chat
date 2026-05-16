import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installOrmForStub } from '@giga/shared/test/supabase-stub';
import { hydrateWorkflowDefinition, normalizeWorkflowText, resolveChatWorkflow } from '@connectingmatrix/chat/services/chat/workflow/runtime/workflow-chat';
import { workflowAgentDefaults } from '@connectingmatrix/chat/services/chat/io/query-chat-formatters';
import type { MockTableRow } from '@giga/shared/types/contracts/graphql.types';

function createSupabaseMock(tables: Record<string, MockTableRow[]>, missingTables: string[] = []) {
  const supabase = {
    from(tableName: string) {
      const filters: Array<{ column: string; value: any; match?: 'eq' | 'in' }> = [];

      return {
        select() {
          return this;
        },
        eq(column: string, value: any) {
          filters.push({ column, value });
          return this;
        },
        neq(column: string, value: any) {
          filters.push({ column, value, match: 'neq' as any });
          return this;
        },
        in(column: string, values: any[]) {
          filters.push({ column, value: values, match: 'in' });
          return this;
        },
        ilike(column: string, value: string) {
          filters.push({ column, value, match: 'ilike' as any });
          return this;
        },
        is(column: string, value: any) {
          filters.push({ column, value });
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        range() {
          return this;
        },
        async maybeSingle() {
          if (missingTables.includes(tableName)) {
            return {
              data: null,
              error: {
                code: '42P01',
                message: `relation "${tableName}" does not exist`,
              },
            };
          }

          const rows = tables[tableName] || [];
          const row =
            rows.find((candidate) =>
              filters.every(({ column, value, match }) =>
                match === 'in'
                  ? Array.isArray(value) && value.includes(candidate[column])
                  : match === 'neq'
                  ? candidate[column] !== value
                  : match === 'ilike'
                  ? String(candidate[column] || '')
                      .toLowerCase()
                      .includes(
                        String(value || '')
                          .replace(/%/g, '')
                          .toLowerCase(),
                      )
                  : candidate[column] === value,
              ),
            ) || null;

          return {
            data: row,
            error: null,
          };
        },
        then(resolve: (value: { data: any[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          const rows = missingTables.includes(tableName)
            ? []
            : (tables[tableName] || []).filter((candidate) =>
                filters.every(({ column, value, match }) =>
                  match === 'in'
                    ? Array.isArray(value) && value.includes(candidate[column])
                    : match === 'neq'
                    ? candidate[column] !== value
                    : match === 'ilike'
                    ? String(candidate[column] || '')
                        .toLowerCase()
                        .includes(
                          String(value || '')
                            .replace(/%/g, '')
                            .toLowerCase(),
                        )
                    : candidate[column] === value,
                ),
              );

          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
    },
  };
  installOrmForStub(supabase as any);
  return supabase;
}

function workflowRow(id: string, overrides: Record<string, any> = {}) {
  const workflow = {
    metadata: {
      id,
      name: `Workflow ${id}`,
    },
    nodes: [],
    connections: [],
  };
  return {
    id,
    is_active: true,
    status: 'published',
    user_id: null,
    organization_id: null,
    is_global: false,
    workflow,
    published_workflow: workflow,
    ...overrides,
  };
}

test('hydrateWorkflowDefinition exposes chat request data through workflow.input', () => {
  const workflow = hydrateWorkflowDefinition({
    workflow: { metadata: { id: 'workflow-1', name: 'Workflow 1' }, nodes: [], connections: [] } as any,
    chatId: 'chat-1',
    message: 'Hello',
    scope: { type: 'channel', id: 'channel-1', organizationId: null },
    scopeSnapshot: null,
    resolvedScope: {
      scope: { type: 'channel', id: 'channel-1', organizationId: null },
      snapshot: null,
      subject_ids: ['subject-1'],
      post_ids: ['post-1'],
    } as any,
    requestPayload: { tag_slugs: ['research'], subject_query: 'hello', top_k: 8, system_prompt: 'Use the workflow' },
  });

  assert.deepEqual(workflow.input, {
    chatId: 'chat-1',
    message: 'Hello',
    scope: { type: 'channel', id: 'channel-1' },
    subjectIds: ['subject-1'],
    postIds: ['post-1'],
    tagSlugs: ['research'],
    subjectQuery: 'hello',
    topK: 8,
    systemPrompt: 'Use the workflow',
    attachments: [],
    chatExecutionMode: null,
    confirmed: false,
    pendingPlan: null,
  });
});

test('normalizeWorkflowText extracts nested agent markdown and ignores object-string placeholders', () => {
  assert.equal(normalizeWorkflowText('[object Object]'), 'Workflow completed with no output.');
  assert.equal(
    normalizeWorkflowText({
      plan: { intent: 'ignore this plan text' },
      input1: {
        agentNode: {
          text: 'Chat Actions: post link is unsupported.',
          markdown: 'Chat Actions: post link is unsupported.',
        },
      },
    }),
    'Chat Actions: post link is unsupported.',
  );
});

test('workflowAgentDefaults extracts agent contract from workflow response envelopes', () => {
  const agent = workflowAgentDefaults({
    input1: {
      agentNode: {
        text: 'I can make these Giga changes after you confirm:',
        agent: {
          intent: 'Create a channel.',
          plan: { intent: 'Create a channel.', actions: [{ id: 'a1', name: 'create_channel', reason: 'Requested.', input: {}, depends_on: [] }] },
          action_results: [],
          response_format: 'confirmation_request',
          requires_confirmation: true,
          pending_actions: [{ id: 'a1', name: 'create_channel', reason: 'Requested.', input: {}, depends_on: [] }],
          pipeline_passes: [],
        },
      },
    },
  });

  assert.equal(agent?.requires_confirmation, true);
  assert.equal(agent?.response_format, 'confirmation_request');
  assert.equal(agent?.pending_actions?.length, 1);
});

test('resolveChatWorkflow prefers a user workflow assignment over the default workflow', async () => {
  const supabase = createSupabaseMock({
    ai_workflow_assignments: [
      {
        id: 'assign-user-1',
        user_id: 'user-1',
        organization_id: null,
        scope_type: 'SUBJECT',
        scope_id: 'subject-1',
        workflow_id: 'workflow-user-1',
      },
      {
        id: 'assign-default-1',
        user_id: null,
        organization_id: null,
        scope_type: 'SUBJECT',
        scope_id: null,
        workflow_id: 'workflow-default-1',
      },
    ],
    ai_workflows: [
      workflowRow('workflow-user-1', {
        user_id: 'user-1',
        organization_id: null,
      }),
      workflowRow('workflow-default-1', { is_global: true }),
    ],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'subject',
    id: 'subject-1',
  });

  assert.equal(resolved?.source, 'user');
  assert.equal(resolved?.assignmentId, 'assign-user-1');
  assert.equal(resolved?.workflowId, 'workflow-user-1');
});

test('resolveChatWorkflow prefers a user workflow assignment over an exact organization assignment', async () => {
  const supabase = createSupabaseMock({
    organizations: [{ id: 'org-1', is_active: true }],
    ai_workflow_assignments: [
      {
        id: 'assign-user-subject',
        user_id: 'user-1',
        organization_id: null,
        scope_type: 'SUBJECT',
        scope_id: 'subject-1',
        workflow_id: 'workflow-user-subject',
      },
      {
        id: 'assign-org-subject',
        user_id: null,
        organization_id: 'org-1',
        scope_type: 'SUBJECT',
        scope_id: 'subject-1',
        workflow_id: 'workflow-org-subject',
      },
    ],
    ai_workflows: [
      workflowRow('workflow-user-subject', { user_id: 'user-1', organization_id: null }),
      workflowRow('workflow-org-subject', { organization_id: 'org-1', is_global: false }),
    ],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'subject',
    id: 'subject-1',
    organizationId: 'org-1',
  });

  assert.equal(resolved?.source, 'user');
  assert.equal(resolved?.assignmentId, 'assign-user-subject');
  assert.equal(resolved?.workflowId, 'workflow-user-subject');
});

test('resolveChatWorkflow falls back to the default workflow when no user assignment exists', async () => {
  const supabase = createSupabaseMock({
    ai_workflow_assignments: [
      {
        id: 'assign-default-2',
        user_id: null,
        organization_id: null,
        scope_type: 'CATEGORY',
        scope_id: null,
        workflow_id: 'workflow-default-2',
      },
    ],
    ai_workflows: [workflowRow('workflow-default-2', { is_global: true })],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'category',
    id: 'category-1',
  });

  assert.equal(resolved?.source, 'globalDefault');
  assert.equal(resolved?.assignmentId, 'assign-default-2');
  assert.equal(resolved?.workflowId, 'workflow-default-2');
});

test('resolveChatWorkflow falls back to the organization type default before the global type default', async () => {
  const supabase = createSupabaseMock({
    organizations: [{ id: 'org-1', is_active: true }],
    ai_workflow_assignments: [
      {
        id: 'assign-org-default-subject',
        user_id: null,
        organization_id: 'org-1',
        scope_type: 'SUBJECT',
        scope_id: null,
        workflow_id: 'workflow-type-org-subject',
      },
      {
        id: 'assign-global-default-subject',
        user_id: null,
        organization_id: null,
        scope_type: 'SUBJECT',
        scope_id: null,
        workflow_id: 'workflow-type-global-subject',
      },
    ],
    ai_workflows: [
      workflowRow('workflow-type-org-subject', {
        organization_id: 'org-1',
        is_global: false,
      }),
      workflowRow('workflow-type-global-subject', { is_global: true }),
    ],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'subject',
    id: 'subject-1',
    organizationId: 'org-1',
  });

  assert.equal(resolved?.source, 'organizationDefault');
  assert.equal(resolved?.assignmentId, 'assign-org-default-subject');
  assert.equal(resolved?.workflowId, 'workflow-type-org-subject');
});

test('resolveChatWorkflow prefers an exact organization assignment before organization and global defaults', async () => {
  const supabase = createSupabaseMock({
    organizations: [{ id: 'org-1', is_active: true }],
    ai_workflow_assignments: [
      {
        id: 'assign-org-exact-subject',
        user_id: null,
        organization_id: 'org-1',
        scope_type: 'SUBJECT',
        scope_id: 'subject-1',
        workflow_id: 'workflow-org-exact-subject',
      },
      {
        id: 'assign-org-default-subject',
        user_id: null,
        organization_id: 'org-1',
        scope_type: 'SUBJECT',
        scope_id: null,
        workflow_id: 'workflow-org-default-subject',
      },
      {
        id: 'assign-global-default-subject',
        user_id: null,
        organization_id: null,
        scope_type: 'SUBJECT',
        scope_id: null,
        workflow_id: 'workflow-global-default-subject',
      },
    ],
    ai_workflows: [
      workflowRow('workflow-org-exact-subject', { organization_id: 'org-1', is_global: false }),
      workflowRow('workflow-org-default-subject', { organization_id: 'org-1', is_global: false }),
      workflowRow('workflow-global-default-subject', { is_global: true }),
    ],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'subject',
    id: 'subject-1',
    organizationId: 'org-1',
  });

  assert.equal(resolved?.source, 'organization');
  assert.equal(resolved?.assignmentId, 'assign-org-exact-subject');
  assert.equal(resolved?.workflowId, 'workflow-org-exact-subject');
});

test('resolveChatWorkflow returns null for inactive organizations', async () => {
  const supabase = createSupabaseMock({
    organizations: [{ id: 'org-1', is_active: false }],
    ai_workflow_assignments: [
      {
        id: 'assign-org-default-subject',
        user_id: null,
        organization_id: 'org-1',
        scope_type: 'SUBJECT',
        scope_id: null,
        workflow_id: 'workflow-type-org-subject',
      },
    ],
    ai_workflows: [
      workflowRow('workflow-type-org-subject', {
        organization_id: 'org-1',
        is_global: false,
      }),
    ],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'subject',
    id: 'subject-1',
    organizationId: 'org-1',
  });

  assert.equal(resolved, null);
});

test('resolveChatWorkflow falls back to the global type default when no exact assignment exists', async () => {
  const supabase = createSupabaseMock({
    ai_workflow_assignments: [
      {
        id: 'assign-global-default-post',
        user_id: null,
        organization_id: null,
        scope_type: 'POST',
        scope_id: null,
        workflow_id: 'workflow-type-global-post',
      },
    ],
    ai_workflows: [workflowRow('workflow-type-global-post', { is_global: true })],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'post',
    id: 'post-1',
  });

  assert.equal(resolved?.source, 'globalDefault');
  assert.equal(resolved?.assignmentId, 'assign-global-default-post');
  assert.equal(resolved?.workflowId, 'workflow-type-global-post');
});

test('resolveChatWorkflow prefers the published snapshot when a workflow is published', async () => {
  const supabase = createSupabaseMock({
    ai_workflow_assignments: [
      {
        id: 'assign-user-published',
        user_id: 'user-1',
        organization_id: null,
        scope_type: 'POST',
        scope_id: 'post-1',
        workflow_id: 'workflow-user-published',
      },
    ],
    ai_workflows: [
      {
        id: 'workflow-user-published',
        is_active: true,
        user_id: 'user-1',
        organization_id: null,
        is_global: false,
        status: 'published',
        workflow: {
          metadata: {
            id: 'workflow-user-published',
            name: 'Draft Workflow',
          },
          nodes: [],
          connections: [],
        },
        published_workflow: {
          metadata: {
            id: 'workflow-user-published',
            name: 'Published Workflow',
          },
          nodes: [],
          connections: [],
        },
      },
    ],
  });

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'post',
    id: 'post-1',
  });

  assert.equal(resolved?.workflow.metadata.name, 'Published Workflow');
});

test('resolveChatWorkflow returns null when workflow tables are not present yet', async () => {
  const supabase = createSupabaseMock({}, ['ai_workflow_assignments']);

  const resolved = await resolveChatWorkflow(supabase as any, 'user-1', {
    type: 'channel',
    id: 'channel-1',
  });

  assert.equal(resolved, null);
});
