import { randomUUID } from 'node:crypto';
import { ChatEntity, ChatMessageEntity, ChatShareEntity } from '@connectingmatrix/orm/repositories/entities';
import { getCurrentUserId } from '@connectingmatrix/chat/services/chat/runtime/persistence';
import { getSessionScope } from '@connectingmatrix/chat/services/chat/auth/scope';
import { ChatSessionRecord, ChatShareDbRecord, ChatShareRecord, ChatShareSnapshot } from '@connectingmatrix/chat/services/chat/contracts/types';

const SHARE_PAGE_SIZE = 200;
const SHARE_SELECT = 'chat_id,share_token,snapshot,published_at,revoked_at,created_at,updated_at';

const contentText = (value: unknown): string => {
  const record = value && typeof value === 'object' ? (value as { text?: unknown }) : null;
  const text = String(record?.text || '').trim();
  return text || String(value || '');
};

const readOrganizationId = (session: ChatSessionRecord): string | null => {
  const snapshot = session.scope_snapshot && typeof session.scope_snapshot === 'object' ? session.scope_snapshot : null;
  return String(snapshot?.organizationId || '').trim() || null;
};

const readShareMessages = (messages: Array<{ role: string; content: string; created_at: string }>) => {
  const items: ChatShareSnapshot['messages'] = [];
  for (const message of messages) {
    items.push({
      sender: message.role === 'assistant' ? 'assistant' : 'user',
      content: { text: String(message.content || '') },
      timestamp: message.created_at,
    });
  }
  return items;
};

const loadAllMessages = async (
  supabase: any,
  userId: string,
  chatId: string,
): Promise<Array<{ role: string; content: string; created_at: string }>> => {
  const messages: Array<{ role: string; content: string; created_at: string }> = [];
  let offset = 0;
  while (true) {
    const result = await ChatMessageEntity.listMessagesPage({ chatId, first: SHARE_PAGE_SIZE, offset });
    const rows = result.rows.map((row) => row.extract());
    for (const row of rows) {
      messages.push({
        role: String(row.role || ''),
        content: contentText(row.content),
        created_at: String(row.created_at || ''),
      });
    }
    if (rows.length < SHARE_PAGE_SIZE) {
      break;
    }
    offset += SHARE_PAGE_SIZE;
  }
  return messages;
};

const normalizeShareRecord = (row: ChatShareDbRecord): ChatShareRecord => ({
  ...row,
  snapshot: row.snapshot as ChatShareSnapshot,
});

type ChatShareDeps = {
  getCurrentUserId: typeof getCurrentUserId;
};

const defaultDeps: ChatShareDeps = {
  getCurrentUserId,
};

export const buildChatShareSnapshot = (
  session: ChatSessionRecord,
  messages: Array<{ role: string; content: string; created_at: string }>,
  publishedAt: string,
): ChatShareSnapshot => {
  const scope = getSessionScope(session);
  return {
    chatId: session.id,
    title: session.title || null,
    scope: scope
      ? {
          type: scope.type,
          id: scope.id,
          organizationId: readOrganizationId(session),
        }
      : null,
    publishedAt,
    messages: readShareMessages(messages),
  };
};

export const publishChatShare = async (supabase: any, chatId: string, deps: ChatShareDeps = defaultDeps): Promise<ChatShareRecord> => {
  const userId = await deps.getCurrentUserId(supabase);
  const sessionEntity = await ChatEntity.readSessionRow(chatId);
  const session = sessionEntity ? (sessionEntity.extract() as ChatSessionRecord) : null;
  if (String(session?.user_id || '') !== String(userId || '')) throw new Error('Chat session not found.');
  if (!session) throw new Error('Chat session not found.');

  const now = new Date().toISOString();
  const messages = await loadAllMessages(supabase, userId, chatId);
  const snapshot = buildChatShareSnapshot(session, messages, now);
  const shareToken = randomUUID().replace(/-/g, '');
  const row = await ChatShareEntity.upsertByChatId({ chatId, token: shareToken, snapshot });
  return normalizeShareRecord((row || {}) as ChatShareDbRecord);
};

export const revokeChatShare = async (supabase: any, chatId: string, deps: ChatShareDeps = defaultDeps): Promise<ChatShareRecord> => {
  const userId = await deps.getCurrentUserId(supabase);
  const sessionEntity = await ChatEntity.readSessionRow(chatId);
  const session = sessionEntity ? (sessionEntity.extract() as ChatSessionRecord) : null;
  if (String(session?.user_id || '') !== String(userId || '')) throw new Error('Chat session not found.');
  if (!session) throw new Error('Chat session not found.');

  const now = new Date().toISOString();
  const row = (await ChatShareEntity.readActiveByChatId(chatId)) as ChatShareDbRecord | null;
  await ChatShareEntity.revokeByChatId(chatId);
  return normalizeShareRecord({ ...(row || {}), revoked_at: now, updated_at: now } as ChatShareDbRecord);
};

export const loadChatShareByChatId = async (supabase: any, chatId: string, deps: ChatShareDeps = defaultDeps): Promise<ChatShareRecord | null> => {
  const userId = await deps.getCurrentUserId(supabase);
  const sessionEntity = await ChatEntity.readSessionRow(chatId);
  const session = sessionEntity ? (sessionEntity.extract() as ChatSessionRecord) : null;
  if (String(session?.user_id || '') !== String(userId || '')) return null;
  if (!session) return null;

  const row = await ChatShareEntity.readActiveByChatId(chatId);
  return row ? normalizeShareRecord(row as ChatShareDbRecord) : null;
};

export const loadPublicChatShareByToken = async (supabase: any, shareToken: string): Promise<ChatShareRecord | null> => {
  const token = String(shareToken || '').trim();
  if (!token) return null;
  const row = await ChatShareEntity.readActiveByToken(token);
  return row ? normalizeShareRecord(row as ChatShareDbRecord) : null;
};
