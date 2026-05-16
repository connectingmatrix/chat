import { ChatEntity } from '@connectingmatrix/orm/repositories/entities';
import { getSessionScope } from './scope';
import type { ChatScope, ChatSessionRecord } from '../contracts/types';

const extractScope = (session: ChatSessionRecord): ChatScope | null => getSessionScope(session);

export const readRecentSessionScope = async (userId: string): Promise<ChatScope | null> => {
  const sessions = await ChatEntity.listScopedSessions({ userId, first: 20, offset: 0 });
  for (const entry of sessions.records) {
    const session = entry.extract() as ChatSessionRecord;
    const scope = extractScope(session);
    if (scope) return scope;
  }
  return null;
};
