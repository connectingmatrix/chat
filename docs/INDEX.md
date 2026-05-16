# @connectingmatrix/chat package index

## Ownership

Single canonical chat system including queryChat/queryChaat, browser debug sessions, confirmations, slash routing, chat attachments.

## Directory contract

- `src/client` — package client binders, dataloaders, GraphQL/socket adapters.
- `src/backend` — package runtime logic, controllers/services/middleware helpers.
- `src/entity` — package entities, repositories, CRUD, schema, and migrations.
- `src/services` — shared package services/status helpers.
- `examples` — launch/debug harnesses only; not production app UI/backend.
- `docs` — usage, contracts, observability, and generated package notes.

## Workspace links

- Root package map: `../../docs/PACKAGE_MAP.md`
- UI app: `../../ui`
- Backend app: `../../backend`

## Local usage

Install from the root workspace or via file link:

```json
{
  "dependencies": {
    "@connectingmatrix/chat": "file:../packages/chat"
  }
}
```

Run examples from this package:

```bash
node examples/playground.mjs
```

Preserved workflow packages may keep their upstream contract and internal paths; new package-owned launchers still live in `examples`.
