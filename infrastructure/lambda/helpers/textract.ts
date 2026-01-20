import { GetDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';

const textract = new TextractClient({});

interface TextractResult {
  text: string;
  status: string;
}


export async function getTextractText(jobId: string): Promise<TextractResult> {
  let nextToken: string | undefined;
  const lines: string[] = [];
  let jobStatus: string | undefined;

  do {
    const res: any = await textract.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken
      })
    );

    jobStatus = res.JobStatus;
    if (!jobStatus) return { text: '', status: 'UNKNOWN' };
    if (jobStatus !== 'SUCCEEDED')
      return { text: '', status: jobStatus };

    if (Array.isArray(res.Blocks)) {
      for (const block of res.Blocks) {
        if (block.BlockType === 'LINE' && block.Text) {
          lines.push(block.Text);
        }
      }
    }

    nextToken = res.NextToken;
  } while (nextToken);

  return {
    text: lines.join('\n'),
    status: jobStatus
  };
}