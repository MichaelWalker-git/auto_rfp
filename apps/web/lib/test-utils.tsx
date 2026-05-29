import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { SWRConfig } from 'swr';

// Mock providers for testing
interface MockProviderProps {
  children: React.ReactNode;
}

// SWR provider that disables caching for tests
function TestSWRProvider({ children }: MockProviderProps) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 0,
        provider: () => new Map(),
      }}
    >
      {children}
    </SWRConfig>
  );
}

// All providers wrapper
function AllProviders({ children }: MockProviderProps) {
  return <TestSWRProvider>{children}</TestSWRProvider>;
}

// Custom render function with all providers
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllProviders, ...options });

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };

// Test utilities
export const mockApiResponse = <T,>(data: T) => ({
  ok: true,
  data,
});

export const mockApiError = (message: string, status = 400) => ({
  ok: false,
  error: message,
  status,
});

// Wait for async operations
export const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

// Mock user for auth tests
export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  orgId: 'org-456',
  role: 'ADMIN' as const,
};

// Mock organization
export const mockOrganization = {
  id: 'org-456',
  name: 'Test Organization',
  description: 'A test organization',
  _count: {
    organizationUsers: 5,
    projects: 10,
  },
};

// Mock project
export const mockProject = {
  id: 'project-789',
  name: 'Test Project',
  description: 'A test project',
  orgId: 'org-456',
  status: 'In Progress',
};

// Mock fetch for API tests
export const createMockFetch = (responses: Record<string, unknown>) => {
  return jest.fn((url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (key) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responses[key]),
      });
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Not found' }),
    });
  });
};

// Type-safe event handler mock
export const mockHandler = jest.fn();

// Generate unique IDs for tests
let idCounter = 0;
export const generateTestId = (prefix = 'test') => `${prefix}-${++idCounter}`;

// Reset ID counter between tests
export const resetTestIds = () => {
  idCounter = 0;
};
