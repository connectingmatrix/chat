# Eighth Pass Gap Closure Audit

Source contract: the package segregation request in `Pasted text(6).txt` where every package owns its `ui`, `backend`, `entity`, GraphQL/API contracts, migrations, status/health, and stub launcher, while `giga-ai-backend` and `giga-ai-ui` stay thin shells.

## Gap findings and fixes

### 1. Logger / sockets / process monitor recursion

**Gap found:** Logger and sockets were bound, but process-monitor broadcasts could recursively re-track themselves:

`ProcessMonitor.track -> Socket.broadcast('process-monitor') -> Socket.PackageObservability.track -> Logger.trackProcess -> ProcessMonitor.track -> ...`

**Fix implemented:** `@connectingmatrix/sockets` now detects observability rooms (`logs`, `process-monitor*`, `process-monitoring*`, `*:logs`, `*:processes`) and avoids tracking those broadcasts again. This keeps live process/log sockets working without recursive process creation.

### 2. Process monitor API completeness

`@connectingmatrix/logger` now owns the runtime process-monitor API:

```ts
processMonitoring.list({ kind?: 'Workflows' | 'Ai Agents' | 'Swarm' | 'Projects' | 'Nodes' });
processMonitoring.live(handler?);
processMonitoring.logs.live('PROCESS_ID', handler?);
processMonitoring.abort('PROCESS_ID', reason?);
processMonitoring.kill('PROCESS_ID', reason?);
processMonitoring.heartbeat('PROCESS_ID', { status, message, metadata });
```

Rows include `pid`, `internalPid`, `cpu`, `ram`, `memory`, `status`, `progress`, `kind`, `abortReason`, and package ownership metadata.

Server routes exposed:

```text
GET  /process-monitoring/list
GET  /process-monitoring/live
GET  /process-monitoring/logs/live
POST /process-monitoring/abort
```

### 3. Runtime processes tracked

Validated tracked process kinds:

```text
Workflows
Ai Agents
Swarm
Projects
Nodes
```

The runtime smoke recorded live rows for all requested groups: Workflows, Ai Agents, Swarm, and Projects.

### 4. Project heartbeat / logs / deployment ownership

`@connectingmatrix/projects` now owns:

- project heartbeat state
- project error state updates from heartbeat
- project logs
- deployment logs
- build, run, deploy
- project abort
- temporary mounted source sessions
- project-centered AI assistant session
- connected DB registration
- connected DB query execution
- source archive save/restore through `@connectingmatrix/file`
- source archive exclusion policy for `node_modules`, `.git`, build outputs, caches, logs, and temp files

Project debug chat remains browser-context-only. Debug events can be sent to the ClickHouse-style sink, but normal chat DB messages are not written.

### 5. Nodes Creator Debug with AI

`@connectingmatrix/nodes` now owns:

- node CRUD
- node validation
- node executor adapter
- node execution
- Debug with AI
- create/debug/execute node assistant
- `.node` package download
- `.node` package import
- drag/import alias through `importDraggedNode(...)`
- process tracking for node execution and node AI sessions

`@connectingmatrix/file` owns the ZIP/MIME/archive work. Nodes owns the `.node` manifest and lifecycle.

### 6. Workflow AI and preserved workflow package bridge

`@connectingmatrix/workflows` now owns:

- workflow AI sessions
- `buildWithAI(...)`
- `debugWithAI(...)`
- `runWithAI(...)`
- workflow execution and abort
- `configurePreservedWorkflowAI(...)`
- `bindGigaAgents(...)`
- `bindNodes(...)`
- `importNodePackageToWorkflow(...)`

Dragging a `.node` into a workflow routes through `Workflows.importNodePackageToWorkflow(...)`, delegates package parsing/import to `@connectingmatrix/nodes`, then adds the imported user node into the workflow definition.

### 7. Giga agents fixed and bound to domains

`@connectingmatrix/giga-agents` now owns only the Giga domain designer agents:

```text
src/backend/agents/workflow-designer-agent
src/backend/agents/tree-designer-agent
src/backend/agents/node-designer-agent
```

It binds to:

```ts
GigaAgents.bindAdapters({
  workflows: Workflows,
  tree: Tree,
  nodes: Nodes,
  aiAgents: AIAgents,
  advancedAgents: AdvancedAIAgents,
});
```

Giga agents no longer pretend to own workflow, tree, or node CRUD. They delegate to the owning packages.

### 8. Swarm knows its systems

`@connectingmatrix/agent-swarm` now binds explicitly to:

```ts
AgentSwarm.bindSystems({ aiAgents, advancedAgents, gigaAgents });
```

Swarm tasks can route to core AI agents, advanced AI agents, or Giga designer agents.

## Runtime smoke summary

Direct runtime smoke:

```json
{
  "listCount": 16,
  "liveCount": 16,
  "logsLiveCount": 3,
  "abortStatus": "aborted",
  "byExpected": {
    "Workflows": 4,
    "Ai Agents": 4,
    "Swarm": 1,
    "Projects": 4
  }
}
```

Server wiring smoke:

```json
{
  "registeredPackages": 14,
  "processMonitoring": {
    "list": 24,
    "live": 24,
    "byKind": {
      "Workflows": 3,
      "Ai Agents": 6,
      "Swarm": 4,
      "Projects": 1
    }
  }
}
```

Server smoke verified logger, sockets, and process monitoring are bound to Workflows, Projects, Nodes, and Giga Agents.

## Validation

- 18 / 18 package builds passed.
- 18 / 18 package tests passed.
- 18 / 18 stub launchers passed.
- Runtime smoke passed.
- Server wiring smoke passed.
- ZIP/MIME runtime implementations outside `@connectingmatrix/file`: none found.
- Duplicate `@giga/chat` repo: not present.
