'use client';

import useSWR, { KeyedMutator } from 'swr';
import { useState } from 'react';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  FoiaSettingsItem,
  FoiaSettingsUpdateRequest,
  FoiaAgencyContactItem,
  FoiaAgencyContactCreateRequest,
} from '@auto-rfp/core';

// ─── GET FOIA Settings ────────────────────────────────────────────────────────

interface UseFoiaSettingsResult {
  settings: FoiaSettingsItem | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  mutate: KeyedMutator<{ settings: FoiaSettingsItem }>;
}

export const useFoiaSettings = (orgId: string | null): UseFoiaSettingsResult => {
  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ settings: FoiaSettingsItem }>(
    orgId ? `${baseUrl}/foia/settings/${orgId}` : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch FOIA settings: ${res.status}. ${body}`);
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  return {
    settings: data?.settings ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
};

// ─── UPDATE FOIA Settings ─────────────────────────────────────────────────────

interface UseUpdateFoiaSettingsResult {
  updateFoiaSettings: (patch: FoiaSettingsUpdateRequest) => Promise<FoiaSettingsItem>;
  isSaving: boolean;
}

export const useUpdateFoiaSettings = (
  orgId: string,
  mutate: KeyedMutator<{ settings: FoiaSettingsItem }>
): UseUpdateFoiaSettingsResult => {
  const [isSaving, setIsSaving] = useState(false);

  const updateFoiaSettings = async (
    patch: FoiaSettingsUpdateRequest
  ): Promise<FoiaSettingsItem> => {
    setIsSaving(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/foia/settings/${orgId}`;

      const res = await authFetcher(url, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to update FOIA settings: ${res.status}. ${body}`);
      }

      const result = await res.json();
      await mutate();
      return result.settings as FoiaSettingsItem;
    } finally {
      setIsSaving(false);
    }
  };

  return { updateFoiaSettings, isSaving };
};

// ─── GET FOIA Agency Contacts ─────────────────────────────────────────────────

interface UseFoiaAgencyContactsResult {
  contacts: FoiaAgencyContactItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  mutate: KeyedMutator<{ contacts: FoiaAgencyContactItem[] }>;
}

export const useFoiaAgencyContacts = (orgId: string | null): UseFoiaAgencyContactsResult => {
  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ contacts: FoiaAgencyContactItem[] }>(
    orgId ? `${baseUrl}/foia/get-foia-agency-contacts?orgId=${orgId}` : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch FOIA agency contacts: ${res.status}. ${body}`);
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  return {
    contacts: data?.contacts ?? [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
};

// ─── UPSERT FOIA Agency Contact ───────────────────────────────────────────────

interface UseUpsertFoiaAgencyContactResult {
  upsertContact: (payload: FoiaAgencyContactCreateRequest) => Promise<FoiaAgencyContactItem>;
  isSaving: boolean;
}

export const useUpsertFoiaAgencyContact = (): UseUpsertFoiaAgencyContactResult => {
  const [isSaving, setIsSaving] = useState(false);

  const upsertContact = async (
    payload: FoiaAgencyContactCreateRequest
  ): Promise<FoiaAgencyContactItem> => {
    setIsSaving(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/foia/upsert-foia-agency-contact`;

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to upsert FOIA agency contact: ${res.status}. ${body}`);
      }

      const result = await res.json();
      return result.contact as FoiaAgencyContactItem;
    } finally {
      setIsSaving(false);
    }
  };

  return { upsertContact, isSaving };
};

// ─── DELETE FOIA Agency Contact ───────────────────────────────────────────────

interface UseDeleteFoiaAgencyContactResult {
  deleteContact: (orgId: string, agencyKey: string) => Promise<void>;
  isDeleting: boolean;
}

export const useDeleteFoiaAgencyContact = (): UseDeleteFoiaAgencyContactResult => {
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteContact = async (orgId: string, agencyKey: string): Promise<void> => {
    setIsDeleting(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const params = new URLSearchParams({ orgId, agencyKey });
      const url = `${baseUrl}/foia/delete-foia-agency-contact?${params.toString()}`;

      const res = await authFetcher(url, { method: 'DELETE' });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to delete FOIA agency contact: ${res.status}. ${body}`);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteContact, isDeleting };
};
