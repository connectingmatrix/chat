import { InMemoryRepository } from './entity/repository.js';
import { LocalEventBus, makeId, nowIso } from './contracts.js';
import { createStubLauncher } from './launcher.js';
import { PackageObservability } from './observability.js';
const chats = new InMemoryRepository('chat');
const messages = new InMemoryRepository('chat_message');
const attachments = new InMemoryRepository('chat_attachment');
const transientSessions = new Map();
const bus = new LocalEventBus();
const slash = new Map();
let responder;
let driveApi;
function normalizeContent(value) { if (typeof value === 'string')
    return value; if (value && typeof value === 'object' && 'message' in value)
    return normalizeContent(value.message); return JSON.stringify(value ?? ''); }
async function defaultResponder(input) { const prior = input.transientMessages?.length ? `\nContext messages: ${input.transientMessages.length}` : ''; return `Chat ${input.chat?.title ?? 'browser-session'} (${input.mode ?? input.chat?.mode ?? 'default'}): ${input.message}${prior}`; }
function newTransientSession(input) { const now = nowIso(); const session = { id: makeId('browser_chat'), scope: input.scope ?? 'generic', ownerId: input.ownerId, messages: [], createdAt: now, updatedAt: now }; transientSessions.set(session.id, session); return session; }
export const Chat = {
    bindDrive(api) { driveApi = api; return Chat; },
    setResponder(next) { responder = next; return Chat; },
    registerSlashCommand(command) { slash.set(command.command.replace(/^\//, ''), command); return Chat; },
    registerSlashCommands(commands = []) { for (const command of commands)
        Chat.registerSlashCommand(command); return Chat; },
    listSlashCommands() { return [...slash.values()].map(({ command, owner, description }) => ({ command, owner, description })); },
    createTransientSession(input = {}) { return newTransientSession(input); },
    createBrowserSession(input = {}) { return newTransientSession({ scope: input.scope, ownerId: input.ownerId ?? input.targetId }); },
    getTransientSession(id) { return transientSessions.get(id); },
    clearTransientSession(id) { return transientSessions.delete(id); },
    clearBrowserSession(id) { return transientSessions.delete(id); },
    createChat(input, context = {}) { return chats.create(input, context); },
    getChats(pagination = {}, context = {}) { return chats.list(context, pagination); },
    getMessages(chatId, pagination = {}, context = {}) { return messages.list(context, { limit: 500 }).items.filter((m) => m.chatId === chatId).slice(pagination.offset ?? 0, (pagination.offset ?? 0) + (pagination.limit ?? 50)); },
    search(chatId, term, context = {}) { return messages.search(term, context, ['content']).filter((m) => m.chatId === chatId); },
    async attachFile(chatId, input, context = {}) { let uploaded = {}; if (driveApi?.upload && input.content != null)
        uploaded = await driveApi.upload({ fileName: input.fileName, content: input.content, path: input.path }, context); return attachments.create({ chatId, fileId: uploaded.id, fileName: uploaded.fileName ?? input.fileName, path: uploaded.path ?? input.path, provider: uploaded.provider }, context); },
    async queryBrowserSession(sessionId, input, context = {}) { return Chat.queryTransient({ ...input, sessionId }, context); },
    async queryTransient(input, context = {}) { const session = input.sessionId ? transientSessions.get(input.sessionId) ?? newTransientSession({ scope: input.scope, ownerId: input.ownerId }) : newTransientSession({ scope: input.scope, ownerId: input.ownerId }); session.messages.push({ role: 'user', content: normalizeContent(input.message), at: nowIso() }); let output; if (input.message.trim().startsWith('/')) {
        const [cmd, ...args] = input.message.trim().slice(1).split(/\s+/);
        const command = slash.get(cmd);
        output = command ? await command.handler(args, context, input.message) : `Unregistered slash command: /${cmd}`;
    }
    else
        output = await (responder ?? defaultResponder)({ ...input, context, transientMessages: session.messages }); const content = normalizeContent(output); session.messages.push({ role: 'assistant', content, at: nowIso() }); session.updatedAt = nowIso(); PackageObservability.track(`chat:transient:${session.id}`, { label: `${session.scope} chat session`, status: 'running', progress: 100, context: { messages: session.messages.length } }, context); await bus.emit(`chat:transient:${session.id}`, session); return { session, message: { role: 'assistant', content, format: typeof output === 'object' ? 'json' : 'text' } }; },
    async queryChat(chatId, input, context = {}) { if (input.transient) {
        const transient = await Chat.queryTransient({ ...input, sessionId: input.transientSessionId, ownerId: chatId }, context);
        return { id: makeId('transient_message'), chatId: transient.session.id, role: 'assistant', content: transient.message.content, format: transient.message.format, createdAt: nowIso(), updatedAt: nowIso() };
    } const chat = chats.get(chatId, context) ?? Chat.createChat({ title: 'Chat', mode: input.mode }, context); const user = messages.create({ chatId: chat.id, role: 'user', content: normalizeContent(input.message), format: 'text', metadata: { mode: input.mode } }, context); for (const file of input.attachments ?? [])
        await Chat.attachFile(chat.id, file, context); let output; if (input.message.trim().startsWith('/')) {
        const [cmd, ...args] = input.message.trim().slice(1).split(/\s+/);
        const command = slash.get(cmd);
        output = command ? await command.handler(args, context, input.message) : `Unregistered slash command: /${cmd}`;
    }
    else
        output = await (responder ?? defaultResponder)({ ...input, chat, context }); const assistant = messages.create({ chatId: chat.id, role: 'assistant', content: normalizeContent(output), format: typeof output === 'object' ? 'json' : 'text', metadata: { replyTo: user.id } }, context); PackageObservability.track(`chat:${chat.id}`, { label: chat.title, status: 'running', progress: 100, context: { lastMessage: assistant.id } }, context); await bus.emit(`chat:${chat.id}`, assistant); return assistant; },
    queryChaat(chatId, input, context = {}) { return Chat.queryChat(chatId, input, context); },
    onMessage(chatId, handler) { return bus.on(`chat:${chatId}`, handler); },
    onTransientSession(sessionId, handler) { return bus.on(`chat:transient:${sessionId}`, handler); },
    launcher: createStubLauncher,
    health() { return { name: '@connectingmatrix/chat', status: 'ok', checkedAt: nowIso(), details: { chats: chats.list({ root: true }).total, messages: messages.list({ root: true }).total, transientSessions: transientSessions.size, slashCommands: [...slash.keys()], singleChatOwner: true, driveBound: Boolean(driveApi), ...PackageObservability.healthDetails() } }; }
};
export const GigaChat = Chat;
export const graphql = { namespace: 'chat', typeDefs: `type Chat { id: ID!, title: String!, mode: String } type ChatMessage { id: ID!, chatId: ID!, role: String!, content: String!, format: String! } input QueryChatInput { message: String!, mode: String, transient: Boolean, transientSessionId: ID } type Query { chatsList: [Chat!]!, chatMessages(chatId: ID!): [ChatMessage!]!, chatLauncher: String! } type Mutation { chatCreate(title: String!, mode: String): Chat!, chatQuery(chatId: ID!, input: QueryChatInput!): ChatMessage! }`, resolvers: { Query: { chatsList: (_, __unknown, ctx) => Chat.getChats({}, ctx).items, chatMessages: (_, args, ctx) => Chat.getMessages(args.chatId, {}, ctx), chatLauncher: (_, __unknown, ctx) => JSON.stringify(createStubLauncher(ctx)) }, Mutation: { chatCreate: (_, args, ctx) => Chat.createChat(args, ctx), chatQuery: (_, args, ctx) => Chat.queryChat(args.chatId, args.input, ctx) } }, migrations: ['migrations/0001_init.sql'] };
export function createPackage() { return { name: '@connectingmatrix/chat', version: '0.3.0', health: () => Chat.health(), graphql, migrations: graphql.migrations, launcher: createStubLauncher, runtime: { Chat, GigaChat, observability: PackageObservability }, routes: [{ method: 'GET', path: '/chat/health', handler: () => Chat.health() }, { method: 'GET', path: '/chat/launcher', handler: (request) => createStubLauncher(request.context ?? {}) }] }; }
export * from './contracts.js';
export * from './package-structure.js';
export * from './observability.js';
export * from './launcher.js';
