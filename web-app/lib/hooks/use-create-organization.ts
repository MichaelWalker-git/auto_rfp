import { Organization } from '@/types/organization';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env'

export function useCreateOrganization() {
  const create = async (payload: { name: string, description: string }): Promise<Organization> => {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error('No ID token found – user is not authenticated.');
    }

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