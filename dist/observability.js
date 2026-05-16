import { nowIso } from './contracts.js';
export class PackageObservability {
    constructor(packageName) {
        this.packageName = packageName;
        this.snapshots = [];
    }
    bindLogger(logger) {
        this.logger = logger;
        return this;
    }
    bindSockets(sockets) {
        this.sockets = sockets;
        this.sockets.register?.(`process:${this.packageName}`);
        this.sockets.register?.('process-monitor');
        this.sockets.register?.('logs');
        return this;
    }
    snapshot(source = 'package', details = {}) {
        const memoryRaw = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage() : undefined;
        const memory = memoryRaw ? Object.fromEntries(Object.entries(memoryRaw).map(([key, value]) => [key, Number(value)])) : undefined;
        const snapshot = {
            packageName: this.packageName,
            pid: typeof process !== 'undefined' ? process.pid : undefined,
            uptimeSeconds: typeof process !== 'undefined' && typeof process.uptime === 'function' ? Number(process.uptime().toFixed(3)) : undefined,
            at: nowIso(),
            source,
            memory,
            details,
        };
        this.snapshots.push(snapshot);
        if (this.snapshots.length > 100)
            this.snapshots.shift();
        void this.logger?.recordPackageSnapshot?.(snapshot);
        void this.sockets?.broadcast?.('process-monitor', snapshot, 'process:snapshot');
        void this.sockets?.broadcast?.(`process:${this.packageName}`, snapshot, 'process:snapshot');
        return snapshot;
    }
    history(limit = 25) {
        return this.snapshots.slice(-Math.max(1, Math.min(100, limit)));
    }
    async emit(level, message, data) {
        const event = { packageName: this.packageName, level, message, data, at: nowIso() };
        if (this.logger?.log)
            await this.logger.log(level, `${this.packageName}:${message}`, data);
        else {
            const method = this.logger?.[level];
            if (method)
                await method(`${this.packageName}:${message}`, data);
        }
        await this.sockets?.emitLog?.({ ...event });
        await this.sockets?.broadcast?.(`logs:${this.packageName}`, event, 'log');
        return event;
    }
    health() {
        return {
            name: `${this.packageName}:observability`,
            status: 'ok',
            checkedAt: nowIso(),
            details: {
                loggerBound: Boolean(this.logger),
                socketsBound: Boolean(this.sockets),
                snapshots: this.snapshots.length,
                lastSnapshot: this.snapshots.at(-1),
            },
        };
    }
}
export function createPackageObservability(packageName) {
    return new PackageObservability(packageName);
}
