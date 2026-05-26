'use client';

import { useCallback } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { CreateCompanyProfileDTO, CompanyProfileResponse } from '@auto-rfp/core';

export const useUpsertCompanyProfile = () => {
  const upsertProfile = useCallback(async (dto: CreateCompanyProfileDTO) => {
    const url = buildApiUrl('/company-profile/upsert');
    return apiMutate<CompanyProfileResponse, CreateCompanyProfileDTO>(url, 'PUT', dto);
  }, []);

  return { upsertProfile };
};
