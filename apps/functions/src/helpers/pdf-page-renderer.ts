import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { uploadToS3 } from './s3';
import { requireEnv } from './env';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

type PageImage = {
  page: number;
  imageKey: string;
  width: number;
  height: number;
};

export const renderPdfPages = async (args: {
  fileKey: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}): Promise<PageImage[]> => {
  const { fileKey, orgId, projectId, opportunityId, documentId } = args;
  const bucket = getDocumentsBucket();

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
    { expiresIn: 300 },
  );

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 816, height: 1056 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // Use Chromium's built-in PDF rendering via a minimal page
    const html = `
<!DOCTYPE html><html><head>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs" type="module"></script>
</head><body style="margin:0;background:#fff;">
<div id="pages"></div>
<script type="module">
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs';
window.__pages=[];window.__done=false;window.__error=null;
async function render(){try{
const pdf=await pdfjsLib.getDocument('${presignedUrl}').promise;
for(let i=1;i<=pdf.numPages;i++){
const pg=await pdf.getPage(i);
const vp=pg.getViewport({scale:2.0});
const canvas=document.createElement('canvas');
canvas.width=vp.width;canvas.height=vp.height;
await pg.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
window.__pages.push({page:i,dataUrl:canvas.toDataURL('image/png'),width:vp.width,height:vp.height});
}
window.__done=true;
}catch(e){window.__error=e.message;window.__done=true;}}
render();
</script></body></html>`;

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForFunction('window.__done===true', { timeout: 60_000 });

    const error = await page.evaluate('window.__error');
    if (error) throw new Error(`PDF render failed: ${error}`);

    const pagesData = await page.evaluate('window.__pages') as Array<{
      page: number;
      dataUrl: string;
      width: number;
      height: number;
    }>;

    const results: PageImage[] = [];

    for (const pg of pagesData) {
      const base64 = pg.dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const imageKey = `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/pages/page-${pg.page}.png`;

      await uploadToS3(bucket, imageKey, buffer, 'image/png');

      results.push({
        page: pg.page,
        imageKey,
        width: pg.width / 2,
        height: pg.height / 2,
      });
    }

    return results;
  } finally {
    await browser.close();
  }
};
