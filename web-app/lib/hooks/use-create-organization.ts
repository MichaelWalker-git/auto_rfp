import { Organization } from '@/types/organization';
import { env } from '@/lib/env';
import { useAuth } from '@/components/AuthProvider';

export function useCreateOrganization() {
  const { getIdToken } = useAuth();
  const token = getIdToken().toString();

  const create = async (payload: { name: string, slug: string, description: string }): Promise<Organization> => {

    const url = `${env.BASE_API_URL.replace(/\/$/, '')}/organization/create-organization`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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