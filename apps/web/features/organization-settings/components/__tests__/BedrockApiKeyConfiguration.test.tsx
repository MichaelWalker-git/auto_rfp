import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BedrockApiKeyConfiguration } from '../BedrockApiKeyConfiguration';
import { useBedrockConfig } from '../../hooks/useBedrockConfig';

jest.mock('../../hooks/useBedrockConfig');
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

let mockHasPermission = true;
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  usePermission: () => mockHasPermission,
}));

const mockUseBedrockConfig = useBedrockConfig as jest.MockedFunction<typeof useBedrockConfig>;

const mockSaveConfig = jest.fn();
const mockMutate = jest.fn();

const setHook = (over: Partial<ReturnType<typeof useBedrockConfig>>) => {
  mockUseBedrockConfig.mockReturnValue({
    status: { configured: false },
    isLoading: false,
    mutate: mockMutate,
    saveConfig: mockSaveConfig,
    isSaving: false,
    ...over,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockHasPermission = true;
  mockSaveConfig.mockResolvedValue({ ok: true });
  setHook({});
});

describe('BedrockApiKeyConfiguration', () => {
  it('shows a skeleton (not a badge) while status is loading', () => {
    setHook({ status: undefined, isLoading: true });
    render(<BedrockApiKeyConfiguration orgId="org-1" />);
    expect(screen.getByTestId('bedrock-status-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Not Configured')).not.toBeInTheDocument();
  });

  it('renders the Not Configured state', () => {
    setHook({ status: { configured: false } });
    render(<BedrockApiKeyConfiguration orgId="org-1" />);
    expect(screen.getByText('Not Configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configure/i })).toBeInTheDocument();
  });

  it('renders the Configured state with an Update action', () => {
    setHook({ status: { configured: true, fallbackModelId: 'fb-model' } });
    render(<BedrockApiKeyConfiguration orgId="org-1" />);
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
  });

  it('opens the dialog with the API key + fallback fields and saves via the hook', async () => {
    render(<BedrockApiKeyConfiguration orgId="org-1" />);
    fireEvent.click(screen.getByRole('button', { name: /configure/i }));

    const keyInput = screen.getByLabelText('API Key');
    const fallbackInput = screen.getByLabelText(/fallback model id/i);
    expect(fallbackInput).toBeInTheDocument();

    fireEvent.change(keyInput, { target: { value: 'my-bedrock-key' } });
    fireEvent.change(fallbackInput, { target: { value: 'us.anthropic.claude-sonnet-4-6' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSaveConfig).toHaveBeenCalledWith({
        apiKey: 'my-bedrock-key',
        fallbackModelId: 'us.anthropic.claude-sonnet-4-6',
      }),
    );
  });

  it('surfaces the missing models when the probe rejects the key (422)', async () => {
    mockSaveConfig.mockResolvedValueOnce({
      ok: false,
      missingModels: ['us.anthropic.claude-opus-4-6-v1'],
      message: 'rejected',
    });
    render(<BedrockApiKeyConfiguration orgId="org-1" />);
    fireEvent.click(screen.getByRole('button', { name: /configure/i }));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Key rejected')).toBeInTheDocument();
    expect(screen.getByText('us.anthropic.claude-opus-4-6-v1')).toBeInTheDocument();
    // Dialog stays open (still shows the save button) so the admin can fix it.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('disables the Configure action for users without org:manage_settings', () => {
    mockHasPermission = false;
    setHook({ status: { configured: false } });
    render(<BedrockApiKeyConfiguration orgId="org-1" />);
    expect(screen.getByRole('button', { name: /configure/i })).toBeDisabled();
  });
});
