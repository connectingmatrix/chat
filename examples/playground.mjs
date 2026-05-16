import { createPackageStatusPanel } from '../dist/index.js';
console.log(JSON.stringify(createPackageStatusPanel({ userId: 'example-user', organizationId: 'example-org', traceId: 'examples/playground' }), null, 2));
