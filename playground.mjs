import { createStubLauncher } from './dist/index.js';
console.log(JSON.stringify(createStubLauncher({ userId: 'stub-user', organizationId: 'stub-org', traceId: 'playground' }), null, 2));
