import { describe, it, expect } from 'vitest';
import {
  PageFurnitureSchema,
  TemplateFurnitureSchema,
  TemplateItemSchema,
  CreateTemplateDTOSchema,
  UpdateTemplateDTOSchema,
  RESERVED_PAGE_TOKENS,
  isReservedPageToken,
  resolveFurnitureVisibility,
  SYSTEM_MACROS,
  type TemplateFurniture,
} from './index';

// A minimal valid template item, so furniture assertions aren't drowned in fixture noise.
const baseItem = {
  id: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  name: 'Cover Letter',
  category: 'COVER_LETTER',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  createdBy: '33333333-3333-3333-3333-333333333333',
};

describe('PageFurnitureSchema', () => {
  it('applies defaults so an empty object is a usable header', () => {
    const { success, data } = PageFurnitureSchema.safeParse({});
    expect(success).toBe(true);
    expect(data).toEqual({ enabled: true, html: '', align: 'CENTER', heightIn: 0.5 });
  });

  it('accepts HTML content including an s3key image reference', () => {
    const html = '<p><img src="s3key:org-1/logo.png" data-s3-key="org-1/logo.png"></p>';
    const { success, data } = PageFurnitureSchema.safeParse({ html });
    expect(success).toBe(true);
    expect(data?.html).toBe(html);
  });

  it('rejects a negative band height, which would pull margins inward', () => {
    expect(PageFurnitureSchema.safeParse({ heightIn: -1 }).success).toBe(false);
  });

  it('rejects a band height taller than the cap', () => {
    expect(PageFurnitureSchema.safeParse({ heightIn: 4 }).success).toBe(false);
  });

  it('rejects an unknown alignment', () => {
    expect(PageFurnitureSchema.safeParse({ align: 'JUSTIFY' }).success).toBe(false);
  });
});

describe('TemplateFurnitureSchema', () => {
  it('defaults both header and footer and starts with no overrides', () => {
    const { success, data } = TemplateFurnitureSchema.safeParse({});
    expect(success).toBe(true);
    // "Default behavior applies both header and footer to all pages unless overridden."
    expect(data?.sectionOverrides).toEqual([]);
    expect(data?.header.enabled).toBe(true);
    expect(data?.footer.enabled).toBe(true);
  });

  it('defaults the header to LEFT, the professional convention for branding', () => {
    // Western reading order puts the eye top-left, which is where a logo belongs
    // in an RFP response. A centred logo reads as a title page.
    expect(TemplateFurnitureSchema.parse({}).header.align).toBe('LEFT');
  });

  it('defaults the footer to CENTER, matching our own brief export', () => {
    // Evaluators track a fixed centre point when flipping pages, and government
    // formatting instructions frequently mandate centred page numbers.
    expect(TemplateFurnitureSchema.parse({}).footer.align).toBe('CENTER');
  });

  it('still honours an explicit alignment over the per-band default', () => {
    const parsed = TemplateFurnitureSchema.parse({ header: { align: 'RIGHT' } });
    expect(parsed.header.align).toBe('RIGHT');
  });

  it('caps sectionOverrides to guard the DynamoDB item size', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ sectionIndex: i }));
    expect(TemplateFurnitureSchema.safeParse({ sectionOverrides: tooMany }).success).toBe(false);
  });

  it('rejects a negative sectionIndex', () => {
    expect(
      TemplateFurnitureSchema.safeParse({ sectionOverrides: [{ sectionIndex: -1 }] }).success,
    ).toBe(false);
  });
});

describe('furniture on template schemas', () => {
  it('is optional on TemplateItem — absent means no header/footer at all', () => {
    const { success, data } = TemplateItemSchema.safeParse(baseItem);
    expect(success).toBe(true);
    // Regression guard: pre-existing templates must not gain furniture implicitly,
    // otherwise every existing template's export output would change.
    expect(data?.furniture).toBeUndefined();
  });

  it('round-trips furniture through TemplateItem', () => {
    const { success, data } = TemplateItemSchema.safeParse({
      ...baseItem,
      furniture: { header: { html: '<p>ACME</p>' }, footer: { html: '<p>{{PAGE_NUMBER}}</p>' } },
    });
    expect(success).toBe(true);
    expect(data?.furniture?.header.html).toBe('<p>ACME</p>');
    expect(data?.furniture?.footer.html).toBe('<p>{{PAGE_NUMBER}}</p>');
  });

  it('is accepted by the create DTO', () => {
    const { success, data } = CreateTemplateDTOSchema.safeParse({
      orgId: baseItem.orgId,
      name: 'T',
      category: 'CUSTOM',
      furniture: { header: { html: '<p>H</p>', align: 'LEFT' } },
    });
    expect(success).toBe(true);
    expect(data?.furniture?.header.align).toBe('LEFT');
  });

  it('is accepted by the update DTO, and stays undefined when omitted', () => {
    const { success, data } = UpdateTemplateDTOSchema.safeParse({ name: 'Renamed' });
    expect(success).toBe(true);
    // The update handler distinguishes "omitted" from "cleared"; an implicit
    // default here would silently wipe a saved header on any unrelated PATCH.
    expect(data?.furniture).toBeUndefined();
  });
});

describe('reserved page tokens', () => {
  it('treats PAGE_NUMBER and TOTAL_PAGES as reserved', () => {
    expect(isReservedPageToken('PAGE_NUMBER')).toBe(true);
    expect(isReservedPageToken('TOTAL_PAGES')).toBe(true);
  });

  it('does not reserve ordinary macros', () => {
    expect(isReservedPageToken('COMPANY_NAME')).toBe(false);
    expect(isReservedPageToken('TODAY')).toBe(false);
  });

  it('exposes every reserved token as a SYSTEM macro for editor discoverability', () => {
    const keys = SYSTEM_MACROS.map((m) => m.key);
    for (const token of RESERVED_PAGE_TOKENS) expect(keys).toContain(token);
  });
});

describe('resolveFurnitureVisibility', () => {
  const furniture = (over: Partial<TemplateFurniture> = {}): TemplateFurniture =>
    TemplateFurnitureSchema.parse({
      header: { html: '<p>H</p>' },
      footer: { html: '<p>F</p>' },
      ...over,
    });

  it('hides everything when furniture is absent', () => {
    expect(resolveFurnitureVisibility(undefined, 0)).toEqual({
      showHeader: false,
      showFooter: false,
    });
  });

  it('shows both on every section when there are no overrides', () => {
    const f = furniture();
    for (const i of [0, 1, 7]) {
      expect(resolveFurnitureVisibility(f, i)).toEqual({ showHeader: true, showFooter: true });
    }
  });

  it('suppresses the header on a cover section without affecting later sections', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    expect(resolveFurnitureVisibility(f, 0)).toEqual({ showHeader: false, showFooter: true });
    expect(resolveFurnitureVisibility(f, 1)).toEqual({ showHeader: true, showFooter: true });
  });

  it('suppresses the footer on an appendix section only', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 2, showFooter: false }] });
    expect(resolveFurnitureVisibility(f, 2)).toEqual({ showHeader: true, showFooter: false });
    expect(resolveFurnitureVisibility(f, 1)).toEqual({ showHeader: true, showFooter: true });
  });

  it('treats an omitted override field as inherit, not as false', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showFooter: false }] });
    expect(resolveFurnitureVisibility(f, 0).showHeader).toBe(true);
  });

  it('hides a disabled header even where an override asks to show it', () => {
    const f = furniture({
      header: { enabled: false, html: '<p>H</p>', align: 'CENTER', heightIn: 0.5 },
      sectionOverrides: [{ sectionIndex: 0, showHeader: true }],
    });
    expect(resolveFurnitureVisibility(f, 0).showHeader).toBe(false);
  });

  it('hides furniture that is enabled but has no content', () => {
    // Otherwise an enabled-but-blank header would reserve margin space and push
    // the body down for no visible reason.
    const f = furniture({ header: { enabled: true, html: '   ', align: 'CENTER', heightIn: 0.5 } });
    expect(resolveFurnitureVisibility(f, 0).showHeader).toBe(false);
    expect(resolveFurnitureVisibility(f, 0).showFooter).toBe(true);
  });
});
