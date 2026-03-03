import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateEditOrganizationDialog } from '../CreateEditOrganizationDialog';
import type { OrganizationItem as Organization } from '@auto-rfp/core';

// Mock useToast
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

describe('CreateEditOrganizationDialog', () => {
  const mockOrganization: Organization = {
    id: 'org-123',
    name: 'Test Organization',
    slug: 'test-org',
    description: 'A test organization',
    aiProcessingEnabled: true,
    autoApprovalThreshold: 80,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    organizationUsers: [],
    projects: [],
    _count: {
      projects: 0,
      organizationUsers: 1,
    },
  };

  const defaultProps = {
    isOpen: true,
    onOpenChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('null safety - regression test for AUTO-RFP-5V/5W', () => {
    it('renders without crashing when formData is not provided', () => {
      render(<CreateEditOrganizationDialog {...defaultProps} />);

      expect(screen.getByLabelText('Organization Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
    });

    it('renders without crashing when organization is provided but formData is not', () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          organization={mockOrganization}
        />
      );

      expect(screen.getByLabelText('Organization Name')).toBeInTheDocument();
    });

    it('populates form with organization data when in edit mode without formData', async () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          organization={mockOrganization}
        />
      );

      await waitFor(() => {
        const nameInput = screen.getByLabelText('Organization Name') as HTMLInputElement;
        expect(nameInput.value).toBe('Test Organization');
      });
    });

    it('handles organization with undefined name gracefully', () => {
      const orgWithoutName = {
        ...mockOrganization,
        name: undefined as unknown as string,
      };

      // Should not throw
      expect(() => {
        render(
          <CreateEditOrganizationDialog
            {...defaultProps}
            organization={orgWithoutName}
          />
        );
      }).not.toThrow();
    });

    it('handles organization with null description gracefully', async () => {
      const orgWithNullDescription = {
        ...mockOrganization,
        description: null as unknown as string,
      };

      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          organization={orgWithNullDescription}
        />
      );

      await waitFor(() => {
        const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement;
        expect(descInput.value).toBe('');
      });
    });
  });

  describe('create mode', () => {
    it('shows "Create New Organization" title when no organization is provided', () => {
      render(<CreateEditOrganizationDialog {...defaultProps} />);

      expect(screen.getByText('Create New Organization')).toBeInTheDocument();
    });

    it('shows empty form fields in create mode', () => {
      render(<CreateEditOrganizationDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText('Organization Name') as HTMLInputElement;
      const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement;

      expect(nameInput.value).toBe('');
      expect(descInput.value).toBe('');
    });

    it('shows "Create Organization" button in create mode', () => {
      render(<CreateEditOrganizationDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Create Organization' })).toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('shows "Edit Organization" title when organization is provided', () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          organization={mockOrganization}
        />
      );

      expect(screen.getByText('Edit Organization')).toBeInTheDocument();
    });

    it('shows "Update Organization" button in edit mode', () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          organization={mockOrganization}
        />
      );

      expect(screen.getByRole('button', { name: 'Update Organization' })).toBeInTheDocument();
    });
  });

  describe('form interactions', () => {
    it('allows typing in the name field', async () => {
      const user = userEvent.setup();
      render(<CreateEditOrganizationDialog {...defaultProps} />);

      const nameInput = screen.getByLabelText('Organization Name');
      await user.type(nameInput, 'New Org Name');

      expect(nameInput).toHaveValue('New Org Name');
    });

    it('allows typing in the description field', async () => {
      const user = userEvent.setup();
      render(<CreateEditOrganizationDialog {...defaultProps} />);

      const descInput = screen.getByLabelText('Description');
      await user.type(descInput, 'New description');

      expect(descInput).toHaveValue('New description');
    });

    it('calls onOpenChange when Cancel is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = jest.fn();
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
        />
      );

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('external formData prop', () => {
    it('uses external formData when provided', () => {
      const externalFormData = {
        name: 'External Name',
        slug: 'external-slug',
        description: 'External description',
      };

      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          formData={externalFormData}
        />
      );

      const nameInput = screen.getByLabelText('Organization Name') as HTMLInputElement;
      expect(nameInput.value).toBe('External Name');
    });

    it('calls onFormChange when form changes with external handler', async () => {
      const user = userEvent.setup();
      const onFormChange = jest.fn();
      const externalFormData = {
        name: '',
        slug: '',
        description: '',
      };

      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          formData={externalFormData}
          onFormChange={onFormChange}
        />
      );

      const nameInput = screen.getByLabelText('Organization Name');
      await user.type(nameInput, 'T');

      expect(onFormChange).toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('shows loading spinner when isLoading is true', () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          isLoading={true}
        />
      );

      expect(screen.getByText('Creating...')).toBeInTheDocument();
    });

    it('shows "Updating..." when isLoading in edit mode', () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          isLoading={true}
          organization={mockOrganization}
        />
      );

      expect(screen.getByText('Updating...')).toBeInTheDocument();
    });

    it('disables Cancel button when loading', () => {
      render(
        <CreateEditOrganizationDialog
          {...defaultProps}
          isLoading={true}
        />
      );

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelButton).toBeDisabled();
    });
  });
});
