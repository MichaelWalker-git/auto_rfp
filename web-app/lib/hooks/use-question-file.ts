import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { fetchAuthSession } from 'aws-amplify/auth';

import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

const BASE = `${env.BASE_API_URL}/questionfile`;

type StartQuestionFilePayload = {
  projectId: string;
  questionFileId: string;
};

type StartQuestionFileResponse = {
  questionFileId: string;
  status: 'processing' | 'text_ready' | 'questions_extracted' | 'error';
};

export async function startQuestionFileFetcher(
  url: string,
  { arg }: { arg: StartQuestionFilePayload },
): Promise<StartQuestionFileResponse> {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || 'Failed to start question file pipeline') as Error & {
      status?: number;
    };
    (err as any).status = res.status;
    throw err;
  }

  return res.json();
}

/**
 * POST /questionfile/start-pipeline
 * body: { projectId, fileKey }
 * response: { questionFileId, status }
 */
export function useStartQuestionFilePipeline(projectId: string) {
  return useSWRMutation<StartQuestionFileResponse, any, string, StartQuestionFilePayload>(
    `${BASE}/start-question-pipeline`,
    startQuestionFileFetcher,
  );
}

type QuestionFileStatusResponse = {
  questionFileId: string;
  projectId: string;
  status: 'processing' | 'text_ready' | 'questions_extracted' | 'error';
  fileKey?: string;
  textFileKey?: string;
  updatedAt?: string;
  errorMessage?: string;
};

/**
 * GET /questionfile/get-question-file?projectId=...&id=...
 * response: QuestionFileStatusResponse
 */
export function useQuestionFileStatus(
  projectId: string | null,
  questionFileId: string | null,
) {
  const key =
    projectId && questionFileId
      ? `${BASE}/get-question-file?projectId=${projectId}&id=${questionFileId}`
      : null;

  return useSWR<QuestionFileStatusResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(text || 'Failed to load question file status') as Error & {
          status?: number;
        };
        (err as any).status = res.status;
        throw err;
      }
      return res.json();
    },
    {
      // Poll every 3s while we have an id
      refreshInterval: questionFileId ? 3000 : 0,
    },
  );
}

export interface QuestionFile {
  questionFileId: string;
  projectId: string;
  fileKey: string;
  textFileKey?: string | null;
  status: 'uploaded' | 'processing' | 'text_ready' | 'questions_extracted' | 'error';
  originalFileName?: string | null;
  mimeType?: string | null;
  sourceDocumentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuestionFileArgs {
  fileKey: string;
  originalFileName?: string;
  mimeType?: string;
  sourceDocumentId?: string;
}

export function useCreateQuestionFile(projectId: string) {
  return useSWRMutation<QuestionFile, any, string, CreateQuestionFileArgs>(
    `${BASE}/create-question-file`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          fileKey: arg.fileKey,
          originalFileName: arg.originalFileName,
          mimeType: arg.mimeType,
          sourceDocumentId: arg.sourceDocumentId,
        }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(
          message || 'Failed to create question file',
        ) as Error & { status?: number };
        (error as any).status = res.status;
        throw error;
      }

      return res.json() as Promise<QuestionFile>;
    },
  );
}
