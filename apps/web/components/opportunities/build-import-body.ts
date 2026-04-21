import type { SearchOpportunitySlim, OpportunitySource } from '@auto-rfp/core';

const formatMMDDYYYY = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

type ImportBodyBuilder = (ctx: {
  opp: SearchOpportunitySlim;
  orgId: string;
  projectId: string;
}) => Record<string, unknown>;

const builders: Record<OpportunitySource, ImportBodyBuilder> = {
  SAM_GOV: ({ opp, orgId, projectId }) => ({
    source: 'SAM_GOV',
    orgId,
    projectId,
    noticeId: opp.noticeId ?? opp.id,
    postedFrom: opp.postedDate
      ? formatMMDDYYYY(new Date(opp.postedDate))
      : formatMMDDYYYY(new Date(Date.now() - 30 * 86_400_000)),
    postedTo: formatMMDDYYYY(new Date()),
  }),
  HIGHER_GOV: ({ opp, orgId, projectId }) => ({
    source: 'HIGHER_GOV',
    orgId,
    projectId,
    oppKey: opp.id,
  }),
  DIBBS: ({ opp, orgId, projectId }) => ({
    source: 'DIBBS',
    orgId,
    projectId,
    solicitationNumber: opp.solicitationNumber ?? opp.id,
  }),
  MANUAL_UPLOAD: ({ opp, orgId, projectId }) => ({
    source: 'MANUAL_UPLOAD',
    orgId,
    projectId,
    id: opp.id,
  }),
};

export const buildImportBody = (
  opp: SearchOpportunitySlim,
  orgId: string,
  projectId: string,
): Record<string, unknown> => {
  const build = builders[opp.source];
  return build({ opp, orgId, projectId });
};
