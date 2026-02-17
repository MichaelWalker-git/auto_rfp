import type { MiddlewareObj } from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ALL_PERMISSIONS, Permission, ROLE_PERMISSIONS, UserRole } from '@auto-rfp/shared';

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

type Claims = Record<string, any>;

type RequestContextWithAuthorizer = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: {
    jwt?: { claims?: Claims };
    claims?: Claims;
  };
};

export type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: {
    userId: string;
    orgId?: string;
    claims: Claims;
  };
  rbac?: {
    role: UserRole;
    permissions: Permission[];
  };
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

function getClaims(event: APIGatewayProxyEventV2): Claims | null {
  const rc = event.requestContext as RequestContextWithAuthorizer;
  return rc.authorizer?.jwt?.claims ?? rc.authorizer?.claims ?? null;
}

function toRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') return null;
  const r = value.trim().toUpperCase();
  if (r === 'ADMIN' || r === 'EDITOR' || r === 'VIEWER' || r === 'BILLING') return r as UserRole;
  return null;
}

export function authContextMiddleware(): MiddlewareObj<AuthedEvent, APIGatewayProxyResultV2> {
  return {
    before: async (request) => {
      const claims = getClaims(request.event);
      if (!claims) {
        request.response = json(401, { message: 'Unauthorized' });
        return;
      }

      const userId = typeof claims.sub === 'string' ? claims.sub : '';

      // Support multi-org: prefer X-Org-Id header, fall back to token claim
      const orgIdFromHeader = request.event.headers?.['x-org-id'];
      const orgIdFromQuery = request.event.queryStringParameters?.orgId;
      const orgId = orgIdFromHeader || orgIdFromQuery;

      request.event.auth = { userId, orgId, claims };
    },
  };
}

export function orgMembershipMiddleware(): MiddlewareObj<AuthedEvent, APIGatewayProxyResultV2> {
  return {
    before: async (request) => {
      const auth = request.event.auth;
      if (!auth) {
        request.response = json(401, { message: 'Unauthorized' });
        return;
      }

      const role = toRole(auth.claims['custom:role']);


      request.event.rbac = role
        ? {
          role,
          permissions: ROLE_PERMISSIONS[role] ?? [],
        }
        : {
          role: 'ADMIN',
          permissions: [...ALL_PERMISSIONS]
        };
    },
  };
}

export function requirePermission(permission: Permission): MiddlewareObj<AuthedEvent, APIGatewayProxyResultV2> {
  return {
    before: async (request) => {
      const perms = request.event.rbac?.permissions;
      if (!perms) throw new HttpError(401, 'Unauthorized');
      if (!perms.includes(permission)) throw new HttpError(403, 'Forbidden');
    },
  };
}

export function httpErrorMiddleware(): MiddlewareObj<any, APIGatewayProxyResultV2> {
  return {
    onError: async (request) => {
      const err = request.error;
      
      // Log the actual error for debugging
      console.error('httpErrorMiddleware caught error:', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
      });
      
      if (err instanceof HttpError) {
        request.response = json(err.statusCode, { message: err.message });
        return;
      }
      
      // Return more details in non-production for debugging
      const errorMessage = err instanceof Error ? err.message : 'Internal Server Error';
      request.response = json(500, { message: 'Internal Server Error', error: errorMessage });
    },
  };
}
