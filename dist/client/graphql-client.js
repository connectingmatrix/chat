export class GraphQLClient {
    constructor(options = {}) {
        this.endpoint = '/graphql';
        this.headers = {};
        if (options.endpoint)
            this.endpoint = options.endpoint.replace(/\/$/, '');
        this.headers = options.headers ?? {};
        this.fetchImpl = options.fetchImpl;
    }
    bindWithServer(endpoint) {
        this.endpoint = endpoint.replace(/\/$/, '');
        return this;
    }
    setHeaders(headers) {
        this.headers = { ...this.headers, ...headers };
        return this;
    }
    async query(operation, variables = {}, context) {
        const fetcher = this.fetchImpl ?? globalThis.fetch;
        if (!fetcher)
            throw new Error('No fetch implementation is available for GraphQLClient');
        const headers = {
            'content-type': 'application/json',
            ...this.headers,
        };
        for (const [key, value] of Object.entries(context?.headers ?? {})) {
            if (typeof value === 'string')
                headers[key] = value;
        }
        const response = await fetcher(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query: operation, variables }),
        });
        const payload = await response.json();
        if (!response.ok || payload.errors?.length) {
            throw new Error(payload.errors?.map((error) => error.message).join('; ') || `GraphQL request failed with ${response.status}`);
        }
        return payload.data;
    }
}
