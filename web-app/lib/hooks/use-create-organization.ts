import { Organization } from '@/types/organization';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

export function useCreateOrganization() {
  const create = async (payload: { name: string, slug: string, description: string }): Promise<Organization> => {
    const url = `${env.BASE_API_URL}/organization/create-organization`;

    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to create organization. Status: ${res.status}. Body: ${body}`,
      );
    }

    return (await res.json()) as Organization;
  };

  return { createOrganization: create };
}
