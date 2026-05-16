export declare const packageStructure: {
    readonly package: "connectingmatrix-chat";
    readonly layers: {
        readonly client: "src/client/index.ts";
        readonly backend: "src/backend/index.ts";
        readonly entity: "src/entity/index.ts";
        readonly playgroundUi: "src/playground-ui";
    };
    readonly meaning: {
        readonly client: "Frontend-safe package binders, dataloaders, GraphQL client helpers, socket adapters, and bindWithServer style hooks. This is not the application UI shell.";
        readonly backend: "Package-owned backend processing, non-CRUD runtime logic, queues, adapters, routes, and package middleware.";
        readonly entity: "Package-owned entities, repositories, package CRUD, migrations, and GraphQL schema/resolvers.";
        readonly playgroundUi: "Optional local stub/playground UI fragments only. Real Giga application screens remain in giga-ai-ui.";
    };
    readonly updatedAt: "2026-05-16T10:33:56.753481+00:00";
};
export default packageStructure;
