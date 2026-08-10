import { render, screen } from '@testing-library/react';
import { TemplateFurnitureSchema, type TemplateFurniture } from '@auto-rfp/core';
import { PageFurnitureOverlay } from '../components/PageFurnitureOverlay';

const furniture = (over: Partial<TemplateFurniture> = {}): TemplateFurniture =>
  TemplateFurnitureSchema.parse({
    header: { html: '<p>ACME Corp</p>' },
    footer: { html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' },
    ...over,
  });

const renderOverlay = (props: Partial<React.ComponentProps<typeof PageFurnitureOverlay>> = {}) =>
  render(
    <PageFurnitureOverlay
      furniture={furniture()}
      pageIndex={0}
      totalPages={3}
      sectionIndex={0}
      paddingY={72}
      paddingX={96}
      resolved={{}}
      failedKeys={{}}
      {...props}
    />,
  );

describe('PageFurnitureOverlay', () => {
  it('renders nothing without furniture, leaving existing documents untouched', () => {
    const { container } = renderOverlay({ furniture: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when both bands are empty', () => {
    const { container } = renderOverlay({ furniture: TemplateFurnitureSchema.parse({}) });
    expect(container).toBeEmptyDOMElement();
  });

  it('draws the header text into the page', () => {
    renderOverlay();
    expect(screen.getByText('ACME Corp')).toBeInTheDocument();
  });

  it('substitutes the REAL page numbers, the way Word displays them', () => {
    renderOverlay({ pageIndex: 1, totalPages: 3 });
    // The whole point of showing furniture on the page: it reads as the finished
    // document, not as a template with tokens in it.
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
  });

  it('shows page 1 of 1 for a single-page document', () => {
    renderOverlay({ pageIndex: 0, totalPages: 1 });
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
  });

  it('positions the header in the top margin and the footer in the bottom', () => {
    const { container } = renderOverlay();
    const bands = container.querySelectorAll('div[style]');
    const styles = [...bands].map((b) => b.getAttribute('style') ?? '');
    expect(styles.some((s) => s.includes('top:'))).toBe(true);
    expect(styles.some((s) => s.includes('bottom:'))).toBe(true);
  });

  it('honours a per-section header suppression', () => {
    renderOverlay({
      furniture: furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] }),
      sectionIndex: 0,
    });
    // Cover page: header hidden, footer still shown.
    expect(screen.queryByText('ACME Corp')).not.toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it('still shows the header on a section without an override', () => {
    renderOverlay({
      furniture: furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] }),
      sectionIndex: 1,
    });
    expect(screen.getByText('ACME Corp')).toBeInTheDocument();
  });

  it('honours a per-section footer suppression on an appendix', () => {
    renderOverlay({
      furniture: furniture({ sectionOverrides: [{ sectionIndex: 2, showFooter: false }] }),
      sectionIndex: 2,
    });
    expect(screen.getByText('ACME Corp')).toBeInTheDocument();
    expect(screen.queryByText(/Page 1 of 3/)).not.toBeInTheDocument();
  });

  it('hides a band that is disabled by its checkbox', () => {
    renderOverlay({
      furniture: furniture({
        header: { enabled: false, html: '<p>ACME Corp</p>', align: 'CENTER', heightIn: 0.5 },
      }),
    });
    expect(screen.queryByText('ACME Corp')).not.toBeInTheDocument();
  });

  it('renders a resolved image with its viewable URL', () => {
    const { container } = renderOverlay({
      furniture: furniture({
        header: { enabled: true, html: '<img src="s3key:org/logo.png">', align: 'CENTER', heightIn: 0.5 },
      }),
      resolved: { 'org/logo.png': 'https://signed.example/logo.png' },
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://signed.example/logo.png');
  });

  it('shows a pending stub rather than a broken image while resolving', () => {
    const { container } = renderOverlay({
      furniture: furniture({
        header: { enabled: true, html: '<img src="s3key:org/logo.png">', align: 'CENTER', heightIn: 0.5 },
      }),
    });
    expect(container.querySelector('.furniture-img-stub[data-state="loading"]')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('strips a script tag from user-authored furniture HTML', () => {
    const { container } = renderOverlay({
      furniture: furniture({
        header: { enabled: true, html: '<script>window.__x=1</script>Safe', align: 'CENTER', heightIn: 0.5 },
      }),
    });
    expect(container.innerHTML).not.toContain('<script');
    expect(container.textContent).toContain('Safe');
  });

  it('applies the configured alignment to the band', () => {
    const { container } = renderOverlay({
      furniture: furniture({
        header: { enabled: true, html: '<p>R</p>', align: 'RIGHT', heightIn: 0.5 },
      }),
    });
    expect(container.innerHTML).toContain('text-align: right');
  });

  it('leaves non-page macros as chips, since they resolve at generation time', () => {
    const { container } = renderOverlay({
      furniture: furniture({
        header: { enabled: true, html: '<p>{{COMPANY_NAME}}</p>', align: 'CENTER', heightIn: 0.5 },
      }),
    });
    expect(container.querySelector('[data-macro="COMPANY_NAME"]')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('{{COMPANY_NAME}}');
  });
});
