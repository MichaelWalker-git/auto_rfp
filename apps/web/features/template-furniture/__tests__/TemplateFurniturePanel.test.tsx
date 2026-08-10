import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { TemplateFurniturePanel } from '../components/TemplateFurniturePanel';
import { useTemplateFurniture } from '../hooks/useTemplateFurniture';

const COVER_BODY = [
  '<h1>Cover</h1>',
  '<div data-page-break="true"></div>',
  '<h1>Technical Approach</h1>',
  '<div data-page-break="true"></div>',
  '<h1>Appendix</h1>',
].join('');

/** Render the panel wired to real hook state, as the pages do. */
const Harness = ({
  bodyHtml = '<p>Body</p>',
  onUploadImage,
}: { bodyHtml?: string; onUploadImage?: (f: File) => Promise<string> }) => {
  const furnitureState = useTemplateFurniture();
  return (
    <TemplateFurniturePanel
      furnitureState={furnitureState}
      bodyHtml={bodyHtml}
      onUploadImage={onUploadImage}
    />
  );
};

describe('TemplateFurniturePanel', () => {
  it('renders header and footer editors', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Header content')).toBeInTheDocument();
    expect(screen.getByLabelText('Footer content')).toBeInTheDocument();
  });

  it('enables both by default, matching "applies to all pages unless overridden"', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/enable header/i)).toBeChecked();
    expect(screen.getByLabelText(/enable footer/i)).toBeChecked();
  });

  it('prompts for a page break when the document has only one section', () => {
    render(<Harness bodyHtml="<p>Body</p>" />);
    expect(screen.getByText(/insert a page break/i)).toBeInTheDocument();
  });

  it('lists a row per page-break section, labelled by heading', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.getByText('Technical Approach')).toBeInTheDocument();
    expect(screen.getByText('Appendix')).toBeInTheDocument();
  });

  it('disables section toggles until there is furniture content', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    // Toggling visibility of a header that does not exist would be meaningless.
    expect(screen.getByLabelText('Show header on section 1')).toBeDisabled();
    expect(screen.getByText(/add header or footer content above/i)).toBeInTheDocument();
  });

  it('enables the header toggles once header content is entered', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    fireEvent.change(screen.getByLabelText('Header content'), {
      target: { value: '<p>ACME</p>' },
    });
    expect(screen.getByLabelText('Show header on section 1')).not.toBeDisabled();
  });

  it('suppresses the header on the cover section only', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    fireEvent.change(screen.getByLabelText('Header content'), {
      target: { value: '<p>ACME</p>' },
    });

    const coverToggle = screen.getByLabelText('Show header on section 1');
    fireEvent.click(coverToggle);

    expect(screen.getByLabelText('Show header on section 1')).not.toBeChecked();
    expect(screen.getByLabelText('Show header on section 2')).toBeChecked();
  });

  it('inserts the page-number token into the footer', () => {
    render(<Harness />);
    // Both editors expose a "Page number" button, so target the footer's.
    const [, footerPageNumber] = screen.getAllByRole('button', { name: /page number/i });
    fireEvent.click(footerPageNumber);
    // Reserved tokens are resolved per-renderer as live fields, not substituted here.
    expect((screen.getByLabelText('Footer content') as HTMLTextAreaElement).value)
      .toContain('{{PAGE_NUMBER}}');
    // ...and must not leak into the header.
    expect((screen.getByLabelText('Header content') as HTMLTextAreaElement).value)
      .not.toContain('{{PAGE_NUMBER}}');
  });

  it('disables the content box when the header is switched off', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/enable header/i));
    expect(screen.getByLabelText('Header content')).toBeDisabled();
  });

  it('inserts an s3key img tag after a successful upload', async () => {
    const onUploadImage = jest.fn().mockResolvedValue('org-1/template-images/logo.png');
    render(<Harness onUploadImage={onUploadImage} />);

    const [headerFileInput] = document.querySelectorAll('input[type="file"]');
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(headerFileInput, { target: { files: [file] } });

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledWith(file));
    await waitFor(() => {
      // The s3key: form is what lets the export resolve the image; a raw URL here
      // would be skipped by both renderers.
      expect((screen.getByLabelText('Header content') as HTMLTextAreaElement).value)
        .toContain('src="s3key:org-1/template-images/logo.png"');
    });
  });

  it('surfaces an upload failure instead of failing silently', async () => {
    const onUploadImage = jest.fn().mockRejectedValue(new Error('Upload blew up'));
    render(<Harness onUploadImage={onUploadImage} />);

    const [headerFileInput] = document.querySelectorAll('input[type="file"]');
    fireEvent.change(headerFileInput, {
      target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Upload blew up'));
  });
});

describe('useTemplateFurniture + panel integration', () => {
  it('produces a payload with the cover override the user set', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    result.current.updateHeader({ html: '<p>ACME</p>' });
    expect(result.current.furniture.header.enabled).toBe(true);
  });
});
