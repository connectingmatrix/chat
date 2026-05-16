import { nowIso, type PackageHealth } from './contracts.js';

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

export class PackageObservability {
  private logger?: LoggerLike;
  private sockets?: SocketLike;
  private readonly snapshots: PackageProcessSnapshot[] = [];

  constructor(public readonly packageName: string) {}

  bindLogger(logger: LoggerLike): this {
    this.logger = logger;
    return this;
  }

  bindSockets(sockets: SocketLike): this {
    this.sockets = sockets;
    this.sockets.register?.(`process:${this.packageName}`);
    this.sockets.register?.('process-monitor');
    this.sockets.register?.('logs');
    return this;
  }

  snapshot(source = 'package', details: Record<string, unknown> = {}): PackageProcessSnapshot {
    const memoryRaw = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage() : undefined;
    const memory = memoryRaw ? Object.fromEntries(Object.entries(memoryRaw).map(([key, value]) => [key, Number(value)])) : undefined;
    const snapshot: PackageProcessSnapshot = {
      packageName: this.packageName,
      pid: typeof process !== 'undefined' ? process.pid : undefined,
      uptimeSeconds: typeof process !== 'undefined' && typeof process.uptime === 'function' ? Number(process.uptime().toFixed(3)) : undefined,
      at: nowIso(),
      source,
      memory,
      details,
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 100) this.snapshots.shift();
    void this.logger?.recordPackageSnapshot?.(snapshot);
    void this.sockets?.broadcast?.('process-monitor', snapshot, 'process:snapshot');
    void this.sockets?.broadcast?.(`process:${this.packageName}`, snapshot, 'process:snapshot');
    return snapshot;
  }

  history(limit = 25): PackageProcessSnapshot[] {
    return this.snapshots.slice(-Math.max(1, Math.min(100, limit)));
  }

  async emit(level: ObservabilityLevel, message: string, data?: unknown): Promise<PackageLogEvent> {
    const event: PackageLogEvent = { packageName: this.packageName, level, message, data, at: nowIso() };
    if (this.logger?.log) await this.logger.log(level, `${this.packageName}:${message}`, data);
    else {
      const method = this.logger?.[level];
      if (method) await method(`${this.packageName}:${message}`, data);
    }
    await this.sockets?.emitLog?.({ ...event });
    await this.sockets?.broadcast?.(`logs:${this.packageName}`, event, 'log');
    return event;
  }

  health(): PackageHealth {
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

export function createPackageObservability(packageName: string): PackageObservability {
  return new PackageObservability(packageName);
}
