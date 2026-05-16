declare const process: { pid: number; uptime?: () => number; memoryUsage?: () => { rss?: number; heapUsed?: number; heapTotal?: number; external?: number; arrayBuffers?: number }; env?: Record<string,string|undefined>; versions?: Record<string,string> };
declare module 'node:test' { const test: any; export default test; }
declare module 'node:assert/strict' { const assert: any; export default assert; }
declare module 'node:http' { export const createServer: any; }
declare module 'node:fs' { const fs: any; export default fs; export const readdirSync:any; export const statSync:any; export const existsSync:any; export const readFileSync:any; export const writeFileSync:any; export const appendFileSync:any; export const mkdirSync:any; }
declare module 'node:path' { const path: any; export default path; export const join:any; export const relative:any; export const dirname:any; }
declare module 'node:child_process' { export const spawnSync: any; }
declare module 'node:crypto' { export const createHmac:any; export const randomUUID:any; export const randomBytes:any; export const timingSafeEqual:any; }
declare module 'socket.io-client' { export const io: any; export type Socket = any; }
declare module 'react' { export const useEffect: any; export const useMemo: any; export const useState: any; export type ReactNode = any; const React: any; export default React; }
interface ImportMeta { env?: Record<string,string|boolean|undefined>; }
declare const Buffer: any;
