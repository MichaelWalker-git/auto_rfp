import type { PastProject } from '@auto-rfp/core';
import {
  getEffectiveDisclosure,
  isUsableInMatching,
  isNameable,
  redactForGeneration,
  anonymizationNotice,
} from './past-performance-disclosure';

const makeProject = (overrides: Partial<PastProject> = {}): PastProject =>
  ({
    projectId: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    title: 'Modernization effort',
    client: 'Acme Federal',
    clientPOC: { name: 'Jane Doe', email: 'jane@acme.gov' },
    contractNumber: 'GS-00F-1234',
    description: 'A sufficiently long description of the work.',
    achievements: [],
    technologies: [],
    naicsCodes: [],
    usageCount: 0,
    usedInBriefIds: [],
    freshnessStatus: 'ACTIVE',
    disclosure: 'PERMISSION_REQUIRED',
    disclosureConfirmed: false,
    disclosureSignals: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdBy: '33333333-3333-3333-3333-333333333333',
    isArchived: false,
    ...overrides,
  }) as PastProject;

describe('getEffectiveDisclosure', () => {
  it('returns NAMEABLE only when confirmed NAMEABLE', () => {
    expect(
      getEffectiveDisclosure(makeProject({ disclosure: 'NAMEABLE', disclosureConfirmed: true })),
    ).toBe('NAMEABLE');
  });

  it('treats NAMEABLE but unconfirmed as PERMISSION_REQUIRED (fail-closed)', () => {
    expect(
      getEffectiveDisclosure(makeProject({ disclosure: 'NAMEABLE', disclosureConfirmed: false })),
    ).toBe('PERMISSION_REQUIRED');
  });

  it('treats a missing disclosure value as PERMISSION_REQUIRED', () => {
    expect(
      getEffectiveDisclosure({
        disclosure: undefined as unknown as PastProject['disclosure'],
        disclosureConfirmed: true,
      }),
    ).toBe('PERMISSION_REQUIRED');
  });

  it('returns DO_NOT_USE when confirmed DO_NOT_USE', () => {
    expect(
      getEffectiveDisclosure(makeProject({ disclosure: 'DO_NOT_USE', disclosureConfirmed: true })),
    ).toBe('DO_NOT_USE');
  });
});

describe('isUsableInMatching', () => {
  it('is false only for effective DO_NOT_USE', () => {
    expect(
      isUsableInMatching(makeProject({ disclosure: 'DO_NOT_USE', disclosureConfirmed: true })),
    ).toBe(false);
  });

  it('is true for anonymized/permission-required projects', () => {
    expect(
      isUsableInMatching(makeProject({ disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true })),
    ).toBe(true);
    expect(isUsableInMatching(makeProject())).toBe(true);
  });

  it('is true for unconfirmed DO_NOT_USE (fail-closed collapses to PERMISSION_REQUIRED, still usable-but-redacted)', () => {
    expect(
      isUsableInMatching(makeProject({ disclosure: 'DO_NOT_USE', disclosureConfirmed: false })),
    ).toBe(true);
  });
});

describe('isNameable', () => {
  it('is true only for confirmed NAMEABLE', () => {
    expect(isNameable(makeProject({ disclosure: 'NAMEABLE', disclosureConfirmed: true }))).toBe(true);
    expect(isNameable(makeProject({ disclosure: 'NAMEABLE', disclosureConfirmed: false }))).toBe(false);
    expect(isNameable(makeProject({ disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true }))).toBe(false);
  });
});

describe('redactForGeneration', () => {
  it('passes a NAMEABLE (confirmed) project through untouched', () => {
    const project = makeProject({ disclosure: 'NAMEABLE', disclosureConfirmed: true });
    expect(redactForGeneration(project)).toBe(project);
  });

  it('scrubs client, clientPOC, and contractNumber for ANONYMIZED_ONLY', () => {
    const project = makeProject({ disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true, domain: 'Healthcare' });
    const redacted = redactForGeneration(project);
    expect(redacted.client).toBe('[Client name withheld — Healthcare engagement]');
    expect(redacted.clientPOC).toBeNull();
    expect(redacted.contractNumber).toBeNull();
  });

  it('scrubs a PERMISSION_REQUIRED (default) project', () => {
    const redacted = redactForGeneration(makeProject());
    expect(redacted.client).toBe('[Client name withheld]');
    expect(redacted.clientPOC).toBeNull();
    expect(redacted.contractNumber).toBeNull();
  });

  it('uses a plain withheld label when domain is absent', () => {
    const redacted = redactForGeneration(makeProject({ domain: null }));
    expect(redacted.client).toBe('[Client name withheld]');
  });

  it('does not mutate the original project', () => {
    const project = makeProject();
    redactForGeneration(project);
    expect(project.client).toBe('Acme Federal');
    expect(project.clientPOC).not.toBeNull();
  });

  it('strips the client name from the description free text (the DegreeData leak)', () => {
    const project = makeProject({
      disclosure: 'ANONYMIZED_ONLY',
      disclosureConfirmed: true,
      client: 'DegreeData',
      description: 'A platform that enabled DegreeData to automate transcript evaluation for DegreeData staff.',
    });
    const redacted = redactForGeneration(project);
    expect(redacted.description).not.toMatch(/DegreeData/i);
    expect(redacted.description).toContain('[client withheld]');
  });

  it('strips the client name from technicalApproach and achievements', () => {
    const project = makeProject({
      disclosure: 'ANONYMIZED_ONLY',
      disclosureConfirmed: true,
      client: 'Porsche Digital',
      technicalApproach: 'Integrated the Porsche Digital logistics API for real-time tracking.',
      achievements: ['Cut Porsche Digital manual work by 80%', 'No name here'],
    });
    const redacted = redactForGeneration(project);
    expect(redacted.technicalApproach).not.toMatch(/Porsche Digital/i);
    expect(redacted.achievements.join(' ')).not.toMatch(/Porsche Digital/i);
    expect(redacted.achievements[1]).toBe('No name here'); // untouched
  });

  it('strips the client name from the title (extraction-derived titles like "DegreeData Transcript Modernization")', () => {
    const project = makeProject({
      disclosure: 'ANONYMIZED_ONLY',
      disclosureConfirmed: true,
      client: 'DegreeData',
      title: 'DegreeData Transcript Modernization',
    });
    const redacted = redactForGeneration(project);
    expect(redacted.title).not.toMatch(/DegreeData/i);
    expect(redacted.title).toContain('Transcript Modernization');
  });

  it('falls back to a placeholder when the title is entirely the client name', () => {
    const project = makeProject({
      disclosure: 'ANONYMIZED_ONLY',
      disclosureConfirmed: true,
      client: 'Porsche Digital',
      title: 'Porsche Digital',
    });
    const redacted = redactForGeneration(project);
    expect(redacted.title).toBe('[Confidential project]');
  });

  it('also strips a POC name / organization that could re-identify the client', () => {
    const project = makeProject({
      disclosure: 'ANONYMIZED_ONLY',
      disclosureConfirmed: true,
      client: 'Acme',
      clientPOC: { name: 'Jane Doe', organization: 'Acme Holdings' },
      description: 'Delivered for Acme Holdings, sponsored by Jane Doe.',
    });
    const redacted = redactForGeneration(project);
    expect(redacted.description).not.toMatch(/Acme Holdings/i);
    expect(redacted.description).not.toMatch(/Jane Doe/i);
  });

  it('does not mangle unrelated words that merely contain the name as a substring', () => {
    const project = makeProject({
      disclosure: 'ANONYMIZED_ONLY',
      disclosureConfirmed: true,
      client: 'IBM',
      description: 'Used a KanBAN board; the IBM mainframe was decommissioned.',
    });
    const redacted = redactForGeneration(project);
    // "KanBAN" contains "BAN" not "IBM"; the standalone "IBM" should be redacted.
    expect(redacted.description).toContain('KanBAN board');
    expect(redacted.description).not.toMatch(/\bIBM\b/);
  });

  it('passes NAMEABLE free text through untouched', () => {
    const project = makeProject({
      disclosure: 'NAMEABLE',
      disclosureConfirmed: true,
      client: 'DegreeData',
      description: 'Built for DegreeData.',
    });
    expect(redactForGeneration(project).description).toBe('Built for DegreeData.');
  });
});

describe('anonymizationNotice', () => {
  it('is empty for a confirmed NAMEABLE project', () => {
    expect(anonymizationNotice(makeProject({ disclosure: 'NAMEABLE', disclosureConfirmed: true }))).toBe('');
  });

  it('returns a CONFIDENTIAL CLIENT instruction for non-NAMEABLE projects', () => {
    expect(anonymizationNotice(makeProject({ disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true })))
      .toMatch(/CONFIDENTIAL CLIENT/);
    // fail-closed default (unconfirmed) also gets the notice
    expect(anonymizationNotice(makeProject())).toMatch(/Do NOT name this client/);
  });
});
