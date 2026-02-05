import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

export interface DeleteOrganizationResponse {
  success: boolean;
  message: string;
  id: string;
}

export function useDeleteOrganization() {
  const deleteOrganization = async (orgId: string): Promise<DeleteOrganizationResponse> => {
    const url = `${env.BASE_API_URL}/organization/delete-organization`;
    
    const res = await authFetcher(`${url}/${encodeURIComponent(orgId)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to delete organization. Status: ${res.status}. Body: ${body}`,
      );
    }

    return (await res.json()) as DeleteOrganizationResponse;
  };

  return { deleteOrganization };
}