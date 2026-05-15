import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block,
  type AnalyzeDocumentCommandOutput,
} from '@aws-sdk/client-textract';
import { v4 as uuidv4 } from 'uuid';

import { requireEnv } from './env';

import type { DetectedFormField } from '@auto-rfp/core';

const textract = new TextractClient({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

type KeyValuePair = {
  key: string;
  value: string;
  confidence: number;
  page: number;
  isCheckbox: boolean;
  boundingBox: { top: number; left: number; width: number; height: number } | null;
};

const getBlockText = (block: Block, blockMap: Map<string, Block>): string => {
  if (!block.Relationships) return '';

  const texts: string[] = [];
  for (const rel of block.Relationships) {
    if (rel.Type === 'CHILD' && rel.Ids) {
      for (const id of rel.Ids) {
        const child = blockMap.get(id);
        if (child?.BlockType === 'WORD' && child.Text) {
          texts.push(child.Text);
        }
        if (child?.BlockType === 'SELECTION_ELEMENT') {
          texts.push(child.SelectionStatus === 'SELECTED' ? '[X]' : '[ ]');
        }
      }
    }
  }
  return texts.join(' ');
};

const isCheckboxValue = (block: Block, blockMap: Map<string, Block>): boolean => {
  if (!block.Relationships) return false;
  for (const rel of block.Relationships) {
    if (rel.Type === 'CHILD' && rel.Ids) {
      for (const id of rel.Ids) {
        const child = blockMap.get(id);
        if (child?.BlockType === 'SELECTION_ELEMENT') return true;
      }
    }
  }
  return false;
};

const NOISE_PATTERNS = [
  /^revised$/i,
  /^page\s*\d/i,
  /^form\s*\d/i,
  /^\d+\/\d+$/,
  /^_{2,}$/,
];

const isNoiseField = (key: string, value: string): boolean => {
  if (key.length < 2) return true;
  if (key.length > 120) return true;
  if (NOISE_PATTERNS.some((p) => p.test(key))) return true;
  if (NOISE_PATTERNS.some((p) => p.test(value))) return true;
  if (value === '( )' || value === '()') return true;
  return false;
};

const FILLABLE_FIELD_PATTERNS = [
  /name/i, /address/i, /city/i, /state/i, /zip/i, /phone/i, /email/i,
  /signature/i, /sign/i, /date/i, /title/i, /company/i, /vendor/i,
  /contractor/i, /ein/i, /tax/i, /fein/i, /uei/i, /cage/i, /naics/i,
  /dba/i, /entity/i, /cert/i, /project/i, /contract/i, /number/i,
  /no\./i, /printed/i, /authorized/i, /mailing/i, /street/i,
  /county/i, /website/i, /url/i, /fax/i, /telephone/i,
];

const looksLikeFillableField = (key: string): boolean =>
  FILLABLE_FIELD_PATTERNS.some((p) => p.test(key));

const extractKeyValuePairs = (response: AnalyzeDocumentCommandOutput): KeyValuePair[] => {
  const blocks = response.Blocks ?? [];
  const blockMap = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  const keyBlocks = blocks.filter(
    (b) => b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes?.includes('KEY'),
  );

  const pairs: KeyValuePair[] = [];

  for (const keyBlock of keyBlocks) {
    const keyText = getBlockText(keyBlock, blockMap);
    if (!keyText) continue;

    let valueText = '';
    let checkbox = false;
    const valueRel = keyBlock.Relationships?.find((r) => r.Type === 'VALUE');
    if (valueRel?.Ids) {
      for (const vid of valueRel.Ids) {
        const valueBlock = blockMap.get(vid);
        if (valueBlock) {
          valueText = getBlockText(valueBlock, blockMap);
          if (isCheckboxValue(valueBlock, blockMap)) checkbox = true;
        }
      }
    }

    const bbox = keyBlock.Geometry?.BoundingBox;

    pairs.push({
      key: keyText.trim(),
      value: valueText.trim(),
      confidence: keyBlock.Confidence ?? 0,
      page: keyBlock.Page ?? 1,
      isCheckbox: checkbox,
      boundingBox: bbox
        ? { top: bbox.Top ?? 0, left: bbox.Left ?? 0, width: bbox.Width ?? 0, height: bbox.Height ?? 0 }
        : null,
    });
  }

  return pairs;
};

// Detect underscored blanks in LINE blocks: "____________" followed by "(Label)" on next line
const extractUnderscoreFields = (response: AnalyzeDocumentCommandOutput): DetectedFormField[] => {
  const blocks = response.Blocks ?? [];
  const lines = blocks
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .sort((a, b) => {
      const pageA = a.Page ?? 1;
      const pageB = b.Page ?? 1;
      if (pageA !== pageB) return pageA - pageB;
      const topA = a.Geometry?.BoundingBox?.Top ?? 0;
      const topB = b.Geometry?.BoundingBox?.Top ?? 0;
      return topA - topB;
    });

  const fields: DetectedFormField[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (usedIndices.has(i)) continue;
    const line = lines[i];
    const text = line.Text ?? '';

    // Pattern 1: Line is mostly underscores (a blank field)
    const isUnderscoreLine = /^[_\s]{5,}$/.test(text) || /_{3,}/.test(text);

    if (isUnderscoreLine) {
      // Look at the next line — often it's a parenthesized label like "(Signature)" or "(Company Name)"
      const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
      const nextText = nextLine?.Text ?? '';
      const labelMatch = nextText.match(/^\s*\(([^)]+)\)\s*$/);

      const label = labelMatch ? labelMatch[1] : text.replace(/_/g, '').trim() || 'Field';
      const bbox = line.Geometry?.BoundingBox;

      fields.push({
        fieldId: uuidv4(),
        label,
        value: null,
        status: 'EMPTY',
        confidence: 0.8,
        profileFieldKey: null,
        manualReason: null,
        pageNumber: line.Page ?? 1,
        cellReference: null,
        boundingBox: bbox
          ? { top: bbox.Top ?? 0, left: bbox.Left ?? 0, width: bbox.Width ?? 0, height: bbox.Height ?? 0 }
          : null,
      });

      if (labelMatch) usedIndices.add(i + 1);
      usedIndices.add(i);
      continue;
    }

    // Pattern 2: "Label: ___________" or "Label ___________" — inline blank
    const inlineMatch = text.match(/^(.{2,50?}?)\s*:?\s*_{3,}\s*$/);
    if (inlineMatch) {
      const label = inlineMatch[1].trim();
      const bbox = line.Geometry?.BoundingBox;

      fields.push({
        fieldId: uuidv4(),
        label,
        value: null,
        status: 'EMPTY',
        confidence: 0.8,
        profileFieldKey: null,
        manualReason: null,
        pageNumber: line.Page ?? 1,
        cellReference: null,
        boundingBox: bbox
          ? { top: bbox.Top ?? 0, left: bbox.Left ?? 0, width: bbox.Width ?? 0, height: bbox.Height ?? 0 }
          : null,
      });
      usedIndices.add(i);
    }
  }

  return fields;
};

export const analyzeDocumentForms = async (fileKey: string): Promise<DetectedFormField[]> => {
  const bucket = getDocumentsBucket();

  const response = await textract.send(
    new AnalyzeDocumentCommand({
      Document: {
        S3Object: { Bucket: bucket, Name: fileKey },
      },
      FeatureTypes: ['FORMS', 'TABLES'],
    }),
  );

  const kvPairs = extractKeyValuePairs(response);

  const fields: DetectedFormField[] = [];

  for (const pair of kvPairs) {
    if (isNoiseField(pair.key, pair.value)) continue;

    if (pair.isCheckbox) {
      fields.push({
        fieldId: uuidv4(),
        label: pair.key,
        value: pair.value.includes('[X]') ? 'Yes' : 'No',
        status: 'MANUAL_REQUIRED',
        confidence: pair.confidence / 100,
        profileFieldKey: null,
        manualReason: 'Checkbox — requires manual review',
        pageNumber: pair.page,
        cellReference: null,
        boundingBox: pair.boundingBox,
      });
      continue;
    }

    const isFillable = looksLikeFillableField(pair.key);

    fields.push({
      fieldId: uuidv4(),
      label: pair.key,
      value: pair.value.length > 0 ? pair.value : null,
      status: isFillable ? 'EMPTY' : 'EMPTY',
      confidence: pair.confidence / 100,
      profileFieldKey: null,
      manualReason: null,
      pageNumber: pair.page,
      cellReference: null,
      boundingBox: pair.boundingBox,
    });
  }

  // Second pass: detect underscored blank fields from LINE blocks
  const underscoreFields = extractUnderscoreFields(response);

  // Deduplicate: skip underscore fields that overlap with already-detected FORMS fields
  const existingLabels = new Set(fields.map((f) => f.label.toLowerCase().trim()));
  for (const uf of underscoreFields) {
    if (!existingLabels.has(uf.label.toLowerCase().trim())) {
      fields.push(uf);
    }
  }

  return fields;
};
