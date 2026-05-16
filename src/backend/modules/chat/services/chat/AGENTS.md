# Chat Service Scope

- Read this file before editing chat routing, mode selection, and assistant execution behavior in
  `src/services/chat/*` and referenced flow modules.

## Chat mode contract

- `queryChat(input)` reads mode from `input.chatMode` and falls back to `input.chat_mode`.
- Supported modes are `DEFAULT`, `AGENT`, `WORKFLOW`, and `SWARM`.
- Invalid modes must fail fast with `Invalid chat mode.`
- `AGENT` mode requires a concrete `agentId` (from `input.agentId`, `input.agent_id`, or session metadata).
- `WORKFLOW` mode requires `workflowId` (`input.workflowId` or `input.workflow_id`).
- `SWARM` mode is routed by `launchAdvancedSwarm` after agent/normalization passes.
- Missing IDs in non-default modes must produce explicit validation errors, not silent fallback.
- `DEFAULT` mode must execute rule/attachment resolution flow; it must not short-circuit to `{ kind: 'default' }` before routing checks.

## Execution routing flow (required)

- `query-chat.ts` is the route boundary. If mode resolves to:
  - `AGENT`: execute agent path (explicit agent > rule-based attachments > default path).
  - `WORKFLOW`: execute workflow path.
  - `SWARM`: launch swarm execution.
  - `DEFAULT`: resolve attachment-based workflow fallback where available, then run agent default path.
- `resolvedWorkflow` from scope attachment is only used by `WORKFLOW`/fallback paths.

## Data contracts shared with UI/socket

- `chat_mode` is the canonical transport field sent from UI.
- `agent_id`, `workflow_id`, and `swarm_id` are mode-typed ids and should be interpreted only for their respective mode.
- Payload contracts for these fields are defined in `src/socket/chat/send-handle.socket.ts` and `src/types/chat.types.ts`.
- `queryChat` must preserve explicit mode and ids from UI; defaulting or overriding explicit intent is a contract violation.
- Chat share snapshots must preserve plain-string message content and object `{ text }` content consistently.

## Validation

- Keep workflow-node behavior in `/Users/abeer/dev/giga/workflow-nodes/src/nodes/*`.
- Use shared MCP-backed execution paths instead of creating duplicate mutation routes.
- If a pending confirmation plan exists, chat must require `confirm`/`cancel` before new mutating execution.
- Live chat test fixtures must remain under `giga-ai-test`.

## Scoped Contract Maintenance

- When changing chat mode transport/validation behavior, update:
  - this file
  - `src/socket/chat/AGENTS.md`
  - related UI mode contracts in the frontend repo.
- Keep this contract section aligned with whichever layer owns mode-specific defaults.

- If any production code file in this folder is updated, update this AGENTS.md in the same change.

## Non-Negotiable Coding Standards

- Never ever write supabase.from we have entities always load data through it
- Do not use `supabase.from` or `input.from` directly. Load data through entities and the ORM.
- Do not add autofills
- Do not add placeholder, do not add normalisation.
- Find and fix the root cause instead of adding the fallback.
- Do not add fallbacks. Fix the logic.
- Everything should be typed dont use unknown, never, any
- Do not use JS-style safe/coercion helper functions.
- Do not use `to*` functions like `toPayload`.
- Do not create map functions.
- Do not check types like `type === Array` or `type === string`.
- Use the `||` operator for comparison.
- Do not write a code file bigger than 70-100 lines.
- Try to generalise multiple lines of code into fewer lines.
- After writing code, recheck patterns across the workspace to remove duplications.
- Do not invent functionality. Ask the user if it already exists somewhere.
- Prefer the smallest correct change over broad refactors.
- Preserve the repo's existing style, structure, and package manager.
- Avoid destructive git commands unless explicitly requested.
- Keep memory entries concise, factual, and tied to the files or behavior that changed.
- Entity table name should come from the Entity and not direct usage.
- Function naming should be .create, .delete .find .update .find .findBy .deleteBy
- Disallowed naming conventions are createRows, listRows and any programatic name for the entity.
- Importing supabase in the entities is disallowed. Upgrade the ORM file is something is not supported by entity. Orm is present at @gigav2/orm
- If Create, Update, Delete, Find is unable to do any thing stop the coding and inform the user of your updates first.
- Do not create proxy or additional functions for create, update, delete
- Keep ORM generic do not add Entity functions in the ORM
- MCP.ts will execute inner graphql for the operations they will not implement any
- JSON is disallowed in the Graphql Schema use proper types only
- Dont use zod for typing
