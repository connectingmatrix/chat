import { type ListResult, type PaginationOptions, type RequestContext } from '../contracts.js';
export interface BaseRecord {
    id: string;
    userId?: string;
    organizationId?: string;
    createdAt: string;
    updatedAt: string;
}
export declare class InMemoryRepository<T extends BaseRecord> {
    private readonly prefix;
    private readonly records;
    constructor(prefix: string);
    create(input: Omit<Partial<T>, 'id' | 'createdAt' | 'updatedAt'> & Record<string, unknown>, context?: RequestContext): T;
    get(id: string, context?: RequestContext): T | undefined;
    list(context?: RequestContext, pagination?: PaginationOptions): ListResult<T>;
    update(id: string, patch: Partial<T>, context?: RequestContext): T;
    delete(id: string, context?: RequestContext): boolean;
    search(term: string, context?: RequestContext, fields?: Array<keyof T>): T[];
    clear(): void;
}
