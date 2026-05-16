import type { RequestContext } from '../contracts.js';

export interface GraphQLClientOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class GraphQLClient {
  private endpoint = '/graphql';
  private headers: Record<string, string> = {};
  private fetchImpl: typeof fetch | undefined;

  constructor(options: GraphQLClientOptions = {}) {
    if (options.endpoint) this.endpoint = options.endpoint.replace(/\/$/, '');
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl;
  }

  bindWithServer(endpoint: string): this {
    this.endpoint = endpoint.replace(/\/$/, '');
    return this;
  }

  setHeaders(headers: Record<string, string>): this {
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  async query<T>(operation: string, variables: Record<string, unknown> = {}, context?: RequestContext): Promise<T> {
    const fetcher = this.fetchImpl ?? globalThis.fetch;
    if (!fetcher) throw new Error('No fetch implementation is available for GraphQLClient');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.headers,
    };
    for (const [key, value] of Object.entries(context?.headers ?? {})) {
      if (typeof value === 'string') headers[key] = value;
    }
    const response = await fetcher(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: operation, variables }),
    });
    const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.map((error) => error.message).join('; ') || `GraphQL request failed with ${response.status}`);
    }
    return payload.data as T;
  }
}
