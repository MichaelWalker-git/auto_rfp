import { apiMutate, buildApiUrl } from './api-helpers';
import type { OpportunityItem, OpportunityStage, UpdateOpportunityStageDTO } from '@auto-rfp/core';

export interface UpdateOpportunityStageResponse {
  ok: boolean;
  oppId: string;
  stage: OpportunityStage;
  item: OpportunityItem;
}

export const updateOpportunityStageApi = (
  orgId: string,
  dto: UpdateOpportunityStageDTO,
): Promise<UpdateOpportunityStageResponse> =>
  apiMutate<UpdateOpportunityStageResponse>(
    buildApiUrl('opportunity/stage', { orgId }),
    'PATCH',
    dto,
  );
