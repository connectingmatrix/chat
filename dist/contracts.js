export class LocalEventBus {
    constructor() {
        this.handlers = new Map();
    }
    on(room, handler) {
        const handlers = this.handlers.get(room) ?? new Set();
        handlers.add(handler);
        this.handlers.set(room, handlers);
        return () => this.off(room, handler);
    }
    off(room, handler) {
        const handlers = this.handlers.get(room);
        if (!handlers)
            return;
        handlers.delete(handler);
        if (handlers.size === 0)
            this.handlers.delete(room);
    }
    async emit(room, payload) {
        const handlers = [...(this.handlers.get(room) ?? [])];
        for (const handler of handlers)
            await handler(payload);
    }
    rooms() {
        return [...this.handlers.keys()];
    }
}
export function nowIso() {
    return new Date().toISOString();
}
export function normalizeLimit(limit, fallback = 50, max = 500) {
    const value = Number.isFinite(limit) ? Number(limit) : fallback;
    return Math.max(1, Math.min(max, Math.floor(value)));
}
export function tenantKey(context) {
    if (context.root)
        return 'root';
    if (context.organizationId)
        return `org:${context.organizationId}`;
    if (context.userId)
        return `user:${context.userId}`;
    return 'anonymous';
}
export function assertTenantMatch(record, context) {
    if (context.root)
        return;
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
export function assertTenantCreate(input, context) {
    if (context.root)
        return;
    if (context.organizationId && typeof input.organizationId === 'string' && input.organizationId !== context.organizationId) {
        throw new Error('Access denied: cannot create record for another organization');
    }
    if (context.userId && typeof input.userId === 'string' && input.userId !== context.userId) {
        throw new Error('Access denied: cannot create record for another user');
    }
}
export function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
}
export function bindWithServerFactory(target, setEndpoint) {
    return Object.assign(target, {
        bindWithServer(endpoint) {
            setEndpoint(endpoint.replace(/\/$/, ''));
            return target;
        },
    });
}
