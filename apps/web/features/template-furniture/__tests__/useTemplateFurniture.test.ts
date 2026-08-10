import { act, renderHook } from '@testing-library/react';
import { TemplateFurnitureSchema } from '@auto-rfp/core';
import { useTemplateFurniture } from '../hooks/useTemplateFurniture';

describe('useTemplateFurniture', () => {
  it('starts empty, and sends undefined so a template gains no furniture', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    // Guards the regression path: saving an untouched template must not attach an
    // empty header/footer, which would change its exported output.
    expect(result.current.toPayload()).toBeUndefined();
  });

  it('hydrates from an existing template', () => {
    const saved = TemplateFurnitureSchema.parse({ header: { html: '<p>ACME</p>' } });
    const { result } = renderHook(() => useTemplateFurniture(saved));
    expect(result.current.furniture.header.html).toBe('<p>ACME</p>');
  });

  it('returns a payload once header content exists', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateHeader({ html: '<p>ACME</p>' }));
    expect(result.current.toPayload()?.header.html).toBe('<p>ACME</p>');
  });

  it('ignores whitespace-only content', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateHeader({ html: '   ' }));
    expect(result.current.toPayload()).toBeUndefined();
  });

  it('updates alignment and band height independently', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateFooter({ html: '<p>F</p>', align: 'RIGHT', heightIn: 0.75 }));
    expect(result.current.furniture.footer.align).toBe('RIGHT');
    expect(result.current.furniture.footer.heightIn).toBe(0.75);
    // The header must be untouched, and keeps its own LEFT default.
    expect(result.current.furniture.header.align).toBe('LEFT');
  });

  it('starts with the professional defaults: header left, footer centred', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    expect(result.current.furniture.header.align).toBe('LEFT');
    expect(result.current.furniture.footer.align).toBe('CENTER');
  });

  it('defaults every section to visible', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    expect(result.current.sectionVisibility(0)).toEqual({ showHeader: true, showFooter: true });
    expect(result.current.sectionVisibility(5)).toEqual({ showHeader: true, showFooter: true });
  });

  it('records a suppression override', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateHeader({ html: '<p>H</p>' }));
    act(() => result.current.setSectionOverride(0, { showHeader: false }));

    expect(result.current.sectionVisibility(0).showHeader).toBe(false);
    expect(result.current.sectionVisibility(1).showHeader).toBe(true);
    expect(result.current.toPayload()?.sectionOverrides).toEqual([
      { sectionIndex: 0, showHeader: false },
    ]);
  });

  it('drops an override once it no longer differs from the default', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateHeader({ html: '<p>H</p>' }));
    act(() => result.current.setSectionOverride(0, { showHeader: false }));
    act(() => result.current.setSectionOverride(0, { showHeader: true }));

    // Redundant overrides would force the export onto its multi-section path for
    // no reason, which costs list-numbering and TOC fidelity in Word.
    expect(result.current.toPayload()?.sectionOverrides).toEqual([]);
  });

  it('keeps overrides sorted by section index', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateHeader({ html: '<p>H</p>' }));
    act(() => result.current.setSectionOverride(3, { showHeader: false }));
    act(() => result.current.setSectionOverride(1, { showHeader: false }));

    expect(result.current.toPayload()?.sectionOverrides.map((o) => o.sectionIndex)).toEqual([1, 3]);
  });

  it('merges a second field into an existing override', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    act(() => result.current.updateHeader({ html: '<p>H</p>' }));
    act(() => result.current.setSectionOverride(0, { showHeader: false }));
    act(() => result.current.setSectionOverride(0, { showFooter: false }));

    expect(result.current.sectionVisibility(0)).toEqual({ showHeader: false, showFooter: false });
    expect(result.current.toPayload()?.sectionOverrides).toHaveLength(1);
  });

  it('resets to empty when handed undefined', () => {
    const saved = TemplateFurnitureSchema.parse({ header: { html: '<p>ACME</p>' } });
    const { result } = renderHook(() => useTemplateFurniture(saved));
    act(() => result.current.setFurniture(undefined));
    expect(result.current.toPayload()).toBeUndefined();
  });
});
