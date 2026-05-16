import { nowIso } from './contracts.js';
function memorySnapshot() {
    const proc = typeof process !== 'undefined' ? process : undefined;
    if (!proc?.memoryUsage)
        return undefined;
    const memory = proc.memoryUsage();
    return { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external };
}
function processIdFromData(data) {
    if (!data || typeof data !== 'object')
        return undefined;
    const value = data.processId;
    return typeof value === 'string' && value ? value : undefined;
}
export class PackageObservabilityRuntime {
    constructor(packageName) {
        this.packageName = packageName;
        this.logs = [];
        this.processes = new Map();
    }
    bindLogger(logger) { return this.bind({ logger: logger }); }
    bindSockets(sockets) { return this.bind({ sockets: sockets }); }
    health() { return { name: this.packageName, status: 'ok', checkedAt: nowIso(), details: this.healthDetails() }; }
    bind(binding) {
        this.logger = binding.logger ?? this.logger;
        this.sockets = binding.sockets ?? this.sockets;
        this.sockets?.register?.(`pkg:${this.packageName}:logs`);
        this.sockets?.register?.(`pkg:${this.packageName}:processes`);
        this.sockets?.register?.('process-monitor');
        this.sockets?.register?.('logs');
        return this;
    }
    registerHealth(health) {
        this.logger?.registerPackage?.(this.packageName, health);
        return this;
    }
    async emit(level, message, data, context = {}) {
        const event = {
            packageName: this.packageName,
            level,
            message,
            data,
            at: nowIso(),
            traceId: context.traceId,
            pid: typeof process !== 'undefined' ? process.pid : undefined,
            memory: memorySnapshot(),
        };
        this.logs.push(event);
        if (this.logs.length > 500)
            this.logs.shift();
        if (this.logger?.log)
            await this.logger.log(level, `${this.packageName}:${message}`, { packageName: this.packageName, ...((data && typeof data === 'object') ? data : { data }) });
        else
            await this.logger?.[level]?.(`${this.packageName}:${message}`, data);
        const processId = processIdFromData(data);
        if (processId)
            await this.logger?.processLog?.(processId, level, message, data, context);
        const payload = event;
        if (this.sockets?.emitLog)
            await this.sockets.emitLog(payload);
        await this.sockets?.broadcast?.(`pkg:${this.packageName}:logs`, payload, 'runtime.log', context.traceId);
        return event;
    }
    track(processId, patch = {}, context = {}) {
        const existing = this.processes.get(processId);
        const now = nowIso();
        const next = {
            packageName: this.packageName,
            processId,
            label: patch.label ?? existing?.label ?? processId,
            status: patch.status ?? existing?.status ?? 'running',
            progress: patch.progress ?? existing?.progress,
            context: patch.context ?? existing?.context,
            updatedAt: now,
            startedAt: existing?.startedAt ?? patch.startedAt ?? now,
            completedAt: patch.completedAt ?? existing?.completedAt,
            abortReason: patch.abortReason ?? existing?.abortReason,
            kind: patch.kind ?? existing?.kind,
            pid: typeof process !== 'undefined' ? process.pid : undefined,
            memory: memorySnapshot(),
        };
        this.processes.set(processId, next);
        void this.logger?.trackProcess?.(processId, next, context);
        void this.sockets?.broadcast?.(`pkg:${this.packageName}:processes`, next, 'runtime.process', context.traceId);
        void this.sockets?.broadcast?.('process-monitor', next, 'runtime.process', context.traceId);
        return next;
    }
    abort(processId, reason = 'aborted', context = {}) {
        const row = this.track(processId, { status: 'aborted', progress: 100, abortReason: reason, completedAt: nowIso() }, context);
        void this.logger?.abortProcess?.(processId, reason, context);
        return row;
    }
    logsSnapshot(limit = 50) {
        return this.logs.slice(-Math.max(1, Math.min(500, limit)));
    }
    processSnapshot() {
        return [...this.processes.values()];
    }
    healthDetails() {
        return {
            observabilityBound: Boolean(this.logger || this.sockets),
            loggerBound: Boolean(this.logger),
            socketsBound: Boolean(this.sockets),
            logs: this.logs.length,
            processes: this.processes.size,
        };
    }
}
export const PackageObservability = new PackageObservabilityRuntime('@connectingmatrix/chat');
export const bindPackageObservability = (binding) => PackageObservability.bind(binding);
export const packageRuntimeSnapshot = () => ({ logs: PackageObservability.logsSnapshot(), processes: PackageObservability.processSnapshot() });
export const createPackageObservability = (packageName) => new PackageObservabilityRuntime(packageName);
