import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSupabaseStub } from '@giga/shared/test/supabase-stub';
import {
  buildChatShareSnapshot,
  loadChatShareByChatId,
  loadPublicChatShareByToken,
  publishChatShare,
  revokeChatShare,
} from '@connectingmatrix/chat/services/chat/runtime/share';

const session = {
  id: 'chat-1',
  title: 'Shared chat',
  user_id: 'user-1',
  system_prompt: null,
  metadata: null,
  last_message_at: '2026-05-01T00:00:00.000Z',
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
  scope_type: 'subject',
  scope_id: 'subject-1',
  scope_snapshot: { organizationId: 'org-1' },
};

const messages = [
  { role: 'user', content: 'Hello', created_at: '2026-05-01T00:01:00.000Z' },
  { role: 'assistant', content: 'World', created_at: '2026-05-01T00:02:00.000Z' },
];

const deps = {
  getCurrentUserId: async () => 'user-1',
  getSessionById: async () => session,
  listMessages: async () => ({ data: messages, count: messages.length, limit: 200, offset: 0 }),
};

const createSupabase = () =>
  createSupabaseStub({
    ai_chat_sessions: [{ ...session }],
    ai_chat_messages: messages.map((message, index) => ({ id: index + 1, chat_id: session.id, user_id: session.user_id, ...message })),
    ai_chat_shares: [],
  });

test('buildChatShareSnapshot strips the snapshot down to public chat content', () => {
  const snapshot = buildChatShareSnapshot(session as any, messages, '2026-05-01T00:03:00.000Z');
  assert.equal(snapshot.chatId, 'chat-1');
  assert.equal(snapshot.scope?.type, 'subject');
  assert.equal(snapshot.messages[0].sender, 'user');
  assert.deepEqual(snapshot.messages[0].content, { text: 'Hello' });
  assert.equal(snapshot.messages[1].sender, 'assistant');
  assert.equal(snapshot.publishedAt, '2026-05-01T00:03:00.000Z');
});

test('publish, revoke, and public lookup use the same share row', async () => {
  const supabase = createSupabase();
  const published = await publishChatShare(supabase, 'chat-1', deps as any);
  assert.ok(published.share_token.length > 0);
  assert.equal(published.snapshot.messages.length, 2);
  assert.equal(published.snapshot.messages[0].content.text, 'Hello');

  const byChatId = await loadChatShareByChatId(supabase, 'chat-1', deps as any);
  assert.equal(byChatId?.share_token, published.share_token);

  const byToken = await loadPublicChatShareByToken(supabase, published.share_token);
  assert.equal(byToken?.share_token, published.share_token);

  const revoked = await revokeChatShare(supabase, 'chat-1', deps as any);
  assert.ok(revoked.revoked_at);
  assert.equal(await loadChatShareByChatId(supabase, 'chat-1', deps as any), null);
  assert.equal(await loadPublicChatShareByToken(supabase, published.share_token), null);
});

test('share migration keeps chat deletes cascading to shares', () => {
  const sql = readFileSync(join(process.cwd(), 'sql/20260501_ai_chat_shares.sql'), 'utf8');
  assert.match(sql, /on delete cascade/i);
});
