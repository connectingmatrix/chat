# @connectingmatrix/chat — auto-generated contracts

    Generated from the package audit on 2026-05-15.

    ## Purpose

    Single chat owner for DB-backed chat, slash routing, attachments, Giga queryChat/queryChaat facade, and browser-only transient sessions for debug flows.

    ## Public contracts

    - `Chat.createChat/getChats/getMessages/search`
- `Chat.queryChat/queryChaat`
- `Chat.createBrowserSession/queryBrowserSession/clearBrowserSession`
- `Chat.registerSlashCommand/registerSlashCommands/listSlashCommands`
- `Chat.attachFile/bindDrive/setResponder`
- `GigaChat alias`

    ## Package-owned surfaces

    - `src/client` owns dataloaders, browser binding and UI-facing data contracts.
    - `src/backend` owns non-CRUD runtime processing, route handlers, health/status and launchers.
    - `src/entity` owns entity records, CRUD repositories and entity GraphQL.
    - `migrations` owns package database migrations.
    - `playground.mjs` launches the package in stub/playable mode.

    ## GraphQL/middleware binding

    This package exposes `createPackage()` so `@connectingmatrix/server` or `giga-ai-backend` can register package middleware, package GraphQL and package health/launcher routes.
