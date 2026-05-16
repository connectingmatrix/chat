import { type PackageHealth, type RequestContext } from './contracts.js';
export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RuntimeProcessKind = 'workflow' | 'ai-agent' | 'swarm' | 'project' | 'node' | 'file' | 'drive' | 'server' | 'logger' | 'socket' | 'unknown' | string;
export type RuntimeProcessStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'errored';
export interface RuntimeLogEvent {
    packageName: string;
    level: RuntimeLogLevel;
    message: string;
    data?: unknown;
    at: string;
    traceId?: string;
    pid?: number;
    memory?: {
        rss?: number;
        heapUsed?: number;
        heapTotal?: number;
        external?: number;
    };
}
export interface RuntimeProcessSnapshot {
    packageName: string;
    processId: string;
    label: string;
    status: RuntimeProcessStatus;
    progress?: number;
    updatedAt: string;
    pid?: number;
    memory?: RuntimeLogEvent['memory'];
    context?: Record<string, unknown>;
    startedAt?: string;
    completedAt?: string;
    abortReason?: string;
    kind?: string;
}
export interface RuntimeLoggerLike {
    log?: (level: RuntimeLogLevel, message: string, data?: unknown) => Promise<unknown> | unknown;
    info?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    warn?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    error?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    debug?: (message: string, data?: unknown) => Promise<unknown> | unknown;
    registerPackage?: (name: string, health: () => PackageHealth | Promise<PackageHealth>) => unknown;
    trackProcess?: (processId: string, patch?: Partial<Omit<RuntimeProcessSnapshot, 'processId' | 'updatedAt'>> & {
        packageName?: string;
    }, context?: RequestContext) => unknown;
    processLog?: (processId: string, level: RuntimeLogLevel, message: string, data?: unknown, context?: RequestContext) => unknown;
    abortProcess?: (processId: string, reason?: string, context?: RequestContext) => unknown;
}
export interface RuntimeSocketLike {
    register?: (room: string) => unknown;
    broadcast?: (room: string, payload: unknown, event?: string, traceId?: string) => Promise<unknown> | unknown;
    emitLog?: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
}
export interface ObservabilityBinding {
    logger?: RuntimeLoggerLike;
    sockets?: RuntimeSocketLike;
}
export declare class PackageObservabilityRuntime {
    readonly packageName: string;
    private logger?;
    private sockets?;
    private readonly logs;
    private readonly processes;
    constructor(packageName: string);
    bindLogger(logger: unknown): this;
    bindSockets(sockets: unknown): this;
    health(): PackageHealth;
    bind(binding: ObservabilityBinding): this;
    registerHealth(health: () => PackageHealth | Promise<PackageHealth>): this;
    emit(level: RuntimeLogLevel, message: string, data?: unknown, context?: RequestContext): Promise<RuntimeLogEvent>;
    track(processId: string, patch?: Partial<Omit<RuntimeProcessSnapshot, 'packageName' | 'processId' | 'updatedAt'>>, context?: RequestContext): RuntimeProcessSnapshot;
    abort(processId: string, reason?: string, context?: RequestContext): RuntimeProcessSnapshot;
    logsSnapshot(limit?: number): RuntimeLogEvent[];
    processSnapshot(): RuntimeProcessSnapshot[];
    healthDetails(): Record<string, unknown>;
}
export declare const PackageObservability: PackageObservabilityRuntime;
export declare const bindPackageObservability: (binding: ObservabilityBinding) => PackageObservabilityRuntime;
export declare const packageRuntimeSnapshot: () => {
    logs: RuntimeLogEvent[];
    processes: RuntimeProcessSnapshot[];
};
export declare const createPackageObservability: (packageName: string) => PackageObservabilityRuntime;
