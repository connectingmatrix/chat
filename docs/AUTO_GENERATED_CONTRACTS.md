# Auto-generated contracts for `@connectingmatrix/chat`

This document is generated from the final package audit. The package owns its `src/ui`, `src/backend`, `src/entity`, migrations, GraphQL/API surfaces, health/status, launcher, and tests unless this is a thin shell repo.

## Public contracts

- `Chat.getChats/getMessages/search`
- `Chat.queryChat/queryChaat`
- `Chat.createBrowserSession/queryBrowserSession/clearBrowserSession`
- `Chat.registerSlashCommands`
- `Chat.bindDrive/bindSockets`

## Package use

```ts
import { createPackage } from '@connectingmatrix/chat';
const pkg = createPackage();
await pkg.health?.();
```

## Backend registration

Register `pkg.routes`, merge `pkg.graphql`, run `pkg.migrations`, and keep auth/signature handling delegated to `@connectingmatrix/orm`.

## Frontend binding

UI adapters expose `bindWithServer('/graphql')` or route-specific helpers. Domain logic remains in the owning package.

## Launcher

```bash
npm run build
npm test
node playground.mjs
```
