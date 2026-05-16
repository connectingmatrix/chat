# Observability for `@connectingmatrix/chat`

This package binds to `@connectingmatrix/logger` and, when available, `@connectingmatrix/sockets` during server composition.

## Process monitor API

```ts
processMonitoring.list();
processMonitoring.live();
processMonitoring.logs.live('PROCESS_ID');
processMonitoring.abort('PROCESS_ID', 'reason');
```

## Tracked runtime kinds

The final wiring tracks the operational processes requested by the product contract: `Workflows`, `Ai Agents`, `Swarm`, and `Projects`. Packages can also report `Nodes`, `Files`, `Drive`, `Chat`, and `Server` runtime rows.

Rows expose PID/internal PID, CPU snapshot, RAM/memory snapshot, status, progress, abortability, heartbeat, and package name when the host runtime supports those fields.

## Logs

Process logs are appended through the logger process-monitor runtime and may be streamed over sockets for process-monitor screens.
