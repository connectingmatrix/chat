import { ENTITY, FIELD, PERMISSIONS, RELATION, Entity, Relation } from '@connectingmatrix/orm/orm';
import type { ChatMessageEntity } from './ChatMessageEntity';
import type { ChatShareEntity } from './ChatShareEntity';
import type { QueryChatInput } from '@connectingmatrix/chat/services/chat/contracts/types';

export type ChatRow = {
  id: string;
  user_id: string;
  title?: string | null;
  system_prompt?: string | null;
  metadata?: Record<string, unknown> | null;
  last_message_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  scope_type?: string | null;
  scope_id?: string | null;
  scope_snapshot?: Record<string, unknown> | null;
  selected_agent_id?: string | null;
};

type PaginationInput = { first?: number | null; offset?: number | null };
type PageResult<T> = { records: T[]; hasNextPage: boolean; returnedCount: number; totalCount?: number };

const pageBounds = (input?: PaginationInput) => {
  const first = Math.max(0, Math.floor(Number(input?.first ?? 50)));
  const offset = Math.max(0, Math.floor(Number(input?.offset ?? 0)));
  return { first, offset };
};

@ENTITY({ table: 'ai_chat_sessions', label: 'Chat', store: 'supabase', primaryKey: 'id', scoped: true })
@PERMISSIONS({
  read: 'CHAT_READ',
  list: 'CHAT_LIST',
  create: 'CHAT_CREATE',
  update: 'CHAT_UPDATE',
  delete: 'CHAT_DELETE',
  relations: {
    messages: { list: 'CHAT_MESSAGE_LIST', create: 'CHAT_MESSAGE_CREATE' },
    shares: { list: 'CHAT_SHARE_LIST', create: 'CHAT_SHARE_CREATE' },
  },
})
export class ChatEntity extends Entity<ChatRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare user_id: string | null;

  @FIELD({ type: 'string' }) public declare title: string | null;

  @FIELD({ type: 'string' }) public declare system_prompt: string | null;

  @FIELD({ type: 'object', default: {} }) public declare metadata: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare last_message_at: string | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  @FIELD({ type: 'string', index: true }) public declare scope_type: string | null;

  @FIELD({ type: 'string', index: true }) public declare scope_id: string | null;

  @FIELD({ type: 'object', default: {} }) public declare scope_snapshot: Record<string, unknown> | null;

  @FIELD({ type: 'string', index: true }) public declare selected_agent_id: string | null;

  @RELATION({
    target: 'ChatMessage',
    relation: 'HAS_CHAT_MESSAGE',
    store: 'supabase',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'chat_id' },
  })
  public declare messages: Relation<ChatMessageEntity>;

  @RELATION({
    target: 'ChatShare',
    relation: 'HAS_CHAT_SHARE',
    store: 'supabase',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'chat_id' },
  })
  public declare shares: Relation<ChatShareEntity>;

  public static async listScopedSessions(
    input: PaginationInput & {
      userId: string;
      scopeType?: string | null;
      scopeId?: string | null;
    },
  ): Promise<PageResult<ChatEntity>> {
    const { first, offset } = pageBounds(input);
    let query = this.find({ user_id: input.userId });
    if (input.scopeType) query = query.where({ scope_type: input.scopeType });
    if (input.scopeId) query = query.where({ scope_id: input.scopeId });
    const result = await query.orderBy('last_message_at', 'desc').limit(first).offset(offset).manyWithCount();
    return {
      records: result.records,
      hasNextPage: offset + result.records.length < result.count,
      returnedCount: result.records.length,
      totalCount: result.count,
    };
  }

  public static async getScopedSession(input: {
    userId: string;
    chatId?: string | null;
    scopeType?: string | null;
    scopeId?: string | null;
  }): Promise<ChatEntity | null> {
    if (input.chatId) {
      const session = await this.single(input.chatId);
      if (!session) return null;
      return String(session.user_id || '') === String(input.userId || '') ? session : null;
    }
    let query = this.find({ user_id: input.userId });
    if (input.scopeType) query = query.where({ scope_type: input.scopeType });
    if (input.scopeId) query = query.where({ scope_id: input.scopeId });
    return query.orderBy('updated_at', 'desc').single();
  }

  public static async query(input: QueryChatInput): Promise<unknown> {
    const module = await import('@connectingmatrix/chat/services/chat/read/query-chat');
    return module.queryChat(input);
  }

  public static async ensureSession(input: {
    userId: string;
    title?: string | null;
    systemPrompt?: string | null;
    scopeType?: string | null;
    scopeId?: string | null;
    scopeSnapshot?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<ChatEntity> {
    const existing = await this.getScopedSession({
      userId: input.userId,
      scopeType: input.scopeType ?? null,
      scopeId: input.scopeId ?? null,
    });
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.create({
      user_id: input.userId,
      title: input.title ?? null,
      system_prompt: input.systemPrompt ?? null,
      metadata: input.metadata ?? {},
      last_message_at: now,
      created_at: now,
      updated_at: now,
      scope_type: input.scopeType ?? null,
      scope_id: input.scopeId ?? null,
      scope_snapshot: input.scopeSnapshot ?? null,
    });
  }

  public async touch(): Promise<this> {
    const now = new Date().toISOString();
    await this.update({ last_message_at: now, updated_at: now });
    return this;
  }

  public static async readSessionRow(chatId: string): Promise<ChatEntity | null> {
    return chatId ? this.single(chatId) : null;
  }

  public static async listByScopeForUser(input: {
    userId: string;
    scopeType?: string | null;
    scopeId?: string | null;
    first?: number | null;
    offset?: number | null;
  }): Promise<ChatEntity[]> {
    const result = await this.listScopedSessions({
      userId: input.userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      first: input.first,
      offset: input.offset,
    });
    return result.records;
  }

  public static async createSessionRow(payload: Omit<ChatRow, 'id'> & { id?: string | null }): Promise<ChatEntity> {
    return this.create(payload);
  }

  public static async updateSessionById(id: string, patch: Partial<ChatRow>): Promise<ChatEntity | null> {
    const row = await this.single(id);
    return row ? row.update(patch) : null;
  }

  public static async readMetadataRow(chatId: string, userId: string): Promise<{ id: string; metadata: Record<string, unknown> | null } | null> {
    const row = await this.find({ id: chatId, user_id: userId }).select('id,metadata').single();
    if (!row?.id) return null;
    return { id: String(row.id), metadata: row.metadata || null };
  }

  public static async updateMetadataRow(
    chatId: string,
    userId: string,
    metadata: Record<string, unknown>,
  ): Promise<{ id: string; metadata: Record<string, unknown> | null } | null> {
    const row = await this.find({ id: chatId, user_id: userId }).single();
    if (!row) return null;
    const updated = await row.update({ metadata, updated_at: new Date().toISOString() });
    return { id: String(updated.id || ''), metadata: updated.metadata || null };
  }

  public static async listByUserScope(input: {
    userId: string;
    columns?: string;
    range?: { from?: number; to?: number };
    scopeType?: string | null;
    scopeId?: string | null;
  }): Promise<ChatEntity[]> {
    if (!input.userId) return [];
    let query = this.find({ user_id: input.userId });
    if (input.scopeType) query = query.where({ scope_type: input.scopeType });
    if (input.scopeId) query = query.where({ scope_id: input.scopeId });
    if (input.columns && input.columns !== '*') query = query.select(input.columns);
    if (input.range)
      query = query.offset(Number(input.range.from || 0)).limit(Math.max(0, Number((input.range.to || 0) - (input.range.from || 0) + 1)));
    return query.orderBy('updated_at', 'desc').many();
  }
}
