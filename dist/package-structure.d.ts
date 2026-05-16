export declare const PACKAGE_STRUCTURE: {
    readonly package: "connectingmatrix-chat";
    readonly structuredAt: "2026-05-15";
    readonly layout: "package-owned-ui-backend-entity";
    readonly principle: "The package owns its UI contract, backend runtime contract, entity/CRUD contract, GraphQL extension, migrations, tests, and status surface. giga-ai-backend and giga-ai-ui remain thin composition shells.";
    readonly entrypoints: {
        readonly root: "src/index.ts";
        readonly ui: "src/ui/index.ts";
        readonly backend: "src/backend/index.ts";
        readonly entity: "src/entity/index.ts";
        readonly structure: "src/package-structure.ts";
    };
    readonly folders: {
        readonly "src/ui": "browser/UI contract: dataloaders, bindWithServer clients, screens, components, socket clients, and designer entry points";
        readonly "src/backend": "server contract: package middleware, GraphQL schema/resolvers, backend services, runtime modules, webhooks/uploads/MCP APIs, and health/status";
        readonly "src/backend/modules": "domain runtime modules owned by this package, grouped by capability instead of legacy app paths";
        readonly "src/entity": "data contract: entities, repositories, access-scoped CRUD, and entity GraphQL support";
        readonly "src/entity/entities": "entity classes and persistent record definitions";
        readonly "src/entity/repositories": "CRUD repositories and persistence adapters";
        readonly "src/entity/graphql": "entity-owned GraphQL contracts/resolvers/schema helpers";
        readonly migrations: "package-owned database migrations";
        readonly tests: "unit and integration tests for the package API and compatibility behavior";
    };
    readonly movesApplied: {
        readonly backend: readonly [readonly ["chat", "modules/chat"]];
        readonly ui: readonly [readonly ["app/components", "components"], readonly ["app/screens", "screens"]];
        readonly entity: readonly [readonly ["repositories/entities", "entities"], readonly ["services/graphql", "graphql"]];
    };
    readonly counts: {
        readonly ui: {
            readonly files: 16;
            readonly bytes: 136817;
        };
        readonly backend: {
            readonly files: 110;
            readonly bytes: 3173601;
        };
        readonly entity: {
            readonly files: 9;
            readonly bytes: 26688;
        };
        readonly migrations: {
            readonly files: 3;
            readonly bytes: 1570;
        };
        readonly tests: {
            readonly files: 53;
            readonly bytes: 33790331;
        };
    };
};
export default PACKAGE_STRUCTURE;
