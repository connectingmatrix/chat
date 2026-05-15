import { LocalEventBus, makeId, nowIso, type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
import { InMemoryRepository, type BaseRecord } from './entity/repository.js';

export interface ChatRecord extends BaseRecord { title: string; mode?: string; }
export interface ChatMessageRecord extends BaseRecord { chatId: string; role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, unknown>; }
export type SlashHandler = (args: string[], context: RequestContext, raw: string) => Promise<unknown> | unknown;
export type ChatResponder = (input: { chatId: string; message: string; mode?: string; context: RequestContext }) => Promise<unknown> | unknown;
export interface SlashCommandDescriptor { command: string; owner?: string; description?: string; handler: SlashHandler; }

const chats = new InMemoryRepository<ChatRecord>('chat');
const messages = new InMemoryRepository<ChatMessageRecord>('chat_msg');
const slash = new Map<string, SlashCommandDescriptor>();
const bus = new LocalEventBus();
let responder: ChatResponder | undefined;

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'message' in content) return normalizeContent((content as { message?: unknown }).message);
  if (content == null) return '';
  try { return JSON.stringify(content); } catch { return String(content); }
}

function normalizeCommand(command: string): string {
  return command.trim().startsWith('/') ? command.trim().toLowerCase() : `/${command.trim().toLowerCase()}`;
}

function helpText(): string {
  const commands = [...slash.values()].map((item) => `${item.command}${item.owner ? ` (${item.owner})` : ''}${item.description ? ` - ${item.description}` : ''}`);
  return commands.length ? `Registered slash commands:\n${commands.join('\n')}` : 'No package slash commands are registered yet.';
}

slash.set('/help', { command: '/help', owner: '@connectingmatrix/chat', description: 'List registered package-owned slash commands', handler: () => helpText() });

export const Chat = {
  bindWithServer(_endpoint: string) { return Chat; },
  setResponder(nextResponder: ChatResponder) { responder = nextResponder; return Chat; },
  registerSlashCommand(command: string, handler: SlashHandler, options: { owner?: string; description?: string } = {}) {
    const normalized = normalizeCommand(command);
    slash.set(normalized, { command: normalized, owner: options.owner, description: options.description, handler });
    return Chat;
  },
  registerSlashCommands(commands: SlashCommandDescriptor[]) {
    for (const command of commands) Chat.registerSlashCommand(command.command, command.handler, { owner: command.owner, description: command.description });
    return Chat;
  },
  listSlashCommands() { return [...slash.values()].map(({ command, owner, description }) => ({ command, owner, description })); },
  getChats(pagination: PaginationOptions = {}, context: RequestContext = {}) { return chats.list(context, pagination); },
  createChat(input: { title: string; mode?: string }, context: RequestContext = {}) { return chats.create(input, context); },
  getMessages(chatId: string, pagination: PaginationOptions = {}, context: RequestContext = {}) {
    const listed = messages.list(context, { ...pagination, limit: pagination.limit ?? 100 });
    return { ...listed, items: listed.items.filter((m) => m.chatId === chatId) };
  },
  search(chatId: string, term: string, context: RequestContext = {}) { return messages.search(term, context, ['content']).filter((m) => m.chatId === chatId); },
  async sendMessage(chatId: string, content: unknown, context: RequestContext = {}) { const message = messages.create({ chatId, role: 'user', content: normalizeContent(content) }, context); await bus.emit(`chat:${chatId}`, message); return message; },
  async queryChat(chatId: string, input: { message: unknown; mode?: string }, context: RequestContext = {}) {
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
  onMessage(chatId: string, handler: (message: ChatMessageRecord) => void | Promise<void>) { return bus.on(`chat:${chatId}`, handler); },
  health(): PackageHealth { return { name: '@connectingmatrix/chat', status: 'ok', checkedAt: nowIso(), details: { chats: chats.list({ root: true }).total, messages: messages.list({ root: true }).total, slashCommands: slash.size, responder: Boolean(responder) } }; },
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
    Query: { chatList: (_: unknown, args: PaginationOptions, ctx: RequestContext) => Chat.getChats(args, ctx).items, chatMessages: (_: unknown, args: { chatId: string }, ctx: RequestContext) => Chat.getMessages(args.chatId, {}, ctx).items, chatSlashCommands: () => Chat.listSlashCommands(), chatHealth: () => Chat.health().status },
    Mutation: { chatCreate: (_: unknown, args: { title: string; mode?: string }, ctx: RequestContext) => Chat.createChat(args, ctx), queryChat: (_: unknown, args: { input: { chatId: string; message: string; mode?: string } }, ctx: RequestContext) => Chat.queryChat(args.input.chatId, { message: args.input.message, mode: args.input.mode }, ctx) },
  },
  migrations: ['migrations/0001_init.sql'],
};
export function createPackage(): PackageModule { return { name: '@connectingmatrix/chat', version: '0.1.0', health: () => Chat.health(), graphql, migrations: graphql.migrations, routes: [{ method: 'GET', path: '/chat/health', handler: () => Chat.health() }, { method: 'POST', path: '/chat/query', handler: (request) => Chat.queryChat(String((request as { body?: { chatId?: string } }).body?.chatId ?? ''), { message: (request as { body?: { message?: unknown; mode?: string } }).body?.message ?? '', mode: (request as { body?: { mode?: string } }).body?.mode }) }] }; }
export * from './contracts.js';
