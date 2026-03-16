import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { resendTempPasswordApi } from '@/lib/hooks/use-user';

// Stable mock toast function shared across all useToast() calls
const mockToast = jest.fn();

// Mock the toast hook
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock the API function
jest.mock('@/lib/hooks/use-user', () => ({
  resendTempPasswordApi: jest.fn(),
}));

// Create a test component that includes the ResendPasswordSection
const ResendPasswordSection = ({
  userId,
  orgId,
  email,
}: {
  userId: string;
  orgId: string;
  email: string;
}) => {
  const { toast } = require('@/components/ui/use-toast').useToast();
  const [isResending, setIsResending] = React.useState(false);

  const handleResendPassword = React.useCallback(async () => {
    setIsResending(true);
    try {
      await resendTempPasswordApi({ orgId, userId });
      toast({
        title: 'Password resent',
        description: `A new temporary password has been sent to ${email}.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resend password';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsResending(false);
    }
  }, [orgId, userId, email, toast]);

  return (
    <div data-testid="resend-password-section">
      <h2>Resend Temporary Password</h2>
      <p>This user has been invited but hasn&apos;t activated their account yet.</p>
      <button
        onClick={handleResendPassword}
        disabled={isResending}
        data-testid="resend-password-button"
      >
        {isResending ? 'Resending...' : 'Resend Password'}
      </button>
    </div>
  );
};

const mockResendTempPasswordApi = resendTempPasswordApi as jest.MockedFunction<typeof resendTempPasswordApi>;

describe('ResendPasswordSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const defaultProps = {
    userId: 'user-123',
    orgId: 'org-456',
    email: 'test@example.com',
  };

  it('renders correctly', () => {
    render(<ResendPasswordSection {...defaultProps} />);
    
    expect(screen.getByText('Resend Temporary Password')).toBeInTheDocument();
    expect(screen.getByText("This user has been invited but hasn't activated their account yet.")).toBeInTheDocument();
    expect(screen.getByTestId('resend-password-button')).toBeInTheDocument();
    expect(screen.getByText('Resend Password')).toBeInTheDocument();
  });

  it('calls resendTempPasswordApi when button is clicked', async () => {
    mockResendTempPasswordApi.mockResolvedValue({
      ok: true,
      orgId: 'org-456',
      userId: 'user-123',
      email: 'test@example.com',
      message: 'Temporary password has been resent successfully',
    });

    render(<ResendPasswordSection {...defaultProps} />);
    
    const button = screen.getByTestId('resend-password-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockResendTempPasswordApi).toHaveBeenCalledWith({
        orgId: 'org-456',
        userId: 'user-123',
      });
    });
  });

  it('shows loading state when resending', async () => {
    mockResendTempPasswordApi.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(<ResendPasswordSection {...defaultProps} />);
    
    const button = screen.getByTestId('resend-password-button');
    fireEvent.click(button);

    // Should show loading state
    expect(screen.getByText('Resending...')).toBeInTheDocument();
    expect(button).toBeDisabled();

    // Wait for the promise to resolve
    await waitFor(() => {
      expect(screen.getByText('Resend Password')).toBeInTheDocument();
    });
  });

  it('shows success toast on successful resend', async () => {
    mockResendTempPasswordApi.mockResolvedValue({
      ok: true,
      orgId: 'org-456',
      userId: 'user-123',
      email: 'test@example.com',
      message: 'Temporary password has been resent successfully',
    });

    render(<ResendPasswordSection {...defaultProps} />);
    
    const button = screen.getByTestId('resend-password-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Password resent',
        description: 'A new temporary password has been sent to test@example.com.',
      });
    });
  });

  it('shows error toast on failed resend', async () => {
    const errorMessage = 'User not found in authentication system';
    mockResendTempPasswordApi.mockRejectedValue(new Error(errorMessage));

    render(<ResendPasswordSection {...defaultProps} />);
    
    const button = screen.getByTestId('resend-password-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    });
  });

  it('handles unknown errors gracefully', async () => {
    mockResendTempPasswordApi.mockRejectedValue('Unknown error');

    render(<ResendPasswordSection {...defaultProps} />);
    
    const button = screen.getByTestId('resend-password-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to resend password',
        variant: 'destructive',
      });
    });
  });

  it('re-enables button after error', async () => {
    mockResendTempPasswordApi.mockRejectedValue(new Error('Test error'));

    render(<ResendPasswordSection {...defaultProps} />);
    
    const button = screen.getByTestId('resend-password-button');
    fireEvent.click(button);

    // Should be disabled during loading
    expect(button).toBeDisabled();

    // Should be re-enabled after error
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
