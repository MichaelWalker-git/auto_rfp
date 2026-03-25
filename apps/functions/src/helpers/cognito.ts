import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
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
 * Set a user's password via AdminSetUserPasswordCommand.
 * If `permanent` is false (default), the user will be in FORCE_CHANGE_PASSWORD state
 * and must change the password on first login.
 */
export const adminSetUserPassword = async (
  cognito: CognitoIdentityProviderClient,
  input: { userPoolId: string; username: string; password: string; permanent?: boolean },
): Promise<void> => {
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: input.userPoolId,
      Username: input.username,
      Password: input.password,
      Permanent: input.permanent ?? false,
    }),
  );
};

/** The default temporary password assigned to all new users. Configurable via DEFAULT_TEMP_PASSWORD env var. */
export const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || 'Welcome1!';

/**
 * Resend invitation to a user by:
 * 1. Resetting their password to the known default temporary password
 * 2. Re-sending the Cognito invite email via AdminCreateUser with MessageAction: RESEND
 *
 * This is much safer than the old approach of deleting and recreating the user,
 * which could lose the Cognito sub and break DynamoDB references.
 */
export const adminResendTempPassword = async (
  cognito: CognitoIdentityProviderClient,
  input: { userPoolId: string; username: string },
): Promise<void> => {
  // Verify user exists and get their status
  const userDetails = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: input.userPoolId,
      Username: input.username,
    }),
  ).catch((e: { name?: string }) => {
    if (e?.name === 'UserNotFoundException') return null;
    throw e;
  });

  if (!userDetails) {
    throw new Error('User not found');
  }

  const userStatus = userDetails.UserStatus;

  // For CONFIRMED users (already set their own password), first reset to default
  // temporary password. This puts them back into FORCE_CHANGE_PASSWORD state,
  // which then allows the RESEND to work.
  if (userStatus === 'CONFIRMED') {
    await adminSetUserPassword(cognito, {
      userPoolId: input.userPoolId,
      username: input.username,
      password: DEFAULT_TEMP_PASSWORD,
      permanent: false, // Moves user to FORCE_CHANGE_PASSWORD state
    });
  }

  // Now RESEND the invitation email. At this point the user is in
  // FORCE_CHANGE_PASSWORD state (either originally or after the reset above).
  // NOTE: RESEND generates a new random temp password internally.
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: input.userPoolId,
      Username: input.username,
      MessageAction: 'RESEND',
      DesiredDeliveryMediums: ['EMAIL'],
    }),
  );

  // Override the random password from RESEND with our known default.
  await adminSetUserPassword(cognito, {
    userPoolId: input.userPoolId,
    username: input.username,
    password: DEFAULT_TEMP_PASSWORD,
    permanent: false,
  });
};
