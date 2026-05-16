# @connectingmatrix/chat

Complete chat system with queryChat, slash command routing, sockets, attachments, modes, dataloaders, GraphQL, and entity CRUD.

This repo is intentionally split into `src/client`, `src/backend`, and `src/entity` so it can be impackage-owned by the frontend, backend, or package-owned migration runner without making `giga-ai-backend` a monorepo again.

## Usage

```ts
import { createPackage } from '@connectingmatrix/chat';

const pkg = createPackage();
await pkg.health();
```

## Server binding

Each package exports a `registerWithServer(app)` helper when server routes are needed, plus a `graphql` bundle containing `typeDefs`, `resolvers`, and `migrations`.

## Frontend binding

UI loaders expose `.bindWithServer('/graphql')` so the same package can work with the current backend or a separately deployed package host.


See `PACKAGE_STRUCTURE.md` for the role-folder source map.

## Final package audit docs

This repo now includes package-local generated docs:

- `docs/AUTO_GENERATED_CONTRACTS.md` — all public contracts and owned surfaces.
- `docs/USAGE.md` — backend registration, frontend binding and launcher usage.
- `docs/OBSERVABILITY.md` — logger/process-monitor/socket wiring.

The package remains independently playable with `npm run build`, `npm test`, and `npm run play`.


## Examples

Debug/demo launchers live in `examples/`. Run `npm run play` after `npm run build`.

## Package documentation

See `docs/INDEX.md` for the final clean workspace contract and `examples/` launcher/debug notes.
