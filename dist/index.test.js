import test from 'node:test';
import assert from 'node:assert/strict';
import { Chat } from './index.js';
test('chat slash routing is registered by package owners instead of hard-coded workflow/tree placeholders', async () => {
    Chat.registerSlashCommand('/tree', () => ({ ok: true, source: '@giga/tree' }), { owner: '@giga/tree', description: 'Tree package route' });
    const c = Chat.createChat({ title: 'c' }, { userId: 'u' });
    const m = await Chat.queryChat(c.id, { message: '/tree' }, { userId: 'u' });
    assert.equal(typeof m.content, 'string');
    assert.match(m.content, /@giga\/tree/);
    assert.equal(Chat.listSlashCommands().some((cmd) => cmd.command === '/tree' && cmd.owner === '@giga/tree'), true);
});
test('unregistered slash commands are explicit instead of fake results', async () => {
    const c = Chat.createChat({ title: 'c2' }, { userId: 'u' });
    const m = await Chat.queryChat(c.id, { message: '/workflow list' }, { userId: 'u' });
    assert.match(m.content, /not registered/);
});
