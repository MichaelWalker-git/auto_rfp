import type { FOIARequestItem } from '@auto-rfp/core';
import type { DBFOIARequestItem } from '@/types/project-outcome';
import { getItem, queryAllBySkPrefix, updateItem } from '@/helpers/db';
import { FOIA_REQUEST_PK } from '@/constants/organization';

/**
 * Build SK for a FOIA request record.
 * SK pattern: `${orgId}#${projectId}#${opportunityId}#${foiaId}`
 */
export const buildFoiaRequestSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  foiaId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${foiaId}`;

/**
 * Build SK prefix for querying FOIA requests by opportunity.
 * SK prefix: `${orgId}#${projectId}#${opportunityId}#`
 */
export const buildFoiaRequestSkPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string,
): string => `${orgId}#${projectId}#${opportunityId}#`;

/**
 * Fetch a single FOIA request by exact identifiers.
 */
export const getFoiaRequest = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  foiaId: string,
): Promise<DBFOIARequestItem | null> =>
  getItem<DBFOIARequestItem>(
    FOIA_REQUEST_PK,
    buildFoiaRequestSk(orgId, projectId, opportunityId, foiaId),
  );

/**
 * List all FOIA requests for an opportunity (paginated).
 * Returns DBFOIARequestItem[] (includes PK/SK).
 */
export const listFoiaRequests = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<DBFOIARequestItem[]> =>
  queryAllBySkPrefix<DBFOIARequestItem>(
    FOIA_REQUEST_PK,
    buildFoiaRequestSkPrefix(orgId, projectId, opportunityId),
  );

/**
 * List every FOIA request in an organization, across all projects.
 *
 * The single-table SK is `{orgId}#{projectId}#{oppId}#{foiaId}`, so an org-wide read
 * is just a shorter prefix — no GSI and no scan. Mirrors `listFoiaAutomationsByOrg`.
 *
 * `listFoiaRequests` cannot serve this: it requires a projectId and an oppId, which
 * an org-wide dashboard does not have.
 */
export const listFoiaRequestsByOrg = async (
  orgId: string,
): Promise<DBFOIARequestItem[]> =>
  queryAllBySkPrefix<DBFOIARequestItem>(FOIA_REQUEST_PK, `${orgId}#`);

/**
 * Generic field update for FOIA request records — a dynamic SET patch that does
 * not pass through the handler's UPDATABLE_FIELDS allowlist.
 *
 * Used by the send path to stamp `sentAt`, `letterS3Key`, `letterPdfS3Key`, and
 * `emlS3Key` without requiring handler-level access to those write-once fields.
 */
export const updateFoiaRequestFields = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  foiaId: string,
  patch: Partial<FOIARequestItem>,
): Promise<DBFOIARequestItem> =>
  updateItem<FOIARequestItem>(
    FOIA_REQUEST_PK,
    buildFoiaRequestSk(orgId, projectId, opportunityId, foiaId),
    patch,
  ) as Promise<DBFOIARequestItem>;
