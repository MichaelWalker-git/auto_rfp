import { render, screen } from '@testing-library/react';
import { DisclosureBadge } from '../DisclosureBadge';

describe('DisclosureBadge', () => {
  it('renders a muted marker for NAMEABLE by default (distinct from unreviewed)', () => {
    render(<DisclosureBadge level="NAMEABLE" />);
    expect(screen.getByText('Nameable')).toBeTruthy();
  });

  it('renders nothing for NAMEABLE when showNameable is false', () => {
    const { container } = render(<DisclosureBadge level="NAMEABLE" showNameable={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a warning for ANONYMIZED_ONLY', () => {
    render(<DisclosureBadge level="ANONYMIZED_ONLY" />);
    expect(screen.getByText('Anonymize')).toBeTruthy();
  });

  it('renders a permission-required warning', () => {
    render(<DisclosureBadge level="PERMISSION_REQUIRED" />);
    expect(screen.getByText('Permission required')).toBeTruthy();
  });

  it('renders a destructive Do not use badge', () => {
    render(<DisclosureBadge level="DO_NOT_USE" />);
    expect(screen.getByText('Do not use')).toBeTruthy();
  });
});
