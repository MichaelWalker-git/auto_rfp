import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { type QuestionFileItem } from '@auto-rfp/shared';
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


export function useQuestionFiles(projectId: string | null) {
  const shouldFetch = !!projectId;

  const url = shouldFetch
    ? `${env.BASE_API_URL}/questionfile/get-question-files?projectId=${encodeURIComponent(
      projectId!,
    )}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<{ items: QuestionFileItem[] }>(
    url,
    async (u: string) => {
      const res = await authFetcher(u);
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to load question files'));
      return (await res.json()) as { items: QuestionFileItem[] };
    },
  );

  return {
    items: data?.items ?? [],
    data,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}

type DeleteQuestionFilePayload = {
  projectId: string;
  questionFileId: string;
};

type DeleteQuestionFileResponse = {
  success: boolean;
  deleted?: {
    projectId: string;
    questionFileId: string;
    sk?: string;
    fileKey?: string | null;
    textFileKey?: string | null;
  };
};

export async function deleteQuestionFileFetcher(
  url: string,
  { arg }: { arg: DeleteQuestionFilePayload },
): Promise<DeleteQuestionFileResponse> {
  const full = `${url}?projectId=${encodeURIComponent(arg.projectId)}&questionFileId=${encodeURIComponent(
    arg.questionFileId,
  )}`;

  const res = await authFetcher(full, { method: 'DELETE' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || 'Failed to delete question file') as Error & {
      status?: number;
    };
    (err as any).status = res.status;
    throw err;
  }
  const raw = await res.text().catch(() => '');
  if (!raw) return { success: true };

  try {
    return JSON.parse(raw) as DeleteQuestionFileResponse;
  } catch {
    return { success: true };
  }
}

export function useDeleteQuestionFile() {
  return useSWRMutation<
    DeleteQuestionFileResponse,
    any,
    string,
    DeleteQuestionFilePayload
  >(`${BASE}/delete-question-file`, deleteQuestionFileFetcher);
}
