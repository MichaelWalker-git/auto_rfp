import { render, screen, waitFor, act } from '@testing-library/react';
import { PageFurnitureSchema, type PageFurniture } from '@auto-rfp/core';
import { FurniturePreview } from '../components/FurniturePreview';

const band = (over: Partial<PageFurniture> = {}): PageFurniture =>
  PageFurnitureSchema.parse(over);

const content = () => screen.getByTestId('furniture-preview-content');

/** The preview debounces presign requests by 300 ms. */
const flushDebounce = async () => {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('FurniturePreview — image resolution', () => {
  it('resolves an s3key reference to a viewable URL', async () => {
    const onGetDownloadUrl = jest.fn().mockResolvedValue('https://signed.example/logo.png');
    render(
      <FurniturePreview
        value={band({ html: '<img src="s3key:org/logo.png">' })}
        onGetDownloadUrl={onGetDownloadUrl}
      />,
    );

    await flushDebounce();
    await waitFor(() => expect(onGetDownloadUrl).toHaveBeenCalledWith('org/logo.png'));
    await waitFor(() =>
      expect(content().querySelector('img')?.getAttribute('src')).toBe('https://signed.example/logo.png'),
    );
  });

  it('never renders the raw s3key: scheme, which a browser cannot load', async () => {
    const onGetDownloadUrl = jest.fn().mockResolvedValue('https://signed.example/logo.png');
    render(
      <FurniturePreview
        value={band({ html: '<img src="s3key:org/logo.png">' })}
        onGetDownloadUrl={onGetDownloadUrl}
      />,
    );
    await flushDebounce();
    await waitFor(() => expect(content().innerHTML).not.toContain('s3key:'));
  });

  it('requests each distinct key once, not per render', async () => {
    const onGetDownloadUrl = jest.fn().mockResolvedValue('https://signed.example/a.png');
    const value = band({ html: '<img src="s3key:a.png"><img src="s3key:a.png">' });
    const { rerender } = render(
      <FurniturePreview value={value} onGetDownloadUrl={onGetDownloadUrl} />,
    );
    await flushDebounce();
    rerender(<FurniturePreview value={value} onGetDownloadUrl={onGetDownloadUrl} />);
    await flushDebounce();

    // A naive effect would presign on every keystroke and every re-render.
    expect(onGetDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('marks an image whose resolution failed, rather than showing a blank', async () => {
    const onGetDownloadUrl = jest.fn().mockRejectedValue(new Error('AccessDenied'));
    render(
      <FurniturePreview
        value={band({ html: '<img src="s3key:org/missing.png">' })}
        onGetDownloadUrl={onGetDownloadUrl}
      />,
    );
    await flushDebounce();
    // A styled stub, not an <img src="">, which browsers draw as a broken-image
    // glyph and reads as an error rather than a pending state.
    await waitFor(() =>
      expect(content().querySelector('.furniture-img-stub[data-state="failed"]')).toBeInTheDocument(),
    );
    expect(content().querySelector('img')).not.toBeInTheDocument();
  });

  it('does not call the resolver when there are no images', async () => {
    const onGetDownloadUrl = jest.fn();
    render(
      <FurniturePreview value={band({ html: '<p>Just text</p>' })} onGetDownloadUrl={onGetDownloadUrl} />,
    );
    await flushDebounce();
    expect(onGetDownloadUrl).not.toHaveBeenCalled();
  });

  it('renders without a resolver, showing a pending stub rather than a broken image', () => {
    render(<FurniturePreview value={band({ html: '<img src="s3key:org/logo.png">' })} />);
    expect(content().querySelector('.furniture-img-stub[data-state="loading"]')).toBeInTheDocument();
    // Never emit an <img> with an empty src — that renders as the browser's "?" glyph.
    expect(content().querySelector('img')).not.toBeInTheDocument();
  });

  it('never emits an img with an empty src', () => {
    render(<FurniturePreview value={band({ html: '<img src="s3key:a.png"><img src="s3key:b.png">' })} />);
    expect(content().innerHTML).not.toContain('src=""');
  });
});

describe('FurniturePreview — macro chips', () => {
  it('renders a macro as a labelled chip, not raw braces', () => {
    render(<FurniturePreview value={band({ html: '<p>{{COMPANY_NAME}}</p>' })} />);
    expect(content().innerHTML).not.toContain('{{COMPANY_NAME}}');
    expect(screen.getByText('‹COMPANY NAME›')).toBeInTheDocument();
  });

  it('marks page tokens as computed per page', () => {
    // These cannot show a fixed value — the renderer resolves them at print time.
    render(<FurniturePreview value={band({ html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' })} />);
    expect(screen.getByText('‹#›')).toBeInTheDocument();
    expect(screen.getByText('‹##›')).toBeInTheDocument();
  });

  it('keeps literal text around a chip', () => {
    render(<FurniturePreview value={band({ html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' })} />);
    expect(content().textContent).toContain('Page');
    expect(content().textContent).toContain('of');
  });

  it('tags each chip with its macro key for debugging', () => {
    render(<FurniturePreview value={band({ html: '{{PROPOSAL_TITLE}}' })} />);
    expect(content().querySelector('[data-macro="PROPOSAL_TITLE"]')).toBeInTheDocument();
  });
});

describe('FurniturePreview — safety', () => {
  it('strips a script tag from user-authored HTML', () => {
    // The content is rendered via dangerouslySetInnerHTML, so sanitisation is required.
    render(<FurniturePreview value={band({ html: '<script>window.__x=1</script><p>ok</p>' })} />);
    expect(content().innerHTML).not.toContain('<script');
    expect(content().textContent).toContain('ok');
  });

  it('strips an inline event handler', () => {
    render(<FurniturePreview value={band({ html: '<p onclick="window.__x=1">text</p>' })} />);
    expect(content().innerHTML).not.toContain('onclick');
  });
});

describe('FurniturePreview — layout fidelity', () => {
  it('applies the configured alignment', () => {
    render(<FurniturePreview value={band({ html: '<p>x</p>', align: 'RIGHT' })} />);
    expect(content()).toHaveStyle({ textAlign: 'right' });
  });

  it('caps image height to the band height', () => {
    // 0.5in at 96 DPI — an uncapped logo would overflow the band in the preview
    // while the PDF caps it, making the preview misleading.
    render(<FurniturePreview value={band({ html: '<img src="s3key:a.png">', heightIn: 0.5 })} />);
    expect(content().getAttribute('style')).toContain('48px');
  });

  it('scales the cap with a taller band', () => {
    render(<FurniturePreview value={band({ html: '<img src="s3key:a.png">', heightIn: 1 })} />);
    expect(content().getAttribute('style')).toContain('96px');
  });
});
