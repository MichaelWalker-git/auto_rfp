import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { type QuestionFileItem } from '@auto-rfp/shared';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

const BASE = `${env.BASE_API_URL}/questionfile`;

type StartQuestionFilePayload = {
  projectId: string;
  oppId: string;
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
    const err = new Error(text || 'Failed to start question file pipeline') as Error & { status?: number };
    (err as any).status = res.status;
    throw err;
  }

  return res.json();
}

export function useStartQuestionFilePipeline() {
  return useSWRMutation<StartQuestionFileResponse, any, string, StartQuestionFilePayload>(
    `${BASE}/start-question-pipeline`,
    startQuestionFileFetcher,
  );
}

export function useQuestionFilesStatus(projectId: string, oppId: string, questionFileIds: string[]) {
  const idsKey = questionFileIds.slice().sort().join(',');

  return useSWR(
    idsKey && projectId ? `multi-status-${projectId}-${idsKey}` : null,
    async () => {
      const promises = questionFileIds.map(async (qfId) => {
        const url = `${BASE}/get-question-file?projectId=${encodeURIComponent(projectId)}&questionFileId=${encodeURIComponent(qfId)}&oppId=${encodeURIComponent(oppId)}`;

        const res = await authFetcher(url);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new Error(text || 'Failed to load question file status') as Error & { status?: number };
          err.status = res.status;
          throw err;
        }

        const data = await res.json();
        return { questionFileId: qfId, data };
      });

      return Promise.all(promises);
    },
    { refreshInterval: 2000, revalidateOnFocus: false },
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
  projectId: string;
  oppId: string;
  fileKey: string;
  originalFileName?: string;
  mimeType?: string;
  sourceDocumentId?: string;
}

export function useCreateQuestionFile(projectId: string, orgId?: string) {
  return useSWRMutation<QuestionFile, any, string, CreateQuestionFileArgs>(
    `${BASE}/create-question-file?projectId=${encodeURIComponent(projectId)}${orgId ? `&orgId=${encodeURIComponent(orgId)}` : ''}`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({
          orgId,
          oppId: arg.oppId,
          projectId,
          fileKey: arg.fileKey,
          originalFileName: arg.originalFileName,
          mimeType: arg.mimeType,
          sourceDocumentId: arg.sourceDocumentId,
        }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to create question file') as Error & { status?: number };
        (error as any).status = res.status;
        throw error;
      }

      return res.json() as Promise<QuestionFile>;
    },
  );
}

type Response = {
  items: QuestionFileItem[];
  nextToken: string | null;
};

export function useQuestionFiles(
  projectId: string | null,
  opts?: { oppId?: string | null; limit?: number },
) {
  const shouldFetch = !!projectId;
  const { oppId, limit } = opts ?? {};

  const url = shouldFetch
    ? `${BASE}/get-question-files?` +
    new URLSearchParams({
      projectId: projectId!,
      ...(oppId ? { oppId } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    }).toString()
    : null;

  const { data, error, isLoading, mutate } = useSWR<Response>(
    url,
    async (u: string) => {
      const res = await authFetcher(u);
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || 'Failed to load question files');
      }
      return (await res.json()) as Response;
    },
    { revalidateOnFocus: false },
  );

  return {
    items: data?.items ?? [],
    nextToken: data?.nextToken ?? null,

    isLoading,
    isError: !!error,
    error,

    refetch: () => mutate(),
  };
}

type DeleteQuestionFilePayload = {
  projectId: string;
  oppId: string;
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
  const full =
    `${url}?projectId=${encodeURIComponent(arg.projectId)}` +
    `&oppId=${encodeURIComponent(arg.oppId)}` +
    `&questionFileId=${encodeURIComponent(arg.questionFileId)}`;

  const res = await authFetcher(full, { method: 'DELETE' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || 'Failed to delete question file') as Error & { status?: number };
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
  return useSWRMutation<DeleteQuestionFileResponse, any, string, DeleteQuestionFilePayload>(
    `${BASE}/delete-question-file`,
    deleteQuestionFileFetcher,
  );
}

type StopQuestionPipelinePayload = {
  projectId: string;
  opportunityId: string;
  questionFileId: string;
};

type StopQuestionPipelineResponse = {
  ok: boolean;
  message: string;
};

export async function stopQuestionPipelineFetcher(
  url: string,
  { arg }: { arg: StopQuestionPipelinePayload },
): Promise<StopQuestionPipelineResponse> {
  const res = await authFetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || 'Failed to stop pipeline') as Error & { status?: number };
    (err as any).status = res.status;
    throw err;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true, message: 'Pipeline stopped' };

  try {
    return JSON.parse(raw) as StopQuestionPipelineResponse;
  } catch {
    return { ok: true, message: 'Pipeline stopped' };
  }
}

export function useStopQuestionPipeline() {
  return useSWRMutation<StopQuestionPipelineResponse, any, string, StopQuestionPipelinePayload>(
    `${BASE}/stop-question-pipeline`,
    stopQuestionPipelineFetcher,
  );
}