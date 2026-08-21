export const FOIA_AUTOMATION_PK = 'FOIA_AUTOMATION';
export const ORG_FOIA_SETTINGS_PK = 'ORG_FOIA_SETTINGS';
export const ORG_AGENCY_CONTACT_PK = 'ORG_AGENCY_CONTACT';
export const FOIA_MAIL_SCAN_PK = 'FOIA_MAIL_SCAN';

/**
 * Mirrored FOIA.gov agency-component directory, plus its lookup pointer rows
 * and the cached HigherGov agency hierarchies. Global, not org-scoped.
 */
export const FOIA_COMPONENT_PK = 'FOIA_COMPONENT';

/** How long a cached HigherGov agency hierarchy stays fresh. Hierarchies change on the order of years. */
export const HIGHERGOV_AGENCY_CACHE_DAYS = 90;

/** TTL for mail scan records (days after scan). */
export const FOIA_MAIL_SCAN_TTL_DAYS = 90;

/** Maximum send attempts before moving to FAILED state. */
export const FOIA_MAX_SEND_ATTEMPTS = 3;
