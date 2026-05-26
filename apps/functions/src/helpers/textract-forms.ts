import {
  Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { v4 as uuidv4 } from 'uuid';

import { requireEnv } from './env';
import type { DetectedFormField, FormFieldStatus } from '@auto-rfp/core';

const REGION = requireEnv('REGION', 'us-east-1');

const textractClient = new TextractClient({ region: REGION });

export type StartFormsAnalysisArgs = {
  bucket: string;
  fileKey: string;
  jobTag: string;
  snsTopicArn: string;
  roleArn: string;
};

export const startFormsAnalysis = async (args: StartFormsAnalysisArgs): Promise<string> => {
  const { bucket, fileKey, jobTag, snsTopicArn, roleArn } = args;
  const res = await textractClient.send(
    new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: fileKey } },
      FeatureTypes: ['FORMS', 'SIGNATURES'],
      JobTag: jobTag,
      NotificationChannel: { SNSTopicArn: snsTopicArn, RoleArn: roleArn },
    }),
  );
  if (!res.JobId) throw new Error('Textract did not return JobId for AnalyzeDocument');
  return res.JobId;
};

export const fetchAllAnalysisBlocks = async (jobId: string): Promise<Block[]> => {
  const all: Block[] = [];
  let nextToken: string | undefined;
  do {
    const res = await textractClient.send(
      new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken }),
    );
    if (res.JobStatus !== 'SUCCEEDED' && res.JobStatus !== 'PARTIAL_SUCCESS') {
      throw new Error(`Textract job ${jobId} status=${res.JobStatus ?? 'UNKNOWN'}`);
    }
    if (Array.isArray(res.Blocks)) all.push(...res.Blocks);
    nextToken = res.NextToken;
  } while (nextToken);
  return all;
};

const ALWAYS_MANUAL_PATTERNS = [
  /signature/i,
  /sign\s*here/i,
  /authorized\s*sign/i,
  /\binitial(s)?\b/i,
  /notary/i,
  /witness/i,
];

const indexBlocks = (blocks: Block[]): Map<string, Block> => {
  const map = new Map<string, Block>();
  for (const b of blocks) if (b.Id) map.set(b.Id, b);
  return map;
};

const childTextOf = (block: Block, byId: Map<string, Block>): string => {
  const parts: string[] = [];
  for (const r of block.Relationships ?? []) {
    if (r.Type !== 'CHILD' || !r.Ids) continue;
    for (const cid of r.Ids) {
      const c = byId.get(cid);
      if (!c) continue;
      if (c.BlockType === 'WORD' && c.Text) parts.push(c.Text);
      else if (c.BlockType === 'SELECTION_ELEMENT' && c.SelectionStatus) {
        parts.push(`[${c.SelectionStatus}]`);
      }
    }
  }
  return parts.join(' ').trim();
};

const childWordsOf = (block: Block, byId: Map<string, Block>): string => {
  const parts: string[] = [];
  for (const r of block.Relationships ?? []) {
    if (r.Type !== 'CHILD' || !r.Ids) continue;
    for (const cid of r.Ids) {
      const c = byId.get(cid);
      if (c?.BlockType === 'WORD' && c.Text) parts.push(c.Text);
    }
  }
  return parts.join(' ').trim();
};

const childSelectionStatusOf = (block: Block, byId: Map<string, Block>): 'SELECTED' | 'NOT_SELECTED' | null => {
  for (const r of block.Relationships ?? []) {
    if (r.Type !== 'CHILD' || !r.Ids) continue;
    for (const cid of r.Ids) {
      const c = byId.get(cid);
      if (c?.BlockType === 'SELECTION_ELEMENT') {
        if (c.SelectionStatus === 'SELECTED') return 'SELECTED';
        if (c.SelectionStatus === 'NOT_SELECTED') return 'NOT_SELECTED';
      }
    }
  }
  return null;
};

const valueBlockOf = (keyBlock: Block, byId: Map<string, Block>): Block | null => {
  const r = (keyBlock.Relationships ?? []).find((rel) => rel.Type === 'VALUE');
  const id = r?.Ids?.[0];
  return id ? byId.get(id) ?? null : null;
};

const bboxOf = (block: Block): DetectedFormField['boundingBox'] => {
  const bb = block.Geometry?.BoundingBox;
  if (!bb || bb.Top == null || bb.Left == null || bb.Width == null || bb.Height == null) return null;
  return { top: bb.Top, left: bb.Left, width: bb.Width, height: bb.Height };
};

/**
 * Parse a Bedrock-emitted page range like "13", "17-19", or "20-21,25" into a
 * Set of 1-indexed page numbers. Returns null for empty/malformed input so
 * callers can treat that as "no filter, accept every page".
 */
export const parsePageRange = (range: string | null | undefined): Set<number> | null => {
  if (!range) return null;
  const pages = new Set<number>();
  for (const part of range.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf('-');
    if (dash === -1) {
      const n = Number.parseInt(trimmed, 10);
      if (Number.isFinite(n) && n > 0) pages.add(n);
      continue;
    }
    const start = Number.parseInt(trimmed.slice(0, dash), 10);
    const end = Number.parseInt(trimmed.slice(dash + 1), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let p = lo; p <= hi; p++) if (p > 0) pages.add(p);
  }
  return pages.size > 0 ? pages : null;
};

export const mapBlocksToFields = (
  blocks: Block[],
  allowedPages?: Set<number> | null,
): DetectedFormField[] => {
  const byId = indexBlocks(blocks);
  const fields: DetectedFormField[] = [];
  const inRange = (page: number | undefined) =>
    !allowedPages || allowedPages.has(page ?? 1);

  // KEY_VALUE_SET → field per KEY block. Only emit fields that the user still needs
  // to act on: blanks (EMPTY), checkboxes (MANUAL_REQUIRED), and signature/notary
  // labels. Already-filled values are skipped — they'd just clutter the editor.
  for (const k of blocks) {
    if (k.BlockType !== 'KEY_VALUE_SET') continue;
    if (!(k.EntityTypes ?? []).includes('KEY')) continue;
    if (!inRange(k.Page)) continue;

    const label = childTextOf(k, byId) || 'Unknown Field';
    const value = valueBlockOf(k, byId);

    const isAlwaysManual = ALWAYS_MANUAL_PATTERNS.some((p) => p.test(label));

    let fieldValue: string | null = null;
    let status: FormFieldStatus = 'EMPTY';
    let manualReason: string | null = null;
    let isAlreadyFilled = false;
    let markType: 'TEXT' | 'CHECKBOX' | 'CIRCLE' = 'TEXT';
    let markChar: string | null = null;

    const isCircleLabel = /\b(en)?circle\b/i.test(label);

    if (value) {
      const selected = childSelectionStatusOf(value, byId);
      const words = childWordsOf(value, byId);

      if (selected !== null) {
        // Checkbox — keep so the user can verify the auto-detected selection
        fieldValue = selected === 'SELECTED' ? 'Yes' : 'No';
        status = 'MANUAL_REQUIRED';
        manualReason = 'Verify checkbox selection';
        markType = 'CHECKBOX';
        markChar = selected === 'SELECTED' ? 'X' : null;
      } else if (words) {
        // Already filled with text — skip unless the label forces manual review
        isAlreadyFilled = true;
      }
    }

    let markGeometry: DetectedFormField['markGeometry'] = null;

    if (isCircleLabel && markType === 'TEXT') {
      // "Circle the correct option" style prompts — surface for manual circle stamp.
      // Pre-seed geometry from the KEY bounding box so the editor knows where to drop
      // the stamp; user can then drag/resize it.
      markType = 'CIRCLE';
      status = 'MANUAL_REQUIRED';
      manualReason = manualReason ?? 'Mark the correct option';
      const bb = bboxOf(value ?? k) ?? bboxOf(k);
      if (bb) {
        markGeometry = {
          cx: bb.left + bb.width / 2,
          cy: bb.top + bb.height / 2,
          radius: Math.min(bb.width, bb.height) / 2,
        };
      }
    }

    if (isAlreadyFilled && !isAlwaysManual) continue;

    if (isAlwaysManual) {
      status = 'MANUAL_REQUIRED';
      manualReason = manualReason ?? 'Requires authorized signature';
    }

    // Bounding box: prefer VALUE block (where the user writes); fall back to KEY for empty checkboxes
    const targetBbox = bboxOf(value ?? k) ?? bboxOf(k);

    fields.push({
      fieldId: uuidv4(),
      label,
      value: fieldValue,
      status,
      confidence: null,
      profileFieldKey: null,
      manualReason,
      pageNumber: k.Page ?? value?.Page ?? 1,
      cellReference: null,
      boundingBox: targetBbox,
      markType,
      markChar,
      markGeometry,
      matrixCategory: null,
      matrixFeature: null,
      matrixColumn: 'OTHER',
    });
  }

  // SIGNATURE blocks → standalone manual fields
  for (const b of blocks) {
    if (b.BlockType !== 'SIGNATURE') continue;
    if (!inRange(b.Page)) continue;
    fields.push({
      fieldId: uuidv4(),
      label: 'Signature',
      value: null,
      status: 'MANUAL_REQUIRED',
      confidence: null,
      profileFieldKey: null,
      manualReason: 'Requires authorized signature',
      pageNumber: b.Page ?? 1,
      cellReference: null,
      boundingBox: bboxOf(b),
      markType: 'TEXT',
      markChar: null,
      markGeometry: null,
      matrixCategory: null,
      matrixFeature: null,
      matrixColumn: 'OTHER',
    });
  }

  return fields;
};
