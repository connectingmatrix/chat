# Client bindings are not application UI

This package uses `src/client` for frontend-safe package binders: GraphQL client helpers, dataloaders, socket adapters, and bind-with-server functions.

Application screens, routes, layouts, and the Giga UI shell stay in `giga-ai-ui`. Any files under `src/playground-ui` are launcher/stub examples only and are not the production application UI.
