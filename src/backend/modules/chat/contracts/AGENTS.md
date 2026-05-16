# AGENTS.md

## Directory Context

- Path: `packages/apps/chat/src/contracts`
- This folder defines frontend integration contracts for this package across GraphQL, socket, and actions surfaces.

## Contract

- Keep all contract rows aligned with runtime truth from this package and composed integration layers.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- Contract rows must include role gates, parameter combinations, source paths, and notes.

## File Usage Specification

### `graphql-contracts.ts`
- Purpose: Declares GraphQL frontend operation contracts owned or consumed by this package.
- Input shape: Static GraphQL contract rows with operation metadata, parameters, combinations, role gates, and source paths.
- Output shape: Typed `GraphqlOperationContract[]` consumed by docs generation and CI contract checks.
- Role interaction rules:
  - `User`: Uses documented operations only when required permissions/scope checks pass.
  - `Root User`: Uses elevated operations when root-level policy checks pass.
  - `Super Admin`: Uses global or org-wide operations when super-admin checks pass.
- Logic gates summary:
  - Operation names must match schema/resolver truth.
  - Parameter combinations must state required/optional field sets.
  - Source paths must point to implementation/resolver ownership.
- Functions (all):
  - None detected by static scan.
- Exports:
  - `GRAPHQL_CONTRACTS`
  - `NO_GRAPHQL_SURFACE_REASON`
- Key snippets and use-case mapping:
  - `L1-L6`: Defines GraphQL contract registry and no-surface reason fallback.

### `socket-contracts.ts`
- Purpose: Declares socket event contracts owned or consumed by this package.
- Input shape: Static socket event rows with direction, payload shape, combinations, role gates, and sources.
- Output shape: Typed `SocketEventContract[]` for generated docs and contract validation.
- Role interaction rules:
  - `User`: Receives/emits events only for authorized scopes and rooms.
  - `Root User`: Can access elevated rooms/events when root gates pass.
  - `Super Admin`: Can access cross-organization/global events when super-admin gates pass.
- Logic gates summary:
  - Event names and payload fields must match runtime handlers.
  - Direction must reflect client->server, server->client, or broadcast usage.
  - Source paths must reference runtime socket modules.
- Functions (all):
  - None detected by static scan.
- Exports:
  - `SOCKET_CONTRACTS`
  - `NO_SOCKET_SURFACE_REASON`
- Key snippets and use-case mapping:
  - `L1-L6`: Defines socket contract registry and no-surface reason fallback.

### `action-contracts.ts`
- Purpose: Declares action contracts owned or consumed by this package.
- Input shape: Static action rows with identity, group, mutability, input/output schema, and role gates.
- Output shape: Typed `ActionContract[]` for action catalog documentation and checks.
- Role interaction rules:
  - `User`: Can invoke actions when permission and scope checks pass.
  - `Root User`: Can invoke elevated actions gated for root flows.
  - `Super Admin`: Can invoke admin/global actions gated for super-admin flows.
- Logic gates summary:
  - Action names must align with runtime catalogs/dispatchers.
  - Output schema must include action identity when runtime returns action results.
  - Source paths must map to package action handlers/catalogs.
- Functions (all):
  - None detected by static scan.
- Exports:
  - `ACTION_CONTRACTS`
  - `NO_ACTION_SURFACE_REASON`
- Key snippets and use-case mapping:
  - `L1-L6`: Defines action contract registry and no-surface reason fallback.

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
