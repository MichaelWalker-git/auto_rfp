import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserRole } from '@auto-rfp/shared';

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
): Promise<{ username: string }> {
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
    await cognito.send(
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

    return { username };
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
