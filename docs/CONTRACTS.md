# @connectingmatrix/chat

The only chat package. Owns persistent chat, browser-only transient chat, slash routing, attachments through drive, and Giga chat API alias.

## Ownership

This package owns its `src/ui`, `src/backend`, `src/entity`, GraphQL bundle, migrations, health/status, launcher, and package contracts. It can be included in backend or UI without assuming a monorepo.

## Public contracts

- `Chat.getChats/getMessages/search`
- `Chat.queryChat/queryChaat`
- `Chat.queryTransient/createTransientSession/clearTransientSession`
- `Chat.registerSlashCommands/registerSlashCommand/listSlashCommands`
- `Chat.bindDrive(Drive)`
- `Chat.onMessage/onTransientSession`
- `GigaChat alias`
- `./giga subpath`


## Basic usage

```ts
import { Chat } from '@connectingmatrix/chat';
const chat = Chat.createChat({ title: 'Main' }, ctx);
await Chat.queryChat(chat.id, { message: '/workflow list' }, ctx);
await Chat.queryTransient({ scope: 'project-debug', ownerId: projectId, message: 'debug this', transient: true }, ctx);
```

## Server usage

```ts
import { createPackage } from '@connectingmatrix/chat';
const pkg = createPackage();
await pkg.health?.();
// register pkg.routes as middleware and merge pkg.graphql into /graphql
```

## UI usage

Package UI modules expose `bindWithServer('/graphql')` where applicable. Domain packages own their dataloaders; the thin UI only renders/binds.

## Observability and process monitor

All packages expose `PackageObservability`. The server wires logger and sockets into every package. Logger registers package health probes and exposes `/logger/process-monitor` plus `/server/process-monitor`.

## Launcher

Run locally:

```bash
npm run build
node playground.mjs
```

The launcher opens in stub mode so the package can be tested independently, similar to workflow designer stub mode.

## GraphQL and routes

GraphQL namespace and routes are returned by `createPackage()`. Routes include health and launcher endpoints when needed.

## Exports

- `.`
- `./backend`
- `./ui`
- `./entity`
- `./package.json`
- `./giga`
- `./package-structure`
- `./launcher`
- `./observability`

## Folder counts

- `src/ui`: 16 files
- `src/backend`: 1 files
- `src/entity`: 9 files
- `migrations`: 3 files
- `tests`: 53 files

