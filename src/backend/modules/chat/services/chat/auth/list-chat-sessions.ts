import { getCurrentUserIdOrThrow } from '@giga/shared/lib/helper';
import { toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { ChatEntity } from '@connectingmatrix/orm/repositories/entities';
import { buildPermissionContext, canReadScopedChat } from '@giga/permissions/services/auth/permission-context';
import { logger } from '../runtime/shared';
import type { ListSessionsInput } from '@giga/shared/types/contracts/chat.types';

export async function listChatSessions(supabase: any, input?: ListSessionsInput) {
  const startedAt = Date.now();
  const startedMeta = {
    scope_type: input?.scope?.type || null,
    scope_id: input?.scope?.id || null,
    limit: input?.limit || null,
    offset: input?.offset || null,
  };
  logger.debug('chat.sessions.list.started', startedMeta);
  try {
    const userId = await getCurrentUserIdOrThrow(supabase);
    const result = await ChatEntity.listScopedSessions({
      userId,
      scopeType: input?.scope?.type || null,
      scopeId: input?.scope?.id || null,
      first: input?.limit || null,
      offset: input?.offset || null,
    });
    const permissionCache: Record<string, ReturnType<typeof buildPermissionContext>> = {};
    const data = [];
    for (const session of result.records || []) {
      const scopeSnapshot = (session.scope_snapshot as Record<string, unknown> | null) || null;
      const organizationId = String(scopeSnapshot?.organizationId || '').trim() || 'USER';
      if (!permissionCache[organizationId]) {
        permissionCache[organizationId] = buildPermissionContext(
          await readUserMatrixState(supabase, { organizationId: organizationId === 'USER' ? null : organizationId, userId }),
          false,
        );
      }
      if (canReadScopedChat(permissionCache[organizationId], session.scope_type)) data.push(session.payload);
    }
    logger.info('chat.sessions.list.completed', { user_id: userId, count: data.length, duration_ms: Date.now() - startedAt });
    return { data, count: data.length, limit: input?.limit || null, offset: input?.offset || null };
  } catch (error) {
    logger.error('chat.sessions.list.failed', { duration_ms: Date.now() - startedAt, error: toErrorMeta(error) });
    throw error;
  }
}
