import { describe, expect, it } from 'vitest';

import {
  ConfirmFoiaRecipientSchema,
  UpdateFoiaCustomDocumentsSchema,
  FoiaAgencyContactCreateRequestSchema,
  FoiaAgencyContactItemSchema,
  FoiaAgencyContactUpdateRequestSchema,
  normalizeAgencyKey,
} from './foia-agency-contact';
import { normalizeAgencyTitle } from './foia-component';

describe('normalizeAgencyKey', () => {
  it('collapses the common spellings of one agency to a single key', () => {
    // Real-world variants from solicitation feeds — including the expanded
    // "Department" spelling, so a directory entry confirmed against one feed's
    // wording still matches another's.
    const variants = [
      'DEPT OF THE ARMY',
      'Dept. of the Army',
      '  dept of the army ',
      'Dept  of  the  Army',
      'DEPT. OF THE ARMY.',
      'Department of the Army',
      'DEPARTMENT OF THE ARMY',
    ];

    const keys = new Set(variants.map(normalizeAgencyKey));

    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('DEPARTMENT OF THE ARMY');
  });

  it('matches the FOIA.gov matcher byte-for-byte', () => {
    // The directory key and the component match key must agree, or a confirmed
    // address silently stops applying when the feed changes its wording.
    for (const name of ['DEPT OF THE NAVY', 'STATE, DEPARTMENT OF', 'U.S. Coast Guard']) {
      expect(normalizeAgencyKey(name)).toBe(normalizeAgencyTitle(name));
    }
  });

  it('uppercases', () => {
    expect(normalizeAgencyKey('general services administration')).toBe(
      'GENERAL SERVICES ADMINISTRATION',
    );
  });

  it('strips punctuation and folds U.S. to a single token', () => {
    expect(normalizeAgencyKey('U.S. Dept. of Energy')).toBe('US DEPARTMENT OF ENERGY');
  });

  it('collapses runs of whitespace including tabs and newlines', () => {
    expect(normalizeAgencyKey('DEPT\tOF\nTHE  NAVY')).toBe('DEPARTMENT OF THE NAVY');
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

  /**
   * `.url()` alone does NOT cover these: zod 3.25 accepts every one of them, because it
   * validates URL syntax and not the scheme. The value is rendered into an anchor's
   * `href`, where `javascript:` executes on click, so the refinement is load-bearing —
   * this test fails if someone simplifies the field back to a bare `.url()`.
   */
  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('rejects a non-http(s) portal URL: %s', (webPortalUrl) => {
    const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({ ...valid, webPortalUrl });

    expect(success).toBe(false);
  });

  it.each(['https://records.example.gov/request', 'http://records.example.gov'])(
    'still accepts %s',
    (webPortalUrl) => {
      const { success } = FoiaAgencyContactCreateRequestSchema.safeParse({ ...valid, webPortalUrl });

      expect(success).toBe(true);
    },
  );

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

describe('UpdateFoiaCustomDocumentsSchema', () => {
  const valid = {
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    customDocumentRequests: ['Section 4.3 individual evaluator scoresheets'],
  };

  it('accepts a valid payload', () => {
    const { success, data } = UpdateFoiaCustomDocumentsSchema.safeParse(valid);

    expect(success).toBe(true);
    expect(data?.customDocumentRequests).toEqual([
      'Section 4.3 individual evaluator scoresheets',
    ]);
  });

  it('accepts an empty array — clearing the list is meaningful', () => {
    const { success, data } = UpdateFoiaCustomDocumentsSchema.safeParse({
      ...valid,
      customDocumentRequests: [],
    });

    expect(success).toBe(true);
    expect(data?.customDocumentRequests).toEqual([]);
  });

  it('trims entries', () => {
    const { data } = UpdateFoiaCustomDocumentsSchema.safeParse({
      ...valid,
      customDocumentRequests: ['  Bid tabulation  '],
    });

    expect(data?.customDocumentRequests).toEqual(['Bid tabulation']);
  });

  it('rejects a whitespace-only entry', () => {
    expect(
      UpdateFoiaCustomDocumentsSchema.safeParse({
        ...valid,
        customDocumentRequests: ['   '],
      }).success,
    ).toBe(false);
  });

  it('rejects more than 25 entries — a huge list invites a burdensome denial', () => {
    expect(
      UpdateFoiaCustomDocumentsSchema.safeParse({
        ...valid,
        customDocumentRequests: Array.from({ length: 26 }, (_, i) => `doc ${i}`),
      }).success,
    ).toBe(false);
  });

  it('allows exactly 25 entries', () => {
    expect(
      UpdateFoiaCustomDocumentsSchema.safeParse({
        ...valid,
        customDocumentRequests: Array.from({ length: 25 }, (_, i) => `doc ${i}`),
      }).success,
    ).toBe(true);
  });

  it('rejects an entry over 500 characters', () => {
    expect(
      UpdateFoiaCustomDocumentsSchema.safeParse({
        ...valid,
        customDocumentRequests: ['x'.repeat(501)],
      }).success,
    ).toBe(false);
  });

  it('requires the full opportunity identity', () => {
    const { oppId: _oppId, ...withoutOpp } = valid;

    expect(UpdateFoiaCustomDocumentsSchema.safeParse(withoutOpp).success).toBe(false);
  });

  it('requires the list to be present — an omitted field is not an empty list', () => {
    const { customDocumentRequests: _c, ...withoutList } = valid;

    expect(UpdateFoiaCustomDocumentsSchema.safeParse(withoutList).success).toBe(false);
  });
});
