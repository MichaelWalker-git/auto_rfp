import { PK_NAME, SK_NAME } from '@/constants/common';
import { DocumentItem } from '@auto-rfp/core';

/**
 * DynamoDB item type for Document entities.
 * Extends the core DocumentItem with DynamoDB partition and sort keys.
 */
export type DocumentDBItem = DocumentItem & {
  [PK_NAME]: string;
  [SK_NAME]: string;
};
