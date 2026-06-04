import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import JSZip from 'jszip';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '@/sentry-lambda';
import { listRequiredFormsByOpportunity, type RequiredFormDBItem } from '@/helpers/required-form';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { sanitizeFileName } from '@/helpers/export';
import { getFileFromS3 } from '@/helpers/s3';
import { fillPdfForm } from '@/helpers/pdf-form-filler';
import { parsePageRange } from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

type ExportMode = 'individual' | 'merged';

interface ExportAllRequiredFormsRequest {
  projectId: string;
  opportunityId: string;
  mode?: ExportMode;
  documentIds?: string[]; // formIds when mode is 'merged'
  format?: 'pdf'; // Only PDF supported for now
  fileName?: string;
  options?: {
    pageSize?: 'letter' | 'a4';
    pageBreakBetween?: boolean;
  };
}

interface ExportedFormInfo {
  formId: string;
  name: string;
  formats: string[];
  skipped: boolean;
  skipReason?: string;
}

const buildExportAllS3Key = (
  orgId: string,
  projectId: string,
  opportunityId: string,
): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${orgId}/${projectId}/${opportunityId}/required-forms/exports/all-forms-${timestamp}.zip`;
};

const buildMergedS3Key = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  format: string,
): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${orgId}/${projectId}/${opportunityId}/required-forms/exports/merged-forms-${timestamp}.${format}`;
};


/**
 * Export a single filled PDF form, extracting only the specified pages
 */
const exportFilledForm = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  form: RequiredFormDBItem,
): Promise<{ buffer: Buffer | null; error?: string }> => {
  const outputKey = `${orgId}/${projectId}/${opportunityId}/required-forms/${form.formId}/export-temp.pdf`;

  try {
    // Fill the PDF form
    await fillPdfForm({
      sourceFileKey: form.sourceFileKey,
      fields: form.fields,
      outputKey,
    });

    // Retrieve the filled PDF
    const filledObj = await s3Client.send(
      new GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: outputKey,
      }),
    );

    const filledBytes = await filledObj.Body?.transformToByteArray();
    if (!filledBytes) {
      return { buffer: null, error: 'Failed to read filled PDF' };
    }

    // If sourcePageRange is specified, extract only those pages
    if (form.sourcePageRange) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const filledPdf = await PDFDocument.load(filledBytes);
        const pageSet = parsePageRange(form.sourcePageRange);

        if (!pageSet || pageSet.size === 0) {
          console.warn(`Empty or invalid page range "${form.sourcePageRange}" for form "${form.name}"`);
          return { buffer: Buffer.from(filledBytes) };
        }

        // Convert 1-indexed Set to 0-indexed array for pdf-lib
        const pageIndices = Array.from(pageSet).map(p => p - 1);

        // Validate indices against actual PDF page count
        const pageCount = filledPdf.getPageCount();
        const validIndices = pageIndices.filter(i => i >= 0 && i < pageCount);

        if (validIndices.length === 0) {
          console.warn(
            `No valid pages in range "${form.sourcePageRange}" for form "${form.name}" (PDF has ${pageCount} pages) - using full PDF`,
          );
          return { buffer: Buffer.from(filledBytes) };
        }

        if (validIndices.length < pageIndices.length) {
          const invalidCount = pageIndices.length - validIndices.length;
          console.warn(
            `Page range "${form.sourcePageRange}" for form "${form.name}" contains ${invalidCount} out-of-bounds pages (PDF has ${pageCount} pages) - extracting ${validIndices.length} valid pages`,
          );
        }

        // Create new PDF with only valid pages
        const extractedPdf = await PDFDocument.create();
        const copiedPages = await extractedPdf.copyPages(filledPdf, validIndices);
        copiedPages.forEach(page => extractedPdf.addPage(page));

        const extractedBytes = await extractedPdf.save();
        return { buffer: Buffer.from(extractedBytes) };
      } catch (extractErr) {
        console.error(`Failed to extract pages for form "${form.name}":`, extractErr);
        return { buffer: null, error: 'Failed to extract form pages' };
      }
    }

    return { buffer: Buffer.from(filledBytes) };
  } catch (err) {
    console.error(`Failed to export form "${form.name}" (${form.formId}):`, err);
    return { buffer: null, error: err instanceof Error ? err.message : 'Export failed' };
  } finally {
    // Clean up temporary file to prevent S3 storage leak
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: outputKey,
        }),
      );
    } catch (cleanupErr) {
      console.warn(`Failed to delete temp file ${outputKey}:`, cleanupErr);
      // Don't fail the export if cleanup fails
    }
  }
};

/**
 * Handle merged export mode - combine multiple PDFs into one
 */
const handleMergedExport = async (
  event: AuthedEvent,
  body: ExportAllRequiredFormsRequest,
): Promise<APIGatewayProxyResultV2> => {
  const { projectId, opportunityId, documentIds = [], fileName, options } = body;
  const orgId = getOrgId(event) || 'DEFAULT';
  const pageBreakBetween = options?.pageBreakBetween ?? true;

  if (!projectId || !opportunityId) {
    return apiResponse(400, { message: 'projectId and opportunityId are required' });
  }

  if (documentIds.length === 0) {
    return apiResponse(400, { message: 'At least one form must be selected for merged export' });
  }

  // Fetch all forms for the opportunity
  const allForms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });

  // Filter to selected forms with fields
  const selectedForms = allForms.filter(
    (f) => documentIds.includes(f.formId) && f.fields.length > 0 && f.sourceFileKey,
  );

  if (selectedForms.length === 0) {
    return apiResponse(400, { message: 'No exportable forms found in selection' });
  }

  // Import pdf-lib for merging
  const { PDFDocument } = await import('pdf-lib');

  // Fill all forms in parallel for faster export
  const fillResults = await Promise.all(
    selectedForms.map((form) => exportFilledForm(orgId, projectId, opportunityId, form)),
  );

  // Create merged PDF document
  const mergedPdf = await PDFDocument.create();
  const exportedForms: ExportedFormInfo[] = [];

  for (let i = 0; i < selectedForms.length; i++) {
    const form = selectedForms[i];
    const { buffer, error } = fillResults[i];

    if (buffer) {
      try {
        const pdfDoc = await PDFDocument.load(buffer);
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach(page => mergedPdf.addPage(page));

        // Add blank page break between forms if requested (except after last form)
        if (pageBreakBetween && i < selectedForms.length - 1) {
          mergedPdf.addPage();
        }

        exportedForms.push({
          formId: form.formId,
          name: form.name,
          formats: ['pdf'],
          skipped: false,
        });
      } catch (pdfErr) {
        console.error(`Failed to merge PDF for form "${form.name}":`, pdfErr);
        exportedForms.push({
          formId: form.formId,
          name: form.name,
          formats: [],
          skipped: true,
          skipReason: 'Failed to merge PDF',
        });
      }
    } else {
      exportedForms.push({
        formId: form.formId,
        name: form.name,
        formats: [],
        skipped: true,
        skipReason: error || 'Failed to export form',
      });
    }
  }

  // Check if any forms were successfully merged
  const successfulExports = exportedForms.filter((f) => !f.skipped);
  if (successfulExports.length === 0) {
    return apiResponse(500, {
      message: 'Failed to merge any forms. Please try again.',
      forms: exportedForms,
    });
  }

  // Save merged PDF
  const mergedPdfBytes = await mergedPdf.save();
  const mergedBuffer = Buffer.from(mergedPdfBytes);

  // Upload to S3
  const s3Key = buildMergedS3Key(orgId, projectId, opportunityId, 'pdf');
  await s3Client.send(
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      Body: mergedBuffer,
      ContentType: 'application/pdf',
    }),
  );

  const defaultFileName = fileName?.trim() || 'Merged Required Forms';
  const finalFileName = `${defaultFileName}.pdf`;

  // Generate presigned URL
  const url = await getSignedUrl(
    s3Client as Parameters<typeof getSignedUrl>[0],
    new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ResponseContentDisposition: `attachment; filename="${finalFileName}"`,
    }),
    { expiresIn: PRESIGN_EXPIRES_IN },
  );

  setAuditContext(event, {
    action: 'DOCUMENTS_BULK_EXPORTED',
    resource: 'document',
    resourceId: opportunityId,
  });

  return apiResponse(200, {
    success: true,
    fileName: finalFileName,
    url,
    documentCount: successfulExports.length,
    format: 'pdf',
  });
};

/**
 * Handle individual export mode - export each form as a separate file in a ZIP
 */
export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body = JSON.parse(event.body) as ExportAllRequiredFormsRequest;

    // Delegate to merged export if mode is 'merged'
    if (body.mode === 'merged') {
      return handleMergedExport(event, body);
    }

    const { projectId, opportunityId } = body;

    if (!projectId || !opportunityId) {
      return apiResponse(400, { message: 'projectId and opportunityId are required' });
    }

    const orgId = getOrgId(event) || 'DEFAULT';

    // List all required forms for this opportunity
    const forms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });

    // Filter to only forms with fields and source files
    const exportableForms = forms.filter(
      (form) => form.fields.length > 0 && form.sourceFileKey,
    );

    if (exportableForms.length === 0) {
      return apiResponse(400, {
        message: 'No forms available for export. Complete forms first.',
      });
    }

    const zip = new JSZip();
    const exportedForms: ExportedFormInfo[] = [];

    // Process each form
    for (const form of exportableForms) {
      const { buffer, error } = await exportFilledForm(orgId, projectId, opportunityId, form);

      if (buffer) {
        const sanitizedName = sanitizeFileName(form.name).slice(0, 80);
        const uniqueId = form.formId.slice(0, 8);
        zip.file(`${sanitizedName}-${uniqueId}.pdf`, buffer);
        exportedForms.push({
          formId: form.formId,
          name: form.name,
          formats: ['pdf'],
          skipped: false,
        });
      } else {
        exportedForms.push({
          formId: form.formId,
          name: form.name,
          formats: [],
          skipped: true,
          skipReason: error || 'Export conversion failed',
        });
      }
    }

    // Check if any forms were actually exported
    const successfulExports = exportedForms.filter((f) => !f.skipped);
    if (successfulExports.length === 0) {
      return apiResponse(500, {
        message: 'Failed to export any forms. Please try again.',
        forms: exportedForms,
      });
    }

    // Generate the ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // Upload ZIP to S3
    const s3Key = buildExportAllS3Key(orgId, projectId, opportunityId);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: s3Key,
        Body: zipBuffer,
        ContentType: 'application/zip',
      }),
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `Required-Forms-Export-${timestamp}.zip`;

    // Generate presigned URL with Content-Disposition to force download
    const url = await getSignedUrl(
      s3Client as Parameters<typeof getSignedUrl>[0],
      new GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${zipFileName}"`,
      }),
      { expiresIn: PRESIGN_EXPIRES_IN },
    );

    setAuditContext(event, {
      action: 'DOCUMENTS_BULK_EXPORTED',
      resource: 'document',
      resourceId: opportunityId,
    });

    return apiResponse(200, {
      success: true,
      export: {
        url,
        fileName: zipFileName,
        bucket: DOCUMENTS_BUCKET,
        key: s3Key,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: 'application/zip',
        sizeBytes: zipBuffer.length,
      },
      summary: {
        totalForms: exportableForms.length,
        exportedForms: successfulExports.length,
        skippedForms: exportedForms.filter((f) => f.skipped).length,
        formats: ['pdf'],
      },
      forms: exportedForms,
    });
  } catch (err) {
    console.error('Error in export-all-required-forms:', err);
    return apiResponse(500, {
      message: 'Failed to export forms',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
