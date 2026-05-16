# Observability for @connectingmatrix/chat

This package exports `PackageObservability` and is wired by `@connectingmatrix/server`. The logger binds sockets, registers package health probes, and emits process snapshots for CPU/memory/process status surfaces.

Contracts:

- `PackageObservability.bind({ logger, sockets })`
- `PackageObservability.track(processId, patch, context)`
- `PackageObservability.emit(level, message, data, context)`
- `PackageObservability.logsSnapshot()`
- `PackageObservability.processSnapshot()`
