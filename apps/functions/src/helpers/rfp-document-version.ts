import { RFP_DOCUMENT_VERSION_PK } from '@/constants/rfp-document-version';
import { createItem, queryBySkPrefix, getItem } from '@/helpers/db';
import { loadTextFromS3, uploadToS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import type { RFPDocumentVersion } from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── SK Builders ───────────────────────────────────────────────────────────────

export const buildVersionSK = (
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): string => {
  return `${projectId}#${opportunityId}#${documentId}#${String(versionNumber).padStart(6, '0')}`;
};

export const buildVersionPrefix = (
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => {
  return `${projectId}#${opportunityId}#${documentId}#`;
};

// ─── S3 Key Builder ────────────────────────────────────────────────────────────

export const buildVersionHtmlKey = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): string => {
  return `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/versions/v${versionNumber}.html`;
};

// ─── CRUD Operations ───────────────────────────────────────────────────────────

export const createVersion = async (
  version: Omit<RFPDocumentVersion, 'createdAt'>,
): Promise<RFPDocumentVersion> => {
  const sk = buildVersionSK(
    version.projectId,
    version.opportunityId,
    version.documentId,
    version.versionNumber,
  );
  return createItem<RFPDocumentVersion>(RFP_DOCUMENT_VERSION_PK, sk, version);
};

export const listVersions = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<RFPDocumentVersion[]> => {
  const prefix = buildVersionPrefix(projectId, opportunityId, documentId);
  const items = await queryBySkPrefix<RFPDocumentVersion>(RFP_DOCUMENT_VERSION_PK, prefix);
  // Sort by version number descending (newest first)
  return items.sort((a, b) => b.versionNumber - a.versionNumber);
};

export const getVersion = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): Promise<RFPDocumentVersion | null> => {
  const sk = buildVersionSK(projectId, opportunityId, documentId, versionNumber);
  return getItem<RFPDocumentVersion>(RFP_DOCUMENT_VERSION_PK, sk);
};

export const getLatestVersionNumber = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<number> => {
  const versions = await listVersions(projectId, opportunityId, documentId);
  return versions.length > 0 ? versions[0].versionNumber : 0;
};

// ─── S3 Operations ─────────────────────────────────────────────────────────────

export const saveVersionHtml = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
  html: string,
): Promise<string> => {
  const key = buildVersionHtmlKey(orgId, projectId, opportunityId, documentId, versionNumber);
  await uploadToS3(DOCUMENTS_BUCKET, key, html, 'text/html; charset=utf-8');
  return key;
};

export const loadVersionHtml = async (htmlContentKey: string): Promise<string> => {
  return loadTextFromS3(DOCUMENTS_BUCKET, htmlContentKey);
};
