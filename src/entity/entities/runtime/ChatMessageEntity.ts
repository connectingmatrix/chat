import { ENTITY, FIELD, RELATION, PERMISSIONS, Entity, Relation } from '@connectingmatrix/orm/orm';
import { ChatEntity } from './ChatEntity';
import type { ChunkEntity } from './ChunkEntity';

export type ChatMessageRow = {
  id: number;
  chat_id: string;
  user_id: string;
  role: string;
  content: string;
  created_at?: string | null;
  source_refs?: Record<string, unknown>[] | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
};

type PaginationInput = { first?: number | null; offset?: number | null };
type PageResult<T> = { records: T[]; hasNextPage: boolean; returnedCount: number; totalCount?: number };

const pageBounds = (input?: PaginationInput) => {
  const first = Math.max(0, Math.floor(Number(input?.first ?? 50)));
  const offset = Math.max(0, Math.floor(Number(input?.offset ?? 0)));
  return { first, offset };
};

@ENTITY({ table: 'ai_chat_messages', label: 'ChatMessage', store: 'supabase', primaryKey: 'id', scoped: true })
@PERMISSIONS({ read: 'CHAT_MESSAGE_READ', list: 'CHAT_MESSAGE_LIST', create: 'CHAT_MESSAGE_CREATE', delete: 'CHAT_MESSAGE_DELETE' })
export class ChatMessageEntity extends Entity<ChatMessageRow> {
  @FIELD({ type: 'number', index: true }) public declare id: number | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare chat_id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare user_id: string | null;

  @FIELD({ type: 'string', required: true }) public declare role: string | null;

  @FIELD({ type: 'string', required: true }) public declare content: string | null;

  @FIELD({ type: 'array' }) public declare source_refs: Record<string, unknown>[] | null;

  @FIELD({ type: 'number' }) public declare prompt_tokens: number | null;

  @FIELD({ type: 'number' }) public declare completion_tokens: number | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @RELATION({
    target: 'Chunk',
    relation: 'HAS_SOURCE_REF',
    store: 'supabase',
    many: true,
    owner: { join: { table: 'ai_message_chunks', sourceField: 'message_id', targetField: 'chunk_id' } },
  })
  public declare chunks: Relation<ChunkEntity>;

  public static async listForChat(input: PaginationInput & { chatId: string }): Promise<PageResult<ChatMessageEntity>> {
    const { first, offset } = pageBounds(input);
    const result = await this.find({ chat_id: input.chatId }).orderBy('created_at', 'asc').limit(first).offset(offset).manyWithCount();
    return {
      records: result.records,
      hasNextPage: offset + result.records.length < result.count,
      returnedCount: result.records.length,
      totalCount: result.count,
    };
  }

  public static async saveMessage(input: {
    chatId: string;
    userId?: string | null;
    role: string;
    content: string | { text?: string | null };
    sourceRefs?: Record<string, unknown>[] | null;
  }): Promise<ChatMessageEntity> {
    const chat = await ChatEntity.load(input.chatId).fetch();
    const userId = String(input.userId || chat.user_id || '').trim();
    const content = typeof input.content === 'string' ? input.content : String(input.content?.text || '').trim();
    const message = await this.createMessage({
      chat_id: input.chatId,
      user_id: userId,
      role: input.role,
      content,
      source_refs: input.sourceRefs ?? null,
    });
    await chat.touch();
    return message;
  }

  public static async createMessage(payload: Omit<ChatMessageRow, 'id'> & { id?: number | null }): Promise<ChatMessageEntity> {
    return this.create(payload);
  }

  public static async listByUserChat(chatId: string): Promise<ChatMessageEntity[]> {
    return chatId ? this.find({ chat_id: chatId }).orderBy('created_at', 'asc').many() : [];
  }

  public static async listMessagesPage(input: {
    chatId: string;
    first?: number | null;
    offset?: number | null;
  }): Promise<{ rows: ChatMessageEntity[]; count: number }> {
    const result = await this.listForChat({ chatId: input.chatId, first: input.first, offset: input.offset });
    return { rows: result.records, count: result.totalCount || 0 };
  }

  public static async listRecentMessages(chatId: string, limit = 25, select = 'id,role,content,created_at'): Promise<Array<Record<string, unknown>>> {
    if (!chatId) return [];
    const rows = await this.find({ chat_id: chatId }).select(select).orderBy('created_at', 'desc').limit(Math.max(1, limit)).many();
    return rows.map((row) => row.extract());
  }

  public static async listAssistantMessageContent(chatId: string, limit = 20): Promise<Array<{ content: string }>> {
    if (!chatId) return [];
    const rows = await this.find({ chat_id: chatId, role: 'assistant' })
      .select('content')
      .orderBy('created_at', 'desc')
      .limit(Math.max(1, limit))
      .many();
    return rows
      .map((row) => row.extract())
      .map((row) => ({ content: String(row.content || '') }))
      .filter((row) => Boolean(row.content));
  }
}
