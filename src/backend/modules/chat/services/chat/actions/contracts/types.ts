import { RetrievedChunk, SourceReference } from '@giga/shared/types/contracts/graphql.types';

export type GigaActionOutput = {
  summary: string;
  data: Record<string, any>;
  sources: SourceReference[];
  retrievedChunks: RetrievedChunk[];
};

export const emptyActionArtifacts = {
  sources: [] as SourceReference[],
  retrievedChunks: [] as RetrievedChunk[],
};
