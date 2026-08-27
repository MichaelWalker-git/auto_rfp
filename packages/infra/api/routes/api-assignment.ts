import type { DomainRoutes } from './types';

/**
 * Domain → HTTP API assignment.
 *
 * AWS caps an HTTP API at 300 integrations (hard limit, not adjustable) and we
 * create one integration per route, so routes are split across two HTTP APIs.
 * A CloudFront distribution in front routes by `/{basePath}/*` path prefix, so
 * the frontend only ever sees one base URL (see docs/API-SPLIT-IMPLEMENTATION.md).
 *
 * Moving a domain between APIs is safe for clients (routing is server-side in
 * CloudFront), but the CloudFront behavior set in api-orchestrator-stack.ts is
 * derived from this set — both change together in one deploy.
 */
export type ApiTier = 'primary' | 'secondary';

/** basePaths served by the secondary HTTP API (document-generation / AI cluster). */
export const SECONDARY_API_DOMAINS: ReadonlySet<string> = new Set([
  'rfp-document',
  'foia',
  'content-library',
  'templates',
  'pricing',
  'required-forms',
  'brief',
  'pastperf',
]);

/**
 * Fail synth well before the AWS limit (300) so the quota error surfaces as a
 * build error with guidance, never as a CloudFormation deploy failure.
 */
export const MAX_ROUTES_PER_API = 280;

export const apiTierForDomain = (basePath: string): ApiTier =>
  SECONDARY_API_DOMAINS.has(basePath) ? 'secondary' : 'primary';

/**
 * Counts routes per API tier and throws if either exceeds MAX_ROUTES_PER_API.
 * Returns the counts so the orchestrator can surface them at synth.
 */
export const validateApiAssignment = (domains: DomainRoutes[]): Record<ApiTier, number> => {
  const counts: Record<ApiTier, number> = { primary: 0, secondary: 0 };
  for (const domain of domains) {
    counts[apiTierForDomain(domain.basePath)] += domain.routes.length;
  }

  for (const tier of ['primary', 'secondary'] as const) {
    if (counts[tier] > MAX_ROUTES_PER_API) {
      throw new Error(
        `The ${tier} HTTP API has ${counts[tier]} routes, over the ${MAX_ROUTES_PER_API} guard ` +
        `(AWS hard limit: 300 integrations per API). Move one or more domains ` +
        `${tier === 'primary' ? 'into' : 'out of'} SECONDARY_API_DOMAINS in ` +
        `packages/infra/api/routes/api-assignment.ts — CloudFront behaviors follow automatically. ` +
        `See docs/API-SPLIT-IMPLEMENTATION.md.`,
      );
    }
  }

  return counts;
};
