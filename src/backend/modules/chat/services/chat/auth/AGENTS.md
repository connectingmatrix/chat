# AGENTS.md

## Directory Context

- Path: `packages/apps/chat/src/services/chat/auth`
- This folder owns the production code files in this folder.

## Contract

- Keep all code in this folder aligned with its layer package boundary.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- This AGENTS file must document each owned file purpose, input/output shape, role rules, logic gates, functions, exports, and line snippets.

## File Usage Specification

### `get-chat-session.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - `fetchChatSession` (L10-L10, function)
- Exports:
  - `fetchChatSession` (L10)
- Key snippets and use-case mapping:
  - `L10-L10`: Implements `fetchChatSession` for this module use case.
### `list-chat-sessions.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - `listChatSessions` (L9-L9, function)
- Exports:
  - `listChatSessions` (L9)
- Key snippets and use-case mapping:
  - `L9-L9`: Implements `listChatSessions` for this module use case.
### `scope.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - `normalizeId` (L7-L7, function)
  - `normalizeIds` (L11-L11, function)
  - `isChatScopeType` (L15-L15, function)
  - `normalizeChatScopeInput` (L19-L19, function)
  - `getSessionScope` (L64-L64, function)
  - `getSessionSnapshotScope` (L77-L77, function)
  - `getLegacySessionScope` (L104-L104, function)
  - `collectTreeNodeScope` (L138-L138, function)
  - `visit` (L142-L142, arrow)
  - `organizationAccessRows` (L172-L172, function)
  - `deniedSet` (L179-L179, function)
  - `resolveOrganizationTreeScope` (L185-L185, function)
  - `resolveChatScopeContext` (L234-L234, function)
- Exports:
  - `isChatScopeType` (L15)
  - `normalizeChatScopeInput` (L19)
  - `getSessionScope` (L64)
  - `getSessionSnapshotScope` (L77)
  - `getLegacySessionScope` (L104)
  - `resolveChatScopeContext` (L234)
- Key snippets and use-case mapping:
  - `L7-L7`: Implements `normalizeId` for this module use case.
  - `L11-L11`: Implements `normalizeIds` for this module use case.
  - `L15-L15`: Implements `isChatScopeType` for this module use case.
  - `L19-L19`: Implements `normalizeChatScopeInput` for this module use case.
  - `L64-L64`: Implements `getSessionScope` for this module use case.
  - `L77-L77`: Implements `getSessionSnapshotScope` for this module use case.
  - `L104-L104`: Implements `getLegacySessionScope` for this module use case.
  - `L138-L138`: Implements `collectTreeNodeScope` for this module use case.
  - `L142-L142`: Implements `visit` for this module use case.
  - `L172-L172`: Implements `organizationAccessRows` for this module use case.
  - `L179-L179`: Implements `deniedSet` for this module use case.
  - `L185-L185`: Implements `resolveOrganizationTreeScope` for this module use case.
  - `L234-L234`: Implements `resolveChatScopeContext` for this module use case.
### `session-scope.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - None detected by static scan.
- Exports:
  - None
- Key snippets and use-case mapping:
  - `L1-L16`: File-level constants/types behavior.

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
