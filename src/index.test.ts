import test from 'node:test';
import assert from 'node:assert/strict';
import { Chat, GigaChat } from './index.js';
test('single chat owns queryChat/queryChaat and slash routing', async () => { const ctx={userId:'u1'}; Chat.registerSlashCommand({command:'workflow', owner:'@connectingmatrix/workflow-driver', handler:()=> 'workflow ok'}); const c=Chat.createChat({title:'T'},ctx); const m=await GigaChat.queryChaat(c.id,{message:'/workflow list'},ctx); assert.equal(m.content,'workflow ok'); assert.equal(Chat.health().details?.singleChatOwner,true); });
