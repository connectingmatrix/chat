import { BadRequestError } from 'routing-controllers';
import { getCurrentUserIdOrThrow } from '@giga/shared/lib/helper';
import { toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { ChatEntity } from '@connectingmatrix/orm/repositories/entities';
import { buildPermissionContext, canReadScopedChat } from '@giga/permissions/services/auth/permission-context';
import { logger } from '../runtime/shared';
import { ChatScope } from '../contracts/types';

export async function fetchChatSession(supabase: any, input: { chatId?: string; scope?: ChatScope | null }) {
  const startedAt = Date.now();
  const startedMeta = {
    chat_id: input.chatId || null,
    scope_type: input.scope?.type || null,
    scope_id: input.scope?.id || null,
  };
  logger.debug('chat.session.fetch.started', startedMeta);
  try {
    const userId = await getCurrentUserIdOrThrow(supabase);
    const session = await ChatEntity.getScopedSession({
      userId,
      chatId: input.chatId || null,
      scopeType: input.scope?.type || null,
      scopeId: input.scope?.id || null,
    });
    const scopeType = String(session?.scope_type || input.scope?.type || '').trim();
    const scopeSnapshot = (session?.scope_snapshot as Record<string, unknown> | null) || null;
    const organizationId = String(scopeSnapshot?.organizationId || input.scope?.organizationId || '').trim() || null;
    if (session && scopeType) {
      const permissions = buildPermissionContext(await readUserMatrixState(supabase, { organizationId, userId }), false);
      if (!canReadScopedChat(permissions, scopeType)) throw new BadRequestError(`Plan access does not allow ${scopeType}_chat read.`);
    }
    logger.info('chat.session.fetch.completed', { user_id: userId, chat_id: session?.id || null, duration_ms: Date.now() - startedAt });
    return session ? session.payload : null;
  } catch (error) {
    logger.error('chat.session.fetch.failed', { duration_ms: Date.now() - startedAt, error: toErrorMeta(error) });
    throw error;
  }
}
