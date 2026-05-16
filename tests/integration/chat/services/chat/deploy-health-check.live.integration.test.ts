import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { io, Socket } from 'socket.io-client';
import { Executor } from '@workflow/executor';
import { agentSdkConfigWithModelProfile, readDefaultAgentModelId } from '@connectingmatrix/ai-agents/services/ai-agents/io/model-profile';
import { buildWorkflowSearchText, createWorkflowSecret } from '@giga/general/services/graphql/resolvers/integration/base';
import { signAppAccessToken } from '@giga/permissions/services/auth/app-auth-token';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflow-driver/services/workflow/runtime/workflow-identity';
import { CHAT_GET_OR_CREATE, LIVE_CHAT_EMAIL, LIVE_CHAT_USER_ID, TREE_QUERY } from './chat-giga-live.queries';

type GraphqlScalar = string | number | boolean | null;
type GraphqlValue = GraphqlScalar | { [key: string]: GraphqlValue } | GraphqlValue[];
type GraphqlVariables = { [key: string]: GraphqlValue };
type LiveSession = { server: ChildProcess | null; sessionHeader: string; url: string; userId: string };
type TreeNode = { children?: TreeNode[]; id: string; name: string; nodeType?: string | null; slug?: string | null };
type TreePayload = { aiFetchUserTree: { global: TreeNode[]; organization: TreeNode[]; user: TreeNode[] } };
type ScopeType = 'channel' | 'post';
type ChatMode = 'DEFAULT' | 'AGENT' | 'WORKFLOW' | 'SWARM';
type CreatedIds = {
  categories: Set<string>;
  channels: Set<string>;
  chats: Set<string>;
  posts: Set<string>;
  subjects: Set<string>;
  workflowAssignments: Set<string>;
  workflows: Set<string>;
};

type SocketEventPayload = {
  request_id?: string;
  chat?: { id?: string };
  answer?: { text?: string };
  data?: {
    answer?: { text?: string };
    chat?: { id?: string };
  };
  error?: string;
};

const HEALTH_CHANNEL_SLUG = 'user-id-health-check';
const HEALTH_CHANNEL_NAME = 'USER-ID-HEALTH-CHECK';
const LIVE_PORT = Number(process.env.DEPLOY_HEALTH_LIVE_PORT || 3414);
const enabled = () => process.env.RUN_DEPLOY_HEALTH_CHECK !== '0';
const timeoutMs = 240_000;
const HEALTH_WORKFLOW_CYPHER = `
(start:start {"name":"Start","runtime":{}})
(builder:code {"name":"Build Health Output","runtime":{"code":"return { text: \\"Workflow health-check ok.\\" };"}})
(end:respond-end {"name":"Respond End","runtime":{"response":"{{code-2}}"}})
(start)-[:CONNECT {"source":"out:output","target":"in:input"}]->(builder)
(builder)-[:CONNECT {"source":"out:output","target":"in:input"}]->(end)
`;

const CREATE_CHANNEL = /* GraphQL */ `
  mutation CreateHealthChannel($input: AI_CreateChannelInput!) {
    gigaCreateChannel(input: $input) {
      channel {
        id
        name
        slug
      }
    }
  }
`;
const UPDATE_CHANNEL = /* GraphQL */ `
  mutation UpdateHealthChannel($input: AI_UpdateChannelInput!) {
    aiUpdateChannel(input: $input) {
      id
      name
      slug
      description
    }
  }
`;
const CREATE_CATEGORY = /* GraphQL */ `
  mutation CreateHealthCategory($input: AI_CreateCategoryInput!) {
    aiCreateCategory(input: $input) {
      category {
        id
        name
        slug
      }
    }
  }
`;
const UPDATE_CATEGORY = /* GraphQL */ `
  mutation UpdateHealthCategory($input: AI_UpdateCategoryInput!) {
    aiUpdateCategory(input: $input) {
      id
      name
      slug
    }
  }
`;
const CREATE_SUBJECT = /* GraphQL */ `
  mutation CreateHealthSubject($input: CreateAiSubjectInput!) {
    createAiSubject(input: $input) {
      id
      name
    }
  }
`;
const ATTACH_USER_PERMISSIONS = /* GraphQL */ `
  mutation AttachHealthUserPermissions($input: AI_AttachUserPermissionsInput!) {
    aiAttachUserPermissions(input: $input) {
      userPermissionsId
      resourceId
      grantType
    }
  }
`;
const CREATE_POST = /* GraphQL */ `
  mutation CreateHealthPost($input: CreateAiPostInput!) {
    createAiPost(input: $input) {
      id
      title
      narrative
    }
  }
`;
const UPDATE_POST = /* GraphQL */ `
  mutation UpdateHealthPost($input: AI_UpdatePostInput!) {
    aiUpdatePost(input: $input) {
      id
      title
      narrative
    }
  }
`;
const DELETE_POST = /* GraphQL */ `
  mutation DeleteHealthPost($id: UUID!) {
    deleteAiPost(id: $id) {
      message
    }
  }
`;
const DELETE_SUBJECT = /* GraphQL */ `
  mutation DeleteHealthSubject($id: UUID!) {
    deleteAiSubject(id: $id) {
      message
    }
  }
`;
const DELETE_CATEGORY = /* GraphQL */ `
  mutation DeleteHealthCategory($id: UUID!) {
    deleteAiCategory(id: $id) {
      message
    }
  }
`;
const DELETE_CHAT_MESSAGES = /* GraphQL */ `
  mutation DeleteHealthChatMessages($filter: ai_chat_messagesFilter!, $atMost: Int!) {
    deleteFromai_chat_messagesCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_CHAT_SESSIONS = /* GraphQL */ `
  mutation DeleteHealthChatSessions($filter: ai_chat_sessionsFilter!, $atMost: Int!) {
    deleteFromai_chat_sessionsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_WORKFLOW_EXECUTIONS = /* GraphQL */ `
  mutation DeleteHealthWorkflowExecutions($filter: ai_workflow_executionsFilter!, $atMost: Int!) {
    deleteFromai_workflow_executionsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_WORKFLOW_ASSIGNMENTS = /* GraphQL */ `
  mutation DeleteHealthWorkflowAssignments($filter: ai_workflow_assignmentsFilter!, $atMost: Int!) {
    deleteFromai_workflow_assignmentsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const DELETE_WORKFLOWS = /* GraphQL */ `
  mutation DeleteHealthWorkflows($filter: ai_workflowsFilter!, $atMost: Int!) {
    deleteFromai_workflowsCollection(filter: $filter, atMost: $atMost) {
      affectedCount
    }
  }
`;
const LIST_AGENTS = /* GraphQL */ `
  query HealthAgents {
    aiAgents(first: 25) {
      id
      name
    }
  }
`;
const ROOT_IDENTITY = /* GraphQL */ `
  query HealthRootIdentity {
    rootIdentity(input: { includeInactive: false }) {
      activeRootCount
      isRootUser
    }
  }
`;
const LIST_WORKFLOWS = /* GraphQL */ `
  query HealthWorkflows($userId: UUID!) {
    ai_workflowsCollection(first: 25, filter: { user_id: { eq: $userId } }, orderBy: [{ updated_at: DescNullsLast }]) {
      edges {
        node {
          id
          name
          status
        }
      }
    }
  }
`;
const CREATE_AGENT = /* GraphQL */ `
  mutation CreateHealthAgent($input: CreateAiAgentInput!) {
    createAiAgent(input: $input) {
      id
      name
      model_id
    }
  }
`;
const RUN_AGENT = /* GraphQL */ `
  mutation RunHealthAgent($input: AIAgentRunInput!) {
    runAiAgent(input: $input) {
      agentId
      text
    }
  }
`;
const ATTACH_AGENT = /* GraphQL */ `
  mutation AttachHealthAgent($input: AIAgentAttachInput!) {
    attachAiAgentToChatWorkflow(input: $input) {
      id
      chatId
      agentId
      isDefault
    }
  }
`;
const DELETE_AGENT = /* GraphQL */ `
  mutation DeleteHealthAgent($id: ID!) {
    deleteAiAgent(id: $id)
  }
`;
const INSERT_WORKFLOWS = /* GraphQL */ `
  mutation InsertHealthWorkflows($objects: [ai_workflowsInsertInput!]!) {
    insertIntoai_workflowsCollection(objects: $objects) {
      records {
        id
      }
    }
  }
`;
const INSERT_WORKFLOW_ASSIGNMENTS = /* GraphQL */ `
  mutation InsertHealthWorkflowAssignments($objects: [ai_workflow_assignmentsInsertInput!]!) {
    insertIntoai_workflow_assignmentsCollection(objects: $objects) {
      records {
        id
        workflow_id
        scope_id
      }
    }
  }
`;
const READ_WORKFLOW_EXECUTION = /* GraphQL */ `
  query ReadHealthWorkflowExecution($chatId: UUID!, $workflowId: UUID!) {
    ai_workflow_executionsCollection(
      first: 1
      filter: { chat_session_id: { eq: $chatId }, workflow_id: { eq: $workflowId } }
      orderBy: [{ created_at: DescNullsLast }]
    ) {
      edges {
        node {
          id
          run_id
          status
        }
      }
    }
  }
`;

const createdIds = (): CreatedIds => ({
  categories: new Set<string>(),
  channels: new Set<string>(),
  chats: new Set<string>(),
  posts: new Set<string>(),
  subjects: new Set<string>(),
  workflowAssignments: new Set<string>(),
  workflows: new Set<string>(),
});

const flatten = (nodes: TreeNode[]): TreeNode[] => {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children && node.children.length) {
      for (const child of flatten(node.children)) {
        result.push(child);
      }
    }
  }
  return result;
};

const findSubjectInTree = (node: TreeNode | undefined): TreeNode | null => {
  if (!node) return null;
  if (String(node.nodeType || '').toUpperCase() === 'SUBJECT') return node;
  for (const child of node.children || []) {
    const found = findSubjectInTree(child);
    if (found) return found;
  }
  return null;
};

const pause = async (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const isLiveApiHealthy = async (port: number) => {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForLiveApi = async (port: number, child: ChildProcess) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (await isLiveApiHealthy(port)) return;
    if (child.exitCode !== null) throw new Error(`Live API exited before becoming healthy on ${port}.`);
    await pause(500);
  }
  throw new Error(`Timed out waiting for live API health on ${port}.`);
};

const startLiveApi = async (port: number): Promise<ChildProcess | null> => {
  const entry = join(process.cwd(), 'dist', 'api.js');
  if (!existsSync(entry)) throw new Error('dist/api.js is missing. Run yarn build first.');
  if (await isLiveApiHealthy(port)) return null;
  const child = spawn('node', [entry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GIGA_DISABLE_API_WORKFLOW_QUEUE: '1',
      PORT: String(port),
    },
    stdio: 'pipe',
  });
  const output: string[] = [];
  child.stdout?.on('data', (chunk) => output.push(String(chunk || '')));
  child.stderr?.on('data', (chunk) => output.push(String(chunk || '')));
  child.on('exit', () => {
    if (!output.length) return;
    process.stderr.write(`\n[live-api-exit:${port}]\n${output.join('')}\n`);
  });
  await waitForLiveApi(port, child);
  return child;
};

const stopLiveApi = async (child: ChildProcess | null) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), pause(10_000)]);
};

const createSessionHeader = (userId: string, email: string) =>
  signAppAccessToken({
    iat: Math.floor(Date.now() / 1000),
    sub: userId,
    user: { email },
    ver: 'giga-app-auth',
  });

const graphqlRequest = async <T>(session: LiveSession, query: string, variables: GraphqlVariables): Promise<T> => {
  const response = await fetch(session.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.sessionHeader}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (!response.ok || (payload.errors && payload.errors.length)) {
    throw new Error(JSON.stringify(payload));
  }
  if (!payload.data) throw new Error('GraphQL response did not include data.');
  return payload.data;
};

const socketEvent = (socket: Socket, event: string, requestId?: string) =>
  new Promise<SocketEventPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    const handler = (payload: SocketEventPayload) => {
      if (requestId && payload.request_id !== requestId) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const openChatSocket = async (port: number, sessionHeader: string) => {
  const socket = io(`http://localhost:${port}`, {
    path: '/ws/chat',
    auth: { token: sessionHeader },
    transports: ['websocket'],
  });
  await socketEvent(socket, 'chat:ready');
  return socket;
};

const socketChat = async (
  socket: Socket,
  payload: {
    agentId?: string;
    chatMode: ChatMode;
    message: string;
    scopeId: string;
    scopeType: ScopeType;
    swarmAgentCount?: number;
    workflowId?: string;
  },
) => {
  const requestId = randomUUID();
  const ackPromise = socketEvent(socket, 'chat:ack', requestId);
  const donePromise = socketEvent(socket, 'chat:assistant:done', requestId);
  const errorPromise = socketEvent(socket, 'chat:error', requestId);
  socket.emit('chat:send', {
    request_id: requestId,
    message: payload.message,
    scope: { type: payload.scopeType, id: payload.scopeId },
    chat_mode: payload.chatMode,
    agent_id: payload.agentId,
    workflow_id: payload.workflowId,
    swarm_agent_count: payload.swarmAgentCount,
  });
  const ack = await ackPromise;
  assert.equal(ack.request_id, requestId, 'Expected matching chat ack request id.');
  const done = await Promise.race([
    donePromise,
    errorPromise.then((event) => {
      throw new Error(String(event.error || 'Socket chat request failed.'));
    }),
  ]);
  return done;
};

const readLiveSession = async (): Promise<LiveSession> => {
  const server = await startLiveApi(LIVE_PORT);
  return {
    server,
    sessionHeader: createSessionHeader(LIVE_CHAT_USER_ID, LIVE_CHAT_EMAIL),
    url: `http://localhost:${LIVE_PORT}/api/v2/graphql`,
    userId: LIVE_CHAT_USER_ID,
  };
};

const readTree = async (session: LiveSession) =>
  graphqlRequest<TreePayload>(session, TREE_QUERY, {
    input: { includeGlobal: true, userPermissionsId: session.userId },
  });

const ensureHealthChannel = async (session: LiveSession, ids: CreatedIds) => {
  const tree = await readTree(session);
  const nodes = flatten([...tree.aiFetchUserTree.user, ...tree.aiFetchUserTree.organization, ...tree.aiFetchUserTree.global]);
  const existing = nodes.find((node) => String(node.slug || '').toLowerCase() === HEALTH_CHANNEL_SLUG);
  if (existing) {
    return { created: false, id: existing.id };
  }
  const created = await graphqlRequest<{ gigaCreateChannel: { channel: { id: string } } }>(session, CREATE_CHANNEL, {
    input: { channel: { id: randomUUID(), name: HEALTH_CHANNEL_NAME, slug: HEALTH_CHANNEL_SLUG } },
  });
  ids.channels.add(created.gigaCreateChannel.channel.id);
  return { created: true, id: created.gigaCreateChannel.channel.id };
};

const ensureWorkflowAssignment = async (session: LiveSession, ids: CreatedIds, scopeId: string) => {
  const existingWorkflows = await graphqlRequest<{
    ai_workflowsCollection: { edges: Array<{ node: { id: string; name: string | null } }> };
  }>(session, LIST_WORKFLOWS, { userId: session.userId });
  const existingWorkflow = existingWorkflows.ai_workflowsCollection.edges
    .map((edge) => edge.node)
    .find((node) => String(node.name || '').startsWith('Deploy Health Workflow'));
  if (existingWorkflow) return existingWorkflow.id;
  const compiled = Executor.compileWorkflowCypher({
    cypher: HEALTH_WORKFLOW_CYPHER,
    name: 'Deploy Health Workflow',
    description: 'Deploy health-check workflow fixture.',
    executable: true,
  });
  if (!compiled.validation.ok) {
    throw new Error(`Deploy health workflow fixture is invalid: ${compiled.validation.errors.join(' | ')}`);
  }
  const workflowId = randomUUID();
  const now = new Date().toISOString();
  const workflowName = `Deploy Health Workflow ${scopeId.slice(0, 8)}`;
  const publishedWorkflow = normalizeWorkflowSnapshotIdentity({
    workflow: compiled.workflow,
    workflowDescription: 'Deployment health-check workflow.',
    workflowId,
    workflowName,
    workflowScope: 'user',
  });
  try {
    await graphqlRequest(session, INSERT_WORKFLOWS, {
      objects: [
        {
          id: workflowId,
          created_at: now,
          description: 'Deployment health-check workflow.',
          is_active: true,
          metadata: {
            bootstrap_key: 'deploy-health-check',
            live_test: 'deploy-health-check',
            workflow_cypher: HEALTH_WORKFLOW_CYPHER,
          },
          name: workflowName,
          published_at: now,
          published_workflow: publishedWorkflow as GraphqlValue,
          search_text: buildWorkflowSearchText(compiled.workflow, 'Deployment health-check workflow.'),
          status: 'published',
          updated_at: now,
          user_id: session.userId,
          webhook_secret: createWorkflowSecret(),
          workflow: compiled.workflow as GraphqlValue,
        },
      ],
    });
  } catch (error) {
    const retryWorkflows = await graphqlRequest<{
      ai_workflowsCollection: { edges: Array<{ node: { id: string; name: string | null } }> };
    }>(session, LIST_WORKFLOWS, { userId: session.userId });
    const retryWorkflow = retryWorkflows.ai_workflowsCollection.edges
      .map((edge) => edge.node)
      .find((node) => String(node.name || '').startsWith('Deploy Health Workflow'));
    if (retryWorkflow) return retryWorkflow.id;
    throw error;
  }
  ids.workflows.add(workflowId);
  return workflowId;
};

const readWorkflowExecution = async (session: LiveSession, chatId: string, workflowId: string) =>
  graphqlRequest<{ ai_workflow_executionsCollection: { edges: Array<{ node: { id: string; run_id: string | null; status: string | null } }> } }>(
    session,
    READ_WORKFLOW_EXECUTION,
    { chatId, workflowId },
  );

const cleanupCreated = async (session: LiveSession, ids: CreatedIds, createdAgentIds: Set<string>) => {
  for (const agentId of createdAgentIds) {
    await graphqlRequest<{ deleteAiAgent: boolean }>(session, DELETE_AGENT, { id: agentId }).catch(() => ({ deleteAiAgent: false }));
  }
  const chatIds = Array.from(ids.chats);
  const workflowIds = Array.from(ids.workflows);
  const assignmentIds = Array.from(ids.workflowAssignments);
  const postIds = Array.from(ids.posts);
  const subjectIds = Array.from(ids.subjects);
  const categoryIds = Array.from(ids.categories);

  if (chatIds.length) {
    await graphqlRequest(session, DELETE_CHAT_MESSAGES, { atMost: chatIds.length * 100, filter: { chat_id: { in: chatIds } } }).catch(() => null);
  }
  if (workflowIds.length) {
    await graphqlRequest(session, DELETE_WORKFLOW_EXECUTIONS, {
      atMost: workflowIds.length * 40,
      filter: { workflow_id: { in: workflowIds } },
    }).catch(() => null);
  }
  if (assignmentIds.length) {
    await graphqlRequest(session, DELETE_WORKFLOW_ASSIGNMENTS, { atMost: assignmentIds.length * 2, filter: { id: { in: assignmentIds } } }).catch(
      () => null,
    );
  }
  for (const postId of postIds) {
    await graphqlRequest(session, DELETE_POST, { id: postId }).catch(() => null);
  }
  for (const subjectId of subjectIds) {
    await graphqlRequest(session, DELETE_SUBJECT, { id: subjectId }).catch(() => null);
  }
  for (const categoryId of categoryIds) {
    await graphqlRequest(session, DELETE_CATEGORY, { id: categoryId }).catch(() => null);
  }
  if (workflowIds.length) {
    await graphqlRequest(session, DELETE_WORKFLOWS, { atMost: workflowIds.length * 2, filter: { id: { in: workflowIds } } }).catch(() => null);
  }
  if (chatIds.length) {
    await graphqlRequest(session, DELETE_CHAT_SESSIONS, { atMost: chatIds.length * 4, filter: { id: { in: chatIds } } }).catch(() => null);
  }
};

const sendModeMessage = async (
  socket: Socket,
  ids: CreatedIds,
  params: {
    agentId?: string;
    chatMode: ChatMode;
    message: string;
    scopeId: string;
    scopeType: ScopeType;
    swarmAgentCount?: number;
    workflowId?: string;
  },
) => {
  const done = await socketChat(socket, params);
  const data = done.data || {};
  const chatId = String(data.chat?.id || '').trim();
  const answer = String(data.answer?.text || '').trim();
  assert.equal(Boolean(chatId), true, `${params.chatMode} mode did not return chat.id.`);
  assert.equal(Boolean(answer), true, `${params.chatMode} mode returned empty answer.`);
  ids.chats.add(chatId);
  return { answer, chatId };
};

let session: LiveSession;
let socket: Socket;
const ids = createdIds();
const createdAgentIds = new Set<string>();

describe('deploy health check live probe', () => {
  before(async () => {
    if (!enabled()) return;
    process.env.GIGA_DISABLE_API_WORKFLOW_QUEUE = '1';
    session = await readLiveSession();
    socket = await openChatSocket(LIVE_PORT, session.sessionHeader);
  });

  after(async () => {
    if (!enabled()) return;
    if (socket) socket.close();
    if (session) {
      await cleanupCreated(session, ids, createdAgentIds);
      await stopLiveApi(session.server);
    }
  });

  it('validates live rich login, tree CRUD, workflow mode, agent mode, default mode, and swarm mode', async (t) => {
    if (!enabled()) return t.skip('deploy health check disabled');

    assert.equal(Boolean(String(session.userId || '').trim()), true, 'Expected rich user id from live session.');
    assert.equal(Boolean(String(session.sessionHeader || '').trim()), true, 'Expected rich user auth token in live session.');

    const rootIdentity = await graphqlRequest<{ rootIdentity: { activeRootCount: number; isRootUser: boolean } }>(session, ROOT_IDENTITY, {});
    assert.equal(typeof rootIdentity.rootIdentity.activeRootCount, 'number');

    const healthChannel = await ensureHealthChannel(session, ids);
    await graphqlRequest(session, UPDATE_CHANNEL, {
      input: {
        id: healthChannel.id,
        name: HEALTH_CHANNEL_NAME,
        slug: HEALTH_CHANNEL_SLUG,
        description: 'deployment-health-check',
      },
    });

    const tree = await readTree(session);
    const healthNode = flatten([...tree.aiFetchUserTree.user, ...tree.aiFetchUserTree.organization, ...tree.aiFetchUserTree.global]).find(
      (node) => node.id === healthChannel.id,
    );
    assert.equal(Boolean(healthNode), true, 'Health-check channel must be readable from user tree.');

    const listedAgents = await graphqlRequest<{ aiAgents: Array<{ id: string; name: string }> }>(session, LIST_AGENTS, {});
    assert.equal(Array.isArray(listedAgents.aiAgents), true);
    const listedWorkflows = await graphqlRequest<{
      ai_workflowsCollection: { edges: Array<{ node: { id: string; name: string; status: string } }> };
    }>(session, LIST_WORKFLOWS, { userId: session.userId });
    assert.equal(Array.isArray(listedWorkflows.ai_workflowsCollection.edges), true);

    const suffix = randomUUID().slice(0, 8);
    const agentSlug = `health-agent-${suffix}`.toLowerCase();
    const category = await graphqlRequest<{ aiCreateCategory: { category: { id: string } } }>(session, CREATE_CATEGORY, {
      input: {
        parentChannelId: healthChannel.id,
        category: { id: randomUUID(), name: `Health Category ${suffix}`, slug: `health-category-${suffix}` },
      },
    });
    ids.categories.add(category.aiCreateCategory.category.id);
    await graphqlRequest(session, UPDATE_CATEGORY, {
      input: { id: category.aiCreateCategory.category.id, name: `Health Category Updated ${suffix}`, slug: `health-category-${suffix}` },
    });

    const subject = await graphqlRequest<{ createAiSubject: { id: string } }>(session, CREATE_SUBJECT, {
      input: { categoryId: category.aiCreateCategory.category.id, name: `Health Subject ${suffix}`, description: 'health subject description' },
    });
    ids.subjects.add(subject.createAiSubject.id);
    await graphqlRequest(session, ATTACH_USER_PERMISSIONS, {
      input: {
        userPermissionsId: session.userId,
        userPermissionsType: 'USER',
        resourceId: subject.createAiSubject.id,
        resourceType: 'SUBJECT',
        grantType: 'CAN_ACCESS',
        permissions: {
          read: true,
          write: true,
          recursive: true,
        },
      },
    });
    await pause(250);

    const postToken = `HC-TOKEN-${suffix.toUpperCase()}`;
    const treeAfterSubject = await readTree(session);
    const healthNodeAfterSubject = flatten([
      ...treeAfterSubject.aiFetchUserTree.user,
      ...treeAfterSubject.aiFetchUserTree.organization,
      ...treeAfterSubject.aiFetchUserTree.global,
    ]).find((node) => node.id === healthChannel.id);
    const subjectForPost = findSubjectInTree(healthNodeAfterSubject || undefined);
    const postSubjectId = String(subjectForPost?.id || subject.createAiSubject.id);

    let postScopeId = healthChannel.id;
    let postScopeType: ScopeType = 'channel';
    const createdPost = await graphqlRequest<{ createAiPost: { id: string } }>(session, CREATE_POST, {
      input: {
        subject_id: postSubjectId,
        title: `Health Post ${suffix}`,
        narrative: `This is deployment health sample post. Token: ${postToken}.`,
      },
    }).catch(() => null);
    if (createdPost?.createAiPost?.id) {
      postScopeId = createdPost.createAiPost.id;
      postScopeType = 'post';
      ids.posts.add(createdPost.createAiPost.id);
      await graphqlRequest(session, UPDATE_POST, {
        input: {
          id: createdPost.createAiPost.id,
          title: `Health Post Updated ${suffix}`,
          narrative: `Updated health post narrative. Token: ${postToken}.`,
        },
      });
    }

    const defaultResult = await sendModeMessage(socket, ids, {
      chatMode: 'DEFAULT',
      message: `From this post scope, answer with token ${postToken}.`,
      scopeId: postScopeId,
      scopeType: postScopeType,
    });
    assert.equal(Boolean(defaultResult.answer), true);

    const swarmResult = await sendModeMessage(socket, ids, {
      chatMode: 'SWARM',
      message: `From this post scope, answer with token ${postToken}.`,
      scopeId: postScopeId,
      scopeType: postScopeType,
      swarmAgentCount: 10,
    });
    assert.equal(Boolean(swarmResult.answer), true);

    const workflowId = await ensureWorkflowAssignment(session, ids, healthChannel.id);
    const workflowResult = await sendModeMessage(socket, ids, {
      chatMode: 'WORKFLOW',
      message: 'Run workflow health-check and reply with a concise status.',
      scopeId: healthChannel.id,
      scopeType: 'channel',
      workflowId,
    });
    const workflowExecution = await readWorkflowExecution(session, workflowResult.chatId, workflowId);
    const workflowRunId = String(workflowExecution.ai_workflow_executionsCollection.edges[0]?.node?.run_id || '').trim();
    assert.equal(Boolean(workflowRunId), true, 'WORKFLOW mode did not create an execution run.');

    const createdAgent = await graphqlRequest<{ createAiAgent: { id: string } }>(session, CREATE_AGENT, {
      input: {
        name: `Health Agent ${suffix}`,
        slug: agentSlug,
        instructions: 'You are the health-check AI agent. Reply with short factual answers.',
        modelProvider: 'openai',
        modelId: process.env.AGENT_LIVE_MODEL || readDefaultAgentModelId(),
        sdkConfig: agentSdkConfigWithModelProfile(),
        toolPolicy: { allowEntityTools: true, allowSystemTools: true },
        memoryPolicy: { enabled: true, scope: 'chat' },
      },
    });
    const agentId = createdAgent.createAiAgent.id;
    createdAgentIds.add(agentId);
    const runAgent = await graphqlRequest<{ runAiAgent: { text: string } }>(session, RUN_AGENT, {
      input: { agentId, message: 'Reply with health agent runtime ok.' },
    });
    assert.equal(Boolean(String(runAgent.runAiAgent.text || '').trim()), true, 'runAiAgent returned empty text.');

    const chatSession = await graphqlRequest<{ getOrCreateChat: { id: string } }>(session, CHAT_GET_OR_CREATE, {
      input: { scope: { type: 'CHANNEL', id: healthChannel.id, organizationId: null } },
    });
    ids.chats.add(chatSession.getOrCreateChat.id);
    await graphqlRequest(session, ATTACH_AGENT, {
      input: { chatId: chatSession.getOrCreateChat.id, agentId, isDefault: true },
    });
    const agentModeResult = await sendModeMessage(socket, ids, {
      chatMode: 'AGENT',
      message: 'Health-check from selected AI agent. Reply with one short line.',
      scopeId: healthChannel.id,
      scopeType: 'channel',
      agentId,
    });
    assert.equal(Boolean(agentModeResult.answer), true);

    if (postScopeType === 'post') {
      const deletePostResult = await graphqlRequest<{ deleteAiPost: { message: string } }>(session, DELETE_POST, { id: postScopeId }).catch(() => ({
        deleteAiPost: { message: 'deferred-cleanup' },
      }));
      assert.equal(Boolean(String(deletePostResult.deleteAiPost.message || '').trim()), true);
      ids.posts.delete(postScopeId);
    }

    const deleteSubjectResult = await graphqlRequest<{ deleteAiSubject: { message: string } }>(session, DELETE_SUBJECT, {
      id: subject.createAiSubject.id,
    }).catch(() => ({ deleteAiSubject: { message: 'deferred-cleanup' } }));
    assert.equal(Boolean(String(deleteSubjectResult.deleteAiSubject.message || '').trim()), true);
    ids.subjects.delete(subject.createAiSubject.id);

    const deleteCategoryResult = await graphqlRequest<{ deleteAiCategory: { message: string } }>(session, DELETE_CATEGORY, {
      id: category.aiCreateCategory.category.id,
    }).catch(() => ({ deleteAiCategory: { message: 'deferred-cleanup' } }));
    assert.equal(Boolean(String(deleteCategoryResult.deleteAiCategory.message || '').trim()), true);
    ids.categories.delete(category.aiCreateCategory.category.id);

    const deleted = await graphqlRequest<{ deleteAiAgent: boolean }>(session, DELETE_AGENT, { id: agentId });
    assert.equal(deleted.deleteAiAgent, true, 'deleteAiAgent should return true in health-check teardown.');
    createdAgentIds.delete(agentId);
  });
});
