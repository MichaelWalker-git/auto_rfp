import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

/**
 * Unified search-opportunities domain.
 * Base path: /search-opportunities
 *
 * One Lambda per action. Source is passed as a body/query param.
 * Adding a new source requires no new routes — just update the handler logic.
 */
export const searchOpportunityDomain = (): DomainRoutes => ({
  basePath: 'search-opportunities',
  routes: [
    // ── Search ────────────────────────────────────────────────────────────
    /** Search all configured sources (source: 'ALL'|'SAM_GOV'|'DIBBS' in body) */
    { method: 'POST', path: 'search',              entry: lambdaEntry('search-opportunity/search.ts') },

    // ── Import ────────────────────────────────────────────────────────────
    /** Import a solicitation (source: 'SAM_GOV'|'DIBBS' in body) */
    { method: 'POST', path: 'import-solicitation', entry: lambdaEntry('search-opportunity/import-solicitation.ts'), timeoutSeconds: 60 },

    // ── API Keys ──────────────────────────────────────────────────────────
    /** Set API key (source: 'SAM_GOV'|'DIBBS' in body) */
    { method: 'POST', path: 'api-key',             entry: lambdaEntry('search-opportunity/set-api-key-unified.ts') },
    /** Get API key status (?source=SAM_GOV|DIBBS or all) */
    { method: 'GET',  path: 'api-key',             entry: lambdaEntry('search-opportunity/get-api-key-unified.ts') },

    // ── Saved Searches ────────────────────────────────────────────────────
    /** Create saved search (source: 'SAM_GOV'|'DIBBS' in body) */
    { method: 'POST',   path: 'saved-search',      entry: lambdaEntry('search-opportunity/saved-search-create.ts') },
    /** List saved searches (?source=SAM_GOV|DIBBS|ALL) */
    { method: 'GET',    path: 'saved-search',      entry: lambdaEntry('search-opportunity/saved-search-list.ts') },
    /** Edit saved search (?source=SAM_GOV|DIBBS) */
    { method: 'PATCH',  path: 'saved-search/{id}', entry: lambdaEntry('search-opportunity/saved-search-edit.ts') },
    /** Delete saved search (?source=SAM_GOV|DIBBS) */
    { method: 'DELETE', path: 'saved-search/{id}', entry: lambdaEntry('search-opportunity/saved-search-delete.ts') },

    // ── SAM.gov specific ──────────────────────────────────────────────────
    { method: 'POST', path: 'opportunity-description', entry: lambdaEntry('search-opportunity/get-opportunity-description.ts') },
  ],
});
