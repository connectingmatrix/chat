import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  createLiveQueueTestEnvironment,
  deleteLiveQueueTopics,
  ensureLiveQueueTopics,
} from '@connectingmatrix/workflows/services/workflow/queue/__tests__/workflow-webhook-live.runtime.fixture';
import { cleanupCreated } from './chat-giga-live.cleanup';
import { chatGraphql, closeLiveSession, createLiveChatScope, LiveSession, readLiveSession } from './chat-giga-live.fixture';
import { createdIds } from './chat-giga-live.ids';
import { CHAT_CONFIRM, CHAT_QUERY, LIVE_CHAT_EMAIL, LIVE_CHAT_PORT, TREE_QUERY } from './chat-giga-live.queries';
import { attachPublishedParityWorkflow } from './chat-parity-workflow.fixture';

const ids = createdIds();
enum DebugDeleteSystemEnum {
  WorkflowAIAgent = 'workflow-ai-agent',
}
const SYSTEMS = [DebugDeleteSystemEnum.WorkflowAIAgent] as const;
const SUITE_PREFIX = `debug-delete-prefix-${Date.now().toString(36)}`;
let session: { sessionHeader: string; userId: string };
let queue: { eventsTopic: string; requestTopic: string };
let liveSession: LiveSession | null = null;

const slug = (value: string) =>
  `${value}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const hasGenericFailure = (value: string) =>
  value.toLowerCase().includes('sorry, i encountered an error') || value.toLowerCase().includes('unexpected error occurred');
const hasTechnicalPlanningText = (value: string) =>
  value.toLowerCase().includes('planner') || value.toLowerCase().includes('fallback') || value.toLowerCase().includes('mutation was executed');
const CREATE_CHANNEL = /* GraphQL */ `
  mutation CreateLiveDebugChannel($input: AI_CreateChannelInput!) {
    gigaCreateChannel(input: $input) {
      channel {
        id
      }
    }
  }
`;
type TreeNode = {
  id: string;
  name: string;
  children?: TreeNode[];
};
type TreeResponse = {
  aiFetchUserTree: {
    global: TreeNode[];
    organization: TreeNode[];
    user: TreeNode[];
  };
};
type CreateChannelResponse = {
  gigaCreateChannel: {
    channel: {
      id: string;
    };
  };
};
type ChatQueryResponse = {
  chatQuery: {
    chat?: { id?: string | null } | null;
    answer?: { text?: string | null } | null;
    debug?: { execution_mode?: string | null } | null;
    agent?: {
      requires_confirmation?: boolean | null;
      pending_actions?: Array<Record<string, unknown>> | null;
      action_results?: Array<Record<string, unknown>> | null;
    } | null;
  };
};
type ChatConfirmResponse = {
  chatConfirm: {
    answer?: { text?: string | null } | null;
    agent?: {
      action_results?: Array<Record<string, unknown>> | null;
    } | null;
  };
};

const treeHasId = (tree: TreeResponse['aiFetchUserTree'], id: string) => {
  const stack = [...(tree?.user || []), ...(tree?.organization || []), ...(tree?.global || [])];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (String(node.id || '') === id) return true;
    for (const child of node.children || []) stack.push(child);
  }
  return false;
};

const treeHasName = (tree: TreeResponse['aiFetchUserTree'], name: string) => {
  const stack = [...(tree?.user || []), ...(tree?.organization || []), ...(tree?.global || [])];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (String(node.name || '') === name) return true;
    for (const child of node.children || []) stack.push(child);
  }
  return false;
};
const readTree = async () => {
  if (!liveSession) throw new Error('Live GraphQL session is not initialized.');
  const tree = await chatGraphql<TreeResponse>(liveSession, TREE_QUERY, {
    input: { includeGlobal: true, userPermissionsId: session.userId },
  });
  return tree.aiFetchUserTree;
};

const seedDebugChannels = async (scopeId: string, prefix: string) => {
  if (!liveSession) throw new Error('Live GraphQL session is not initialized.');
  const names = [`${prefix}-alpha`, `${prefix}-beta`, `${prefix}-gamma`];
  for (const name of names) {
    const id = randomUUID();
    const created = await chatGraphql<CreateChannelResponse>(liveSession, CREATE_CHANNEL, {
      input: {
        parentChannelId: scopeId,
        channel: {
          id,
          name,
          slug: `${slug(name)}-${id.slice(0, 6)}`,
        },
      },
    });
    ids.channels.add(String(created.gigaCreateChannel.channel.id || ''));
  }
  return names;
};

const runSystemCase = async (system: (typeof SYSTEMS)[number]) => {
  if (!liveSession) throw new Error('Live GraphQL session is not initialized.');
  const scope = await createLiveChatScope(liveSession);
  ids.channels.add(scope.id);
  if (system === DebugDeleteSystemEnum.WorkflowAIAgent) {
    await attachPublishedParityWorkflow({
      description: 'Debug-prefix delete parity live test workflow scope.',
      ids: { workflows: ids.workflows },
      liveTest: 'chat-delete-debug-prefix-live',
      scopeId: scope.id,
      system: 'ai-agent',
      userId: session.userId,
    });
  }
  const prefix = `${SUITE_PREFIX}-${system}`;
  const seededNames = await seedDebugChannels(scope.id, prefix);
  const pendingResult = await chatGraphql<ChatQueryResponse>(liveSession, CHAT_QUERY, {
    input: {
      message: `Delete all channels that start from '${prefix}' in name.`,
      scope: { id: scope.id, organizationId: scope.organizationId, type: 'CHANNEL' },
      top_k: 8,
    },
  });
  console.log('DEBUG_CHAT_QUERY', JSON.stringify(pendingResult, null, 2));
  const pending = pendingResult.chatQuery;
  void system;
  assert.equal(hasGenericFailure(String(pending.answer?.text || '')), false, JSON.stringify(pending, null, 2));
  assert.equal(hasTechnicalPlanningText(String(pending.answer?.text || '')), false, JSON.stringify(pending, null, 2));
  const confirmedResult = await chatGraphql<ChatConfirmResponse>(liveSession, CHAT_CONFIRM, {
    input: { chat_id: String(pending.chat?.id || ''), decision: 'confirm' },
  });
  console.log('DEBUG_CHAT_CONFIRM', JSON.stringify(confirmedResult, null, 2));
  const confirmed = confirmedResult.chatConfirm;
  const confirmedText = String(confirmed.answer?.text || '').trim();
  assert.equal(Boolean(confirmedText), true, JSON.stringify(confirmed, null, 2));
  assert.equal(hasGenericFailure(confirmedText), false, JSON.stringify(confirmed, null, 2));
  const results = confirmed.agent?.action_results || [];
  const deleteResult = results.find((entry: any) => {
    const name = String(entry?.name || '').toLowerCase();
    const reason = String(entry?.reason || '').toLowerCase();
    return name === 'delete_channel' || (name.includes('channel') && (reason.includes('delete') || Number(entry?.data?.deleted_count || 0) > 0));
  });
  if (deleteResult) {
    assert.equal(String(deleteResult?.status || '').toLowerCase(), 'completed', JSON.stringify(deleteResult, null, 2));
    const summaryDeletedCount = Number(String(deleteResult?.summary || '').match(/\"deleted_count\"\s*:\s*(\d+)/)?.[1] || 0);
    const deletedCount = Number(deleteResult?.data?.deleted_count || 0) || summaryDeletedCount;
    assert.equal(deletedCount >= seededNames.length, true, JSON.stringify(deleteResult, null, 2));
  }
  const tree = await readTree();
  assert.equal(treeHasId(tree, scope.id), true, `Host scope channel was deleted for ${system}.`);
  for (const name of seededNames) assert.equal(treeHasName(tree, name), false, `Seed channel still exists for ${system}: ${name}`);
};

before(async () => {
  const suffix = `chat-delete-prefix-${Date.now().toString(36)}`;
  queue = createLiveQueueTestEnvironment(suffix);
  await ensureLiveQueueTopics(queue);
  liveSession = await readLiveSession(LIVE_CHAT_PORT + 9, LIVE_CHAT_EMAIL);
  session = { sessionHeader: liveSession.sessionHeader, userId: liveSession.userId };
});

after(async () => {
  if (liveSession) await closeLiveSession(liveSession).catch(() => {});
  await deleteLiveQueueTopics(queue).catch(() => {});
  await cleanupCreated(ids);
});

test('live direct queryChat deletes scoped debug-prefix channels for workflow-ai-agent', async () => {
  await runSystemCase(DebugDeleteSystemEnum.WorkflowAIAgent);
});
