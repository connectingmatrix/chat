import { assertTenantCreate, assertTenantMatch, makeId, normalizeLimit } from '../contracts.js';
export class InMemoryRepository {
    constructor(prefix) {
        this.prefix = prefix;
        this.records = new Map();
    }
    create(input, context = {}) {
        assertTenantCreate(input, context);
        const now = new Date().toISOString();
        const record = {
            ...input,
            id: typeof input.id === 'string' ? input.id : makeId(this.prefix),
            userId: input.userId ?? context.userId,
            organizationId: input.organizationId ?? context.organizationId,
            createdAt: now,
            updatedAt: now,
        };
        this.records.set(record.id, record);
        return record;
    }
    get(id, context = {}) {
        const record = this.records.get(id);
        if (!record)
            return undefined;
        assertTenantMatch(record, context);
        return record;
    }
    list(context = {}, pagination = {}) {
        const limit = normalizeLimit(pagination.limit);
        const offset = Math.max(0, Number(pagination.offset ?? 0));
        const filtered = [...this.records.values()].filter((record) => {
            try {
                assertTenantMatch(record, context);
                return true;
            }
            catch {
                return false;
            }
        });
        const items = filtered.slice(offset, offset + limit);
        const nextOffset = offset + limit;
        return {
            items,
            total: filtered.length,
            nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined,
        };
    }
    update(id, patch, context = {}) {
        const existing = this.get(id, context);
        if (!existing)
            throw new Error(`${this.prefix} record not found: ${id}`);
        const safePatch = { ...patch };
        delete safePatch.id;
        delete safePatch.userId;
        delete safePatch.organizationId;
        delete safePatch.createdAt;
        const updated = {
            ...existing,
            ...safePatch,
            id: existing.id,
            userId: existing.userId,
            organizationId: existing.organizationId,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        };
        assertTenantMatch(updated, context);
        this.records.set(id, updated);
        return updated;
    }
    delete(id, context = {}) {
        const existing = this.get(id, context);
        if (!existing)
            return false;
        return this.records.delete(id);
    }
    search(term, context = {}, fields = []) {
        const needle = term.trim().toLowerCase();
        return this.list(context, { limit: 500 }).items.filter((record) => {
            const values = fields.length ? fields.map((field) => record[field]) : Object.values(record);
            return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
        });
    }
    clear() {
        this.records.clear();
    }
}
