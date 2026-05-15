import { LocalEventBus, nowIso } from './contracts.js';
import { InMemoryRepository } from './entity/repository.js';
const chats = new InMemoryRepository('chat');
const messages = new InMemoryRepository('chat_msg');
const slash = new Map();
const bus = new LocalEventBus();
let responder;
function normalizeContent(content) {
    if (typeof content === 'string')
        return content;
    if (content && typeof content === 'object' && 'message' in content)
        return normalizeContent(content.message);
    if (content == null)
        return '';
    try {
        return JSON.stringify(content);
    }
    catch {
        return String(content);
    }
}
function normalizeCommand(command) {
    return command.trim().startsWith('/') ? command.trim().toLowerCase() : `/${command.trim().toLowerCase()}`;
}
function helpText() {
    const commands = [...slash.values()].map((item) => `${item.command}${item.owner ? ` (${item.owner})` : ''}${item.description ? ` - ${item.description}` : ''}`);
    return commands.length ? `Registered slash commands:\n${commands.join('\n')}` : 'No package slash commands are registered yet.';
}
slash.set('/help', { command: '/help', owner: '@connectingmatrix/chat', description: 'List registered package-owned slash commands', handler: () => helpText() });
export const Chat = {
    bindWithServer(_endpoint) { return Chat; },
    setResponder(nextResponder) { responder = nextResponder; return Chat; },
    registerSlashCommand(command, handler, options = {}) {
        const normalized = normalizeCommand(command);
        slash.set(normalized, { command: normalized, owner: options.owner, description: options.description, handler });
        return Chat;
    },
    registerSlashCommands(commands) {
        for (const command of commands)
            Chat.registerSlashCommand(command.command, command.handler, { owner: command.owner, description: command.description });
        return Chat;
    },
    listSlashCommands() { return [...slash.values()].map(({ command, owner, description }) => ({ command, owner, description })); },
    getChats(pagination = {}, context = {}) { return chats.list(context, pagination); },
    createChat(input, context = {}) { return chats.create(input, context); },
    getMessages(chatId, pagination = {}, context = {}) {
        const listed = messages.list(context, { ...pagination, limit: pagination.limit ?? 100 });
        return { ...listed, items: listed.items.filter((m) => m.chatId === chatId) };
    },
    search(chatId, term, context = {}) { return messages.search(term, context, ['content']).filter((m) => m.chatId === chatId); },
    async sendMessage(chatId, content, context = {}) { const message = messages.create({ chatId, role: 'user', content: normalizeContent(content) }, context); await bus.emit(`chat:${chatId}`, message); return message; },
    async queryChat(chatId, input, context = {}) {
        await Chat.sendMessage(chatId, input.message, context);
        const text = normalizeContent(input.message).trim();
        const [command, ...args] = text.split(/\s+/);
        const normalizedCommand = normalizeCommand(command || '');
        const handler = text.startsWith('/') ? slash.get(normalizedCommand)?.handler : undefined;
        const reply = handler
            ? await handler(args, context, text)
            : text.startsWith('/')
                ? `Slash command is not registered: ${normalizedCommand}. Try /help.`
                : responder
                    ? await responder({ chatId, message: text, mode: input.mode, context })
                    : text;
        const assistant = messages.create({ chatId, role: 'assistant', content: normalizeContent(reply), metadata: { mode: input.mode, slashCommand: handler ? normalizedCommand : undefined } }, context);
        await bus.emit(`chat:${chatId}`, assistant);
        return assistant;
    },
    onMessage(chatId, handler) { return bus.on(`chat:${chatId}`, handler); },
    health() { return { name: '@connectingmatrix/chat', status: 'ok', checkedAt: nowIso(), details: { chats: chats.list({ root: true }).total, messages: messages.list({ root: true }).total, slashCommands: slash.size, responder: Boolean(responder) } }; },
};
export const graphql = {
    namespace: 'chat',
    typeDefs: `
    type Chat { id: ID!, title: String!, mode: String, createdAt: String!, updatedAt: String! }
    type ChatMessage { id: ID!, chatId: ID!, role: String!, content: String!, createdAt: String!, updatedAt: String! }
    type SlashCommand { command: String!, owner: String, description: String }
    input QueryChatInput { chatId: ID!, message: String!, mode: String }
    type Query { chatList(limit: Int, offset: Int): [Chat!]!, chatMessages(chatId: ID!): [ChatMessage!]!, chatSlashCommands: [SlashCommand!]!, chatHealth: String! }
    type Mutation { chatCreate(title: String!, mode: String): Chat!, queryChat(input: QueryChatInput!): ChatMessage! }
  `,
    resolvers: {
        Query: { chatList: (_, args, ctx) => Chat.getChats(args, ctx).items, chatMessages: (_, args, ctx) => Chat.getMessages(args.chatId, {}, ctx).items, chatSlashCommands: () => Chat.listSlashCommands(), chatHealth: () => Chat.health().status },
        Mutation: { chatCreate: (_, args, ctx) => Chat.createChat(args, ctx), queryChat: (_, args, ctx) => Chat.queryChat(args.input.chatId, { message: args.input.message, mode: args.input.mode }, ctx) },
    },
    migrations: ['migrations/0001_init.sql'],
};
export function createPackage() { return { name: '@connectingmatrix/chat', version: '0.1.0', health: () => Chat.health(), graphql, migrations: graphql.migrations, routes: [{ method: 'GET', path: '/chat/health', handler: () => Chat.health() }, { method: 'POST', path: '/chat/query', handler: (request) => Chat.queryChat(String(request.body?.chatId ?? ''), { message: request.body?.message ?? '', mode: request.body?.mode }) }] }; }
export * from './contracts.js';
