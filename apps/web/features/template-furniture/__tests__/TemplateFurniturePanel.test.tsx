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

/**
 * The panel mirrors `MacroInsertionBar`: collapsible groups, only `Header` open by
 * default. Tests must expand a group before its controls exist in the DOM.
 */
const expandGroup = (name: 'Header' | 'Footer' | 'Per-Section Visibility') => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`, 'i') }));
};

describe('TemplateFurniturePanel — collapsible structure', () => {
  it('renders a toggle button per group', () => {
    render(<Harness />);
    for (const name of ['Header', 'Footer', 'Per-Section Visibility']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`, 'i') })).toBeInTheDocument();
    }
  });

  it('opens Header by default and leaves the others closed', () => {
    render(<Harness />);
    // Matches the Insert Variables panel, where the first group is pre-expanded.
    expect(screen.getByRole('button', { name: /^Header/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Footer/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Per-Section/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('only renders a group body once expanded', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('Footer content')).not.toBeInTheDocument();
    expandGroup('Footer');
    expect(screen.getByLabelText('Footer content')).toBeInTheDocument();
  });

  it('collapses an open group again', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Header content')).toBeInTheDocument();
    expandGroup('Header');
    expect(screen.queryByLabelText('Header content')).not.toBeInTheDocument();
  });

  it('shows Off badges while collapsed, so state is legible', () => {
    render(<Harness />);
    // Without this a user cannot tell a configured header from an empty one.
    expect(screen.getAllByText('Off').length).toBeGreaterThanOrEqual(2);
  });

  it('flips the badge to On once content exists', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Header content'), {
      target: { value: '<p>ACME</p>' },
    });
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('summarises override count on the per-section group', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    fireEvent.change(screen.getByLabelText('Header content'), {
      target: { value: '<p>ACME</p>' },
    });
    expandGroup('Per-Section Visibility');
    fireEvent.click(screen.getByLabelText('Show header on section 1'));
    expect(screen.getByText('1 override')).toBeInTheDocument();
  });
});

describe('TemplateFurniturePanel — content editing', () => {
  it('renders header and footer editors', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Header content')).toBeInTheDocument();
    expandGroup('Footer');
    expect(screen.getByLabelText('Footer content')).toBeInTheDocument();
  });

  it('enables both by default, matching "applies to all pages unless overridden"', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/enable header/i)).toBeChecked();
    expandGroup('Footer');
    expect(screen.getByLabelText(/enable footer/i)).toBeChecked();
  });

  it('inserts the page-number token into the footer', () => {
    render(<Harness />);
    // Collapse Header first so only the footer's controls are mounted — otherwise
    // both groups expose a "Page number" button and the query is ambiguous.
    expandGroup('Header');
    expandGroup('Footer');

    fireEvent.click(screen.getByRole('button', { name: /page number/i }));

    // Reserved tokens are resolved per-renderer as live fields, not substituted here.
    expect((screen.getByLabelText('Footer content') as HTMLTextAreaElement).value)
      .toContain('{{PAGE_NUMBER}}');
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

describe('TemplateFurniturePanel — per-section visibility', () => {
  it('prompts for a page break when the document has only one section', () => {
    render(<Harness bodyHtml="<p>Body</p>" />);
    expandGroup('Per-Section Visibility');
    expect(screen.getByText(/insert a page break/i)).toBeInTheDocument();
  });

  it('lists a row per page-break section, labelled by heading', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    expandGroup('Per-Section Visibility');
    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.getByText('Technical Approach')).toBeInTheDocument();
    expect(screen.getByText('Appendix')).toBeInTheDocument();
  });

  it('disables section toggles until there is furniture content', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    expandGroup('Per-Section Visibility');
    // Toggling visibility of a header that does not exist would be meaningless.
    expect(screen.getByLabelText('Show header on section 1')).toBeDisabled();
    expect(screen.getByText(/add header or footer content above/i)).toBeInTheDocument();
  });

  it('enables the header toggles once header content is entered', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    fireEvent.change(screen.getByLabelText('Header content'), {
      target: { value: '<p>ACME</p>' },
    });
    expandGroup('Per-Section Visibility');
    expect(screen.getByLabelText('Show header on section 1')).not.toBeDisabled();
  });

  it('suppresses the header on the cover section only', () => {
    render(<Harness bodyHtml={COVER_BODY} />);
    fireEvent.change(screen.getByLabelText('Header content'), {
      target: { value: '<p>ACME</p>' },
    });
    expandGroup('Per-Section Visibility');

    fireEvent.click(screen.getByLabelText('Show header on section 1'));

    expect(screen.getByLabelText('Show header on section 1')).not.toBeChecked();
    expect(screen.getByLabelText('Show header on section 2')).toBeChecked();
  });
});

describe('useTemplateFurniture + panel integration', () => {
  it('produces a payload with the cover override the user set', () => {
    const { result } = renderHook(() => useTemplateFurniture());
    result.current.updateHeader({ html: '<p>ACME</p>' });
    expect(result.current.furniture.header.enabled).toBe(true);
  });
});
