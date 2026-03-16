import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserRole } from '@auto-rfp/core';

export type CreateCognitoUserInput = {
  userPoolId: string;

  /**
   * We’ll use this as Cognito Username (recommended: emailLower).
   */
  username: string;

  email: string;
  emailVerified?: boolean;

  firstName?: string;
  lastName?: string;
  phone?: string; // E.164 ideally

  /**
   * Optional custom attributes (must exist in the pool).
   */
  custom?: {
    orgId?: string;
    userId?: string;
    role?: UserRole;
  };

  /**
   * If true, Cognito will send its default invite email/SMS.
   * If false, we suppress the invite.
   */
  sendInvite?: boolean;
};

export async function adminCreateUser(
  cognito: CognitoIdentityProviderClient,
  input: CreateCognitoUserInput,
): Promise<{ username: string; sub: string }> {
  const {
    userPoolId,
    username,
    email,
    emailVerified = true,
    firstName,
    lastName,
    phone,
    custom,
    sendInvite = false,
  } = input;

  try {
    const result = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        ...(sendInvite ? {} : { MessageAction: 'SUPPRESS' }),
        UserAttributes: [
          { Name: 'email', Value: email },
          ...(emailVerified ? [{ Name: 'email_verified', Value: 'true' }] : []),

          ...(firstName ? [{ Name: 'given_name', Value: firstName }] : []),
          ...(lastName ? [{ Name: 'family_name', Value: lastName }] : []),
          ...(phone ? [{ Name: 'phone_number', Value: phone }] : []),

          ...(custom?.orgId ? [{ Name: 'custom:orgId', Value: custom.orgId }] : []),
          ...(custom?.userId ? [{ Name: 'custom:userId', Value: custom.userId }] : []),
          ...(custom?.role ? [{ Name: 'custom:role', Value: custom.role }] : []),
        ],
      }),
    );

    // Extract the Cognito sub (UUID) from the response
    const sub = result.User?.Attributes?.find(a => a.Name === 'sub')?.Value;
    if (!sub) {
      console.warn('Cognito did not return sub for user:', username);
    }

    return { username, sub: sub || username };
  } catch (e: any) {
    // surface a stable error code for handlers/helpers
    if (e?.name === 'UsernameExistsException') {
      const err = new Error('COGNITO_USERNAME_EXISTS');
      (err as any).details = { username };
      throw err;
    }
    throw e;
  }
}

export async function adminDeleteUser(
  cognito: CognitoIdentityProviderClient,
  input: { userPoolId: string; username: string },
): Promise<void> {
  await cognito.send(
    new AdminDeleteUserCommand({
      UserPoolId: input.userPoolId,
      Username: input.username,
    }),
  );
}

/**
 * Get an existing Cognito user's details (including sub).
 * Returns null if user not found.
 */
export async function adminGetUser(
  cognito: CognitoIdentityProviderClient,
  input: { userPoolId: string; username: string },
): Promise<{ username: string; sub: string; email?: string } | null> {
  try {
    const result = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: input.userPoolId,
        Username: input.username,
      }),
    );
    const sub = result.UserAttributes?.find(a => a.Name === 'sub')?.Value;
    const email = result.UserAttributes?.find(a => a.Name === 'email')?.Value;
    return { username: result.Username || input.username, sub: sub || input.username, email };
  } catch (e: any) {
    if (e?.name === 'UserNotFoundException') return null;
    throw e;
  }
}

export async function adminUpdateUserAttributes(
  cognito: CognitoIdentityProviderClient,
  input: {
    userPoolId: string;
    username: string;
    attributes: Array<{ Name: string; Value: string }>;
  },
): Promise<void> {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: input.userPoolId,
      Username: input.username,
      UserAttributes: input.attributes,
    }),
  );
}

/**
 * Resend temporary password to a user by triggering a new password challenge.
 * This will send a new temporary password email to the user.
 */
export async function adminResendTempPassword(
  cognito: CognitoIdentityProviderClient,
  input: { userPoolId: string; username: string },
): Promise<void> {
  try {
    // First, we need to recreate the user to trigger a new temporary password
    // Get the current user details
    const existingUser = await adminGetUser(cognito, input);
    if (!existingUser) {
      throw new Error('User not found');
    }

    // Get user attributes to recreate with same data
    const userDetails = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: input.userPoolId,
        Username: input.username,
      }),
    );

    const email = userDetails.UserAttributes?.find(a => a.Name === 'email')?.Value;
    const firstName = userDetails.UserAttributes?.find(a => a.Name === 'given_name')?.Value;
    const lastName = userDetails.UserAttributes?.find(a => a.Name === 'family_name')?.Value;
    const phone = userDetails.UserAttributes?.find(a => a.Name === 'phone_number')?.Value;
    const emailVerified = userDetails.UserAttributes?.find(a => a.Name === 'email_verified')?.Value === 'true';
    const orgId = userDetails.UserAttributes?.find(a => a.Name === 'custom:orgId')?.Value;
    const userId = userDetails.UserAttributes?.find(a => a.Name === 'custom:userId')?.Value;
    const role = userDetails.UserAttributes?.find(a => a.Name === 'custom:role')?.Value;

    if (!email) {
      throw new Error('User email not found');
    }

    // Delete the existing user
    await adminDeleteUser(cognito, input);

    // Recreate the user with the same attributes but send invite this time
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: input.userPoolId,
        Username: input.username,
        MessageAction: undefined, // This will send the invite email
        UserAttributes: [
          { Name: 'email', Value: email },
          ...(emailVerified ? [{ Name: 'email_verified', Value: 'true' }] : []),
          ...(firstName ? [{ Name: 'given_name', Value: firstName }] : []),
          ...(lastName ? [{ Name: 'family_name', Value: lastName }] : []),
          ...(phone ? [{ Name: 'phone_number', Value: phone }] : []),
          ...(orgId ? [{ Name: 'custom:orgId', Value: orgId }] : []),
          ...(userId ? [{ Name: 'custom:userId', Value: userId }] : []),
          ...(role ? [{ Name: 'custom:role', Value: role }] : []),
        ],
      }),
    );
  } catch (e: any) {
    console.error('Error resending temporary password:', e);
    throw e;
  }
}
