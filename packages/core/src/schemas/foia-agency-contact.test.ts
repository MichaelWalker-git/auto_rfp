import { describe, expect, it } from 'vitest';

import {
  ConfirmFoiaRecipientSchema,
  FoiaAgencyContactCreateRequestSchema,
  FoiaAgencyContactItemSchema,
  FoiaAgencyContactUpdateRequestSchema,
  normalizeAgencyKey,
} from './foia-agency-contact';

describe('normalizeAgencyKey', () => {
  it('collapses the common spellings of one agency to a single key', () => {
    // These are all real-world variants of the same agency from solicitation feeds.
    const variants = [
      'DEPT OF THE ARMY',
      'Dept. of the Army',
      '  dept of the army ',
      'Dept  of  the  Army',
      'DEPT. OF THE ARMY.',
    ];

    const keys = new Set(variants.map(normalizeAgencyKey));

    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('DEPT OF THE ARMY');
  });

  it('uppercases', () => {
    expect(normalizeAgencyKey('general services administration')).toBe(
      'GENERAL SERVICES ADMINISTRATION',
    );
  });

  it('strips punctuation but keeps word separation', () => {
    expect(normalizeAgencyKey('U.S. Dept. of Energy')).toBe('U S DEPT OF ENERGY');
  });

  it('collapses runs of whitespace including tabs and newlines', () => {
    expect(normalizeAgencyKey('DEPT\tOF\nTHE  NAVY')).toBe('DEPT OF THE NAVY');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeAgencyKey('   NASA   ')).toBe('NASA');
  });

  it('keeps digits, which appear in DoD office codes', () => {
    expect(normalizeAgencyKey('W6QM MICC-FT SAM HOUSTON')).toBe('W6QM MICC FT SAM HOUSTON');
  });

  it('does NOT conflate distinct sibling agency components', () => {
    // The whole reason matching is exact: these are different offices and a
    // fuzzy match would send a statutory request to the wrong one.
    expect(normalizeAgencyKey('USAF AFMC AFLCMC')).not.toBe(normalizeAgencyKey('USAF AFMC AFSC'));
    expect(normalizeAgencyKey('DEPT OF THE ARMY')).not.toBe(normalizeAgencyKey('DEPT OF THE NAVY'));
  });

  it('is idempotent — normalizing a key again is a no-op', () => {
    const once = normalizeAgencyKey('Dept. of the Army');

    expect(normalizeAgencyKey(once)).toBe(once);
  });

  it('handles an empty string without throwing', () => {
    expect(normalizeAgencyKey('')).toBe('');
    expect(normalizeAgencyKey('   ')).toBe('');
  });
});

describe('FoiaAgencyContactCreateRequestSchema', () => {
  const valid = {
    orgId: 'org-1',
    agencyName: 'Dept. of the Army',
    foiaEmail: 'foia@army.mil',
    foiaAddress: '1000 Army Pentagon, Washington, DC 20310',
  };

  it('accepts a complete contact and defaults acceptsEmail to true', () => {
    const { success, data } = FoiaAgencyContactCreateRequestSchema.safeParse(valid);

    expect(success).toBe(true);
    expect(data?.acceptsEmail).toBe(true);
  });

  it('rejects an invalid FOIA email', () => {
    const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({
      ...valid,
      foiaEmail: 'not-an-email',
    });

    expect(success).toBe(false);
  });

  it('rejects a blank agency name', () => {
    const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({
      ...valid,
      agencyName: '   ',
    });

    expect(success).toBe(false);
  });

  it('trims the agency name', () => {
    const { data } = FoiaAgencyContactCreateRequestSchema.safeParse({
      ...valid,
      agencyName: '  NASA  ',
    });

    expect(data?.agencyName).toBe('NASA');
  });

  it('supports a portal-only agency with no email', () => {
    const { success, data } = FoiaAgencyContactCreateRequestSchema.safeParse({
      orgId: 'org-1',
      agencyName: 'Some State Agency',
      foiaEmail: null,
      foiaAddress: null,
      acceptsEmail: false,
      webPortalUrl: 'https://records.example.gov/request',
    });

    expect(success).toBe(true);
    expect(data?.acceptsEmail).toBe(false);
  });

  it('rejects a malformed portal URL', () => {
    const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({
      ...valid,
      webPortalUrl: 'not a url',
    });

    expect(success).toBe(false);
  });

  it('accepts a STATE jurisdiction with a state name', () => {
    const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({
      ...valid,
      jurisdiction: 'STATE',
      state: 'California',
    });

    expect(success).toBe(true);
  });

  it('rejects an unknown jurisdiction', () => {
    const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({
      ...valid,
      jurisdiction: 'MUNICIPAL',
    });

    expect(success).toBe(false);
  });
});

describe('FoiaAgencyContactUpdateRequestSchema', () => {
  it('does not allow orgId to be patched', () => {
    const { success, data } = FoiaAgencyContactUpdateRequestSchema.safeParse({
      orgId: 'other-org',
      foiaEmail: 'new@army.mil',
    });

    expect(success).toBe(true);
    expect((data as Record<string, unknown>).orgId).toBeUndefined();
  });

  it('accepts an empty patch', () => {
    expect(FoiaAgencyContactUpdateRequestSchema.safeParse({}).success).toBe(true);
  });

  it('still validates supplied fields', () => {
    expect(
      FoiaAgencyContactUpdateRequestSchema.safeParse({ foiaEmail: 'bad' }).success,
    ).toBe(false);
  });
});

describe('FoiaAgencyContactItemSchema', () => {
  it('accepts a bounced contact flagged as no longer accepting email', () => {
    const { success } = FoiaAgencyContactItemSchema.safeParse({
      orgId: 'org-1',
      agencyKey: 'DEPT OF THE ARMY',
      agencyName: 'Dept. of the Army',
      foiaEmail: 'foia@army.mil',
      foiaAddress: '1000 Army Pentagon',
      acceptsEmail: false,
      lastBounceReason: 'smtp; 550 5.1.1 user unknown',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(success).toBe(true);
  });

  it('requires an agencyKey', () => {
    const { success } = FoiaAgencyContactItemSchema.safeParse({
      orgId: 'org-1',
      agencyName: 'Dept. of the Army',
    });

    expect(success).toBe(false);
  });
});

describe('ConfirmFoiaRecipientSchema', () => {
  const valid = {
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    foiaEmail: 'foia@army.mil',
    foiaAddress: '1000 Army Pentagon, Washington, DC 20310',
  };

  it('defaults to saving the confirmed address to the directory', () => {
    const { success, data } = ConfirmFoiaRecipientSchema.safeParse(valid);

    expect(success).toBe(true);
    // Saving by default is what makes the fallback chain strengthen with use.
    expect(data?.saveToDirectory).toBe(true);
  });

  it('allows opting out of saving', () => {
    const { data } = ConfirmFoiaRecipientSchema.safeParse({ ...valid, saveToDirectory: false });

    expect(data?.saveToDirectory).toBe(false);
  });

  it('requires a valid email — this address receives a legal request', () => {
    expect(ConfirmFoiaRecipientSchema.safeParse({ ...valid, foiaEmail: 'nope' }).success).toBe(false);
  });

  it('requires a mailing address', () => {
    expect(ConfirmFoiaRecipientSchema.safeParse({ ...valid, foiaAddress: '  ' }).success).toBe(false);
  });

  it('requires the full opportunity identity', () => {
    const { oppId: _oppId, ...withoutOpp } = valid;

    expect(ConfirmFoiaRecipientSchema.safeParse(withoutOpp).success).toBe(false);
  });
});
