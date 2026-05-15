import type { RequestContext } from '../contracts.js';
export interface GraphQLClientOptions {
    endpoint?: string;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
}
export declare class GraphQLClient {
    private endpoint;
    private headers;
    private fetchImpl;
    constructor(options?: GraphQLClientOptions);
    bindWithServer(endpoint: string): this;
    setHeaders(headers: Record<string, string>): this;
    query<T>(operation: string, variables?: Record<string, unknown>, context?: RequestContext): Promise<T>;
}
