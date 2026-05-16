# AGENTS.md

## Directory Context

- Path: `packages/apps/chat/src/services/chat/actions/read`
- This folder owns the production code files in this folder.

## Contract

- Keep all code in this folder aligned with its layer package boundary.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- This AGENTS file must document each owned file purpose, input/output shape, role rules, logic gates, functions, exports, and line snippets.

## File Usage Specification

### `workflow-history-read.ts`
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
  - `runFetchWorkflowRuns` (L9-L9, function)
  - `runFetchWorkflowRevisions` (L60-L60, function)
- Exports:
  - `runFetchWorkflowRuns` (L9)
  - `runFetchWorkflowRevisions` (L60)
- Key snippets and use-case mapping:
  - `L9-L9`: Implements `runFetchWorkflowRuns` for this module use case.
  - `L60-L60`: Implements `runFetchWorkflowRevisions` for this module use case.
### `workflow-read.ts`
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
  - `workflowExcerpt` (L13-L13, function)
  - `workflowReadScope` (L17-L17, function)
  - `workflowRow` (L21-L21, function)
  - `assertOrganizationAccess` (L35-L35, function)
  - `workflowQuery` (L40-L40, function)
  - `workflowListQuery` (L67-L67, function)
  - `assertGlobalWorkflowRead` (L83-L83, function)
  - `runFetchAllWorkflows` (L89-L89, function)
  - `runFetchWorkflow` (L103-L103, function)
- Exports:
  - `workflowExcerpt` (L13)
  - `workflowReadScope` (L17)
  - `assertGlobalWorkflowRead` (L83)
  - `runFetchAllWorkflows` (L89)
  - `runFetchWorkflow` (L103)
- Key snippets and use-case mapping:
  - `L13-L13`: Implements `workflowExcerpt` for this module use case.
  - `L17-L17`: Implements `workflowReadScope` for this module use case.
  - `L21-L21`: Implements `workflowRow` for this module use case.
  - `L35-L35`: Implements `assertOrganizationAccess` for this module use case.
  - `L40-L40`: Implements `workflowQuery` for this module use case.
  - `L67-L67`: Implements `workflowListQuery` for this module use case.
  - `L83-L83`: Implements `assertGlobalWorkflowRead` for this module use case.
  - `L89-L89`: Implements `runFetchAllWorkflows` for this module use case.
  - `L103-L103`: Implements `runFetchWorkflow` for this module use case.

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
