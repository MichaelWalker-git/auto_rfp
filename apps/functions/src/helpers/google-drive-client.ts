/**
 * google-drive-client.ts
 *
 * Single source of truth for authenticating to Google Drive on behalf of an
 * organization. Replaces three verbatim copies of the same JWT/delegation
 * bootstrap (`helpers/google-drive.ts`, `handlers/rfp-document/sync-to-google-drive.ts`,
 * `handlers/rfp-document/sync-from-google-drive.ts`).
 *
 * Auth model: an org-level service account JSON stored in Secrets Manager under
 * `google-api-key-<orgId>`, used with **domain-wide delegation**. Service accounts
 * have no Drive storage quota of their own, so every call impersonates a real
 * Workspace user (`delegate_email`) who owns the resulting files.
 *
 * Deliberately depends on nothing but `googleapis`, the secret reader, and the
 * secret-prefix constant — no DynamoDB, no S3. The scheduled poller imports this
 * module, and dragging DynamoDB/Linear code into that bundle would slow every
 * cold start. Callers that want the legacy "fall back to the first org member's
 * email" behaviour pass `resolveDelegateFallback`, which keeps the DynamoDB
 * dependency on the caller's side.
 */

import { drive_v3, google } from 'googleapis';

import { getApiKey } from './api-key-storage';
import { GOOGLE_SECRET_PREFIX } from '../constants/google';

/** Full drive scope — we both read and write files owned by the delegate. */
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'] as const;

/** MIME type of an uploaded Word document (the bytes we send to Drive). */
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** MIME type of a *native* Google Doc — the conversion target, and what makes a file collaboratively editable. */
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

/**
 * Operator-facing setup guidance. One copy, so the API error bodies and the logs
 * can't drift apart.
 */
export const DRIVE_NOT_CONFIGURED_DETAILS =
  'To enable Google Drive sync, go to Organization Settings and add a Google Service Account JSON key. ' +
  'The JSON must include "delegate_email" set to a Google Workspace user with Drive storage. ' +
  'Then configure domain-wide delegation in admin.google.com: ' +
  'Security → Access and data control → API controls → Manage Domain Wide Delegation, ' +
  'adding the service account Client ID with scope https://www.googleapis.com/auth/drive.';

export interface DriveClient {
  drive: drive_v3.Drive;
  /** The Workspace user being impersonated; owns every file we create. */
  delegateEmail: string;
}

interface ServiceAccountCredentials {
  client_email?: string;
  private_key?: string;
  client_id?: string;
  delegate_email?: string;
}

/** Narrow unknown JSON to the credential fields we read, without asserting shape. */
const parseCredentials = (raw: string): ServiceAccountCredentials | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { client_email, private_key, client_id, delegate_email } =
    parsed as Record<string, unknown>;

  return {
    client_email: typeof client_email === 'string' ? client_email : undefined,
    private_key: typeof private_key === 'string' ? private_key : undefined,
    client_id: typeof client_id === 'string' ? client_id : undefined,
    delegate_email: typeof delegate_email === 'string' ? delegate_email : undefined,
  };
};

/**
 * Build an authorized Drive client for an org, or `null` when Drive is not
 * usable for that org (no secret, malformed secret, no delegate, delegation
 * rejected). Returning `null` rather than throwing lets the poller skip an
 * unconfigured org without aborting the whole pass.
 */
export const getDriveClientForOrg = async (
  orgId: string,
  opts?: { resolveDelegateFallback?: () => Promise<string | null> },
): Promise<DriveClient | null> => {
  const serviceAccountJson = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);
  if (!serviceAccountJson) {
    console.log(`[GoogleDrive] No service account key configured for org ${orgId}`);
    return null;
  }

  const credentials = parseCredentials(serviceAccountJson);
  if (!credentials) {
    console.error(
      '[GoogleDrive] The stored credential is not valid JSON. A Google Service Account ' +
      'JSON key is required (not a simple API key).',
    );
    return null;
  }

  if (!credentials.client_email || !credentials.private_key) {
    console.error(
      '[GoogleDrive] Invalid service account key: missing client_email or private_key.',
    );
    return null;
  }

  // Priority: explicit delegate_email, then the caller-supplied fallback.
  let delegateEmail = credentials.delegate_email;
  if (!delegateEmail && opts?.resolveDelegateFallback) {
    try {
      delegateEmail = (await opts.resolveDelegateFallback()) ?? undefined;
    } catch (err) {
      console.error(
        `[GoogleDrive] Delegate fallback lookup failed: ${(err as Error)?.message}`,
      );
    }
  }

  if (!delegateEmail) {
    console.error(
      '[GoogleDrive] No delegate email available — service accounts have no Drive storage quota, ' +
      'so domain-wide delegation is required. ' +
      `Client ID ${credentials.client_id ?? '(unknown)'}. ${DRIVE_NOT_CONFIGURED_DETAILS}`,
    );
    return null;
  }

  try {
    const jwtClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [...DRIVE_SCOPES],
      subject: delegateEmail,
    });
    await jwtClient.authorize();
    return { drive: google.drive({ version: 'v3', auth: jwtClient }), delegateEmail };
  } catch (err) {
    console.error(
      `[GoogleDrive] JWT authorization failed for delegate ${delegateEmail}: ` +
      `${(err as Error)?.message}. ${DRIVE_NOT_CONFIGURED_DETAILS}`,
    );
    return null;
  }
};

// ─── Error classification ────────────────────────────────────────────────────
// googleapis surfaces HTTP failures as GaxiosError, which carries `code` (often
// a string) and `response.status`. Read both rather than trusting either.

const getDriveErrorStatus = (err: unknown): number | null => {
  if (typeof err !== 'object' || err === null) return null;
  const { code, response, status } = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };

  for (const candidate of [code, status, response?.status]) {
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) {
      return Number(candidate);
    }
  }
  return null;
};

/** The file is gone (deleted, or never existed). Safe to re-create once. */
export const isDriveNotFound = (err: unknown): boolean => getDriveErrorStatus(err) === 404;

/**
 * We are not allowed to touch the file. NEVER re-create on this: a deprovisioned
 * or unshared delegate 403s on a file that still exists, so recreating is exactly
 * how duplicate Drive files get produced.
 */
export const isDriveForbidden = (err: unknown): boolean => {
  const status = getDriveErrorStatus(err);
  return status === 401 || status === 403;
};

/** Quota exceeded or rate limited — retry with backoff. */
export const isDriveRateLimited = (err: unknown): boolean => {
  const status = getDriveErrorStatus(err);
  return status === 429 || status === 500 || status === 502 || status === 503;
};
