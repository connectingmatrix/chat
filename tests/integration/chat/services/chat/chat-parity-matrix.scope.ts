import { randomUUID } from 'node:crypto';
import { attachPublishedParityWorkflows, chatParityWorkflowFixtureHash, refreshPublishedParityWorkflows } from './chat-parity-workflow.fixture';
import { chatGraphql, LiveSession } from './chat-giga-live.fixture';
import { CreatedIds } from './chat-giga-live.ids';
import { TREE_QUERY } from './chat-giga-live.queries';

export enum ParitySystemEnum {
  ChatOnly = 'chat-only',
  WorkflowLegacy = 'workflow-legacy',
  WorkflowAIAgent = 'workflow-ai-agent',
}
export const PARITY_SYSTEMS = [ParitySystemEnum.ChatOnly, ParitySystemEnum.WorkflowLegacy, ParitySystemEnum.WorkflowAIAgent] as const;
export type ParitySystem = (typeof PARITY_SYSTEMS)[number];
export type ParityScopeRequest = {
  label: string;
  laneKey: string;
  scopeId?: string | null;
  scopeName?: string | null;
  workflowFixtureHash?: string | null;
  workflowId?: string | null;
};
type MatrixTreeNode = { children?: MatrixTreeNode[]; id: string; name: string; nodeType: string; slug?: string | null };
export const paritySystem = (value: string | undefined): ParitySystem | null => {
  if (value === ParitySystemEnum.ChatOnly || value === ParitySystemEnum.WorkflowLegacy || value === ParitySystemEnum.WorkflowAIAgent) {
    return value;
  }
  return null;
};

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CREATE_CHANNEL = /* GraphQL */ `
  mutation CreateMatrixChannel($input: AI_CreateChannelInput!) {
    gigaCreateChannel(input: $input) {
      channel {
        id
        name
        slug
      }
    }
  }
`;

function findPath(nodes: MatrixTreeNode[], names: string[]) {
  let currentNodes = nodes;
  let current: MatrixTreeNode | null = null;
  for (const name of names) {
    current = currentNodes.find((node) => node.name === name) || null;
    if (!current) return null;
    currentNodes = current.children || [];
  }
  return current;
}

function findNodeById(nodes: MatrixTreeNode[], id: string): MatrixTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children || [], id);
    if (child) return child;
  }
  return null;
}

async function readTree(session: LiveSession, input: { rootId?: string | null; rootType?: string | null } = {}) {
  const result = await chatGraphql<{ aiFetchUserTree: { user: MatrixTreeNode[] } }>(session, TREE_QUERY, {
    input: { includeGlobal: false, rootId: input.rootId || null, rootType: input.rootType || null, userPermissionsId: session.userId },
  });
  return result.aiFetchUserTree.user || [];
}

async function readChannelRoot(session: LiveSession, id: string) {
  const roots = await readTree(session, { rootId: id, rootType: 'CHANNEL' });
  return findNodeById(roots, id);
}

async function createChannelViaGraphql(session: LiveSession, input: { id: string; name: string; parentChannelId?: string | null; slug: string }) {
  const result = await chatGraphql<{ gigaCreateChannel: { channel: { id: string; name: string; slug: string } } }>(session, CREATE_CHANNEL, {
    input: {
      channel: {
        id: input.id,
        name: input.name,
        slug: input.slug,
      },
      parentChannelId: input.parentChannelId || null,
    },
  });
  return result.gigaCreateChannel.channel;
}

async function ensureChannelPath(session: LiveSession, names: string[]) {
  let tree = await readTree(session);
  for (let index = 0; index < names.length; index += 1) {
    const current = findPath(tree, names.slice(0, index + 1));
    if (current) continue;
    const parent = index ? findPath(tree, names.slice(0, index)) : null;
    const id = randomUUID();
    await createChannelViaGraphql(session, {
      id,
      name: names[index],
      parentChannelId: parent?.id || null,
      slug: `${slug(names[index])}-${id.slice(0, 6)}`,
    });
    tree = await readTree(session);
  }
  return findPath(await readTree(session), names);
}
export const parityArtifactsPath = ['giga-ai-test', 'queryChat', 'matrix-artifacts'];
const baselineLaneChannels = ['WP-Global'];
const parityBranchByUser = new Map<string, Promise<MatrixTreeNode | null>>();
export async function ensureParityArtifactsChannel(session: LiveSession, existingId?: string | null) {
  const cached = parityBranchByUser.get(session.userId);
  if (cached) return cached;
  const pending = existingId
    ? readChannelRoot(session, existingId).then((channel) => channel || ensureChannelPath(session, parityArtifactsPath))
    : ensureChannelPath(session, parityArtifactsPath);
  parityBranchByUser.set(session.userId, pending);
  try {
    return await pending;
  } catch (error) {
    parityBranchByUser.delete(session.userId);
    throw error;
  }
}

const matrixScopeName = (request: ParityScopeRequest) =>
  request.scopeName || `query-chat ${slug(request.label).slice(0, 48)} ${randomUUID().slice(0, 6)}`;

export async function createParityScopes(system: ParitySystem, session: LiveSession, ids: CreatedIds, requests: ParityScopeRequest[]) {
  const branch = await ensureParityArtifactsChannel(session);
  const parentChannelId = String(branch?.id || '').trim();
  if (!parentChannelId) throw new Error('Could not resolve giga-ai-test/queryChat parent channel.');
  const branchNode = await readChannelRoot(session, parentChannelId);
  const scopes = requests.map((request) => {
    const cachedScopeId = request.scopeId && branchNode && findNodeById(branchNode.children || [], request.scopeId) ? request.scopeId : '';
    const id = cachedScopeId || request.scopeId || randomUUID();
    const name = cachedScopeId ? request.scopeName || request.label : matrixScopeName(request);
    return {
      created: !cachedScopeId,
      request,
      scope: { id, organizationId: null, type: 'channel' },
      channel: { id, name, slug: `matrix-${slug(system)}-${slug(request.laneKey)}-${id.slice(0, 8)}` },
    };
  });
  const created = scopes.filter((entry) => entry.created).map((entry) => entry.channel);
  await Promise.all(created.map((channel) => createChannelViaGraphql(session, { ...channel, parentChannelId })));
  scopes.filter((entry) => entry.created).forEach((entry) => ids.channels.add(entry.scope.id));
  const reusableWorkflowByScope = new Map(
    scopes.filter((entry) => entry.request.workflowId).map((entry) => [entry.scope.id, entry.request.workflowId as string]),
  );
  const fixtureSystem = system === ParitySystemEnum.WorkflowAIAgent ? 'ai-agent' : 'legacy';
  const fixtureHash = system === ParitySystemEnum.ChatOnly ? '' : chatParityWorkflowFixtureHash(fixtureSystem);
  const workflowByScope =
    system === ParitySystemEnum.ChatOnly
      ? new Map<string, string>()
      : new Map([
          ...reusableWorkflowByScope,
          ...(await attachPublishedParityWorkflows(
            session,
            scopes
              .filter((entry) => !reusableWorkflowByScope.has(entry.scope.id))
              .map((entry) => ({
                description: `${system} matrix scope.`,
                ids,
                liveTest: system as string,
                scopeId: entry.scope.id,
                system: fixtureSystem,
                userId: session.userId,
              })),
          )),
        ]);
  if (system !== ParitySystemEnum.ChatOnly && reusableWorkflowByScope.size) {
    await refreshPublishedParityWorkflows(
      session,
      scopes
        .filter((entry) => reusableWorkflowByScope.has(entry.scope.id) && entry.request.workflowFixtureHash !== fixtureHash)
        .map((entry) => ({
          description: `${system} matrix scope.`,
          scopeId: entry.scope.id,
          system: fixtureSystem,
          workflowId: reusableWorkflowByScope.get(entry.scope.id) || '',
        })),
    );
  }
  return scopes.map((entry) => ({
    scope: entry.scope,
    workflowFixtureHash: workflowByScope.get(entry.scope.id) ? fixtureHash : '',
    workflowId: workflowByScope.get(entry.scope.id) || '',
    sessionMetadata: null,
  }));
}

export async function ensureParityLaneFixtures(session: LiveSession, lanes: Array<{ scope: { id: string } }>) {
  await Promise.all(
    lanes.map(async (lane) => {
      const root = await readChannelRoot(session, lane.scope.id);
      await Promise.all(
        baselineLaneChannels
          .filter((name) => !findPath(root?.children || [], [name]))
          .map((name) => {
            const id = randomUUID();
            return createChannelViaGraphql(session, {
              id,
              name,
              parentChannelId: lane.scope.id,
              slug: `${slug(name)}-${id.slice(0, 6)}`,
            });
          }),
      );
    }),
  );
}

export async function createParityScope(
  system: ParitySystem,
  session: LiveSession,
  ids: CreatedIds,
  label: string,
  options?: { scopeId?: string | null; scopeName?: string | null },
) {
  const [scope] = await createParityScopes(system, session, ids, [
    { label, laneKey: label, scopeId: options?.scopeId, scopeName: options?.scopeName },
  ]);
  return scope;
}
