import { describe, it, expect } from 'vitest';
import {
  KBCoverageCategorySchema,
  KBCoverageCategoryDefSchema,
  KBCoverageIncompleteBodySchema,
  KBCoverageResponseSchema,
  KB_COVERAGE_CATEGORIES,
  KB_COVERAGE_CATEGORY_KEYS,
  KB_COVERAGE_GATED_DOCUMENT_TYPES,
  DOCUMENT_TYPE_REQUIRED_COVERAGE,
  GenerationPreconditionErrorCodeSchema,
  buildCoverageByDocumentType,
  buildKBCoverageIncompleteMessage,
  formatMissingCoverageCategories,
  getKBCoverageCategoryLabel,
  getMissingCoverageCategories,
  getRequiredCoverageCategories,
  type KBCoverageSnapshot,
} from './kb-coverage';
import { RFP_DOCUMENT_TYPES } from './rfp-document';

const emptySnapshot: KBCoverageSnapshot = {
  PERSONNEL_BIOS: { present: false, count: 0 },
  CERTIFICATIONS: { present: false, count: 0 },
  INSURANCE: { present: false, count: 0 },
};

const fullSnapshot: KBCoverageSnapshot = {
  PERSONNEL_BIOS: { present: true, count: 3 },
  CERTIFICATIONS: { present: true, count: 2 },
  INSURANCE: { present: true, count: 1 },
};

describe('KB_COVERAGE_CATEGORIES registry', () => {
  it('should have a row for every category key', () => {
    for (const key of KBCoverageCategorySchema.options) {
      expect(KB_COVERAGE_CATEGORIES[key]).toBeDefined();
      expect(KB_COVERAGE_CATEGORIES[key].key).toBe(key);
    }
  });

  it('should have every row satisfy the descriptor schema', () => {
    for (const def of Object.values(KB_COVERAGE_CATEGORIES)) {
      const { success, error } = KBCoverageCategoryDefSchema.safeParse(def);
      expect(error?.issues).toBeUndefined();
      expect(success).toBe(true);
    }
  });

  it('should give every row a non-empty operator-facing label', () => {
    for (const def of Object.values(KB_COVERAGE_CATEGORIES)) {
      expect(def.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('should back every declared source with the data it needs to probe', () => {
    for (const def of Object.values(KB_COVERAGE_CATEGORIES)) {
      if (def.sources.includes('CONTENT_LIBRARY_CATEGORY')) {
        expect(def.contentLibraryAliases.length).toBeGreaterThan(0);
      }
      if (def.sources.includes('COMPANY_PROFILE_FIELD')) {
        expect(def.companyProfileCategories.length).toBeGreaterThan(0);
      }
    }
  });

  it('should not declare content-library aliases without the matching source', () => {
    // Otherwise the alias is dead config: the probe would never read it.
    for (const def of Object.values(KB_COVERAGE_CATEGORIES)) {
      if (def.contentLibraryAliases.length > 0) {
        expect(def.sources).toContain('CONTENT_LIBRARY_CATEGORY');
      }
      if (def.companyProfileCategories.length > 0) {
        expect(def.sources).toContain('COMPANY_PROFILE_FIELD');
      }
    }
  });

  it('should expose the keys in registry order', () => {
    expect(KB_COVERAGE_CATEGORY_KEYS).toEqual(['PERSONNEL_BIOS', 'CERTIFICATIONS', 'INSURANCE']);
  });

  it('should return the label for a category', () => {
    expect(getKBCoverageCategoryLabel('PERSONNEL_BIOS')).toBe('personnel bios');
  });
});

describe('DOCUMENT_TYPE_REQUIRED_COVERAGE', () => {
  it('should require personnel bios and certifications for TEAM_QUALIFICATIONS', () => {
    expect(getRequiredCoverageCategories('TEAM_QUALIFICATIONS')).toEqual([
      'PERSONNEL_BIOS',
      'CERTIFICATIONS',
    ]);
  });

  it('should return no requirements for an unmapped standard type', () => {
    expect(getRequiredCoverageCategories('TECHNICAL_PROPOSAL')).toEqual([]);
  });

  it('should fail open for an org-defined custom document type', () => {
    // RFPDocumentTypeSchema accepts arbitrary UPPER_SNAKE_CASE slugs; an
    // unmapped custom type must never be blocked on coverage.
    expect(getRequiredCoverageCategories('MY_CUSTOM_TYPE')).toEqual([]);
  });

  it('should fail open for an empty document type', () => {
    expect(getRequiredCoverageCategories('')).toEqual([]);
  });

  it('should only map real document types', () => {
    for (const documentType of Object.keys(DOCUMENT_TYPE_REQUIRED_COVERAGE)) {
      expect(RFP_DOCUMENT_TYPES).toHaveProperty(documentType);
    }
  });

  it('should only require categories that exist in the registry', () => {
    for (const categories of Object.values(DOCUMENT_TYPE_REQUIRED_COVERAGE)) {
      for (const key of categories ?? []) {
        expect(KB_COVERAGE_CATEGORY_KEYS).toContain(key);
      }
    }
  });

  it('should list every mapped type as gated', () => {
    expect(KB_COVERAGE_GATED_DOCUMENT_TYPES).toEqual(
      Object.keys(DOCUMENT_TYPE_REQUIRED_COVERAGE),
    );
  });
});

describe('getMissingCoverageCategories', () => {
  it('should name every missing category on an empty KB', () => {
    expect(getMissingCoverageCategories('TEAM_QUALIFICATIONS', emptySnapshot)).toEqual([
      { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
      { key: 'CERTIFICATIONS', label: 'certification records' },
    ]);
  });

  it('should report nothing missing on a fully covered KB', () => {
    expect(getMissingCoverageCategories('TEAM_QUALIFICATIONS', fullSnapshot)).toEqual([]);
  });

  it('should report only the categories that are actually absent', () => {
    const partial: KBCoverageSnapshot = {
      ...emptySnapshot,
      PERSONNEL_BIOS: { present: true, count: 1 },
    };
    expect(getMissingCoverageCategories('TEAM_QUALIFICATIONS', partial)).toEqual([
      { key: 'CERTIFICATIONS', label: 'certification records' },
    ]);
  });

  it('should treat a category absent from the snapshot as missing', () => {
    // An omitted category means its probe never ran — passing the gate on
    // data we never read would defeat the point.
    expect(getMissingCoverageCategories('CERTIFICATIONS', {})).toEqual([
      { key: 'CERTIFICATIONS', label: 'certification records' },
    ]);
  });

  it('should report nothing missing for an unmapped type even on an empty KB', () => {
    expect(getMissingCoverageCategories('TECHNICAL_PROPOSAL', emptySnapshot)).toEqual([]);
  });
});

describe('buildCoverageByDocumentType', () => {
  it('should mark every gated type uncovered on an empty KB', () => {
    const byType = buildCoverageByDocumentType(emptySnapshot);
    expect(Object.keys(byType).sort()).toEqual([...KB_COVERAGE_GATED_DOCUMENT_TYPES].sort());
    expect(byType.TEAM_QUALIFICATIONS.covered).toBe(false);
    expect(byType.TEAM_QUALIFICATIONS.missing).toHaveLength(2);
    expect(byType.CERTIFICATIONS.missing).toEqual([
      { key: 'CERTIFICATIONS', label: 'certification records' },
    ]);
  });

  it('should mark every gated type covered on a full KB', () => {
    const byType = buildCoverageByDocumentType(fullSnapshot);
    for (const status of Object.values(byType)) {
      expect(status.covered).toBe(true);
      expect(status.missing).toEqual([]);
    }
  });

  it('should not include unmapped document types', () => {
    expect(buildCoverageByDocumentType(emptySnapshot)).not.toHaveProperty('TECHNICAL_PROPOSAL');
  });
});

describe('message formatting', () => {
  it('should join labels for the named list', () => {
    expect(
      formatMissingCoverageCategories(
        getMissingCoverageCategories('TEAM_QUALIFICATIONS', emptySnapshot),
      ),
    ).toBe('personnel bios, certification records');
  });

  it('should name the gaps in the refusal message', () => {
    const message = buildKBCoverageIncompleteMessage(
      getMissingCoverageCategories('TEAM_QUALIFICATIONS', emptySnapshot),
    );
    expect(message).toContain('personnel bios');
    expect(message).toContain('certification records');
  });

  it('should return an empty string for no missing categories', () => {
    expect(formatMissingCoverageCategories([])).toBe('');
  });
});

describe('error codes and response bodies', () => {
  it('should accept both precondition codes', () => {
    expect(GenerationPreconditionErrorCodeSchema.safeParse('KB_COVERAGE_INCOMPLETE').success).toBe(true);
    expect(GenerationPreconditionErrorCodeSchema.safeParse('SOLUTION_PLAN_REQUIRED').success).toBe(true);
  });

  it('should reject an unknown precondition code', () => {
    expect(GenerationPreconditionErrorCodeSchema.safeParse('NOPE').success).toBe(false);
  });

  it('should validate a 409 coverage body', () => {
    const { success, data } = KBCoverageIncompleteBodySchema.safeParse({
      code: 'KB_COVERAGE_INCOMPLETE',
      message: 'missing stuff',
      missingCategories: [{ key: 'PERSONNEL_BIOS', label: 'personnel bios' }],
    });
    expect(success).toBe(true);
    expect(data?.missingCategories[0].key).toBe('PERSONNEL_BIOS');
  });

  it('should reject a 409 body carrying the wrong code', () => {
    const { success } = KBCoverageIncompleteBodySchema.safeParse({
      code: 'SOLUTION_PLAN_REQUIRED',
      message: 'wrong gate',
      missingCategories: [],
    });
    expect(success).toBe(false);
  });

  it('should validate the coverage endpoint response', () => {
    const { success } = KBCoverageResponseSchema.safeParse({
      snapshot: emptySnapshot,
      byDocumentType: buildCoverageByDocumentType(emptySnapshot),
      isGateEnabled: false,
    });
    expect(success).toBe(true);
  });

  it('should reject a snapshot with an unknown category', () => {
    const { success } = KBCoverageResponseSchema.safeParse({
      snapshot: { NOT_A_CATEGORY: { present: true, count: 1 } },
      byDocumentType: {},
      isGateEnabled: false,
    });
    expect(success).toBe(false);
  });
});
