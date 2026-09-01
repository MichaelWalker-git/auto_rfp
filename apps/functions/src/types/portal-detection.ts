import { PortalType } from '@auto-rfp/core';

/**
 * Detected portal information
 */
export interface DetectedPortal {
  detected: boolean;
  type: PortalType;
  baseUrl: string;
  recordTypeField?: string; // The form field name for specifying agency/sub-entity
  recordTypeValue?: string; // The required value for the record type field
}