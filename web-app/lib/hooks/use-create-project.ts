import { Project } from '@/types/project';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';
import { breadcrumbs } from '@/lib/sentry';
import { authFetcher } from '@/lib/auth/auth-fetcher';

type CreateProjectPayload = {
  orgId: string;
  name: string;
  description?: string;
};

export function useCreateProject() {
  const create = async (payload: CreateProjectPayload): Promise<Project> => {
    const url = `${env.BASE_API_URL}/projects/create`;

    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to create project. Status: ${res.status}. Body: ${body}`,
      );
    }

    const project = (await res.json()) as Project;
    breadcrumbs.projectCreated(project.id, project.name);
    return project;
  };

  return { createProject: create };
}