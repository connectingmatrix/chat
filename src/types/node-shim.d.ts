
declare module 'node:test' { const test: any; export default test; }
declare module 'node:assert/strict' { const assert: any; export default assert; }
declare module 'node:fs' { export function appendFileSync(path: string, data: string): void; export function mkdirSync(path: string, opts?: any): void; }
declare module 'node:path' { export function dirname(path: string): string; }
declare module 'node:crypto' { export function createHmac(algorithm: string, key: string): { update(data: string): any; digest(enc: string): string }; export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean; }
declare module 'node:http' { export function createServer(handler: (request: any, response: any) => any): any; }
declare const process: { pid: number; memoryUsage?: () => NodeJS.MemoryUsage };
declare const Buffer: { from(input: any, encoding?: string): any; concat(chunks: any[]): any; };
declare namespace NodeJS { interface MemoryUsage { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers?: number } }
