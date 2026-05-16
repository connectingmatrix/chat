# Using @connectingmatrix/chat

    ```ts
    import { Chat } from '@connectingmatrix/chat';
const transient = Chat.createBrowserSession({ scope: 'project-debug', targetId: projectId });
await Chat.queryBrowserSession(transient.id, { message: 'debug without chat DB persistence' }, ctx);
    ```

    ## Backend registration

    ```ts
    import { createPackage } from '@connectingmatrix/chat';
    const module = createPackage();
    server.register(module);
    ```

    ## Frontend binding

    Packages that expose UI dataloaders support `.bindWithServer('/graphql')` or a package-owned client under `src/client`.

    ## Playable launcher

    ```bash
    npm run build
    npm test
    npm run play
    ```
