export type CrudAction = 'create' | 'read' | 'update' | 'delete' | 'execute';
export type ObjectScope = 'user' | 'organization' | 'root';
export interface RequestContext {
    userId?: string;
    organizationId?: string;
    root?: boolean;
    headers?: Record<string, string | undefined>;
    traceId?: string;
    scope?: ObjectScope;
    permissionToken?: unknown;
}
export interface PackageHealth {
    name: string;
    status: 'ok' | 'degraded' | 'down';
    details?: Record<string, unknown>;
    checkedAt: string;
}
export interface PaginationOptions {
    limit?: number;
    offset?: number;
    cursor?: string;
}
export interface ListResult<T> {
    items: T[];
    total: number;
    nextCursor?: string;
}
export interface GraphQLPackage {
    namespace: string;
    typeDefs: string;
    resolvers: Record<string, unknown>;
    migrations?: string[];
    launcher?: (context?: RequestContext) => PackageLauncherPanel | Promise<PackageLauncherPanel>;
    slashCommands?: Array<{
        command: string;
        owner?: string;
        description?: string;
        handler: (args: string[], context: RequestContext, raw?: string) => unknown | Promise<unknown>;
    }>;
    runtime?: Record<string, unknown>;
}
export interface PackageRoute {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    handler: (request: unknown, response?: unknown) => Promise<unknown> | unknown;
}
export interface PackageLauncherAction {
    name: string;
    label: string;
    description?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'LOCAL';
    path?: string;
    sampleInput?: unknown;
}
export interface PackageLauncherPanel {
    packageName: string;
    title: string;
    mode: 'stub' | 'connected';
    status: 'ready' | 'degraded' | 'offline';
    checkedAt: string;
    summary: string;
    healthPath?: string;
    graphqlNamespace?: string;
    routes?: Array<{
        method: string;
        path: string;
        description?: string;
    }>;
    owns?: {
        ui?: string[];
        backend?: string[];
        entity?: string[];
        migrations?: string[];
    };
    actions: PackageLauncherAction[];
    sampleData?: unknown;
    context?: Record<string, unknown>;
    notes?: string[];
}
export interface PackageModule {
    name: string;
    version: string;
    health: () => PackageHealth | Promise<PackageHealth>;
    graphql?: GraphQLPackage;
    routes?: PackageRoute[];
    migrations?: string[];
    launcher?: (context?: RequestContext) => PackageLauncherPanel | Promise<PackageLauncherPanel>;
    slashCommands?: Array<{
        command: string;
        owner?: string;
        description?: string;
        handler: (args: string[], context: RequestContext, raw?: string) => unknown | Promise<unknown>;
    }>;
    runtime?: Record<string, unknown>;
}
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
export declare class LocalEventBus {
    private readonly handlers;
    on<T = unknown>(room: string, handler: EventHandler<T>): () => void;
    off(room: string, handler: EventHandler): void;
    emit<T = unknown>(room: string, payload: T): Promise<void>;
    rooms(): string[];
}
export declare function nowIso(): string;
export declare function normalizeLimit(limit?: number, fallback?: number, max?: number): number;
export declare function tenantKey(context: RequestContext): string;
export declare function assertTenantMatch<T extends {
    userId?: string;
    organizationId?: string;
}>(record: T, context: RequestContext): void;
export declare function assertTenantCreate(input: {
    userId?: unknown;
    organizationId?: unknown;
}, context: RequestContext): void;
export declare function makeId(prefix: string): string;
export declare function bindWithServerFactory<T extends object>(target: T, setEndpoint: (endpoint: string) => void): T & {
    bindWithServer(endpoint: string): T & {
        bindWithServer(endpoint: string): T;
    };
};
