import { unique } from 'giga-ai-helper';
import { CategoryEntity, ChannelEntity, OrganisationEntity, PostEntity, SubjectEntity } from '@connectingmatrix/orm/repositories/entities';
import { fetchUserTree } from '@giga/tree/services/giga/tree/read/fetchUserTree';
import { TreeNode } from '@giga/shared/types/contracts/graph.types';
import { ChatScope, ChatScopeSnapshot, ChatScopeType, CHAT_SCOPE_TYPES, ChatSessionRecord, ResolvedChatScope } from '../contracts/types';

function normalizeId(value: string | null | undefined) {
  return String(value || '').trim();
}

function normalizeIds(values: Array<string | null | undefined>) {
  return unique(values.map((value) => normalizeId(value)).filter(Boolean));
}

export function isChatScopeType(value: string | null | undefined): value is ChatScopeType {
  return CHAT_SCOPE_TYPES.includes(String(value || '').trim() as ChatScopeType);
}

export function normalizeChatScopeInput(input: {
  scope?: Partial<ChatScope> | null;
  subjectId?: string | null;
  subjectIds?: string[] | null;
  postId?: string | null;
  allowEmpty?: boolean;
}): ChatScope | null {
  const scopeType = normalizeId(input.scope?.type);
  const scopeId = normalizeId(input.scope?.id);

  if (scopeType || scopeId) {
    if (!isChatScopeType(scopeType) || !scopeId) {
      throw new Error('scope.type and scope.id are required for exact-scope chats.');
    }

    return {
      type: scopeType,
      id: scopeId,
      organizationId: normalizeId(input.scope?.organizationId) || null,
    };
  }

  const postId = normalizeId(input.postId);
  const subjectIds = normalizeIds([input.subjectId || null, ...(input.subjectIds || [])]);

  if (postId && subjectIds.length) {
    throw new Error('A chat session can scope to subject or post, not both.');
  }

  if (subjectIds.length > 1) {
    throw new Error('Exact-scope chats require a single subject id.');
  }

  if (postId) {
    return { type: 'post', id: postId };
  }

  if (subjectIds.length === 1) {
    return { type: 'subject', id: subjectIds[0] };
  }

  if (input.allowEmpty) return null;
  throw new Error('chat scope is required.');
}

export function getSessionScope(session: ChatSessionRecord): ChatScope | null {
  if (!isChatScopeType(session.scope_type) || !normalizeId(session.scope_id)) {
    return null;
  }

  const snapshot = session.scope_snapshot && typeof session.scope_snapshot === 'object' ? session.scope_snapshot : null;
  return {
    type: session.scope_type,
    id: normalizeId(session.scope_id),
    organizationId: normalizeId(snapshot?.organizationId as string | null | undefined) || null,
  };
}

export function getSessionSnapshotScope(session: ChatSessionRecord): ResolvedChatScope | null {
  const scope = getSessionScope(session);
  const snapshot = session.scope_snapshot || null;
  if (!scope || !snapshot || snapshot.legacy || snapshot.type !== scope.type || snapshot.id !== scope.id) return null;

  const subjectIds = normalizeIds([
    scope.type === 'subject' ? scope.id : null,
    snapshot.subject_id || null,
    ...((snapshot.subject_ids || []) as string[]),
  ]);
  const postIds = normalizeIds([scope.type === 'post' ? scope.id : null, snapshot.post_id || null, ...((snapshot.post_ids || []) as string[])]);

  return {
    scope,
    snapshot: {
      ...snapshot,
      id: scope.id,
      organizationId: scope.organizationId || null,
      post_ids: postIds,
      subject_ids: subjectIds,
      type: scope.type,
    },
    post_ids: postIds,
    subject_ids: subjectIds,
  };
}

export function getLegacySessionScope(session: ChatSessionRecord): ResolvedChatScope | null {
  const legacy = session.metadata && typeof session.metadata === 'object' ? (session.metadata.legacy_scope as Record<string, unknown> | null) : null;
  const scopeSnapshot = session.scope_snapshot || null;

  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    return null;
  }

  const subjectIds = normalizeIds((legacy.subject_ids as string[] | undefined) || []);
  const postIds = normalizeIds([...((legacy.post_ids as string[] | undefined) || []), typeof legacy.post_id === 'string' ? legacy.post_id : null]);

  const fallbackType = isChatScopeType(session.scope_type) ? session.scope_type : 'subject';
  const fallbackId = normalizeId(session.scope_id) || session.id;
  const snapshot: ChatScopeSnapshot = {
    type: fallbackType,
    id: fallbackId,
    legacy: true,
    subject_ids: subjectIds,
    post_ids: postIds,
    ...scopeSnapshot,
  };

  return {
    scope: {
      type: fallbackType,
      id: fallbackId,
      organizationId: normalizeId(scopeSnapshot?.organizationId as string | null | undefined) || null,
    },
    snapshot,
    subject_ids: subjectIds,
    post_ids: postIds,
  };
}

function collectTreeNodeScope(root: TreeNode, scope: ChatScope): ResolvedChatScope {
  const subjectIds = new Set<string>();
  const postIds = new Set<string>();

  const visit = (node: TreeNode) => {
    if (node.nodeType === 'SUBJECT') {
      subjectIds.add(node.id);
      (node.posts || []).forEach((post) => {
        if (post?.id) postIds.add(post.id);
      });
    }

    (node.children || []).forEach(visit);
  };

  visit(root);

  return {
    scope,
    snapshot: {
      type: scope.type,
      id: scope.id,
      organizationId: scope.organizationId || null,
      name: root.name || null,
      slug: root.slug || null,
      is_global: Boolean(root.isGlobal),
      subject_ids: Array.from(subjectIds),
      post_ids: Array.from(postIds),
    },
    subject_ids: Array.from(subjectIds),
    post_ids: Array.from(postIds),
  };
}

async function organizationAccessRows(supabase: any, userId: string, organizationId: string, scope: ChatScope) {
  const access = await OrganisationEntity.readScopeAccessRows(userId, organizationId);
  if (!access.organization || access.organization.is_active === false || !access.membership)
    throw new Error(`${scope.type} scope could not be resolved.`);
  return access.restrictions;
}

function deniedSet(rows: any[], targetType: string) {
  const values = new Set<string>();
  for (const row of rows) if (String(row?.target_type || '').toUpperCase() === targetType && row?.target_id) values.add(String(row.target_id));
  return values;
}

async function resolveOrganizationTreeScope(supabase: any, userId: string, scope: ChatScope): Promise<ResolvedChatScope | null> {
  const organizationId = normalizeId(scope.organizationId);
  if (!organizationId || (scope.type !== 'channel' && scope.type !== 'category')) return null;
  const restrictions = await organizationAccessRows(supabase, userId, organizationId, scope);
  const deniedChannels = deniedSet(restrictions, 'CHANNEL');
  const deniedCategories = deniedSet(restrictions, 'CATEGORY');
  const deniedSubjects = deniedSet(restrictions, 'SUBJECT');
  const deniedPosts = deniedSet(restrictions, 'POST');
  const targetType = scope.type === 'channel' ? 'CHANNEL' : 'CATEGORY';
  if ((targetType === 'CHANNEL' ? deniedChannels : deniedCategories).has(scope.id)) throw new Error(`${scope.type} scope could not be resolved.`);
  const rows = (
    scope.type === 'channel'
      ? await ChannelEntity.readOrganizationScopeRows({ id: scope.id, organizationId })
      : await CategoryEntity.readOrganizationScopeRows({ id: scope.id, organizationId })
  ) as Array<{
    root?: Record<string, unknown>;
    subjectId?: string;
    channelIds?: string[];
    categoryIds?: string[];
  }>;
  const root = rows[0]?.root || null;
  if (!root) throw new Error(`${scope.type} scope could not be resolved.`);
  const subjectIds: string[] = [];
  for (const item of rows) {
    const id = normalizeId(item?.subjectId);
    if (!id || deniedSubjects.has(id)) continue;
    if ((item?.channelIds || []).some((entry: string) => deniedChannels.has(entry))) continue;
    if ((item?.categoryIds || []).some((entry: string) => deniedCategories.has(entry))) continue;
    subjectIds.push(id);
  }
  const posts = subjectIds.length ? await PostEntity.listIdsBySubjectIds(normalizeIds(subjectIds)) : [];
  const postIds = normalizeIds(posts.map((post: any) => post.id)).filter((id) => !deniedPosts.has(id));
  return {
    scope,
    snapshot: {
      type: scope.type,
      id: scope.id,
      organizationId,
      name: String(root.name || '').trim() || null,
      slug: String(root.slug || '').trim() || null,
      is_global: root.isGlobal === true,
      subject_ids: normalizeIds(subjectIds),
      post_ids: postIds,
    },
    subject_ids: normalizeIds(subjectIds),
    post_ids: postIds,
  };
}

export async function resolveChatScopeContext(supabase: any, userId: string, scope: ChatScope): Promise<ResolvedChatScope> {
  if (scope.type === 'temporary') {
    return {
      scope,
      snapshot: {
        type: 'temporary',
        id: scope.id,
        organizationId: scope.organizationId || null,
        subject_ids: [],
        post_ids: [],
      },
      subject_ids: [],
      post_ids: [],
    };
  }
  if (scope.type === 'subject') {
    const [subject, posts] = (await Promise.all([SubjectEntity.readScopeRow(scope.id), PostEntity.listIdsBySubjectId(scope.id)])) as [
      Record<string, unknown> | null,
      Array<{ id: string }>,
    ];
    if (!subject?.id) {
      throw new Error('Subject scope could not be resolved.');
    }

    return {
      scope,
      snapshot: {
        type: 'subject',
        id: scope.id,
        organizationId: scope.organizationId || null,
        name: String(subject.name || '').trim() || null,
        slug: String(subject.slug || '').trim() || null,
        subject_ids: [scope.id],
        post_ids: normalizeIds(posts.map((post: any) => post.id)),
      },
      subject_ids: [scope.id],
      post_ids: normalizeIds(posts.map((post: any) => post.id)),
    };
  }

  if (scope.type === 'post') {
    const post = (await PostEntity.readScopeRow(scope.id)) as Record<string, unknown> | null;
    if (!post?.id) {
      throw new Error('Post scope could not be resolved.');
    }

    return {
      scope,
      snapshot: {
        type: 'post',
        id: scope.id,
        organizationId: scope.organizationId || null,
        name: String(post.title || '').trim() || null,
        subject_id: String(post.subject_id || '').trim() || null,
        subject_ids: normalizeIds([String(post.subject_id || '').trim() || null]),
        post_id: String(post.id || ''),
        post_ids: [String(post.id || '')],
      },
      subject_ids: normalizeIds([String(post.subject_id || '').trim() || null]),
      post_ids: [String(post.id || '')],
    };
  }

  const organizationScope = await resolveOrganizationTreeScope(supabase, userId, scope);
  if (organizationScope) return organizationScope;

  const forest = await fetchUserTree(supabase, {
    userPermissionsId: userId,
    organizationId: scope.organizationId || null,
    rootId: scope.id,
    includeGlobal: true,
  });

  const roots = [...(forest.user || []), ...(forest.organization || []), ...(forest.global || [])];
  const root = roots.find((entry) => entry.id === scope.id) || null;
  if (!root) {
    throw new Error(`${scope.type} scope could not be resolved.`);
  }

  return collectTreeNodeScope(root, scope);
}
