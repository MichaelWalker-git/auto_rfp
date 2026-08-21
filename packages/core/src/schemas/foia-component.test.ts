import { describe, expect, it } from 'vitest';

import {
  FoiaComponentItemSchema,
  buildFoiaComponentLookup,
  formatFoiaComponentAddress,
  getFoiaComponentEmail,
  matchFoiaComponent,
  normalizeAgencyTitle,
  resolveFoiaSubmissionMethod,
} from './foia-component';

/**
 * Real components from the live FOIA.gov API, including genuine ambiguity
 * (five distinct "Office of Inspector General" entries) and a real inactive
 * component (GSA has status=false upstream).
 */
const COMPONENTS = [
  { componentId: 'uscg', title: 'U.S. Coast Guard', abbreviation: 'USCG' },
  { componentId: 'noaa', title: 'National Oceanic and Atmospheric Administration', abbreviation: 'NOAA' },
  { componentId: 'blm', title: 'Bureau of Land Management', abbreviation: 'BLM' },
  { componentId: 'usgs', title: 'U.S. Geological Survey', abbreviation: 'USGS' },
  { componentId: 'nps', title: 'National Park Service', abbreviation: 'NPS' },
  { componentId: 'daf', title: 'Department of the Air Force', abbreviation: 'DAF' },
  { componentId: 'army', title: 'Department of the Army', abbreviation: 'DA' },
  { componentId: 'navy', title: 'Department of the Navy', abbreviation: 'DON' },
  { componentId: 'dla', title: 'Defense Logistics Agency', abbreviation: 'DLA' },
  { componentId: 'msfc', title: 'Marshall Space Flight Center', abbreviation: 'MSFC' },
  { componentId: 'dos', title: 'Department of State', abbreviation: 'DOS - Main' },
  { componentId: 'ams', title: 'Agricultural Marketing Service', abbreviation: 'AMS' },
  { componentId: 'fs', title: 'Forest Service', abbreviation: 'FS' },
  { componentId: 'gsa', title: 'General Services Administration', abbreviation: 'GSA' },
  // Real duplicates from the live dataset: "Office of Inspector General" appears
  // 12 times with a byte-identical title and "Office of the Inspector General"
  // 13 times, all abbreviated OIG. Both the title and the abbreviation are
  // therefore ambiguous and must refuse.
  { componentId: 'oig1', title: 'Office of Inspector General', abbreviation: 'OIG' },
  { componentId: 'oig2', title: 'Office of Inspector General', abbreviation: 'OIG' },
  { componentId: 'oig3', title: 'Office of the Inspector General', abbreviation: 'OIG' },
  { componentId: 'oig4', title: 'Office of the Inspector General', abbreviation: 'OIG' },
] as const;

const lookup = buildFoiaComponentLookup([...COMPONENTS]);

const match = (name: string) => matchFoiaComponent(name, lookup);

describe('normalizeAgencyTitle', () => {
  it('expands DEPT to DEPARTMENT', () => {
    expect(normalizeAgencyTitle('DEPT OF THE NAVY')).toBe('DEPARTMENT OF THE NAVY');
    expect(normalizeAgencyTitle('Dept. of the Navy')).toBe('DEPARTMENT OF THE NAVY');
  });

  it('collapses U.S. / US / USA to one form', () => {
    expect(normalizeAgencyTitle('U.S. Coast Guard')).toBe('US COAST GUARD');
    expect(normalizeAgencyTitle('US COAST GUARD')).toBe('US COAST GUARD');
    expect(normalizeAgencyTitle('USA Coast Guard')).toBe('US COAST GUARD');
  });

  it('spells out the ampersand before stripping punctuation', () => {
    expect(normalizeAgencyTitle('Mine Safety & Health')).toBe('MINE SAFETY AND HEALTH');
  });

  it('un-inverts a feed-style department name', () => {
    expect(normalizeAgencyTitle('STATE, DEPARTMENT OF')).toBe('DEPARTMENT OF STATE');
    expect(normalizeAgencyTitle('VETERANS AFFAIRS, DEPARTMENT OF')).toBe(
      'DEPARTMENT OF VETERANS AFFAIRS',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeAgencyTitle('  DEPT   OF \t THE  ARMY ')).toBe('DEPARTMENT OF THE ARMY');
  });

  it('is idempotent', () => {
    const once = normalizeAgencyTitle('Dept. of the Navy');
    expect(normalizeAgencyTitle(once)).toBe(once);
  });

  it('keeps digits, which appear in office codes', () => {
    expect(normalizeAgencyTitle('USFS Region 6')).toBe('USFS REGION 6');
  });

  it('does not conflate distinct departments', () => {
    expect(normalizeAgencyTitle('DEPT OF THE ARMY')).not.toBe(
      normalizeAgencyTitle('DEPT OF THE NAVY'),
    );
  });

  it('handles empty input without throwing', () => {
    expect(normalizeAgencyTitle('')).toBe('');
    expect(normalizeAgencyTitle('   ')).toBe('');
  });
});

describe('matchFoiaComponent — HigherGov "(ABBR)" format', () => {
  it('resolves a unique abbreviation', () => {
    const r = match('Defense Logistics Agency (DLA)');
    expect(r).toEqual({ matched: true, componentId: 'dla', tier: 'ABBREVIATION' });
  });

  it('refuses an ambiguous abbreviation rather than picking one', () => {
    // OIG maps to 22 components in the real dataset. Guessing would send a
    // statutory request to an arbitrary agency's inspector general.
    const r = match('Office of Inspector General (OIG)');
    expect(r).toEqual({ matched: false, refusal: 'ABBREVIATION_AMBIGUOUS' });
  });

  it('falls back to the title when the abbreviation is unknown', () => {
    const r = match('Department of the Navy (XYZZY)');
    expect(r).toEqual({ matched: true, componentId: 'navy', tier: 'EXACT_TITLE' });
  });
});

describe('matchFoiaComponent — SAM dot-hierarchy', () => {
  it('resolves the department, not the local field office', () => {
    // Naive token matching sent this to a "Houston District Office" on the
    // shared word "Houston" — a wrong-agency send.
    const r = match('DEPT OF DEFENSE.DEPT OF THE ARMY.AMC.ACC.MICC.W6QM MICC-FT SAM HOUSTON');
    expect(r).toEqual({ matched: true, componentId: 'army', tier: 'HIERARCHY_SEGMENT' });
  });

  it('resolves an inverted department segment', () => {
    const r = match('STATE, DEPARTMENT OF.U.S. MISSION TO GEORGIA.U.S. EMBASSY IN TBILISI');
    expect(r).toEqual({ matched: true, componentId: 'dos', tier: 'HIERARCHY_SEGMENT' });
  });

  it('prefers the least specific confident hit (root-first)', () => {
    const r = match('DEPT OF THE NAVY.NAVAL SUPPLY SYSTEMS COMMAND');
    expect(r).toEqual({ matched: true, componentId: 'navy', tier: 'HIERARCHY_SEGMENT' });
  });

  it('resolves a sub-agency when the root is not itself a component', () => {
    const r = match('NASA.MARSHALL SPACE FLIGHT CENTER');
    expect(r).toEqual({ matched: true, componentId: 'msfc', tier: 'HIERARCHY_SEGMENT' });
  });

  it('normalizes U.S. within a segment', () => {
    const r = match('HOMELAND SECURITY, DEPARTMENT OF.US COAST GUARD');
    expect(r).toEqual({ matched: true, componentId: 'uscg', tier: 'HIERARCHY_SEGMENT' });
  });

  it('refuses when no segment matches', () => {
    const r = match('SOME AGENCY.SOME OFFICE.SOME BRANCH');
    expect(r).toEqual({ matched: false, refusal: 'NO_MATCH' });
  });
});

describe('matchFoiaComponent — bare names', () => {
  it('resolves an exact title', () => {
    const r = match('Department of the Air Force');
    expect(r).toEqual({ matched: true, componentId: 'daf', tier: 'EXACT_TITLE' });
  });

  it('refuses a HigherGov leaf office', () => {
    // These are the real values: leaf offices, not FOIA components. They must
    // refuse so the hierarchy walk or a human can resolve them.
    for (const leaf of [
      'ACC Orlando',
      'TAC New Jersey',
      'U.S. Embassy In Tbilisi',
      'Western Acquisition Division',
      'DHS Office of the Chief Procurement Officer',
      'NPS Midwest Region',
      'FCI Bastrop',
    ]) {
      expect(match(leaf)).toEqual({ matched: false, refusal: 'NO_MATCH' });
    }
  });

  it('refuses an ambiguous bare title', () => {
    expect(match('Office of Inspector General')).toEqual({
      matched: false,
      refusal: 'TITLE_AMBIGUOUS',
    });
  });

  it('refuses empty input', () => {
    expect(match('')).toEqual({ matched: false, refusal: 'EMPTY_INPUT' });
    expect(matchFoiaComponent(null, lookup)).toEqual({ matched: false, refusal: 'EMPTY_INPUT' });
    expect(matchFoiaComponent(undefined, lookup)).toEqual({ matched: false, refusal: 'EMPTY_INPUT' });
  });
});

describe('matchFoiaComponent — no false positives', () => {
  it('never matches an unrelated agency on shared words', () => {
    // Each of these shares vocabulary with a real component but is not one.
    for (const input of [
      'Houston District Office',
      'Region 5',
      'National Office',
      'Office of the Chief Procurement Officer',
      'Eastern Acquisition Division',
      'Department of Fictional Affairs',
    ]) {
      const r = match(input);
      expect(r.matched, `"${input}" must not match`).toBe(false);
    }
  });
});

describe('getFoiaComponentEmail', () => {
  it('returns the published address', () => {
    expect(getFoiaComponentEmail({ emails: ['foia@army.mil'], isActive: true })).toBe(
      'foia@army.mil',
    );
  });

  it('refuses an inactive component', () => {
    // 206 of 614 components are inactive upstream; their mailboxes may be dead,
    // and a statutory request into a dead inbox fails silently.
    expect(getFoiaComponentEmail({ emails: ['foia@old.gov'], isActive: false })).toBeUndefined();
  });

  it('returns undefined when no email is published', () => {
    expect(getFoiaComponentEmail({ emails: [], isActive: true })).toBeUndefined();
  });

  it('skips a blank entry', () => {
    expect(getFoiaComponentEmail({ emails: ['  ', 'real@agency.gov'], isActive: true })).toBe(
      'real@agency.gov',
    );
  });
});

describe('resolveFoiaSubmissionMethod', () => {
  const base = {
    emails: [] as string[],
    isActive: true,
    submissionWebUrl: null,
    submissionAddress: null,
    submissionFax: null,
  };

  it('prefers email — the only channel software can complete unattended', () => {
    expect(
      resolveFoiaSubmissionMethod({
        ...base,
        emails: ['foia@a.gov'],
        submissionWebUrl: 'https://portal.gov',
      }),
    ).toBe('EMAIL');
  });

  it('falls back to a portal', () => {
    expect(resolveFoiaSubmissionMethod({ ...base, submissionWebUrl: 'https://portal.gov' })).toBe(
      'PORTAL',
    );
  });

  it('falls back to postal mail', () => {
    expect(
      resolveFoiaSubmissionMethod({
        ...base,
        submissionAddress: { addressLine1: '1 Agency Way', locality: 'Washington' },
      }),
    ).toBe('MAIL');
  });

  it('falls back to fax', () => {
    expect(resolveFoiaSubmissionMethod({ ...base, submissionFax: '202-555-0100' })).toBe('FAX');
  });

  it('reports UNKNOWN when there is no channel at all', () => {
    expect(resolveFoiaSubmissionMethod(base)).toBe('UNKNOWN');
  });

  it('does not offer EMAIL for an inactive component', () => {
    expect(
      resolveFoiaSubmissionMethod({ ...base, emails: ['x@a.gov'], isActive: false }),
    ).toBe('UNKNOWN');
  });
});

describe('formatFoiaComponentAddress', () => {
  it('renders the single line the letter template expects', () => {
    expect(
      formatFoiaComponentAddress({
        addressLine1: 'Information Access Programs Directorate',
        addressLine2: 'Attn: FOIA',
        locality: 'Washington',
        administrativeArea: 'DC',
        postalCode: '20520',
      }),
    ).toBe('Information Access Programs Directorate, Attn: FOIA, Washington, DC 20520');
  });

  it('omits missing parts rather than printing gaps', () => {
    expect(formatFoiaComponentAddress({ addressLine1: '1 Way', locality: 'Denver' })).toBe(
      '1 Way, Denver',
    );
  });

  it('returns undefined for an empty or absent address', () => {
    expect(formatFoiaComponentAddress(null)).toBeUndefined();
    expect(formatFoiaComponentAddress(undefined)).toBeUndefined();
    expect(formatFoiaComponentAddress({})).toBeUndefined();
  });
});

describe('FoiaComponentItemSchema', () => {
  it('accepts a real seeded record', () => {
    const { success } = FoiaComponentItemSchema.safeParse({
      componentId: 'abc-123',
      title: 'Department of the Army',
      normalizedTitle: 'DEPARTMENT OF THE ARMY',
      abbreviation: 'DA',
      isActive: true,
      emails: ['usarmy.belvoir.hqda-esa.mbx.rmda-foia@army.mil'],
      submissionAddress: { addressLine1: '9301 Chapek Rd', locality: 'Fort Belvoir' },
      portalSubmissionFormat: 'api',
      fetchedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(success).toBe(true);
  });

  it('defaults emails to an empty array', () => {
    const { data } = FoiaComponentItemSchema.safeParse({
      componentId: 'x',
      title: 'T',
      normalizedTitle: 'T',
      fetchedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(data?.emails).toEqual([]);
    expect(data?.isActive).toBe(true);
  });
});
