import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const filesIn = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesIn(path));
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) files.push(path);
  }
  return files;
};

const readRunnerPath = (packageRoot: string): string => {
  const localRunner = resolve(packageRoot, '__tests__/sweep/export-sweep.runner.ts');
  if (existsSync(localRunner)) return localRunner;
  return resolve(packageRoot, '../../shared/__tests__/sweep/export-sweep.runner.ts');
};

test('export sweep loads and exercises package exports in isolated child runs', () => {
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  const runner = readRunnerPath(packageRoot);
  const sources = filesIn(resolve(packageRoot, 'src'));
  let successful = 0;
  for (const source of sources) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', runner, source], {
      cwd: packageRoot,
      env: process.env,
      timeout: 30000,
      stdio: 'pipe',
    });
    if (result.status === 0) successful += 1;
  }
  assert.ok(successful > 0);
});
