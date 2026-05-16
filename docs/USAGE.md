# Usage for @connectingmatrix/chat

```ts
import { Chat } from '@connectingmatrix/chat';
const chat = Chat.createChat({ title: 'Main' }, ctx);
await Chat.queryChat(chat.id, { message: '/workflow list' }, ctx);
await Chat.queryTransient({ scope: 'project-debug', ownerId: projectId, message: 'debug this', transient: true }, ctx);
```

See `../README.md` for the full contract list.
