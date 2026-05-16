# Chat Parity AI Agent Workflow

`chat-parity-ai-agent-workflow.cypher` is the source of truth for the AI Agent workflow fixture.
`chat-parity-ai-agent-workflow.compiled.json` must be regenerated from that Cypher any time the workflow graph changes.

## Update Flow

1. Fix the shared node contracts first.
   - `workflow-nodes` for schema, worker runtime, inspector fields, and port compatibility.
   - `giga-wf-executor` for worker-owned runtime behavior and compatibility coverage.
   - `giga-ai-backend` only for backend-dispatched nodes that actually call backend services.
2. Edit `/Users/abeer/dev/giga/giga-ai-backend/src/services/chat/workflow/chat-parity-ai-agent/chat-parity-ai-agent-workflow.cypher`.
3. Regenerate the compiled fixture from the Cypher:

```bash
cd /Users/abeer/dev/giga/giga-ai-backend
yarn tsx -e "import { readFileSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { Executor } from '@workflow/executor'; const base = join(process.cwd(), 'src/services/chat/workflow/chat-parity-ai-agent'); const cypher = readFileSync(join(base, 'chat-parity-ai-agent-workflow.cypher'), 'utf8'); const compiled = Executor.compileWorkflowCypher({ cypher, name: 'Chat Workflow Parity AI Agent', description: 'Chat Workflow Parity AI Agent fixture.', executable: true }); if (!compiled.validation.ok) throw new Error(compiled.validation.errors.join(' | ')); writeFileSync(join(base, 'chat-parity-ai-agent-workflow.compiled.json'), JSON.stringify(compiled, null, 2) + '\n');"
```

4. Attach or refresh the workflow on the debug channel:

```bash
cd /Users/abeer/dev/giga/giga-ai-backend
yarn workflow:chat-parity:ai-agent:bootstrap --email rich@gigaintelligence.com
```

That script upserts the workflow, creates the debug channel when needed, and updates the workflow assignment for the target user.

5. Attach the same latest workflow to any existing channel:

```bash
cd /Users/abeer/dev/giga/giga-ai-backend
yarn workflow:chat-parity:ai-agent:attach --channel-id f45712dd-8bad-4ac8-8101-38c346ea6dd0
```

If the channel has no `createdBy`, pass the workflow owner explicitly:

```bash
cd /Users/abeer/dev/giga/giga-ai-backend
yarn workflow:chat-parity:ai-agent:attach --channel-id <channel-id> --email rich@gigaintelligence.com
```

The attach command updates the exact `(user_id, scope_type, scope_id)` assignment for that channel instead of moving another channel's workflow assignment.

## Validation

- `cd /Users/abeer/dev/giga/workflow-nodes && yarn typecheck`
- `cd /Users/abeer/dev/giga/giga-wf-executor && yarn vitest run src/__tests__/ai-agent-control-node-runtime.test.ts src/__tests__/ai-agent-port-compatibility.test.ts`
- `cd /Users/abeer/dev/giga/giga-ai-backend && yarn test workflow:compat`
- `cd /Users/abeer/dev/giga/giga-ai-backend && yarn tsx --test src/services/chat/workflow/__tests__/chat-parity-ai-agent-fixture.test.ts`
- `cd /Users/abeer/dev/giga/giga-ai-backend && ./node_modules/.bin/tsx --test src/services/chat/__tests__/chat-workflow-ai-agent-hello-debug-live.integration.test.ts src/services/chat/__tests__/chat-workflow-ai-agent-hello-debug-socket-live.integration.test.ts`
- `cd /Users/abeer/dev/giga/giga-ai-backend && yarn build && ./node_modules/.bin/tsx --test --test-concurrency=1 src/services/chat/__tests__/chat-workflow-ai-agent-debug-live.integration.test.ts src/services/chat/__tests__/chat-workflow-ai-agent-send-debug-live.integration.test.ts src/services/chat/__tests__/chat-workflow-ai-agent-hello-debug-socket-live.integration.test.ts src/services/chat/__tests__/chat-workflow-ai-agent-live.integration.test.ts src/services/chat/__tests__/chat-workflow-ai-agent-send-live.integration.test.ts src/services/chat/__tests__/chat-workflow-ai-agent-send-socket-live.integration.test.ts`

## Notes

- Do not edit the compiled JSON by hand.
- `merge`, `if-else`, and `respond-end` are worker-owned nodes and should not be routed through backend helper handlers.
- The live AI Agent tests attach workflow fixtures inline for isolated scopes, but the bootstrap script is the durable path for keeping the debug channel assignment current.
- Run the live AI Agent suites with `--test-concurrency=1` so temporary attached workflow assignments do not overlap the debug-channel assertions.
