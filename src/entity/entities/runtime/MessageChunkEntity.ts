import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm/orm';

export type MessageChunkRow = {
  message_id: number;
  chunk_id: number;
  rank?: number | null;
  similarity?: number | null;
};

@ENTITY({ table: 'ai_message_chunks', label: 'MessageChunk', store: 'supabase', primaryKey: ['message_id', 'chunk_id'] })
@PERMISSIONS({ read: 'MESSAGE_CHUNK_READ', create: 'MESSAGE_CHUNK_CREATE', delete: 'MESSAGE_CHUNK_DELETE' })
export class MessageChunkEntity extends Entity<MessageChunkRow> {
  @FIELD({ type: 'number', required: true, index: true }) public declare message_id: number | null;

  @FIELD({ type: 'number', required: true, index: true }) public declare chunk_id: number | null;

  @FIELD({ type: 'number' }) public declare rank: number | null;

  @FIELD({ type: 'number' }) public declare similarity: number | null;

  public static async saveUsage(input: {
    messageId: number;
    chunks: Array<{ chunk_id: number; rank?: number | null; similarity?: number | null }>;
  }): Promise<void> {
    if (!input.chunks.length) return;
    for (let index = 0; index < input.chunks.length; index += 1) {
      const chunk = input.chunks[index];
      await this.create({
        message_id: input.messageId,
        chunk_id: chunk.chunk_id,
        rank: chunk.rank ?? index + 1,
        similarity: chunk.similarity ?? 0,
      });
    }
  }

  public static async findByMessageIds(messageIds: number[]): Promise<MessageChunkEntity[]> {
    const ids = messageIds.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (!ids.length) return [];
    return this.find().whereIn('message_id', ids).many();
  }
}
