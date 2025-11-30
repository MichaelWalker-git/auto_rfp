import { Project } from '@/types/project';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';

type CreateProjectPayload = {
  orgId: string;
  name: string;
  description?: string;
};

export function useCreateProject() {
  const create = async (payload: CreateProjectPayload): Promise<Project> => {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error('No ID token found – user is not authenticated.');
    }

    const base = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${base}/project/create-project`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to create project. Status: ${res.status}. Body: ${body}`,
      );
    }

    return (await res.json()) as Project;
  };

  return { createProject: create };
}