import { type BaseRecord } from './entity/repository.js';
import { type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
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
export interface TransientChatSession {
    id: string;
    scope: 'project-debug' | 'agent-chat' | 'agent-creation-debug' | 'generic';
    ownerId?: string;
    messages: Array<{
        role: ChatMessage['role'];
        content: string;
        at: string;
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
    transient?: boolean;
    transientSessionId?: string;
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
    transientMessages?: TransientChatSession['messages'];
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
    bindDrive(api: typeof driveApi): /*elided*/ any;
    setResponder(next: typeof responder): /*elided*/ any;
    registerSlashCommand(command: SlashCommand): /*elided*/ any;
    registerSlashCommands(commands?: SlashCommand[]): /*elided*/ any;
    listSlashCommands(): {
        command: string;
        owner: string | undefined;
        description: string | undefined;
    }[];
    createTransientSession(input?: {
        scope?: TransientChatSession["scope"];
        ownerId?: string;
    }): TransientChatSession;
    createBrowserSession(input?: {
        scope?: TransientChatSession["scope"];
        targetId?: string;
        ownerId?: string;
        browserContext?: Record<string, unknown>;
    }): TransientChatSession;
    getTransientSession(id: string): TransientChatSession | undefined;
    clearTransientSession(id: string): boolean;
    clearBrowserSession(id: string): boolean;
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
    queryBrowserSession(sessionId: string, input: QueryChatInput, context?: RequestContext): Promise<{
        session: TransientChatSession;
        message: {
            role: "assistant";
            content: string;
            format: "text" | "json";
        };
    }>;
    queryTransient(input: QueryChatInput & {
        sessionId?: string;
        scope?: TransientChatSession["scope"];
        ownerId?: string;
    }, context?: RequestContext): Promise<{
        session: TransientChatSession;
        message: {
            role: "assistant";
            content: string;
            format: "text" | "json";
        };
    }>;
    queryChat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    queryChaat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    onMessage(chatId: string, handler: (message: ChatMessage) => void | Promise<void>): () => void;
    onTransientSession(sessionId: string, handler: (session: TransientChatSession) => void | Promise<void>): () => void;
    launcher: typeof import("./launcher.js").createConnectingmatrixChatStubLauncher;
    health(): PackageHealth;
};
export declare const GigaChat: {
    bindDrive(api: typeof driveApi): /*elided*/ any;
    setResponder(next: typeof responder): /*elided*/ any;
    registerSlashCommand(command: SlashCommand): /*elided*/ any;
    registerSlashCommands(commands?: SlashCommand[]): /*elided*/ any;
    listSlashCommands(): {
        command: string;
        owner: string | undefined;
        description: string | undefined;
    }[];
    createTransientSession(input?: {
        scope?: TransientChatSession["scope"];
        ownerId?: string;
    }): TransientChatSession;
    createBrowserSession(input?: {
        scope?: TransientChatSession["scope"];
        targetId?: string;
        ownerId?: string;
        browserContext?: Record<string, unknown>;
    }): TransientChatSession;
    getTransientSession(id: string): TransientChatSession | undefined;
    clearTransientSession(id: string): boolean;
    clearBrowserSession(id: string): boolean;
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
    queryBrowserSession(sessionId: string, input: QueryChatInput, context?: RequestContext): Promise<{
        session: TransientChatSession;
        message: {
            role: "assistant";
            content: string;
            format: "text" | "json";
        };
    }>;
    queryTransient(input: QueryChatInput & {
        sessionId?: string;
        scope?: TransientChatSession["scope"];
        ownerId?: string;
    }, context?: RequestContext): Promise<{
        session: TransientChatSession;
        message: {
            role: "assistant";
            content: string;
            format: "text" | "json";
        };
    }>;
    queryChat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    queryChaat(chatId: string, input: QueryChatInput, context?: RequestContext): Promise<ChatMessage>;
    onMessage(chatId: string, handler: (message: ChatMessage) => void | Promise<void>): () => void;
    onTransientSession(sessionId: string, handler: (session: TransientChatSession) => void | Promise<void>): () => void;
    launcher: typeof import("./launcher.js").createConnectingmatrixChatStubLauncher;
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
export * from './observability.js';
export * from './launcher.js';
