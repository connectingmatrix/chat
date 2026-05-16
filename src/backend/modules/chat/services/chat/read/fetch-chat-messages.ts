import { getCurrentUserIdOrThrow } from '@giga/shared/lib/helper';
import { toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { ChatEntity, ChatMessageEntity } from '@connectingmatrix/orm/repositories/entities';
import { logger } from '../runtime/shared';
import type { ListMessagesInput } from '@giga/shared/types/contracts/chat.types';

export async function fetchChatMessages(supabase: any, input: ListMessagesInput) {
  const startedAt = Date.now();
  logger.debug('chat.messages.list.started', { chat_id: input.chatId, limit: input.limit || null, offset: input.offset || null });
  try {
    const userId = await getCurrentUserIdOrThrow(supabase);
    const session = await ChatEntity.getScopedSession({ userId, chatId: input.chatId });
    if (!session) throw new Error('Chat session not found.');
    const result = await ChatMessageEntity.listForChat({ chatId: input.chatId, first: input.limit || null, offset: input.offset || null });
    const completedMeta = {
      chat_id: input.chatId,
      user_id: userId,
      count: result.returnedCount,
      duration_ms: Date.now() - startedAt,
    };
    logger.info('chat.messages.list.completed', completedMeta);
    return {
      data: result.records.map((record) => record.payload),
      count: result.returnedCount,
      limit: input.limit || null,
      offset: input.offset || null,
    };
  } catch (error) {
    logger.error('chat.messages.list.failed', { chat_id: input.chatId, duration_ms: Date.now() - startedAt, error: toErrorMeta(error) });
    throw error;
  }
}
