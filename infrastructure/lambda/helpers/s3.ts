import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';


export const s3 = new S3Client({});

export async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

export async function loadTextFromS3(bucket: string, key: string): Promise<string> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return streamToString(res.Body);
  } catch (err) {
    return ''
  }
}

export async function uploadToS3(bucket: string, key: string, body: Buffer | string, contentType?: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getFileFromS3(bucket: string, key: string) {
  const obj =  await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!obj.Body) throw new Error('S3 object body is empty');
  return obj.Body;
}