import { nowIso, type PackageHealth, type RequestContext } from './contracts.js';

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
  memory?: { rss?: number; heapUsed?: number; heapTotal?: number; external?: number };
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
  trackProcess?: (processId: string, patch?: Partial<Omit<RuntimeProcessSnapshot, 'processId' | 'updatedAt'>> & { packageName?: string }, context?: RequestContext) => unknown;
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

function memorySnapshot(): RuntimeLogEvent['memory'] | undefined {
  const proc = typeof process !== 'undefined' ? process : undefined;
  if (!proc?.memoryUsage) return undefined;
  const memory = proc.memoryUsage();
  return { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external };
}

function processIdFromData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const value = (data as { processId?: unknown; id?: unknown }).processId;
  return typeof value === 'string' && value ? value : undefined;
}

export class PackageObservabilityRuntime {
  private logger?: RuntimeLoggerLike;
  private sockets?: RuntimeSocketLike;
  private readonly logs: RuntimeLogEvent[] = [];
  private readonly processes = new Map<string, RuntimeProcessSnapshot>();

  constructor(public readonly packageName: string) {}

  bindLogger(logger: unknown): this { return this.bind({ logger: logger as RuntimeLoggerLike }); }

  bindSockets(sockets: unknown): this { return this.bind({ sockets: sockets as RuntimeSocketLike }); }

  health(): PackageHealth { return { name: this.packageName, status: 'ok', checkedAt: nowIso(), details: this.healthDetails() }; }

  bind(binding: ObservabilityBinding): this {
    this.logger = binding.logger ?? this.logger;
    this.sockets = binding.sockets ?? this.sockets;
    this.sockets?.register?.(`pkg:${this.packageName}:logs`);
    this.sockets?.register?.(`pkg:${this.packageName}:processes`);
    this.sockets?.register?.('process-monitor');
    this.sockets?.register?.('logs');
    return this;
  }

  registerHealth(health: () => PackageHealth | Promise<PackageHealth>): this {
    this.logger?.registerPackage?.(this.packageName, health);
    return this;
  }

  async emit(level: RuntimeLogLevel, message: string, data?: unknown, context: RequestContext = {}): Promise<RuntimeLogEvent> {
    const event: RuntimeLogEvent = {
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
    if (this.logs.length > 500) this.logs.shift();
    if (this.logger?.log) await this.logger.log(level, `${this.packageName}:${message}`, { packageName: this.packageName, ...((data && typeof data === 'object') ? data as Record<string, unknown> : { data }) });
    else await this.logger?.[level]?.(`${this.packageName}:${message}`, data);
    const processId = processIdFromData(data);
    if (processId) await this.logger?.processLog?.(processId, level, message, data, context);
    const payload = event as unknown as Record<string, unknown>;
    if (this.sockets?.emitLog) await this.sockets.emitLog(payload);
    await this.sockets?.broadcast?.(`pkg:${this.packageName}:logs`, payload, 'runtime.log', context.traceId);
    return event;
  }

  track(processId: string, patch: Partial<Omit<RuntimeProcessSnapshot, 'packageName' | 'processId' | 'updatedAt'>> = {}, context: RequestContext = {}): RuntimeProcessSnapshot {
    const existing = this.processes.get(processId);
    const now = nowIso();
    const next: RuntimeProcessSnapshot = {
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

  abort(processId: string, reason = 'aborted', context: RequestContext = {}): RuntimeProcessSnapshot {
    const row = this.track(processId, { status: 'aborted', progress: 100, abortReason: reason, completedAt: nowIso() }, context);
    void this.logger?.abortProcess?.(processId, reason, context);
    return row;
  }

  logsSnapshot(limit = 50): RuntimeLogEvent[] {
    return this.logs.slice(-Math.max(1, Math.min(500, limit)));
  }

  processSnapshot(): RuntimeProcessSnapshot[] {
    return [...this.processes.values()];
  }

  healthDetails(): Record<string, unknown> {
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
export const bindPackageObservability = (binding: ObservabilityBinding) => PackageObservability.bind(binding);
export const packageRuntimeSnapshot = () => ({ logs: PackageObservability.logsSnapshot(), processes: PackageObservability.processSnapshot() });

export const createPackageObservability = (packageName: string) => new PackageObservabilityRuntime(packageName);
