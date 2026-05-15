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
}

export interface PackageRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: (request: unknown, response?: unknown) => Promise<unknown> | unknown;
}

export interface PackageModule {
  name: string;
  version: string;
  health: () => PackageHealth | Promise<PackageHealth>;
  graphql?: GraphQLPackage;
  routes?: PackageRoute[];
  migrations?: string[];
}

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export class LocalEventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(room: string, handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(room) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.handlers.set(room, handlers);
    return () => this.off(room, handler as EventHandler);
  }

  off(room: string, handler: EventHandler): void {
    const handlers = this.handlers.get(room);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this.handlers.delete(room);
  }

  async emit<T = unknown>(room: string, payload: T): Promise<void> {
    const handlers = [...(this.handlers.get(room) ?? [])];
    for (const handler of handlers) await handler(payload);
  }

  rooms(): string[] {
    return [...this.handlers.keys()];
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeLimit(limit?: number, fallback = 50, max = 500): number {
  const value = Number.isFinite(limit) ? Number(limit) : fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function tenantKey(context: RequestContext): string {
  if (context.root) return 'root';
  if (context.organizationId) return `org:${context.organizationId}`;
  if (context.userId) return `user:${context.userId}`;
  return 'anonymous';
}

export function assertTenantMatch<T extends { userId?: string; organizationId?: string }>(record: T, context: RequestContext): void {
  if (context.root) return;
  if (record.organizationId) {
    if (!context.organizationId || record.organizationId !== context.organizationId) {
      throw new Error('Access denied: record belongs to another organization');
    }
    return;
  }
  if (record.userId && (!context.userId || record.userId !== context.userId)) {
    throw new Error('Access denied: record belongs to another user');
  }
}

export function assertTenantCreate(input: { userId?: unknown; organizationId?: unknown }, context: RequestContext): void {
  if (context.root) return;
  if (context.organizationId && typeof input.organizationId === 'string' && input.organizationId !== context.organizationId) {
    throw new Error('Access denied: cannot create record for another organization');
  }
  if (context.userId && typeof input.userId === 'string' && input.userId !== context.userId) {
    throw new Error('Access denied: cannot create record for another user');
  }
}

export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function bindWithServerFactory<T extends object>(target: T, setEndpoint: (endpoint: string) => void) {
  return Object.assign(target, {
    bindWithServer(endpoint: string) {
      setEndpoint(endpoint.replace(/\/$/, ''));
      return target as T & { bindWithServer(endpoint: string): T };
    },
  });
}
