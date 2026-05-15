import { Chat } from './index.js'; const c=Chat.createChat({title:'demo'}); console.log(await Chat.queryChat(c.id,{message:'/workflow list'}));
