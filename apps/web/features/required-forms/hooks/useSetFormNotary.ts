'use client';

import { useCallback } from 'react';
import type { NotaryStatus, NotaryClassificationSource } from '@auto-rfp/core';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

interface SetFormNotaryArgs {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
  notaryStatus: NotaryStatus;
}

interface SetFormNotaryResponse {
  formId: string;
  notaryStatus: NotaryStatus;
  notarySource: NotaryClassificationSource;
}

/**
 * Manual notary override (FR7.2): set a form's notary classification by hand.
 * The backend stamps `notarySource: 'USER_SET'`, so AI detection re-runs will
 * never overwrite the user's decision, and recomputes the opportunity rollup
 * (without a notification) so the card chip updates immediately.
 */
export const useSetFormNotary = () => {
  const setFormNotary = useCallback(
    async (args: SetFormNotaryArgs) =>
      apiMutate<SetFormNotaryResponse, SetFormNotaryArgs>(
        buildApiUrl('/required-forms/set-notary'),
        'POST',
        args,
      ),
    [],
  );

  return { setFormNotary };
};
