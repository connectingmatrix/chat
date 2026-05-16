import { emitChatRoomEventIfAvailable } from '@connectingmatrix/sockets/chat/telemetry/event-bus';
import { queryChat } from '../read/query-chat';
import type { QueryChatInput } from '../contracts/types';

type SendToRoomInput = QueryChatInput & {
  requestId?: string | null;
};

export async function sendChatToRoom(input: SendToRoomInput) {
  try {
    const result = await queryChat({
      ...input,
      debug: {
        requestId: input.requestId || undefined,
        emit: (event) => {
          const chatId = String(event.chat_id || input.chatId || '').trim();
          if (!chatId) return;
          emitChatRoomEventIfAvailable(chatId, 'chat:debug', {
            request_id: input.requestId || null,
            chat_id: chatId,
            stage: event.stage,
            status: event.status,
            emit: event.emit === true,
            emit_room: event.emit_room || null,
            message: event.message,
            timestamp: event.timestamp || new Date().toISOString(),
            meta: event.meta || {},
          });
        },
      },
    });
    const chat = (result as { chat?: { id?: string | null } } | null)?.chat || null;
    const chatId = String(chat?.id || input.chatId || '').trim();
    if (chatId) emitChatRoomEventIfAvailable(chatId, 'chat:assistant:done', { request_id: input.requestId || null, data: result });
    return result;
  } catch (error: unknown) {
    const chatId = String(input.chatId || '').trim();
    if (chatId)
      emitChatRoomEventIfAvailable(chatId, 'chat:error', {
        request_id: input.requestId || null,
        error: error instanceof Error ? error.message : 'Failed to process chat message.',
      });
    throw error;
  }
}
