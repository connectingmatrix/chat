import { chatGraphql, LiveSession } from './chat-giga-live.fixture';
import { CreatedIds, setList } from './chat-giga-live.ids';

type CleanupMutation = { affectedCount?: number; records?: unknown[] };

const DELETE_CHAT_MESSAGES = /* GraphQL */ `
  mutation DeleteMatrixChatMessages($filter: ai_chat_messagesFilter, $atMost: Int!) {
    deleteFromai_chat_messagesCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_CHAT_SESSIONS = /* GraphQL */ `
  mutation DeleteMatrixChatSessions($filter: ai_chat_sessionsFilter, $atMost: Int!) {
    deleteFromai_chat_sessionsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_WORKFLOW_ASSIGNMENTS = /* GraphQL */ `
  mutation DeleteMatrixWorkflowAssignments($filter: ai_workflow_assignmentsFilter, $atMost: Int!) {
    deleteFromai_workflow_assignmentsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_WORKFLOW_EXECUTIONS = /* GraphQL */ `
  mutation DeleteMatrixWorkflowExecutions($filter: ai_workflow_executionsFilter, $atMost: Int!) {
    deleteFromai_workflow_executionsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_WORKFLOWS = /* GraphQL */ `
  mutation DeleteMatrixWorkflows($filter: ai_workflowsFilter, $atMost: Int!) {
    deleteFromai_workflowsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_POST = /* GraphQL */ `
  mutation DeleteMatrixPost($id: UUID!) {
    deleteAiPost(id: $id) {
      message
    }
  }
`;
const DELETE_SUBJECT = /* GraphQL */ `
  mutation DeleteMatrixSubject($id: UUID!) {
    deleteAiSubject(id: $id) {
      message
    }
  }
`;
const DELETE_CATEGORY = /* GraphQL */ `
  mutation DeleteMatrixCategory($id: UUID!) {
    deleteAiCategory(id: $id) {
      message
    }
  }
`;
const DELETE_CHANNEL = /* GraphQL */ `
  mutation DeleteMatrixChannel($id: UUID!) {
    deleteAiChannel(id: $id) {
      message
    }
  }
`;

const collectionDelete = async (session: LiveSession, query: string, filter: Record<string, unknown>, atMost: number) =>
  chatGraphql<Record<string, CleanupMutation>>(session, query, { atMost: Math.max(atMost, 1), filter });

const itemDelete = async (session: LiveSession, query: string, ids: string[]) => {
  for (const id of ids) await chatGraphql(session, query, { id });
};

export async function cleanupCreatedThroughGraphql(session: LiveSession, ids: CreatedIds): Promise<void> {
  const chatIds = setList(ids.chats);
  const categoryIds = setList(ids.categories);
  const channelIds = setList(ids.channels);
  const postIds = setList(ids.posts);
  const subjectIds = setList(ids.subjects);
  const workflowIds = setList(ids.workflows);
  const failures: Error[] = [];
  const step = async (executor: () => Promise<unknown>) => {
    try {
      await executor();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error || 'Cleanup failed.')));
    }
  };
  await step(async () => {
    if (chatIds.length) await collectionDelete(session, DELETE_CHAT_MESSAGES, { chat_id: { in: chatIds } }, chatIds.length * 50);
  });
  await step(async () => {
    if (workflowIds.length)
      await collectionDelete(session, DELETE_WORKFLOW_ASSIGNMENTS, { workflow_id: { in: workflowIds } }, workflowIds.length * 4);
  });
  await step(async () => {
    if (channelIds.length) await collectionDelete(session, DELETE_WORKFLOW_ASSIGNMENTS, { scope_id: { in: channelIds } }, channelIds.length * 4);
  });
  await step(async () => {
    if (workflowIds.length)
      await collectionDelete(session, DELETE_WORKFLOW_EXECUTIONS, { workflow_id: { in: workflowIds } }, workflowIds.length * 20);
  });
  await step(async () => itemDelete(session, DELETE_POST, postIds));
  await step(async () => itemDelete(session, DELETE_SUBJECT, subjectIds));
  await step(async () => itemDelete(session, DELETE_CATEGORY, categoryIds));
  await step(async () => itemDelete(session, DELETE_CHANNEL, channelIds));
  await step(async () => {
    if (workflowIds.length) await collectionDelete(session, DELETE_WORKFLOWS, { id: { in: workflowIds } }, workflowIds.length);
  });
  await step(async () => {
    if (chatIds.length) await collectionDelete(session, DELETE_CHAT_SESSIONS, { id: { in: chatIds } }, chatIds.length);
  });
  if (failures.length) throw new Error(failures.map((error) => error.message).join(' | '));
}
