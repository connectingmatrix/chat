# Final Gap Closure Contracts

Package: `@connectingmatrix/chat`

This document records the final implementation pass for the package-segregated architecture. Each package keeps its own `src/ui`, `src/backend`, `src/entity`, migrations, GraphQL/API contracts, health/status, launcher and tests. Backend/UI shells only wire or render package surfaces.

## Offered contracts

- package-owned ui/backend/entity contracts
- GraphQL/API routes
- health/status/launcher
- observability/process-monitor binding where applicable

## Observability

Packages that create runtime work bind to `@connectingmatrix/logger` and publish process snapshots/logs through the shared process monitor. The shared API surface is:

```ts
processMonitoring.list();
processMonitoring.live();
processMonitoring.logs.live('PROCESS_ID');
processMonitoring.abort('PROCESS_ID', 'reason');
```

Processes are normalized into Workflows, Ai Agents, Swarm, Projects, Nodes, Files, Drive, Server and package/runtime rows.

## Stub launcher

Run the package locally with:

```bash
npm run build
npm test
node playground.mjs
```

The launcher intentionally runs in stub/playground mode so the repo can be opened and tested independently.
