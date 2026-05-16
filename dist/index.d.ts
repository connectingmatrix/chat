import { type BaseRecord } from './entity/repository.js';
import { type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
import { createPackageStatusPanel } from './services/package-status.service.js';
export interface ChatRecord extends BaseRecord {
    title: string;
    mode?: string;
}
export interface ChatMessage extends BaseRecord {
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    format: 'text' | 'json' | 'markdown';
    metadata?: Record<string, unknown>;
}
export interface ChatAttachment extends BaseRecord {
    chatId: string;
    messageId?: string;
    fileId?: string;
    fileName: string;
    path?: string;
    provider?: string;
}
export interface BrowserChatSession {
    id: string;
    scope: 'project-debug' | 'agent-chat' | 'agent-creation-debug' | 'generic';
    targetId?: string;
    persistChat: false;
    browserContext: Record<string, unknown>;
    messages: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        at: string;
        metadata?: Record<string, unknown>;
    }>;
    createdAt: string;
    updatedAt: string;
}
export interface QueryChatInput {
    message: string;
    mode?: string;
    attachments?: Array<{
        fileName: string;
        content?: string | Uint8Array;
        path?: string;
    }>;
    confirm?: boolean;
    browserContext?: Record<string, unknown>;
}
export type QueryChatOptions = QueryChatInput;
export type ChatMessageRecord = ChatMessage;
export type ChatAttachmentRecord = ChatAttachment;
export interface SlashCommand {
    command: string;
    owner?: string;
    description?: string;
    handler: (args: string[], context: RequestContext, raw?: string) => unknown | Promise<unknown>;
}
declare let responder: ((input: QueryChatInput & {
    chat?: ChatRecord;
    context: RequestContext;
    browserSession?: BrowserChatSession;
}) => Promise<string>) | undefined;
declare let driveApi: {
    upload?: (input: {
        fileName: string;
        content: string | Uint8Array;
        path?: string;
    }, context?: RequestContext) => Promise<{
        id?: string;
        path?: string;
        provider?: string;
        fileName?: string;
    }>;
} | undefined;
export declare const Chat: {
    bindLogger(logger: unknown): /*elided*/ any;
    bindSockets(sockets: unknown): /*elided*/ any;
    bindDrive(api: typeof driveApi): /*elided*/ any;
    setResponder(next: typeof responder): /*elided*/ any;
    registerSlashCommand(command: SlashCommand): /*elided*/ any;
    registerSlashCommands(commands?: SlashCommand[]): /*elided*/ any;
    listSlashCommands(): {
        command: string;
        owner: string;
        description: string;
    }[];
    createChat(input: {
        title: string;
        mode?: string;
    }, context?: RequestContext): ChatRecord;
    getChats(pagination?: PaginationOptions, context?: RequestContext): import("./contracts.js").ListResult<ChatRecord>;
    getMessages(chatId: string, pagination?: PaginationOptions, context?: RequestContext): ChatMessage[];
    search(chatId: string, term: string, context?: RequestContext): ChatMessage[];
    attachFile(chatId: string, input: {
        fileName: string;
        content?: string | Uint8Array;
        path?: string;
    }, context?: RequestContext): Promise<ChatAttachment>;
    queryChat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    queryChaat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    createBrowserSession(input?: {
        scope?: BrowserChatSession["scope"];
        targetId?: string;
        browserContext?: Record<string, unknown>;
    }): BrowserChatSession;
    queryBrowserSession(sessionId: string, input: QueryChatInput, context?: RequestContext): Promise<{
        role: "assistant";
        content: string;
        at: string;
        metadata: {
            transient: boolean;
            persistedToChatDb: boolean;
        };
    }>;
    clearBrowserSession(sessionId: string): boolean;
    onMessage(chatId: string, handler: (message: ChatMessage) => void | Promise<void>): () => void;
    launcher: typeof createPackageStatusPanel;
    health(): PackageHealth;
};
export declare const GigaChat: {
    bindLogger(logger: unknown): /*elided*/ any;
    bindSockets(sockets: unknown): /*elided*/ any;
    bindDrive(api: typeof driveApi): /*elided*/ any;
    setResponder(next: typeof responder): /*elided*/ any;
    registerSlashCommand(command: SlashCommand): /*elided*/ any;
    registerSlashCommands(commands?: SlashCommand[]): /*elided*/ any;
    listSlashCommands(): {
        command: string;
        owner: string;
        description: string;
    }[];
    createChat(input: {
        title: string;
        mode?: string;
    }, context?: RequestContext): ChatRecord;
    getChats(pagination?: PaginationOptions, context?: RequestContext): import("./contracts.js").ListResult<ChatRecord>;
    getMessages(chatId: string, pagination?: PaginationOptions, context?: RequestContext): ChatMessage[];
    search(chatId: string, term: string, context?: RequestContext): ChatMessage[];
    attachFile(chatId: string, input: {
        fileName: string;
        content?: string | Uint8Array;
        path?: string;
    }, context?: RequestContext): Promise<ChatAttachment>;
    queryChat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    queryChaat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    createBrowserSession(input?: {
        scope?: BrowserChatSession["scope"];
        targetId?: string;
        browserContext?: Record<string, unknown>;
    }): BrowserChatSession;
    queryBrowserSession(sessionId: string, input: QueryChatInput, context?: RequestContext): Promise<{
        role: "assistant";
        content: string;
        at: string;
        metadata: {
            transient: boolean;
            persistedToChatDb: boolean;
        };
    }>;
    clearBrowserSession(sessionId: string): boolean;
    onMessage(chatId: string, handler: (message: ChatMessage) => void | Promise<void>): () => void;
    launcher: typeof createPackageStatusPanel;
    health(): PackageHealth;
};
export declare const graphql: {
    namespace: string;
    typeDefs: string;
    resolvers: {
        Query: {
            chatsList: (_: unknown, __unknown: unknown, ctx: RequestContext) => ChatRecord[];
            chatMessages: (_: unknown, args: {
                chatId: string;
            }, ctx: RequestContext) => ChatMessage[];
            chatLauncher: (_: unknown, __unknown: unknown, ctx: RequestContext) => string;
        };
        Mutation: {
            chatCreate: (_: unknown, args: {
                title: string;
                mode?: string;
            }, ctx: RequestContext) => ChatRecord;
            chatQuery: (_: unknown, args: {
                chatId: string;
                input: QueryChatInput;
            }, ctx: RequestContext) => Promise<ChatMessage>;
        };
    };
    migrations: string[];
};
export declare function createPackage(): PackageModule;
export * from './contracts.js';
export * from './package-structure.js';
export * from './services/package-status.service.js';
