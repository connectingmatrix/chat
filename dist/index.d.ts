import { type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
import { type BaseRecord } from './entity/repository.js';
export interface ChatRecord extends BaseRecord {
    title: string;
    mode?: string;
}
export interface ChatMessageRecord extends BaseRecord {
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
}
export type SlashHandler = (args: string[], context: RequestContext, raw: string) => Promise<unknown> | unknown;
export type ChatResponder = (input: {
    chatId: string;
    message: string;
    mode?: string;
    context: RequestContext;
}) => Promise<unknown> | unknown;
export interface SlashCommandDescriptor {
    command: string;
    owner?: string;
    description?: string;
    handler: SlashHandler;
}
export declare const Chat: {
    bindWithServer(_endpoint: string): /*elided*/ any;
    setResponder(nextResponder: ChatResponder): /*elided*/ any;
    registerSlashCommand(command: string, handler: SlashHandler, options?: {
        owner?: string;
        description?: string;
    }): /*elided*/ any;
    registerSlashCommands(commands: SlashCommandDescriptor[]): /*elided*/ any;
    listSlashCommands(): {
        command: string;
        owner: string | undefined;
        description: string | undefined;
    }[];
    getChats(pagination?: PaginationOptions, context?: RequestContext): import("./contracts.js").ListResult<ChatRecord>;
    createChat(input: {
        title: string;
        mode?: string;
    }, context?: RequestContext): ChatRecord;
    getMessages(chatId: string, pagination?: PaginationOptions, context?: RequestContext): {
        items: ChatMessageRecord[];
        total: number;
        nextCursor?: string;
    };
    search(chatId: string, term: string, context?: RequestContext): ChatMessageRecord[];
    sendMessage(chatId: string, content: unknown, context?: RequestContext): Promise<ChatMessageRecord>;
    queryChat(chatId: string, input: {
        message: unknown;
        mode?: string;
    }, context?: RequestContext): Promise<ChatMessageRecord>;
    onMessage(chatId: string, handler: (message: ChatMessageRecord) => void | Promise<void>): () => void;
    health(): PackageHealth;
};
export declare const graphql: {
    namespace: string;
    typeDefs: string;
    resolvers: {
        Query: {
            chatList: (_: unknown, args: PaginationOptions, ctx: RequestContext) => ChatRecord[];
            chatMessages: (_: unknown, args: {
                chatId: string;
            }, ctx: RequestContext) => ChatMessageRecord[];
            chatSlashCommands: () => {
                command: string;
                owner: string | undefined;
                description: string | undefined;
            }[];
            chatHealth: () => "ok" | "degraded" | "down";
        };
        Mutation: {
            chatCreate: (_: unknown, args: {
                title: string;
                mode?: string;
            }, ctx: RequestContext) => ChatRecord;
            queryChat: (_: unknown, args: {
                input: {
                    chatId: string;
                    message: string;
                    mode?: string;
                };
            }, ctx: RequestContext) => Promise<ChatMessageRecord>;
        };
    };
    migrations: string[];
};
export declare function createPackage(): PackageModule;
export * from './contracts.js';
