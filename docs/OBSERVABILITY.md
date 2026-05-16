# Observability for @connectingmatrix/chat

Each package includes `src/observability.ts` and can be bound by `@connectingmatrix/server` or `giga-ai-backend`.

Runtime binding sequence:

1. `@connectingmatrix/logger` exposes `Logger` and `ProcessMonitor`.
2. `@connectingmatrix/sockets` exposes `Socket` and log/process event rooms.
3. Server wiring calls `observability.bindLogger(Logger)` and `observability.bindSockets(Socket)` for every package runtime.
4. Package logs and snapshots are emitted to `logs`, `logs:<package>`, `process-monitor`, and `process:<package>` rooms.

This keeps process CPU/memory/pid style telemetry package-owned while allowing the process monitor UI to read a common stream.
