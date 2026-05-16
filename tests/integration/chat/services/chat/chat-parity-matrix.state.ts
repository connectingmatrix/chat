import { chatGraphql, LiveSession, liveSessionForUser } from './chat-giga-live.fixture';
import { LIVE_CHAT_USER_ID } from './chat-giga-live.queries';

type SessionRef = LiveSession | string;
type WorkflowExecutionRow = {
  chat_session_id?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  id?: string;
  logs?: unknown;
  response_payload?: unknown;
  run_id?: string | null;
  status?: string | null;
  workflow_id?: string | null;
};
type WorkflowRow = { id?: string; metadata?: unknown; name?: string; published_workflow?: unknown; status?: string | null; workflow?: unknown };
type WorkflowAssignmentRow = {
  id?: string;
  metadata?: unknown;
  organization_id?: string | null;
  scope_id?: string | null;
  scope_type?: string | null;
  user_id?: string | null;
  workflow_id?: string | null;
};
type PostRow = { id?: string; narrative?: string | null; subject_id?: string | null; title?: string | null };

const sessionFrom = (value: SessionRef) => (typeof value === 'string' ? liveSessionForUser(value) : value);

const READ_WORKFLOW_EXECUTION = /* GraphQL */ `
  query ReadMatrixWorkflowExecution($chatId: UUID!, $workflowId: UUID!) {
    ai_workflow_executionsCollection(
      first: 1
      filter: { chat_session_id: { eq: $chatId }, workflow_id: { eq: $workflowId } }
      orderBy: [{ created_at: DescNullsLast }]
    ) {
      edges {
        node {
          id
          chat_session_id
          workflow_id
          run_id
          status
          logs
          response_payload
          created_at
          completed_at
        }
      }
    }
  }
`;

const READ_WORKFLOW_ROW = /* GraphQL */ `
  query ReadMatrixWorkflowRow($userId: UUID!, $name: String!) {
    ai_workflowsCollection(first: 1, filter: { user_id: { eq: $userId }, name: { eq: $name } }, orderBy: [{ updated_at: DescNullsLast }]) {
      edges {
        node {
          id
          name
          status
          workflow
          published_workflow
          metadata
        }
      }
    }
  }
`;

const READ_WORKFLOW_ASSIGNMENT = /* GraphQL */ `
  query ReadMatrixWorkflowAssignment($scopeId: String!, $workflowId: UUID) {
    ai_workflow_assignmentsCollection(
      first: 1
      filter: { scope_type: { eq: "CHANNEL" }, scope_id: { eq: $scopeId }, workflow_id: { eq: $workflowId } }
      orderBy: [{ updated_at: DescNullsLast }]
    ) {
      edges {
        node {
          id
          scope_id
          scope_type
          workflow_id
          organization_id
          user_id
          metadata
        }
      }
    }
  }
`;

const READ_WORKFLOW_ASSIGNMENT_ANY = /* GraphQL */ `
  query ReadMatrixWorkflowAssignmentAny($scopeId: String!) {
    ai_workflow_assignmentsCollection(
      first: 1
      filter: { scope_type: { eq: "CHANNEL" }, scope_id: { eq: $scopeId } }
      orderBy: [{ updated_at: DescNullsLast }]
    ) {
      edges {
        node {
          id
          scope_id
          scope_type
          workflow_id
          organization_id
          user_id
          metadata
        }
      }
    }
  }
`;

const READ_POST_ROW = /* GraphQL */ `
  query ReadMatrixPostRow($title: String!) {
    ai_postsCollection(first: 1, filter: { title: { eq: $title } }, orderBy: [{ created_at: DescNullsLast }]) {
      edges {
        node {
          id
          subject_id
          title
          narrative
        }
      }
    }
  }
`;

export async function readWorkflowExecution(session: LiveSession, chatId: string, workflowId: string) {
  const result = await chatGraphql<{ ai_workflow_executionsCollection: { edges: Array<{ node: WorkflowExecutionRow }> } }>(
    session,
    READ_WORKFLOW_EXECUTION,
    {
      chatId,
      workflowId,
    },
  );
  return result.ai_workflow_executionsCollection.edges[0]?.node || null;
}

export async function readWorkflowRow(sessionRef: SessionRef, name: string) {
  const session = sessionFrom(sessionRef);
  const result = await chatGraphql<{ ai_workflowsCollection: { edges: Array<{ node: WorkflowRow }> } }>(session, READ_WORKFLOW_ROW, {
    name,
    userId: session.userId,
  });
  return result.ai_workflowsCollection.edges[0]?.node || null;
}

export async function readWorkflowAssignment(scopeId: string, workflowId?: string) {
  const session = liveSessionForUser(LIVE_CHAT_USER_ID);
  const query = workflowId ? READ_WORKFLOW_ASSIGNMENT : READ_WORKFLOW_ASSIGNMENT_ANY;
  const result = await chatGraphql<{ ai_workflow_assignmentsCollection: { edges: Array<{ node: WorkflowAssignmentRow }> } }>(session, query, {
    scopeId,
    workflowId: workflowId || null,
  });
  return result.ai_workflow_assignmentsCollection.edges[0]?.node || null;
}

export async function readPostRow(sessionRef: SessionRef, title: string) {
  const result = await chatGraphql<{ ai_postsCollection: { edges: Array<{ node: PostRow }> } }>(sessionFrom(sessionRef), READ_POST_ROW, {
    title,
  });
  return result.ai_postsCollection.edges[0]?.node || null;
}

export function treeNode(tree: any, name: string) {
  const stack = [...(tree?.user || []), ...(tree?.organization || []), ...(tree?.global || [])];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (String(node.name || '').trim() === name) return node;
    for (const child of node.children || []) stack.push(child);
  }
  return null;
}

export function treeHasChild(tree: any, parentName: string, childName: string) {
  const parent = treeNode(tree, parentName);
  if (!parent) return false;
  for (const child of parent.children || []) {
    if (String(child?.name || '').trim() === childName) return true;
  }
  return false;
}
