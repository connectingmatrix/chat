# AGENTS.md

## Directory Context

- Path: `packages/apps/chat/src/services/chat/final-response`
- This folder owns the production code files in this folder.

## Contract

- Keep all code in this folder aligned with its layer package boundary.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- This AGENTS file must document each owned file purpose, input/output shape, role rules, logic gates, functions, exports, and line snippets.

## File Usage Specification

### `compact.ts`
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
  - `envNumber` (L8-L8, function)
  - `clip` (L13-L13, function)
  - `compactPasses` (L18-L18, function)
  - `compactFinalContext` (L41-L41, function)
- Exports:
  - `compactFinalContext` (L41)
- Key snippets and use-case mapping:
  - `L8-L8`: Implements `envNumber` for this module use case.
  - `L13-L13`: Implements `clip` for this module use case.
  - `L18-L18`: Implements `compactPasses` for this module use case.
  - `L41-L41`: Implements `compactFinalContext` for this module use case.
### `decision.ts`
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
  - `normalizeMode` (L6-L6, function)
  - `decideFinalResponse` (L11-L11, function)
- Exports:
  - `decideFinalResponse` (L11)
- Key snippets and use-case mapping:
  - `L6-L6`: Implements `normalizeMode` for this module use case.
  - `L11-L11`: Implements `decideFinalResponse` for this module use case.
### `orchestrate.ts`
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
  - `errorMessage` (L11-L11, function)
  - `finalizeAgentResponse` (L17-L17, function)
- Exports:
  - `finalizeAgentResponse` (L17)
- Key snippets and use-case mapping:
  - `L11-L11`: Implements `errorMessage` for this module use case.
  - `L17-L17`: Implements `finalizeAgentResponse` for this module use case.
### `response.ts`
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
  - `gigaRelated` (L13-L13, function)
  - `mergeExecution` (L18-L18, function)
  - `mutationPlan` (L26-L26, function)
  - `workflowResultOutput` (L36-L36, function)
  - `compose` (L41-L41, function)
  - `failure` (L74-L74, function)
- Exports:
  - `gigaRelated` (L13)
  - `mergeExecution` (L18)
  - `mutationPlan` (L26)
  - `compose` (L41)
  - `failure` (L74)
- Key snippets and use-case mapping:
  - `L13-L13`: Implements `gigaRelated` for this module use case.
  - `L18-L18`: Implements `mergeExecution` for this module use case.
  - `L26-L26`: Implements `mutationPlan` for this module use case.
  - `L36-L36`: Implements `workflowResultOutput` for this module use case.
  - `L41-L41`: Implements `compose` for this module use case.
  - `L74-L74`: Implements `failure` for this module use case.
### `types.ts`
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
  - `L1-L38`: File-level constants/types behavior.

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
