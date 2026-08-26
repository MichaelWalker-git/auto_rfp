import {
  apiTierForDomain,
  validateApiAssignment,
  SECONDARY_API_DOMAINS,
  MAX_ROUTES_PER_API,
} from './api-assignment';
import type { DomainRoutes, RouteDef } from './types';

const makeRoutes = (count: number): RouteDef[] =>
  Array.from({ length: count }, (_, i) => ({
    method: 'GET' as const,
    path: `route-${i}`,
    entry: `handlers/fake/route-${i}.ts`,
  }));

const makeDomain = (basePath: string, routeCount: number): DomainRoutes => ({
  basePath,
  routes: makeRoutes(routeCount),
});

describe('apiTierForDomain', () => {
  it('assigns domains in SECONDARY_API_DOMAINS to the secondary API', () => {
    for (const basePath of SECONDARY_API_DOMAINS) {
      expect(apiTierForDomain(basePath)).toBe('secondary');
    }
  });

  it('assigns all other domains to the primary API', () => {
    expect(apiTierForDomain('organization')).toBe('primary');
    expect(apiTierForDomain('user')).toBe('primary');
    expect(apiTierForDomain('some-future-domain')).toBe('primary');
  });

  it('does not match on prefix or casing — only exact basePath', () => {
    expect(apiTierForDomain('foia-extra')).toBe('primary');
    expect(apiTierForDomain('FOIA')).toBe('primary');
  });
});

describe('validateApiAssignment', () => {
  it('counts routes per tier', () => {
    const counts = validateApiAssignment([
      makeDomain('organization', 9),
      makeDomain('user', 10),
      makeDomain('foia', 17),
      makeDomain('pricing', 14),
      makeDomain('apn', 0),
    ]);
    expect(counts).toEqual({ primary: 19, secondary: 31 });
  });

  it('passes at exactly the cap', () => {
    expect(() =>
      validateApiAssignment([makeDomain('organization', MAX_ROUTES_PER_API)]),
    ).not.toThrow();
  });

  it('throws with guidance when the primary API exceeds the cap', () => {
    expect(() =>
      validateApiAssignment([makeDomain('organization', MAX_ROUTES_PER_API + 1)]),
    ).toThrow(/primary HTTP API has 281 routes.*api-assignment\.ts/s);
  });

  it('throws when the secondary API exceeds the cap', () => {
    expect(() =>
      validateApiAssignment([makeDomain('foia', MAX_ROUTES_PER_API + 1)]),
    ).toThrow(/secondary HTTP API/);
  });

  it('handles an empty domain list', () => {
    expect(validateApiAssignment([])).toEqual({ primary: 0, secondary: 0 });
  });
});
