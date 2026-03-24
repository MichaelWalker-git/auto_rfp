import { PK_NAME, SK_NAME } from '@/constants/common';

export interface PineconeHit {
  id?: string;
  score?: number;
  source?: {
    [PK_NAME]: string;
    [SK_NAME]: string;
    externalId?: string;
    documentId?: string;
    chunkKey?: string;
    chunkIndex?: number;
    [key: string]: unknown;
  };
}
