import { randomUUID } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { io } from 'socket.io-client';
import {
  createUserSessionHeader,
  graphqlRequest,
  isLiveApiHealthy,
  startLiveApi,
  stopLiveApi,
} from '@giga/general/services/graphql/__tests__/activity-log-live.runtime.fixture';
import { ensureLiveQueueTopics } from '@connectingmatrix/workflows/services/workflow/queue/__tests__/workflow-webhook-live.runtime.fixture';
import { LIVE_CHAT_EMAIL, LIVE_CHAT_USER_ID, TREE_QUERY } from './chat-giga-live.queries';
import type { Socket } from 'socket.io-client';

export type LiveSession = {
  server: ChildProcess | null;
  sessionHeader: string;
  url: string;
  userId: string;
};

const LIVE_SESSION_HEADERS = new Map<string, string>();
const LIVE_SESSIONS = new Map<string, LiveSession>();
const defaultScopePath = ['giga-ai-test', 'queryChat'];
const liveQueueBrokers = process.env.WORKFLOW_QUEUE_TEST_BROKERS || 'localhost:19092,localhost:29092,localhost:39092';
const liveQueueSsl = 'false';
const liveQueueUsername = '';
const liveQueuePassword = '';
type LiveTreeNode = { children?: LiveTreeNode[]; id: string; name: string; nodeType?: string; slug?: string | null };
type LiveQueueEnv = ReturnType<typeof liveQueueEnv>;
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const findPath = (nodes: LiveTreeNode[], names: string[]) => {
  let currentNodes = nodes;
  let current: LiveTreeNode | null = null;
  for (const name of names) {
    current = currentNodes.find((node) => String(node?.name || '').trim() === name) || null;
    if (!current) return null;
    currentNodes = current.children || [];
  }
  return current;
};

const CREATE_CHANNEL = /* GraphQL */ `
  mutation CreateLiveChatScopeChannel($input: AI_CreateChannelInput!) {
    gigaCreateChannel(input: $input) {
      channel {
        id
        name
        slug
      }
    }
  }
`;

const PREFLIGHT_QUERY = /* GraphQL */ `
  query LiveChatDataPlanePreflight {
    rootIdentity(input: { includeInactive: false }) {
      activeRootCount
      isRootUser
    }
  }
`;

const readTree = async (session: LiveSession) => {
  const result = await chatGraphql<{ aiFetchUserTree: { user: LiveTreeNode[] } }>(session, TREE_QUERY, {
    input: { includeGlobal: false, userPermissionsId: session.userId },
  });
  return result.aiFetchUserTree.user || [];
};

const createChannelViaGraphql = async (session: LiveSession, input: { id: string; name: string; parentChannelId?: string | null; slug: string }) => {
  const result = await chatGraphql<{ gigaCreateChannel: { channel: { id: string; name: string; slug: string } } }>(session, CREATE_CHANNEL, {
    input: {
      channel: { id: input.id, name: input.name, slug: input.slug },
      parentChannelId: input.parentChannelId || null,
    },
  });
  return result.gigaCreateChannel.channel;
};

const ensureScopeParent = async (session: LiveSession) => {
  for (let index = 0; index < defaultScopePath.length; index += 1) {
    const tree = await readTree(session);
    const current = findPath(tree, defaultScopePath.slice(0, index + 1));
    if (current?.id) continue;
    const parent = index ? findPath(tree, defaultScopePath.slice(0, index)) : null;
    const id = randomUUID();
    await createChannelViaGraphql(session, {
      id,
      name: defaultScopePath[index],
      parentChannelId: parent?.id || null,
      slug: `${slug(defaultScopePath[index])}-${id.slice(0, 6)}`,
    });
  }
  return findPath(await readTree(session), defaultScopePath);
};

export function liveQueueEnv(port: number) {
  const suffix = `chat-${port}`;
  return {
    WORKFLOW_QUEUE_BROKERS: liveQueueBrokers,
    WORKFLOW_QUEUE_SSL: liveQueueSsl,
    WORKFLOW_QUEUE_USERNAME: liveQueueUsername,
    WORKFLOW_QUEUE_PASSWORD: liveQueuePassword,
    WORKFLOW_QUEUE_CLIENT_ID: `workflow-queue-${suffix}`,
    WORKFLOW_QUEUE_REQUEST_TOPIC: `workflow-execution-requests-${suffix}`,
    WORKFLOW_QUEUE_EVENTS_TOPIC: `workflow-execution-events-${suffix}`,
    WORKFLOW_QUEUE_REQUEST_CONSUMER_GROUP_ID: `workflow-queue-worker-${suffix}`,
    WORKFLOW_QUEUE_EVENT_CONSUMER_GROUP_ID: `workflow-queue-events-${suffix}`,
  };
}

export async function readLiveSession(port: number, email: string, options: { queueEnv?: LiveQueueEnv } = {}): Promise<LiveSession> {
  if (email !== LIVE_CHAT_EMAIL) throw new Error(`Live chat GraphQL fixtures require LIVE_CHAT_EMAIL (${LIVE_CHAT_EMAIL}). Received ${email}.`);
  const userId = LIVE_CHAT_USER_ID;
  const queueEnv = options.queueEnv || liveQueueEnv(port);
  process.env.WORKFLOW_QUEUE_BROKERS = queueEnv.WORKFLOW_QUEUE_BROKERS || liveQueueBrokers;
  process.env.WORKFLOW_QUEUE_SSL = queueEnv.WORKFLOW_QUEUE_SSL || liveQueueSsl;
  process.env.WORKFLOW_QUEUE_USERNAME = queueEnv.WORKFLOW_QUEUE_USERNAME || liveQueueUsername;
  process.env.WORKFLOW_QUEUE_PASSWORD = queueEnv.WORKFLOW_QUEUE_PASSWORD || liveQueuePassword;
  if (process.env.GIGA_DISABLE_API_WORKFLOW_QUEUE !== '1' && !(await isLiveApiHealthy(port))) {
    await ensureLiveQueueTopics({ requestTopic: queueEnv.WORKFLOW_QUEUE_REQUEST_TOPIC, eventsTopic: queueEnv.WORKFLOW_QUEUE_EVENTS_TOPIC });
  }
  let sessionHeader = LIVE_SESSION_HEADERS.get(userId) || '';
  if (!sessionHeader) {
    sessionHeader = await createUserSessionHeader(userId, email, { fastAppToken: process.env.CHAT_PARITY_FAST_AUTH === '1' });
    LIVE_SESSION_HEADERS.set(userId, sessionHeader);
  }
  const session = {
    server: await startLiveApi(port, queueEnv),
    sessionHeader,
    url: `http://localhost:${port}/api/v2/graphql`,
    userId,
  };
  LIVE_SESSIONS.set(userId, session);
  return session;
}

export async function closeLiveSession(session: LiveSession): Promise<void> {
  await stopLiveApi(session.server);
  session.server = null;
}

export function chatGraphql<T>(session: LiveSession, query: string, variables: Record<string, unknown>): Promise<T> {
  return graphqlRequest<T>(session.url, session.sessionHeader, query, variables);
}

export function liveSessionForUser(userId: string) {
  const session = LIVE_SESSIONS.get(userId);
  if (!session) throw new Error(`No live GraphQL session is registered for user ${userId}.`);
  return session;
}

export async function assertLiveDataPlaneReady(session: LiveSession) {
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.CHAT_PARITY_PREFLIGHT_TIMEOUT_MS || 15_000);
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for live chat data-plane preflight.`)), timeoutMs);
  });
  try {
    await Promise.race([chatGraphql(session, PREFLIGHT_QUERY, {}), timeout]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Live chat data-plane preflight failed after ${Date.now() - startedAt}ms. Matrix lanes were not launched. ${message}`);
  } finally {
    clearTimeout(timer!);
  }
  return { durationMs: Date.now() - startedAt };
}

export async function createLiveChatScope(userOrSession: string | LiveSession, options: { name?: string; parentChannelId?: string } = {}) {
  const session = typeof userOrSession === 'string' ? liveSessionForUser(userOrSession) : userOrSession;
  const id = randomUUID();
  const scopeSlug = `chat-live-${id.slice(0, 8)}`;
  const name = String(options.name || `query-chat ${scopeSlug}`).trim();
  const resolvedParent = String(options.parentChannelId || '').trim() || String((await ensureScopeParent(session))?.id || '').trim();
  if (!resolvedParent) throw new Error('Could not resolve giga-ai-test scoped parent channel.');
  await createChannelViaGraphql(session, { id, name, parentChannelId: resolvedParent, slug: scopeSlug });
  return {
    type: 'CHANNEL',
    id,
    organizationId: null,
  };
}

export function socketEvent(socket: Socket, event: string, accept: (payload: any) => boolean = () => true, timeoutMs = 240_000) {
  return new Promise<any>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const handler = (payload: any) => {
      if (!accept(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    socket.on(event, handler);
  });
}

export async function openChatSocket(port: number, sessionHeader: string) {
  const socket = io(`http://localhost:${port}`, {
    path: '/ws/chat',
    auth: { token: sessionHeader },
    transports: ['websocket'],
  });
  await socketEvent(socket, 'chat:ready');
  return socket;
}

export async function socketChat(socket: Socket, payload: Record<string, unknown>) {
  const requestId = String(payload.request_id || '');
  const ack = socketEvent(socket, 'chat:ack', (event) => event?.request_id === requestId);
  socket.emit('chat:send', payload);
  const done = await new Promise<any>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('chat:assistant:done', onDone);
      socket.off('chat:error', onError);
    };
    const onDone = (event: any) => {
      if (event?.request_id !== requestId) return;
      cleanup();
      resolve(event);
    };
    const onError = (event: any) => {
      if (event?.request_id !== requestId) return;
      cleanup();
      reject(new Error(String(event?.error || 'Socket chat request failed.')));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for chat:assistant:done or chat:error.'));
    }, 240_000);
    socket.on('chat:assistant:done', onDone);
    socket.on('chat:error', onError);
  });
  return {
    ack: await ack,
    done,
  };
}
