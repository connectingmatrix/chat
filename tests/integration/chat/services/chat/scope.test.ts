import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLegacySessionScope, normalizeChatScopeInput } from '@connectingmatrix/chat/services/chat/auth/scope';

test('normalizeChatScopeInput accepts exact scope payloads', () => {
  const scope = normalizeChatScopeInput({
    scope: {
      type: 'channel',
      id: '11111111-1111-1111-1111-111111111111',
      organizationId: 'org-1',
    },
  });

  assert.deepEqual(scope, {
    type: 'channel',
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: 'org-1',
  });
});

test('normalizeChatScopeInput converts legacy single subject input into exact subject scope', () => {
  const scope = normalizeChatScopeInput({
    subjectIds: ['22222222-2222-2222-2222-222222222222'],
  });

  assert.deepEqual(scope, {
    type: 'subject',
    id: '22222222-2222-2222-2222-222222222222',
  });
});

test('normalizeChatScopeInput converts legacy post input into exact post scope', () => {
  const scope = normalizeChatScopeInput({
    postId: '33333333-3333-3333-3333-333333333333',
  });

  assert.deepEqual(scope, {
    type: 'post',
    id: '33333333-3333-3333-3333-333333333333',
  });
});

test('normalizeChatScopeInput rejects multi-subject scope creation', () => {
  assert.throws(
    () =>
      normalizeChatScopeInput({
        subjectIds: ['44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555'],
      }),
    /single subject id/i,
  );
});

test('getLegacySessionScope preserves archived multi-scope context', () => {
  const resolved = getLegacySessionScope({
    id: '66666666-6666-6666-6666-666666666666',
    user_id: '77777777-7777-7777-7777-777777777777',
    title: 'Legacy Chat',
    system_prompt: null,
    metadata: {
      legacy_scope: {
        subject_ids: ['88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999'],
        post_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
      },
    },
    last_message_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scope_type: 'subject',
    scope_id: '66666666-6666-6666-6666-666666666666',
    scope_snapshot: null,
  });

  assert.ok(resolved);
  assert.equal(resolved?.scope.type, 'subject');
  assert.equal(resolved?.scope.id, '66666666-6666-6666-6666-666666666666');
  assert.equal(resolved?.snapshot?.legacy, true);
  assert.deepEqual(resolved?.subject_ids, ['88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999']);
  assert.deepEqual(resolved?.post_ids, ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
});
