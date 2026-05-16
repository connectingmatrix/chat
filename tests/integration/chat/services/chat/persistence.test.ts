import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installOrmForStub } from '@giga/shared/test/supabase-stub';
import { ensureSession, getSessionByScope } from '@connectingmatrix/chat/services/chat/runtime/persistence';

function createSupabase(rows: Array<Record<string, unknown>>) {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        range() {
          return Promise.resolve({ data: rows, error: null, count: rows.length });
        },
        limit() {
          return Promise.resolve({ data: rows, error: null, count: rows.length });
        },
      };
    },
  } as any;
  installOrmForStub(supabase);
  return supabase;
}

test('getSessionByScope keeps organization scoped chats separate from user scoped chats', async () => {
  const rows = [
    {
      id: 'user-chat',
      user_id: 'user-1',
      scope_type: 'subject',
      scope_id: 'subject-1',
      scope_snapshot: null,
      updated_at: '2026-04-03T00:00:00.000Z',
    },
    {
      id: 'org-chat',
      user_id: 'user-1',
      scope_type: 'subject',
      scope_id: 'subject-1',
      scope_snapshot: { organizationId: 'org-1' },
      updated_at: '2026-04-03T00:00:01.000Z',
    },
  ];

  const userSession = await getSessionByScope(createSupabase(rows), 'user-1', {
    type: 'subject',
    id: 'subject-1',
    organizationId: null,
  });
  const organizationSession = await getSessionByScope(createSupabase(rows), 'user-1', {
    type: 'subject',
    id: 'subject-1',
    organizationId: 'org-1',
  });

  assert.equal(userSession?.id, 'user-chat');
  assert.equal(organizationSession?.id, 'org-chat');
});

test('ensureSession reuses the canonical scope session after a duplicate insert conflict', async () => {
  const existingSession = {
    id: 'org-chat',
    user_id: 'user-1',
    title: 'Hello world',
    system_prompt: null,
    metadata: null,
    last_message_at: '2026-04-03T00:00:01.000Z',
    created_at: '2026-04-03T00:00:01.000Z',
    updated_at: '2026-04-03T00:00:01.000Z',
    scope_type: 'subject',
    scope_id: 'subject-1',
    scope_snapshot: { organizationId: 'org-1' },
  };
  let scopeReads = 0;

  const supabase = {
    from(table: string) {
      if (table !== 'ai_chat_sessions') throw new Error(`Unexpected table ${table}`);

      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        range() {
          scopeReads += 1;
          const data = scopeReads === 1 ? [] : [existingSession];
          return Promise.resolve({ data, error: null, count: data.length });
        },
        limit() {
          scopeReads += 1;
          const data = scopeReads === 1 ? [] : [existingSession];
          return Promise.resolve({ data, error: null, count: data.length });
        },
        insert() {
          return {
            select() {
              return this;
            },
            single() {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "ai_chat_sessions_user_scope_uidx"',
                },
              });
            },
          };
        },
      };
    },
  } as any;
  installOrmForStub(supabase);

  const ensured = await ensureSession(supabase, {
    userId: 'user-1',
    scope: {
      type: 'subject',
      id: 'subject-1',
      organizationId: 'org-1',
    },
    titleFromMessage: 'Hello world',
  });

  assert.equal(ensured.created, false);
  assert.equal(ensured.session.id, 'org-chat');
});
