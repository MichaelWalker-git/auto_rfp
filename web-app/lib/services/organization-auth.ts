import { IOrganizationAuth } from '@/lib/interfaces/llamacloud-service';
import { AuthorizationError, ForbiddenError } from '@/lib/errors/api-errors';
import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Helper: get current Cognito session (ID token, payload, etc.)
 */
async function getCurrentSession() {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken;
    if (!idToken) return null;

    return {
      idToken,
      payload: idToken.payload as Record<string, any>,
    };
  } catch {
    return null;
  }
}

/**
 * Helper: extract user id (Cognito sub) from token payload
 */
function getUserIdFromPayload(payload: Record<string, any>): string | null {
  const sub = payload['sub'];
  return typeof sub === 'string' ? sub : null;
}

/**
 * Helper: parse organization role from Cognito groups
 *
 * Assumes groups look like:
 *   "org:<organizationId>:owner"
 *   "org:<organizationId>:admin"
 *   "org:<organizationId>:member"
 *
 * Example:
 *   org:org-123:owner -> role "owner" for organization "org-123"
 */
function parseOrgRoleFromToken(
  payload: Record<string, any>,
  organizationId: string,
): string | null {
  const groups =
    (payload['cognito:groups'] as string[] | undefined) ?? [];

  // Expected pattern: org:<organizationId>:<role>
  const prefix = `org:${organizationId}:`;

  const match = groups.find((g) => g.startsWith(prefix));
  if (!match) return null;

  const parts = match.split(':');
  const role = parts[2];
  return role ?? null;
}

/**
 * Organization authorization service implementation based on Cognito (Amplify)
 */
export class OrganizationAuth implements IOrganizationAuth {
  /**
   * Get current authenticated user (from Cognito token)
   */
  async getCurrentUser(): Promise<{ id: string } | null> {
    const session = await getCurrentSession();
    if (!session) return null;

    const userId = getUserIdFromPayload(session.payload);
    if (!userId) return null;

    return { id: userId };
  }

  /**
   * Get user's role in an organization from Cognito groups
   *
   * NOTE: `userId` param is ignored here, because we can only see
   * the *current* user's token in this context.
   */
  async getUserOrganizationRole(
    _userId: string,
    organizationId: string,
  ): Promise<string | null> {
    const session = await getCurrentSession();
    if (!session) {
      throw new AuthorizationError('Authentication required');
    }

    const role = parseOrgRoleFromToken(
      session.payload,
      organizationId,
    );
    return role;
  }

  /**
   * Check if user has admin access to organization (owner/admin)
   */
  async hasAdminAccess(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    try {
      const role = await this.getUserOrganizationRole(
        userId,
        organizationId,
      );
      return role === 'owner' || role === 'admin';
    } catch {
      return false;
    }
  }

  /**
   * Verify user has admin access and throw if not
   */
  async requireAdminAccess(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const hasAccess = await this.hasAdminAccess(userId, organizationId);
    if (!hasAccess) {
      throw new ForbiddenError(
        'Only organization owners and admins can perform this action',
      );
    }
  }

  /**
   * Get authenticated user and verify admin access in one step
   */
  async getAuthenticatedAdminUser(
    organizationId: string,
  ): Promise<{ id: string }> {
    const user = await this.getCurrentUser();
    if (!user) {
      throw new AuthorizationError('Authentication required');
    }

    await this.requireAdminAccess(user.id, organizationId);
    return user;
  }

  /**
   * Check if user is a member of an organization
   *
   * Here "member" = any role for that organization in Cognito groups.
   */
  async isMemberOfOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    try {
      const role = await this.getUserOrganizationRole(
        userId,
        organizationId,
      );
      return role !== null;
    } catch {
      return false;
    }
  }

  /**
   * Verify user is a member and throw if not
   */
  async requireMembership(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const isMember = await this.isMemberOfOrganization(
      userId,
      organizationId,
    );
    if (!isMember) {
      throw new ForbiddenError(
        'You do not have access to this organization',
      );
    }
  }

  /**
   * Get authenticated user and verify membership
   */
  async getAuthenticatedMember(
    organizationId: string,
  ): Promise<{ id: string }> {
    const user = await this.getCurrentUser();
    if (!user) {
      throw new AuthorizationError('Authentication required');
    }

    await this.requireMembership(user.id, organizationId);
    return user;
  }
}

// Export singleton instance
export const organizationAuth = new OrganizationAuth();
