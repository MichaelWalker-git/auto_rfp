import { Project } from '@/types/project';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

type UpdateProjectPayload = {
  orgId: string;
  projectId: string;
  name: string;
  description?: string;
};

export function useUpdateProject() {
  const update = async (payload: UpdateProjectPayload): Promise<Project> => {
    const base = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${base}/project/edit-project?orgId=${payload.orgId}&projectId=${payload.projectId}`;

    const res = await authFetcher(url, {
      method: 'PUT',
      body: JSON.stringify({
        name: payload.name,
        description: payload.description,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to update project. Status: ${res.status}. Body: ${body}`,
      );
    }

    return (await res.json()) as Project;
  };

  return { updateProject: update };
}