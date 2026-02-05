import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PROPOSAL_PK } from '../constants/proposal';
import { getProposal, proposalSK } from '../helpers/proposal';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { type ProposalDocument } from '@auto-rfp/shared';
import { nowIso } from '../helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

interface WordExportRequest {
  projectId: string;
  proposalId: string;
  opportunityId: string;
  options?: {
    pageLimitsPerSection?: number; // Maximum pages per section (optional)
    includeCitations?: boolean; // Include citations with references (optional)
  };
}

/**
 * Download template from S3 or create empty document if template doesn't exist
 */
async function getOrCreateTemplate(organizationId: string): Promise<Buffer> {
  try {
    const getCmd = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: `${organizationId}/template.docx`,
    });

    const response = await s3Client.send(getCmd);
    if (response.Body) {
      const buffer = await response.Body.transformToByteArray();
      return Buffer.from(buffer);
    }
  } catch (error) {
    console.warn(`Template not found for organization ${organizationId}, creating empty template`, error);
  }

  // Create empty template if not found
  const emptyDoc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: '',
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(emptyDoc);
}

/**
 * Merge proposal sections into template buffer by manipulating docx XML
 */
async function mergeProposalWithTemplate(
  templateBuffer: Buffer,
  proposalSections: Paragraph[],
): Promise<Buffer> {
  try {
    const zip = new JSZip();
    await zip.loadAsync(templateBuffer);

    const templateXml = await zip.file('word/document.xml')?.async('string');
    if (!templateXml) throw new Error('Invalid template: missing word/document.xml');

    // Build proposal doc -> extract its body content (WITHOUT its sectPr)
    const tempDoc = new Document({
      sections: [{ children: proposalSections }],
    });
    const proposalBuffer = await Packer.toBuffer(tempDoc);

    const proposalZip = new JSZip();
    await proposalZip.loadAsync(proposalBuffer);

    const proposalXml = await proposalZip.file('word/document.xml')?.async('string');
    if (!proposalXml) throw new Error('Failed to extract proposal document XML');

    // 1) Extract TEMPLATE body and TEMPLATE sectPr (keep this!)
    const templateBodyMatch = templateXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
    if (!templateBodyMatch?.[1]) throw new Error('Failed to extract template body');

    const templateBodyInner = templateBodyMatch[1];

    const templateSectPrMatch = templateBodyInner.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    if (!templateSectPrMatch?.[0]) {
      throw new Error('Template is missing w:sectPr (no header/footer bindings?)');
    }
    const templateSectPr = templateSectPrMatch[0];

    // Remove sectPr from template body content (we will re-add it at the end)
    const templateBodyContentWithoutSectPr = templateBodyInner.replace(templateSectPr, '');

    // 2) Extract PROPOSAL body content WITHOUT its sectPr
    const proposalBodyMatch = proposalXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
    if (!proposalBodyMatch?.[1]) throw new Error('Failed to extract proposal body');

    const proposalBodyInner = proposalBodyMatch[1];
    const proposalContentWithoutSectPr = proposalBodyInner.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, '');

    // 3) Merge: template content + proposal content + template sectPr (keeps headers/footers!)
    const mergedBodyInner =
      templateBodyContentWithoutSectPr +
      proposalContentWithoutSectPr +
      templateSectPr;

    const mergedXml = templateXml.replace(
      /<w:body>[\s\S]*?<\/w:body>/,
      `<w:body>${mergedBodyInner}</w:body>`,
    );

    zip.file('word/document.xml', mergedXml);

    return await zip.generateAsync({ type: 'nodebuffer' });
  } catch (error) {
    console.error('Error merging proposal with template:', error);

    // Fallback: standalone doc (no template header)
    const fallbackDoc = new Document({
      sections: [{ children: proposalSections }],
    });
    return await Packer.toBuffer(fallbackDoc);
  }
}


/**
 * Extract citations from content (looks for [1], [2], etc. patterns)
 */
function extractCitations(content: string): { cleanContent: string; citations: string[] } {
  const citations: string[] = [];
  const citationPattern = /\[(\d+)\]/g;
  const matches = content.match(citationPattern);

  if (matches) {
    matches.forEach((match) => {
      const num = match.replace(/[\[\]]/g, '');
      if (!citations.includes(num)) {
        citations.push(num);
      }
    });
  }

  return {
    cleanContent: content,
    citations: citations.sort((a, b) => parseInt(a) - parseInt(b)),
  };
}

/**
 * Estimate page count for content (rough approximation)
 * Assumes ~500 words per page, ~5 characters per word
 */
function estimatePageCount(content: string): number {
  const wordsPerPage = 500;
  const charsPerWord = 5;
  const charCount = content.length;
  const wordCount = charCount / charsPerWord;
  return Math.ceil(wordCount / wordsPerPage);
}

/**
 * Truncate content to fit within page limit
 */
function enforcePageLimit(content: string, maxPages: number): string {
  const wordsPerPage = 500;
  const charsPerWord = 5;
  const maxChars = maxPages * wordsPerPage * charsPerWord;

  if (content.length <= maxChars) {
    return content;
  }

  // Truncate and add ellipsis
  const truncated = content.substring(0, maxChars - 100);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > maxChars - 200) {
    return truncated.substring(0, lastPeriod + 1) + '\n\n[Content truncated due to page limit]';
  }
  return truncated + '...\n\n[Content truncated due to page limit]';
}

/**
 * Build proposal sections to append to template
 */
function buildProposalSections(
  document: ProposalDocument,
  options?: {
    pageLimitsPerSection?: number;
    includeCitations?: boolean;
  }
): Paragraph[] {
  const sections: Paragraph[] = [];
  const allCitations: Set<string> = new Set();

  // Add title
  sections.push(
    new Paragraph({
      text: document.proposalTitle,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 400 },
    }),
  );

  // Add customer name if available
  if (document.customerName) {
    sections.push(
      new Paragraph({
        text: `Customer: ${document.customerName}`,
        spacing: { after: 300 },
      }),
    );
  }

  // Add date
  sections.push(
    new Paragraph({
      text: `Date: ${new Date().toLocaleDateString()}`,
      spacing: { after: 600 },
    }),
  );

  // Add executive summary if available
  if (document.outlineSummary) {
    sections.push(
      new Paragraph({
        text: 'Executive Summary',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      }),
    );
    sections.push(
      new Paragraph({
        text: document.outlineSummary,
        spacing: { after: 400 },
        alignment: AlignmentType.JUSTIFIED,
      }),
    );
  }

  // Add proposal sections
  document.sections.forEach((section, sectionIndex) => {
    let sectionContent = '';

    sections.push(
      new Paragraph({
        text: `${sectionIndex + 1}. ${section.title}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      }),
    );

    // Section summary if available
    if (section.summary) {
      sectionContent += section.summary + '\n\n';
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.summary,
              italics: true,
            }),
          ],
          spacing: { after: 300 },
        }),
      );
    }

    // Subsections
    section.subsections.forEach((subsection, subIndex) => {
      sections.push(
        new Paragraph({
          text: `${sectionIndex + 1}.${subIndex + 1} ${subsection.title}`,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 200 },
        }),
      );

      // Subsection content
      let content = subsection.content || '';
      sectionContent += content + '\n\n';

      // Extract citations if needed
      if (options?.includeCitations) {
        const { cleanContent, citations } = extractCitations(content);
        citations.forEach(c => allCitations.add(c));
        content = cleanContent;
      }

      // Apply page limit if specified
      if (options?.pageLimitsPerSection) {
        const currentPageCount = estimatePageCount(sectionContent);
        if (currentPageCount > options.pageLimitsPerSection) {
          content = enforcePageLimit(content,
            Math.max(1, options.pageLimitsPerSection - estimatePageCount(sectionContent.replace(content, ''))));
        }
      }

      const contentParagraphs = content.split('\n\n');
      contentParagraphs.forEach((para) => {
        if (para?.trim()) {
          sections.push(
            new Paragraph({
              text: para.trim(),
              spacing: { after: 200 },
              alignment: AlignmentType.JUSTIFIED,
            }),
          );
        }
      });
    });

    // Page break between sections (except last)
    if (sectionIndex < document.sections.length - 1) {
      sections.push(new Paragraph({ pageBreakBefore: true }));
    }
  });

  // Add References section if citations were found
  if (options?.includeCitations && allCitations.size > 0) {
    sections.push(new Paragraph({ pageBreakBefore: true }));
    sections.push(
      new Paragraph({
        text: 'References',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
    );

    // Add placeholder references (in production, these would come from actual sources)
    Array.from(allCitations).forEach((citation) => {
      sections.push(
        new Paragraph({
          text: `[${citation}] Reference details to be provided by content management system`,
          spacing: { after: 100 },
          indent: { left: 360 },
        }),
      );
    });

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Note: Citation references will be populated when integrated with the content management system.',
            italics: true,
            size: 20,
          }),
        ],
        spacing: { before: 200 },
      }),
    );
  }

  return sections;
}

/**
 * Upload document to S3 and return presigned URL
 */
async function uploadAndGetPresignedUrl(
  buffer: Buffer,
  organizationId: string,
  projectId: string,
  opportunityId: string,
  proposalId: string,
  proposalTitle: string,
): Promise<{ key: string; url: string }> {
  const sanitizedTitle = proposalTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const key = `${organizationId}/${projectId}/${opportunityId}/${proposalId}/${sanitizedTitle}.docx`;

  const putCmd = new PutObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  await s3Client.send(putCmd);

  const getCmd = new GetObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(s3Client as any, getCmd, {
    expiresIn: PRESIGN_EXPIRES_IN,
  });

  return { key, url };
}

/**
 * Update proposal with docFileKey in DynamoDB
 */
async function updateProposalDocFileKey(
  projectId: string,
  proposalId: string,
  docFileKey: string,
): Promise<void> {
  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROPOSAL_PK,
      [SK_NAME]: proposalSK(projectId, proposalId),
    },
    UpdateExpression: 'SET docFileKey = :docFileKey, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':docFileKey': docFileKey,
      ':updatedAt': nowIso(),
    },
  });

  await docClient.send(cmd);
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    let body: WordExportRequest = JSON.parse(event.body);

    const { projectId, proposalId, opportunityId } = body;

    if (!projectId || !proposalId || !opportunityId) {
      return apiResponse(400, { message: 'projectId, proposalId, and opportunityId are required' });
    }

    // Retrieve proposal from DynamoDB
    const proposal = await getProposal(projectId, proposalId);
    if (!proposal) {
      return apiResponse(404, { message: 'Proposal not found' });
    }

    const organizationId = proposal.organizationId || getOrgId(event) || 'DEFAULT';

    // Get or create template document
    const templateBuffer = await getOrCreateTemplate(organizationId);

    // Build proposal sections with options
    const proposalSections = buildProposalSections(proposal.document, body.options);

    // Merge proposal with template
    const wordBuffer = await mergeProposalWithTemplate(templateBuffer, proposalSections);

    // Upload to S3 and get presigned URL
    const { key, url } = await uploadAndGetPresignedUrl(
      wordBuffer,
      organizationId,
      projectId,
      opportunityId,
      proposalId,
      proposal.document.proposalTitle,
    );

    // Update proposal with docFileKey
    await updateProposalDocFileKey(projectId, proposalId, key);

    return apiResponse(200, {
      success: true,
      proposal: {
        id: proposal.id,
        title: proposal.document.proposalTitle,
      },
      export: {
        format: 'docx',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
      },
      options: {
        pageLimitsPerSection: body.options?.pageLimitsPerSection,
        includeCitations: body.options?.includeCitations,
      },
    });
  } catch (err) {
    console.error('Error generating Word document:', err);
    return apiResponse(500, {
      message: 'Failed to generate Word document',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:export'))
    .use(httpErrorMiddleware()),
);