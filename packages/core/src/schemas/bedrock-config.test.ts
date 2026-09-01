import { describe, it, expect } from 'vitest';
import {
  BedrockConfigCreateRequestSchema,
  BedrockConfigUpdateRequestSchema,
  BedrockConfigItemSchema,
  BedrockConfigDBItemSchema,
  BedrockConfigListItemSchema,
  BedrockProbeResultSchema,
} from './bedrock-config';
import { PK_NAME, SK_NAME } from '../constants';

const validProbe = {
  probedAt: '2026-09-01T00:00:00.000Z',
  accepted: true,
  results: [
    { modelId: 'amazon.titan-embed-text-v2:0', role: 'embeddings' as const, ok: true },
    { modelId: 'us.anthropic.claude-opus-4-6', role: 'default' as const, ok: false, error: 'ResourceNotFoundException' },
  ],
};

const validItem = {
  id: 'org-123',
  orgId: 'org-123',
  fallbackModelId: 'us.anthropic.claude-sonnet-4-6',
  lastProbe: validProbe,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('BedrockConfigCreateRequestSchema', () => {
  it('accepts a valid create request', () => {
    expect(BedrockConfigCreateRequestSchema.safeParse({ orgId: 'org-1', fallbackModelId: 'm' }).success).toBe(true);
  });

  it('accepts a create request without the optional fallbackModelId', () => {
    const { success, data } = BedrockConfigCreateRequestSchema.safeParse({ orgId: 'org-1' });
    expect(success).toBe(true);
    expect(data?.fallbackModelId).toBeUndefined();
  });

  it('rejects a missing orgId', () => {
    expect(BedrockConfigCreateRequestSchema.safeParse({ fallbackModelId: 'm' }).success).toBe(false);
  });

  it('rejects an empty fallbackModelId', () => {
    expect(BedrockConfigCreateRequestSchema.safeParse({ orgId: 'org-1', fallbackModelId: '' }).success).toBe(false);
  });
});

describe('BedrockConfigUpdateRequestSchema', () => {
  it('is fully optional and omits orgId', () => {
    expect(BedrockConfigUpdateRequestSchema.safeParse({}).success).toBe(true);
    expect(BedrockConfigUpdateRequestSchema.safeParse({ fallbackModelId: 'm' }).success).toBe(true);
    // orgId is omitted from the update shape — extra keys are stripped, not an error.
    const { data } = BedrockConfigUpdateRequestSchema.safeParse({ orgId: 'org-1' });
    expect((data as Record<string, unknown>).orgId).toBeUndefined();
  });
});

describe('BedrockProbeResultSchema', () => {
  it('accepts a valid probe result', () => {
    expect(BedrockProbeResultSchema.safeParse(validProbe).success).toBe(true);
  });

  it('rejects an unknown model role', () => {
    const bad = { ...validProbe, results: [{ modelId: 'x', role: 'nope', ok: true }] };
    expect(BedrockProbeResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe('BedrockConfigItemSchema', () => {
  it('accepts a valid item without db keys', () => {
    expect(BedrockConfigItemSchema.safeParse(validItem).success).toBe(true);
  });

  it('accepts an item with no probe recorded yet', () => {
    const { success } = BedrockConfigItemSchema.safeParse({ id: 'org-1', orgId: 'org-1' });
    expect(success).toBe(true);
  });

  it('never carries the api key — an apiKey field is stripped, not persisted', () => {
    const { data } = BedrockConfigItemSchema.safeParse({ ...validItem, apiKey: 'super-secret' });
    expect((data as Record<string, unknown>).apiKey).toBeUndefined();
  });
});

describe('BedrockConfigDBItemSchema', () => {
  it('rejects the pure Item shape (missing single-table keys)', () => {
    expect(BedrockConfigDBItemSchema.safeParse(validItem).success).toBe(false);
  });

  it('accepts the item once the computed PK/SK keys are added', () => {
    const { success } = BedrockConfigDBItemSchema.safeParse({
      ...validItem,
      [PK_NAME]: 'BEDROCK_CONFIG',
      [SK_NAME]: 'org-123',
    });
    expect(success).toBe(true);
  });
});

describe('BedrockConfigListItemSchema', () => {
  it('accepts a lightweight projection', () => {
    expect(
      BedrockConfigListItemSchema.safeParse({ id: 'org-1', orgId: 'org-1', updatedAt: '2026-09-01T00:00:00.000Z' }).success,
    ).toBe(true);
  });
});
