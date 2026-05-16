# AGENTS.md

## Directory Context

- Path: `packages/apps/chat/src/services/chat/io`
- This folder owns the production code files in this folder.

## Contract

- Keep all code in this folder aligned with its layer package boundary.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- This AGENTS file must document each owned file purpose, input/output shape, role rules, logic gates, functions, exports, and line snippets.

## File Usage Specification

### `graphql-payload.ts`
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
  - `toGraphqlChatScope` (L1-L1, arrow)
  - `toGraphqlChatQueryPayload` (L10-L10, arrow)
- Exports:
  - `toGraphqlChatScope` (L1)
  - `toGraphqlChatQueryPayload` (L10)
- Key snippets and use-case mapping:
  - `L1-L1`: Implements `toGraphqlChatScope` for this module use case.
  - `L10-L10`: Implements `toGraphqlChatQueryPayload` for this module use case.
### `query-chat-formatters.ts`
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
  - `toChatSources` (L27-L27, function)
  - `agentActionDefaults` (L44-L44, function)
  - `agentActionResultDefaults` (L59-L59, function)
  - `agentPlanDefaults` (L75-L75, function)
  - `agentPassDefaults` (L83-L83, function)
  - `workflowAgentCandidate` (L93-L93, function)
  - `workflowAgentDefaults` (L122-L122, function)
- Exports:
  - `toChatSources` (L27)
  - `agentActionDefaults` (L44)
  - `agentActionResultDefaults` (L59)
  - `agentPlanDefaults` (L75)
  - `agentPassDefaults` (L83)
  - `workflowAgentDefaults` (L122)
- Key snippets and use-case mapping:
  - `L27-L27`: Implements `toChatSources` for this module use case.
  - `L44-L44`: Implements `agentActionDefaults` for this module use case.
  - `L59-L59`: Implements `agentActionResultDefaults` for this module use case.
  - `L75-L75`: Implements `agentPlanDefaults` for this module use case.
  - `L83-L83`: Implements `agentPassDefaults` for this module use case.
  - `L93-L93`: Implements `workflowAgentCandidate` for this module use case.
  - `L122-L122`: Implements `workflowAgentDefaults` for this module use case.

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
