import { Organization } from '@/types/organization';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';

export function useGetOrganizationById() {
  const getById = async (id: string): Promise<Organization> => {
    if (!id) {
      throw new Error('Organization id is required');
    }

    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error('No ID token found – user is not authenticated.');
    }

    // Adjust the path if your API is different, e.g. /organizations/${id}
    const base = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${base}/organization/${encodeURIComponent(id)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new Error(`Organization not found. Body: ${body}`);
      }
      throw new Error(
        `Failed to fetch organization. Status: ${res.status}. Body: ${body}`,
      );
    }

    return (await res.json()) as Organization;
  };

  return { getOrganizationById: getById };
}
