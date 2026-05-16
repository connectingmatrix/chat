import fs from 'node:fs';
import { ParitySystem } from './chat-parity-matrix.scope';

export type MatrixLaneManifestLane = {
  chatId: string;
  lane: number;
  scope: { id: string; organizationId: null; type: 'channel' };
  sessionMetadata: Record<string, unknown> | null;
  workflowFixtureHash?: string;
  workflowId: string;
};

export type MatrixLaneManifest = {
  artifactsChannel: { id: string; name: string; path: string[] };
  generatedAt: string;
  systems: Partial<Record<ParitySystem, MatrixLaneManifestLane[]>>;
};

export const matrixLaneManifestFile = () =>
  process.env.CHAT_PARITY_LANE_MANIFEST_FILE || `${process.cwd()}/packages/apps/chat/src/services/chat/__tests__/artifacts/chat-parity-lanes.json`;

export const readMatrixLaneManifest = (file = matrixLaneManifestFile()): MatrixLaneManifest => {
  if (!fs.existsSync(file)) throw new Error(`Chat parity lane manifest is missing: ${file}. Run yarn test chat:giga:provision first.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as MatrixLaneManifest;
};

export const writeMatrixLaneManifest = (manifest: MatrixLaneManifest, file = matrixLaneManifestFile()) => {
  fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};
