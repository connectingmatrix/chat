# Package structure — connectingmatrix-chat

```text
src/
  client/        # package client binders/dataloaders only; not the Giga app UI
  backend/       # package runtime/backend logic
  entity/        # package CRUD/entity/graphql/migrations ownership
  playground-ui/ # optional local launcher/stub UI fragments only
migrations/
tests/
docs/
```

`src/client` replaces the previous confusing `src/ui` name. The full application UI stays in `giga-ai-ui`.
