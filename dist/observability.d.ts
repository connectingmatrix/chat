import { type PackageHealth } from './contracts.js';
export type ObservabilityLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LoggerLike {
    log?: (level: ObservabilityLevel, message: string, data?: unknown) => Promise<unknown> | unknown;
    debug?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    info?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    warn?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    error?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    recordPackageSnapshot?: (snapshot: PackageProcessSnapshot) => Promise<unknown> | unknown;
}
export interface SocketLike {
    register?: (room: string) => unknown;
    broadcast?: (room: string, payload: unknown, event?: string, traceId?: string) => Promise<unknown> | unknown;
    emitLog?: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
}
export interface PackageProcessSnapshot {
    packageName: string;
    pid?: number;
    at: string;
    source: string;
    uptimeSeconds?: number;
    memory?: Record<string, number>;
    details?: Record<string, unknown>;
}
export interface PackageLogEvent {
    packageName: string;
    level: ObservabilityLevel;
    message: string;
    data?: unknown;
    at: string;
}
export declare class PackageObservability {
    readonly packageName: string;
    private logger?;
    private sockets?;
    private readonly snapshots;
    constructor(packageName: string);
    bindLogger(logger: LoggerLike): this;
    bindSockets(sockets: SocketLike): this;
    snapshot(source?: string, details?: Record<string, unknown>): PackageProcessSnapshot;
    history(limit?: number): PackageProcessSnapshot[];
    emit(level: ObservabilityLevel, message: string, data?: unknown): Promise<PackageLogEvent>;
    health(): PackageHealth;
}
export declare function createPackageObservability(packageName: string): PackageObservability;
