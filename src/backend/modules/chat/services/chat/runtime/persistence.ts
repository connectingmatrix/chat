import { SupabaseClient } from '@supabase/supabase-js';
import { toNumberOrNull } from 'giga-ai-helper';
import { getCurrentUserIdOrThrow } from '@giga/shared/lib/helper';
import { getScopedLogger } from '@connectingmatrix/logger/lib/logger';
import { ChatEntity, ChatMessageEntity, ChunkEntity, MessageChunkEntity } from '@connectingmatrix/orm/repositories/entities';
import {
  CHAT_SCOPE_TYPES,
  ChatMessageRecord,
  ChatMessageRole,
  ChatScope,
  ChatScopeSnapshot,
  ChatSessionRecord,
  RetrievedChunk,
  SourceReference,
} from '@connectingmatrix/chat/services/chat/contracts/types';
import { isChatSessionScopeConflict } from './error-manager';
import type { MessageChunkRow } from '@giga/shared/types/contracts/chat.types';

const DEFAULT_CHAT_TITLE_LENGTH = 80;
const SESSION_SELECT = [
  'id',
  'user_id',
  'title',
  'system_prompt',
  'metadata',
  'last_message_at',
  'created_at',
  'updated_at',
  'scope_type',
  'scope_id',
  'scope_snapshot',
].join(',');

export function inferChatTitle(message: string, maxLength = DEFAULT_CHAT_TITLE_LENGTH) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New chat';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Backward-compatible helper kept in persistence for callers that still import it here.
 * Canonical scope parsing lives in chat/scope.ts.
 */
export function getSessionScope(session: ChatSessionRecord): ChatScope | null {
  const scopeType = String(session.scope_type || '')
    .trim()
    .toLowerCase();
  const scopeId = String(session.scope_id || '').trim();

  if (!scopeId || !CHAT_SCOPE_TYPES.includes(scopeType as (typeof CHAT_SCOPE_TYPES)[number])) {
    return null;
  }

  const normalizedScopeType = scopeType as ChatScope['type'];
  return {
    type: normalizedScopeType,
    id: scopeId,
    organizationId: readScopeOrganizationId(session),
  };
}

function normalizeMessageChunkRow(row: any): MessageChunkRow | null {
  const messageId = toNumberOrNull(row?.message_id);
  const chunkId = toNumberOrNull(row?.chunk_id);
  if (!messageId || !chunkId) return null;

  return {
    message_id: messageId,
    chunk_id: chunkId,
    rank: toNumberOrNull(row.rank),
    similarity: toNumberOrNull(row.similarity),
    subject_id: row.subject_id || null,
    post_id: row.post_id || null,
    attachment_id: row.attachment_id || null,
    source_kind: row.source_kind || null,
    chunk_index: toNumberOrNull(row.chunk_index),
    token_count: toNumberOrNull(row.token_count),
    content: row.content || null,
    metadata: row.metadata || null,
  };
}

const logger = getScopedLogger('chat-persistence-service');

function isLegacySession(session: ChatSessionRecord | null | undefined) {
  return Boolean(session?.metadata && typeof session.metadata?.legacy_scope === 'object');
}

function readScopeOrganizationId(session: ChatSessionRecord | null | undefined) {
  const snapshot = session?.scope_snapshot && typeof session.scope_snapshot === 'object' ? session.scope_snapshot : null;
  const organizationId = String(snapshot?.organizationId || '').trim();
  return organizationId || null;
}

async function tryRpcMessageChunkRetrieval(supabase: any, chatId: string, messageIds: number[]): Promise<MessageChunkRow[] | null> {
  void supabase;
  void chatId;
  void messageIds;
  return null;
}

async function fallbackMessageChunkRetrieval(supabase: any, messageIds: number[]): Promise<MessageChunkRow[]> {
  if (!messageIds.length) return [];

  const mappings = await MessageChunkEntity.findByMessageIds(messageIds);
  if (!mappings?.length) return [];

  const chunkIds = Array.from(
    new Set(mappings.map((mapping: any) => toNumberOrNull(mapping.chunk_id)).filter((chunkId) => chunkId !== null)),
  ) as number[];

  if (!chunkIds.length) return [];

  const chunks = await ChunkEntity.findByIds(chunkIds);

  const chunkMap = new Map<number, any>();
  for (const chunk of chunks || []) {
    const chunkId = toNumberOrNull(chunk.id);
    if (!chunkId) continue;
    chunkMap.set(chunkId, chunk);
  }

  return (mappings || [])
    .map((mapping: any) => {
      const chunkId = toNumberOrNull(mapping.chunk_id);
      const messageId = toNumberOrNull(mapping.message_id);
      if (!chunkId || !messageId) return null;

      const chunk = chunkMap.get(chunkId);
      return normalizeMessageChunkRow({
        message_id: messageId,
        chunk_id: chunkId,
        rank: mapping.rank,
        similarity: mapping.similarity,
        subject_id: chunk?.subject_id || null,
        post_id: chunk?.post_id || null,
        attachment_id: chunk?.attachment_id || null,
        source_kind: chunk?.source_kind || null,
        chunk_index: chunk?.chunk_index ?? null,
        token_count: chunk?.token_count ?? null,
        content: chunk?.content || null,
        metadata: chunk?.metadata || null,
      });
    })
    .filter(Boolean) as MessageChunkRow[];
}

async function loadMessageChunks(supabase: any, chatId: string, messageIds: number[]): Promise<Map<number, MessageChunkRow[]>> {
  const grouped = new Map<number, MessageChunkRow[]>();
  if (!messageIds.length) return grouped;

  const rpcRows = await tryRpcMessageChunkRetrieval(supabase, chatId, messageIds);
  const rows = rpcRows || (await fallbackMessageChunkRetrieval(supabase, messageIds));

  if (!rpcRows) {
    logger.debug('chat.message_chunks.fallback.used', { chat_id: chatId, rows: rows.length });
  }

  for (const row of rows) {
    const list = grouped.get(row.message_id) || [];
    list.push(row);
    grouped.set(row.message_id, list);
  }

  return grouped;
}

export async function getCurrentUserId(supabase: any): Promise<string> {
  return getCurrentUserIdOrThrow(supabase);
}

export async function getSessionById(supabase: SupabaseClient, userId: string, chatId: string): Promise<ChatSessionRecord | null> {
  const session = await ChatEntity.readSessionRow(chatId);
  const row = session ? (session.extract() as ChatSessionRecord) : null;
  if (!row) return null;
  return String(row.user_id || '') === String(userId || '') ? row : null;
}

export async function getSessionByScope(supabase: SupabaseClient, userId: string, scope: ChatScope): Promise<ChatSessionRecord | null> {
  const sessions = await ChatEntity.listByScopeForUser({
    userId,
    scopeType: scope.type,
    scopeId: scope.id,
    first: 20,
    offset: 0,
  });
  const rows = sessions.map((session) => session.extract() as ChatSessionRecord);
  return rows.find((session) => readScopeOrganizationId(session) === (scope.organizationId || null)) || null;
}

export async function getChatSession(
  supabase: SupabaseClient,
  userId: string,
  params: { chatId?: string; scope?: ChatScope | null },
): Promise<ChatSessionRecord | null> {
  if (params.chatId) {
    return getSessionById(supabase, userId, params.chatId);
  }

  if (!params.scope) {
    return null;
  }

  return getSessionByScope(supabase, userId, params.scope);
}

export async function createSession(
  supabase: any,
  params: {
    userId: string;
    scope: ChatScope;
    title?: string | null;
    systemPrompt?: string | null;
    metadata?: Record<string, any> | null;
    scopeSnapshot?: ChatScopeSnapshot | null;
  },
): Promise<ChatSessionRecord> {
  // prettier-ignore
  logger.info('chat.session.create.started', { scope_type: params.scope.type, scope_id: params.scope.id, has_system_prompt: Boolean(params.systemPrompt), });
  const scopeSnapshot =
    params.scopeSnapshot || params.scope.organizationId
      ? {
          ...(params.scopeSnapshot || {}),
          organizationId: params.scope.organizationId || null,
        }
      : null;
  const timestamp = new Date().toISOString();
  const entity = await ChatEntity.createSessionRow({
    user_id: params.userId,
    title: params.title || null,
    system_prompt: params.systemPrompt || null,
    metadata: params.metadata || null,
    last_message_at: timestamp,
    scope_type: params.scope.type,
    scope_id: params.scope.id,
    scope_snapshot: scopeSnapshot,
  });
  const data = entity.extract() as ChatSessionRecord;

  logger.info('chat.session.create.completed', { chat_id: data.id, scope_type: data.scope_type, scope_id: data.scope_id });

  return data as ChatSessionRecord;
}

export async function updateSession(supabase: any, chatId: string, patch: Record<string, any>): Promise<void> {
  await ChatEntity.updateSessionById(chatId, patch);
}

export async function ensureSession(
  supabase: any,
  params: {
    userId: string;
    chatId?: string;
    scope?: ChatScope | null;
    titleFromMessage?: string;
    systemPrompt?: string | null;
    metadata?: Record<string, any> | null;
    scopeSnapshot?: ChatScopeSnapshot | null;
  },
): Promise<{ session: ChatSessionRecord; created: boolean }> {
  // prettier-ignore
  logger.debug('chat.session.ensure.started', { chat_id: params.chatId || null, scope_type: params.scope?.type || null, scope_id: params.scope?.id || null, });
  if (params.chatId) {
    const existing = await getSessionById(supabase, params.userId, params.chatId);
    if (!existing) throw new Error('Chat session not found.');
    // prettier-ignore
    logger.info('chat.session.ensure.existing', { chat_id: existing.id, scope_type: existing.scope_type, scope_id: existing.scope_id, legacy: isLegacySession(existing), });
    return {
      session: existing,
      created: false,
    };
  }

  if (!params.scope) {
    throw new Error('chat scope is required when creating a session.');
  }

  const existing = await getSessionByScope(supabase, params.userId, params.scope);
  if (existing) {
    logger.info('chat.session.ensure.reused', { chat_id: existing.id, scope_type: existing.scope_type, scope_id: existing.scope_id });
    return {
      session: existing,
      created: false,
    };
  }

  const title = inferChatTitle(params.titleFromMessage || '');
  let created: ChatSessionRecord;
  try {
    created = await createSession(supabase, {
      userId: params.userId,
      scope: params.scope,
      title,
      systemPrompt: params.systemPrompt || null,
      metadata: params.metadata || null,
      scopeSnapshot: params.scopeSnapshot || null,
    });
  } catch (error: unknown) {
    if (!isChatSessionScopeConflict(error)) throw error;

    const reused = await getSessionByScope(supabase, params.userId, params.scope);
    if (!reused) throw error;

    logger.info('chat.session.ensure.reused_after_conflict', { chat_id: reused.id, scope_type: reused.scope_type, scope_id: reused.scope_id });

    return {
      session: reused,
      created: false,
    };
  }

  logger.info('chat.session.ensure.created', { chat_id: created.id, scope_type: created.scope_type, scope_id: created.scope_id });

  return {
    session: created,
    created: true,
  };
}

export async function saveMessage(
  supabase: any,
  params: {
    chatId: string;
    userId: string;
    role: ChatMessageRole;
    content: string;
    sourceRefs?: SourceReference[] | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
  },
): Promise<ChatMessageRecord> {
  // prettier-ignore
  logger.debug('chat.message.save.started', { chat_id: params.chatId, role: params.role, content_chars: params.content?.length || 0, has_source_refs: Boolean(params.sourceRefs?.length), });
  const data = await ChatMessageEntity.createMessage({
    chat_id: params.chatId,
    user_id: params.userId,
    role: params.role,
    content: params.content,
    source_refs: params.sourceRefs || null,
    prompt_tokens: params.promptTokens ?? null,
    completion_tokens: params.completionTokens ?? null,
  });
  const message = data.extract() as ChatMessageRecord;
  logger.debug('chat.message.save.completed', { chat_id: params.chatId, role: params.role, message_id: message.id });
  return message;
}

export async function saveMessageChunkUsage(supabase: any, messageId: number, chunks: RetrievedChunk[]): Promise<void> {
  if (!chunks.length) {
    logger.debug('chat.message_chunks.save.skipped', { message_id: messageId, reason: 'no_chunks' });
    return;
  }

  const rows = chunks.map((chunk, index) => ({
    message_id: messageId,
    chunk_id: chunk.chunk_id,
    rank: chunk.rank || index + 1,
    similarity: chunk.similarity ?? 0,
  }));

  await MessageChunkEntity.saveUsage({ messageId, chunks: rows });
  logger.debug('chat.message_chunks.save.completed', { message_id: messageId, rows: rows.length });
}

export async function touchSession(supabase: any, chatId: string) {
  await updateSession(supabase, chatId, {
    last_message_at: new Date().toISOString(),
  });
  logger.debug('chat.session.touch.completed', { chat_id: chatId });
}

export async function listSessions(
  supabase: any,
  userId: string,
  options?: {
    scope?: ChatScope | null;
    limit?: number;
    offset?: number;
  },
) {
  const startedAt = Date.now();
  const limit = Math.min(100, Math.max(1, options?.limit || 20));
  const offset = Math.max(0, options?.offset || 0);

  // prettier-ignore
  logger.debug('chat.sessions.list.query.started', { user_id: userId, scope_type: options?.scope?.type || null, scope_id: options?.scope?.id || null, limit, offset, });

  const data = await ChatEntity.listByUserScope({
    userId,
    scopeType: options?.scope?.type,
    scopeId: options?.scope?.id,
    columns: SESSION_SELECT,
    range: { from: offset, to: offset + Math.max(limit * 3, limit) - 1 },
  });

  const filtered = (data || [])
    .map((session) => session as unknown as ChatSessionRecord)
    .filter((session) => (!options?.scope ? true : readScopeOrganizationId(session) === (options.scope.organizationId || null)))
    .filter((session) => !isLegacySession(session))
    .slice(0, limit);

  const payload = {
    data: filtered,
    count: filtered.length,
    limit,
    offset,
  };

  logger.info('chat.sessions.list.query.completed', { user_id: userId, count: payload.count, duration_ms: Date.now() - startedAt });

  return payload;
}

export async function listMessages(
  supabase: any,
  userId: string,
  chatId: string,
  options?: {
    limit?: number;
    offset?: number;
  },
) {
  const startedAt = Date.now();
  // prettier-ignore
  logger.debug('chat.messages.list.query.started', { user_id: userId, chat_id: chatId, limit: options?.limit || null, offset: options?.offset || null, });

  const session = await getSessionById(supabase, userId, chatId);
  if (!session) throw new Error('Chat session not found.');

  const limit = Math.min(200, Math.max(1, options?.limit || 100));
  const offset = Math.max(0, options?.offset || 0);

  const messageResult = await ChatMessageEntity.listMessagesPage({
    chatId,
    first: limit,
    offset,
  });

  const messageRows = messageResult.rows || [];
  const messageIds = messageRows.map((message: any) => toNumberOrNull(message.id)).filter((messageId) => messageId !== null) as number[];
  const chunksByMessageId = await loadMessageChunks(supabase, chatId, messageIds);

  const payload = {
    data: messageRows.map((message: any) => {
      const messageId = toNumberOrNull(message.id);
      return {
        ...message,
        message_chunks: messageId ? chunksByMessageId.get(messageId) || [] : [],
      };
    }),
    count: messageResult.count || 0,
    limit,
    offset,
  };

  logger.info('chat.messages.list.query.completed', { user_id: userId, chat_id: chatId, count: payload.count, duration_ms: Date.now() - startedAt });

  return payload;
}
