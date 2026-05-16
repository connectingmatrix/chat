export const packageStructure = {
  "package": "connectingmatrix-chat",
  "layers": {
    "client": "src/client/index.ts",
    "backend": "src/backend/index.ts",
    "entity": "src/entity/index.ts",
    "playgroundUi": "src/playground-ui"
  },
  "meaning": {
    "client": "Frontend-safe package binders, dataloaders, GraphQL client helpers, socket adapters, and bindWithServer style hooks. This is not the application UI shell.",
    "backend": "Package-owned backend processing, non-CRUD runtime logic, queues, adapters, routes, and package middleware.",
    "entity": "Package-owned entities, repositories, package CRUD, migrations, and GraphQL schema/resolvers.",
    "playgroundUi": "Optional local stub/playground UI fragments only. Real Giga application screens remain in giga-ai-ui."
  },
  "updatedAt": "2026-05-16T10:33:56.753481+00:00"
} as const;
export default packageStructure;
