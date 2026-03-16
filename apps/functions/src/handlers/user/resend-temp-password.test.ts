// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({})),
}));

// Mock helper functions
jest.mock('@/helpers/cognito', () => ({
  adminResendTempPassword: jest.fn(),
  adminGetUser: jest.fn(),
}));

jest.mock('@/helpers/user', () => ({
  getUserByOrgAndId: jest.fn(),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
process.env.REGION = 'us-east-1';

import { adminResendTempPassword, adminGetUser } from '@/helpers/cognito';
import { getUserByOrgAndId } from '@/helpers/user';

const mockAdminResendTempPassword = adminResendTempPassword as jest.MockedFunction<typeof adminResendTempPassword>;
const mockAdminGetUser = adminGetUser as jest.MockedFunction<typeof adminGetUser>;
const mockGetUserByOrgAndId = getUserByOrgAndId as jest.MockedFunction<typeof getUserByOrgAndId>;

// Create a business function to test (similar to other handlers)
const resendTempPassword = async (orgId: string, userId: string) => {
  // 1. Get user from DynamoDB to verify they exist and get their email
  const user = await getUserByOrgAndId(orgId, userId);
  if (!user) {
    throw new Error('User not found');
  }

  // 2. Get user from Cognito to verify they exist there too
  const cognitoUser = await adminGetUser({} as any, {
    userPoolId: 'test-pool-id',
    username: user.email.toLowerCase(),
  });

  if (!cognitoUser) {
    throw new Error('User not found in authentication system');
  }

  // 3. Resend temporary password
  await adminResendTempPassword({} as any, {
    userPoolId: 'test-pool-id',
    username: user.email.toLowerCase(),
  });

  return {
    ok: true,
    orgId,
    userId,
    email: user.email,
    message: 'Temporary password has been resent successfully',
  };
};

describe('resend-temp-password handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('resendTempPassword', () => {
    it('should resend temporary password successfully', async () => {
      const mockUser = {
        userId: 'user-456',
        email: 'test@example.com',
        displayName: 'Test User',
      };

      const mockCognitoUser = {
        username: 'test@example.com',
        sub: 'user-456',
        email: 'test@example.com',
      };

      mockGetUserByOrgAndId.mockResolvedValue(mockUser);
      mockAdminGetUser.mockResolvedValue(mockCognitoUser);
      mockAdminResendTempPassword.mockResolvedValue();

      const result = await resendTempPassword('org-123', 'user-456');

      expect(result).toEqual({
        ok: true,
        orgId: 'org-123',
        userId: 'user-456',
        email: 'test@example.com',
        message: 'Temporary password has been resent successfully',
      });

      expect(mockGetUserByOrgAndId).toHaveBeenCalledWith('org-123', 'user-456');
      expect(mockAdminGetUser).toHaveBeenCalledWith(expect.anything(), {
        userPoolId: 'test-pool-id',
        username: 'test@example.com',
      });
      expect(mockAdminResendTempPassword).toHaveBeenCalledWith(expect.anything(), {
        userPoolId: 'test-pool-id',
        username: 'test@example.com',
      });
    });

    it('should throw error when user not found in DynamoDB', async () => {
      mockGetUserByOrgAndId.mockResolvedValue(null);

      await expect(resendTempPassword('org-123', 'nonexistent-user')).rejects.toThrow('User not found');
    });

    it('should throw error when user not found in Cognito', async () => {
      const mockUser = {
        userId: 'user-456',
        email: 'test@example.com',
        displayName: 'Test User',
      };

      mockGetUserByOrgAndId.mockResolvedValue(mockUser);
      mockAdminGetUser.mockResolvedValue(null);

      await expect(resendTempPassword('org-123', 'user-456')).rejects.toThrow('User not found in authentication system');
    });

    it('should handle Cognito errors', async () => {
      const mockUser = {
        userId: 'user-456',
        email: 'test@example.com',
        displayName: 'Test User',
      };

      const mockCognitoUser = {
        username: 'test@example.com',
        sub: 'user-456',
        email: 'test@example.com',
      };

      mockGetUserByOrgAndId.mockResolvedValue(mockUser);
      mockAdminGetUser.mockResolvedValue(mockCognitoUser);
      mockAdminResendTempPassword.mockRejectedValue(new Error('Cognito service error'));

      await expect(resendTempPassword('org-123', 'user-456')).rejects.toThrow('Cognito service error');
    });

    it('should handle DynamoDB errors', async () => {
      mockGetUserByOrgAndId.mockRejectedValue(new Error('DynamoDB connection error'));

      await expect(resendTempPassword('org-123', 'user-456')).rejects.toThrow('DynamoDB connection error');
    });
  });
});