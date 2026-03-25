import { describe, it, expect } from 'vitest';
import {
  QuickSummarySchema,
  normalizeRole,
  isKnownRole,
  KNOWN_ROLES,
  RoleSchema,
  ContactSchema,
  ContactsSectionSchema,
} from './executive-opportunity-brief';

describe('QuickSummarySchema', () => {
  // ── Happy path ──

  it('parses a fully populated summary', () => {
    const input = {
      title: 'Cloud Migration Services',
      agency: 'Department of Defense',
      office: 'Office of IT',
      solicitationNumber: 'FA8103-24-R-0001',
      naics: '541611',
      contractType: 'FIXED_PRICE',
      setAside: 'SMALL_BUSINESS',
      placeOfPerformance: 'Washington, DC',
      estimatedValueUsd: '$1.5M',
      periodOfPerformance: 'Base year + 4 option years',
      summary: 'Solicitation for enterprise cloud migration services supporting DoD digital transformation.',
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe(input.summary);
    expect(data?.title).toBe(input.title);
  });

  it('parses with only the required summary field', () => {
    const input = {
      summary: 'A brief summary of the opportunity.',
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe(input.summary);
    expect(data?.contractType).toBe('UNKNOWN');
    expect(data?.setAside).toBe('UNKNOWN');
  });

  // ── Default values ──

  it('applies default values for contractType and setAside', () => {
    const input = { summary: 'Test summary content.' };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.contractType).toBe('UNKNOWN');
    expect(data?.setAside).toBe('UNKNOWN');
  });

  // ── Summary field coercion ──

  it('trims whitespace from summary string', () => {
    const input = { summary: '  Trimmed summary content.  ' };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe('Trimmed summary content.');
  });

  it('coerces summary object to JSON string', () => {
    const input = {
      summary: { text: 'This is a summary', details: 'More info' },
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toContain('This is a summary');
    expect(typeof data?.summary).toBe('string');
  });

  it('coerces summary array to JSON string', () => {
    const input = {
      summary: ['First sentence.', 'Second sentence.'],
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(typeof data?.summary).toBe('string');
    expect(data?.summary).toContain('First sentence.');
  });

  it('coerces numeric summary to string', () => {
    const input = { summary: 12345 };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe('12345');
  });

  // ── Validation failures ──

  it('rejects empty summary string', () => {
    const input = { summary: '' };

    const { success, error } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
    expect(error?.issues[0]?.message).toBe('Summary must not be empty');
  });

  it('rejects whitespace-only summary', () => {
    const input = { summary: '   ' };

    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });

  it('rejects null summary', () => {
    const input = { summary: null };

    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });

  it('rejects undefined summary (missing field)', () => {
    const input = {};

    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });

  // ── Optional fields ──

  it('allows all optional fields to be omitted', () => {
    const input = { summary: 'Minimal summary.' };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.title).toBeUndefined();
    expect(data?.agency).toBeUndefined();
    expect(data?.office).toBeUndefined();
    expect(data?.solicitationNumber).toBeUndefined();
    expect(data?.naics).toBeUndefined();
    expect(data?.placeOfPerformance).toBeUndefined();
    expect(data?.estimatedValueUsd).toBeUndefined();
    expect(data?.periodOfPerformance).toBeUndefined();
  });

  // ── Passthrough (extra fields from LLM) ──

  it('allows extra fields from LLM without failing', () => {
    const input = {
      summary: 'A valid summary.',
      evidence: 'Some evidence text',
      metadata: { source: 'bedrock' },
      extraField: 'should not cause failure',
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe('A valid summary.');
    // Extra fields are passed through
    expect((data as Record<string, unknown>).evidence).toBe('Some evidence text');
  });

  // ── Edge cases from real LLM responses ──

  it('handles LLM returning null for optional string fields', () => {
    const input = {
      title: null,
      agency: null,
      summary: 'Valid summary text.',
    };

    // The schema uses .nullish() which accepts null, undefined, and the actual type
    // So this should succeed, not fail
    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.title).toBe(null);
    expect(data?.agency).toBe(null);
    expect(data?.summary).toBe('Valid summary text.');
  });

  it('rejects boolean false as summary (coerced to empty string)', () => {
    const input = { summary: false };

    // false is falsy, so preprocess converts it to String(false || '') = ''
    // which fails the min(1) check — this is correct behavior
    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RoleSchema and Contact Normalization Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('normalizeRole', () => {
  it('should return known roles unchanged', () => {
    expect(normalizeRole('CONTRACTING_OFFICER')).toBe('CONTRACTING_OFFICER');
    expect(normalizeRole('TECHNICAL_POC')).toBe('TECHNICAL_POC');
    expect(normalizeRole('PROGRAM_MANAGER')).toBe('PROGRAM_MANAGER');
  });

  it('should normalize common abbreviations', () => {
    expect(normalizeRole('CO')).toBe('CONTRACTING_OFFICER');
    expect(normalizeRole('COR')).toBe('CONTRACTING_OFFICER_REPRESENTATIVE');
    expect(normalizeRole('PM')).toBe('PROGRAM_MANAGER');
    expect(normalizeRole('CS')).toBe('CONTRACT_SPECIALIST');
  });

  it('should normalize spaced variations to known roles', () => {
    expect(normalizeRole('Contracting Officer')).toBe('CONTRACTING_OFFICER');
    expect(normalizeRole('CONTRACTING OFFICER REPRESENTATIVE')).toBe('CONTRACTING_OFFICER_REPRESENTATIVE');
    expect(normalizeRole('Technical POC')).toBe('TECHNICAL_POC');
  });

  it('should handle case-insensitive matching', () => {
    expect(normalizeRole('contracting_officer')).toBe('CONTRACTING_OFFICER');
    expect(normalizeRole('Program_Manager')).toBe('PROGRAM_MANAGER');
  });

  it('should return unknown roles unchanged', () => {
    expect(normalizeRole('Quality Assurance Lead')).toBe('Quality Assurance Lead');
    expect(normalizeRole('Security Officer')).toBe('Security Officer');
    expect(normalizeRole('IT Director')).toBe('IT Director');
    expect(normalizeRole('CUSTOM_ROLE_NAME')).toBe('CUSTOM_ROLE_NAME');
  });

  it('should handle edge cases', () => {
    expect(normalizeRole('')).toBe('');
    expect(normalizeRole(null)).toBe('');
    expect(normalizeRole(undefined)).toBe('');
    expect(normalizeRole('  CONTRACTING_OFFICER  ')).toBe('CONTRACTING_OFFICER');
  });
});

describe('isKnownRole', () => {
  it('should return true for known roles', () => {
    expect(isKnownRole('CONTRACTING_OFFICER')).toBe(true);
    expect(isKnownRole('TECHNICAL_POC')).toBe(true);
    expect(isKnownRole('OTHER')).toBe(true);
  });

  it('should return false for unknown roles', () => {
    expect(isKnownRole('Quality Assurance Lead')).toBe(false);
    expect(isKnownRole('CUSTOM_ROLE')).toBe(false);
    expect(isKnownRole('')).toBe(false);
  });
});

describe('KNOWN_ROLES', () => {
  it('should contain expected roles', () => {
    expect(KNOWN_ROLES).toContain('CONTRACTING_OFFICER');
    expect(KNOWN_ROLES).toContain('CONTRACTING_OFFICER_REPRESENTATIVE');
    expect(KNOWN_ROLES).toContain('CONTRACT_SPECIALIST');
    expect(KNOWN_ROLES).toContain('TECHNICAL_POC');
    expect(KNOWN_ROLES).toContain('PROGRAM_MANAGER');
    expect(KNOWN_ROLES).toContain('SMALL_BUSINESS_SPECIALIST');
    expect(KNOWN_ROLES).toContain('OTHER');
  });

  it('should have exactly 10 roles', () => {
    expect(KNOWN_ROLES.length).toBe(10);
  });
});

describe('RoleSchema', () => {
  it('should parse known roles without error', () => {
    const { success, data } = RoleSchema.safeParse('CONTRACTING_OFFICER');
    expect(success).toBe(true);
    expect(data).toBe('CONTRACTING_OFFICER');
  });

  it('should normalize abbreviations during parsing', () => {
    const { success, data } = RoleSchema.safeParse('CO');
    expect(success).toBe(true);
    expect(data).toBe('CONTRACTING_OFFICER');
  });

  it('should accept unknown roles without error', () => {
    const { success, data } = RoleSchema.safeParse('Quality Assurance Lead');
    expect(success).toBe(true);
    expect(data).toBe('Quality Assurance Lead');
  });

  it('should accept any string role', () => {
    const { success, data } = RoleSchema.safeParse('SOME_CUSTOM_ROLE_FROM_SOLICITATION');
    expect(success).toBe(true);
    expect(data).toBe('SOME_CUSTOM_ROLE_FROM_SOLICITATION');
  });
});

describe('ContactSchema', () => {
  it('should parse contact with known role', () => {
    const contact = {
      role: 'CONTRACTING_OFFICER',
      name: 'John Doe',
      email: 'john@example.gov',
    };
    const { success, data } = ContactSchema.safeParse(contact);
    expect(success).toBe(true);
    expect(data?.role).toBe('CONTRACTING_OFFICER');
  });

  it('should parse contact with unknown role (no validation error)', () => {
    const contact = {
      role: 'Quality Assurance Lead',
      name: 'Jane Smith',
      email: 'jane@example.gov',
    };
    const { success, data } = ContactSchema.safeParse(contact);
    expect(success).toBe(true);
    expect(data?.role).toBe('Quality Assurance Lead');
  });

  it('should parse contact with abbreviation and normalize it', () => {
    const contact = {
      role: 'COR',
      name: 'Bob Johnson',
      email: 'bob@example.gov',
    };
    const { success, data } = ContactSchema.safeParse(contact);
    expect(success).toBe(true);
    expect(data?.role).toBe('CONTRACTING_OFFICER_REPRESENTATIVE');
  });
});

describe('ContactsSectionSchema', () => {
  it('should parse contacts section with mixed known and unknown roles', () => {
    const section = {
      contacts: [
        { role: 'CONTRACTING_OFFICER', name: 'John Doe', email: 'john@example.gov' },
        { role: 'Quality Assurance Lead', name: 'Jane Smith', email: 'jane@example.gov' },
        { role: 'Security Officer', name: 'Bob Johnson', email: 'bob@example.gov' },
      ],
      missingRecommendedRoles: ['TECHNICAL_POC', 'PROGRAM_MANAGER'],
    };
    const { success, data, error } = ContactsSectionSchema.safeParse(section);

    if (!success) {
      console.error('Validation errors:', JSON.stringify(error.issues, null, 2));
    }

    expect(success).toBe(true);
    expect(data?.contacts?.length).toBe(3);
    expect(data?.contacts?.[0]?.role).toBe('CONTRACTING_OFFICER');
    expect(data?.contacts?.[1]?.role).toBe('Quality Assurance Lead'); // Unknown role preserved
    expect(data?.contacts?.[2]?.role).toBe('Security Officer'); // Unknown role preserved
  });

  it('should not fail when AI returns CONTRACTING_OFFICER_REPRESENTATIVE role', () => {
    // This is the actual error case from production - AI returns role that was previously
    // in enum but now we want to ensure it still works
    const section = {
      contacts: [
        { role: 'CONTRACTING_OFFICER_REPRESENTATIVE', name: 'Test User', email: 'test@example.gov' },
      ],
      missingRecommendedRoles: [],
    };
    const { success, error } = ContactsSectionSchema.safeParse(section);

    if (!success) {
      console.error('Validation errors:', JSON.stringify(error.issues, null, 2));
    }

    expect(success).toBe(true);
  });

  it('should handle empty contacts array', () => {
    const section = {
      contacts: [],
      missingRecommendedRoles: ['CONTRACTING_OFFICER', 'TECHNICAL_POC'],
    };
    const { success } = ContactsSectionSchema.safeParse(section);
    expect(success).toBe(true);
  });
});
