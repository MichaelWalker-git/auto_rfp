import { fireEvent, render, screen } from '@testing-library/react';
import { OrganizationCard } from '../OrganizationCard';
import type { OrganizationItem } from '@auto-rfp/core';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
}));

jest.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ permissions: ['org:edit', 'org:delete'] }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ setCurrentOrganization: jest.fn() }),
}));

jest.mock('@/components/organizations/CreateEditOrganizationDialog', () => ({
  CreateEditOrganizationDialog: () => null,
}));

// Mock Next.js Link. onClick is forwarded so a click that bubbles up from a
// card action reaches the link handler, exactly as it would in the browser.
const linkClick = jest.fn();
jest.mock('next/link', () => {
  return ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      onClick={(e) => {
        linkClick(e);
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
});

describe('OrganizationCard', () => {
  const organization = {
    id: 'org-1',
    name: 'Acme',
    description: 'An org',
  } as unknown as OrganizationItem;

  beforeEach(() => {
    mockPush.mockClear();
    linkClick.mockClear();
  });

  it('links to the organization page', () => {
    render(<OrganizationCard organization={organization} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/organizations/org-1');
  });

  it('opens the delete flow without navigating into the organization', () => {
    const onDelete = jest.fn();
    render(<OrganizationCard organization={organization} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove organization' }));

    expect(onDelete).toHaveBeenCalledWith(organization);
    expect(mockPush).not.toHaveBeenCalled();
    expect(linkClick).not.toHaveBeenCalled();
  });

  it('navigates into the organization when the card body is clicked', () => {
    render(<OrganizationCard organization={organization} onDelete={jest.fn()} />);

    fireEvent.click(screen.getByText('Acme'));

    expect(linkClick).toHaveBeenCalled();
  });
});
