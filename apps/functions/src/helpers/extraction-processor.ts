import { invokeModel } from '@/helpers/bedrock-http-client';
import { getFileFromS3, loadTextFromS3 } from '@/helpers/s3';
import { createDraftPastProjectRecord, checkDuplicatePastProject, listDraftRecords, createDraftLaborRateRecord, checkDuplicateLaborRate, createDraftBOMItemRecord } from '@/helpers/extraction';
import { type PastProjectDraft, type LaborRateDraft } from '@auto-rfp/core';
import { listPastProjects } from '@/helpers/past-performance';
import { getLaborRatesByOrg } from '@/helpers/pricing';
import { requireEnv } from '@/helpers/env';
import {
  ExtractedPastProjectSchema,
  PAST_PERF_EXTRACTION_SYSTEM_PROMPT,
  createPastPerfExtractionUserPrompt,
  ExtractedLaborRateSchema,
  PRICING_EXTRACTION_SYSTEM_PROMPT,
  createPricingExtractionUserPrompt,
  ExtractedBOMItemSchema,
  BOM_EXTRACTION_SYSTEM_PROMPT,
  createBOMExtractionUserPrompt,
} from '@/constants/extraction-prompts';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Use Claude 3 Haiku for cost-effective extraction
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0');

/** Load document text from S3 based on file type */
const loadDocumentText = async (documentsBucket: string, s3Key: string, fileName: string): Promise<string> => {
  const lowerFileName = fileName.toLowerCase();
  const lowerKey = s3Key.toLowerCase();
  
  const isDocx = lowerFileName.endsWith('.docx') || lowerFileName.endsWith('.doc') ||
                 lowerKey.endsWith('.docx') || lowerKey.endsWith('.doc');
  const isPdf = lowerFileName.endsWith('.pdf') || lowerKey.endsWith('.pdf');
  const isCsv = lowerFileName.endsWith('.csv') || lowerKey.endsWith('.csv');
  const isXlsx = lowerFileName.endsWith('.xlsx') || lowerFileName.endsWith('.xls') ||
                 lowerKey.endsWith('.xlsx') || lowerKey.endsWith('.xls');
  
  if (isDocx) {
    console.log('Processing DOCX file with mammoth');
    const fileStream = await getFileFromS3(documentsBucket, s3Key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of fileStream as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const { value: text } = await mammoth.extractRawText({ buffer });
    return text;
  }
  
  if (isPdf) {
    console.log('Processing PDF file with pdf-parse');
    const fileStream = await getFileFromS3(documentsBucket, s3Key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of fileStream as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    try {
      const pdfParse = require('pdf-parse/lib/pdf-parse');
      const pdfResult = await pdfParse(buffer);
      return pdfResult.text || '';
    } catch (pdfErr) {
      console.warn('pdf-parse failed:', pdfErr);
      return '';
    }
  }
  
  if (isCsv) {
    console.log('Processing CSV file');
    const fileStream = await getFileFromS3(documentsBucket, s3Key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of fileStream as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    // Parse CSV as a workbook to get consistent formatting
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return convertWorkbookToText(workbook);
  }
  
  if (isXlsx) {
    console.log('Processing Excel file (XLSX/XLS)');
    const fileStream = await getFileFromS3(documentsBucket, s3Key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of fileStream as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return convertWorkbookToText(workbook);
  }
  
  return await loadTextFromS3(documentsBucket, s3Key);
};

/** Convert Excel/CSV workbook to structured text for AI extraction */
const convertWorkbookToText = (workbook: XLSX.WorkBook): string => {
  const textParts: string[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    
    // Convert to array of arrays for easier processing
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    if (!data || data.length === 0) continue;
    
    textParts.push(`\n=== Sheet: ${sheetName} ===\n`);
    
    // First row is typically headers
    const headers = (data[0] ?? []) as unknown[];
    if (headers.length > 0) {
      textParts.push(`Headers: ${headers.join(' | ')}\n`);
    }
    
    // Process data rows
    for (let i = 1; i < data.length; i++) {
      const row = (data[i] ?? []) as unknown[];
      if (!row || row.length === 0 || row.every(cell => cell === null || cell === undefined || cell === '')) continue;
      
      // Format row with header labels if available
      const formattedCells: string[] = [];
      for (let j = 0; j < row.length; j++) {
        const cellValue = row[j];
        if (cellValue === null || cellValue === undefined || cellValue === '') continue;
        
        const headerLabel = headers[j] ? `${headers[j]}: ` : '';
        formattedCells.push(`${headerLabel}${cellValue}`);
      }
      
      if (formattedCells.length > 0) {
        textParts.push(`Row ${i}: ${formattedCells.join(' | ')}`);
      }
    }
  }
  
  return textParts.join('\n');
};

/** Parse JSON array from AI response text */
const parseJsonFromResponse = (textContent: string): unknown[] | null => {
  let jsonStr = textContent.trim();
  
  if (jsonStr.includes('```json')) {
    const start = jsonStr.indexOf('```json') + 7;
    const end = jsonStr.indexOf('```', start);
    jsonStr = end > start ? jsonStr.slice(start, end) : jsonStr.slice(start);
  } else if (jsonStr.includes('```')) {
    const start = jsonStr.indexOf('```') + 3;
    const end = jsonStr.indexOf('```', start);
    jsonStr = end > start ? jsonStr.slice(start, end) : jsonStr.slice(start);
  }
  
  const arrayStart = jsonStr.indexOf('[');
  const arrayEnd = jsonStr.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);
  } else {
    const objStart = jsonStr.indexOf('{');
    const objEnd = jsonStr.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      jsonStr = jsonStr.slice(objStart, objEnd + 1);
    }
  }
  
  try {
    const parsed = JSON.parse(jsonStr.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
};

/** Call Bedrock model and extract text response */
const callBedrockForExtraction = async (systemPrompt: string, userPrompt: string): Promise<string | null> => {
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
  
  const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
    content?: Array<{ type: string; text?: string }>;
  };
  
  return parsed.content?.find((c) => c.type === 'text')?.text ?? null;
};

export interface ExtractPastPerformanceInput {
  orgId: string;
  jobId: string;
  s3Key: string;
  fileName: string;
  userId: string;
}

/**
 * Extracts past performance projects from a document
 * Returns array of created draft IDs
 */
export const extractPastPerformanceFromDocument = async (
  input: ExtractPastPerformanceInput
): Promise<string[]> => {
  const { orgId, jobId, s3Key, fileName, userId } = input;
  const documentsBucket = requireEnv('DOCUMENTS_BUCKET');

  console.log(`Extracting past performance from ${fileName} (${s3Key})`);

  // 1. Load document text
  const docText = await loadDocumentText(documentsBucket, s3Key, fileName);
  if (!docText || docText.trim().length === 0) {
    console.warn(`Document ${fileName} is empty or could not be parsed`);
    return [];
  }
  console.log(`Loaded document text: ${docText.length} characters`);
  console.log(`Document text preview: ${docText.slice(0, 500)}`);

  // 2. Call Bedrock to extract past performance
  const textContent = await callBedrockForExtraction(
    PAST_PERF_EXTRACTION_SYSTEM_PROMPT,
    createPastPerfExtractionUserPrompt(docText)
  );
  if (!textContent) {
    console.warn('No text content in Bedrock response');
    return [];
  }

  console.log('AI raw response (first 1000 chars):', textContent.slice(0, 1000));
  
  const extractedProjects = parseJsonFromResponse(textContent);
  if (!extractedProjects) {
    console.error('Failed to parse extraction response');
    return [];
  }
  console.log('Parsed JSON projects count:', extractedProjects.length);

  console.log(`Extracted ${extractedProjects.length} projects from document`);

  // 3. Validate and create drafts
  const draftIds: string[] = [];

  // Get existing projects for duplicate detection
  const existingProjectsResult = await listPastProjects(orgId);
  const existingDrafts = await listDraftRecords<PastProjectDraft>('PAST_PERFORMANCE', orgId);
  const allExisting = [
    ...existingProjectsResult.items.map((p) => ({
      projectId: p.projectId,
      title: p.title,
      client: p.client,
      contractNumber: p.contractNumber,
      value: p.value,
    })),
    ...existingDrafts.map((d) => ({
      projectId: d.projectId,
      title: d.title,
      client: d.client,
      contractNumber: d.contractNumber,
      value: d.value,
    })),
  ];

  for (const rawProject of extractedProjects) {
    const validated = ExtractedPastProjectSchema.safeParse(rawProject);
    if (!validated.success) {
      console.warn('Project failed validation:', validated.error.issues);
      continue;
    }

    const project = validated.data;

    // Check for duplicates
    const duplicateWarning = await checkDuplicatePastProject(orgId, {
      title: project.title,
      client: project.client,
      contractNumber: project.contractNumber,
      value: project.value,
    }, allExisting);

    // Create draft
    const draft = await createDraftPastProjectRecord({
      orgId,
      title: project.title,
      client: project.client,
      contractNumber: project.contractNumber ?? null,
      startDate: project.startDate ?? null,
      endDate: project.endDate ?? null,
      value: project.value ?? null,
      description: project.description,
      technicalApproach: project.technicalApproach ?? null,
      achievements: project.achievements,
      performanceRating: project.performanceRating ?? null,
      domain: project.domain ?? null,
      technologies: project.technologies,
      naicsCodes: project.naicsCodes,
      contractType: project.contractType ?? null,
      setAside: project.setAside ?? null,
      teamSize: project.teamSize ?? null,
      durationMonths: project.durationMonths ?? null,
      clientPOC: project.clientPOC ?? null,
      extractionSource: {
        sourceType: 'DIRECT_UPLOAD',
        sourceDocumentKey: s3Key,
        sourceDocumentName: fileName,
        sourceChunkKeys: [s3Key],
        extractedAt: new Date().toISOString(),
        extractedBy: userId,
        extractionJobId: jobId,
      },
      fieldConfidence: {
        title: project.confidence.title,
        client: project.confidence.client,
        contractNumber: project.confidence.contractNumber,
        value: project.confidence.value,
        description: project.confidence.description,
        achievements: project.confidence.achievements,
        domain: project.confidence.domain,
        technologies: project.confidence.technologies,
        overall: project.confidence.overall,
      },
      duplicateWarning,
    });

    draftIds.push(draft.projectId);
    console.log(`Created draft: ${draft.projectId} - "${project.title}"`);

    // Add to existing for next duplicate check
    allExisting.push({
      projectId: draft.projectId,
      title: project.title,
      client: project.client,
      contractNumber: project.contractNumber,
      value: project.value,
    });
  }

  console.log(`Created ${draftIds.length} drafts from ${fileName}`);
  return draftIds;
};

export type ExtractLaborRatesInput = ExtractPastPerformanceInput;

/**
 * Extracts labor rates from a document (rate cards, GSA schedules, etc.)
 * Returns array of created labor rate IDs
 */
export const extractLaborRatesFromDocument = async (
  input: ExtractLaborRatesInput
): Promise<string[]> => {
  const { orgId, s3Key, fileName } = input;
  const documentsBucket = requireEnv('DOCUMENTS_BUCKET');

  console.log(`Extracting labor rates from ${fileName} (${s3Key})`);

  // 1. Load document text using shared helper
  const docText = await loadDocumentText(documentsBucket, s3Key, fileName);
  if (!docText || docText.trim().length === 0) {
    console.warn(`Document ${fileName} is empty or could not be parsed`);
    return [];
  }
  console.log(`Loaded document text: ${docText.length} characters`);
  console.log(`Document text preview: ${docText.slice(0, 500)}`);

  // 2. Call Bedrock to extract labor rates
  const textContent = await callBedrockForExtraction(
    PRICING_EXTRACTION_SYSTEM_PROMPT,
    createPricingExtractionUserPrompt(docText)
  );
  if (!textContent) {
    console.warn('No text content in Bedrock response');
    return [];
  }

  console.log('AI raw response (first 1000 chars):', textContent.slice(0, 1000));
  
  const extractedRates = parseJsonFromResponse(textContent);
  if (!extractedRates) {
    console.error('Failed to parse extraction response');
    return [];
  }
  console.log(`Extracted ${extractedRates.length} labor rates from document`);

  // 3. Validate and create DRAFT labor rates (not actual labor rates)
  const draftIds: string[] = [];

  // Get existing labor rates for duplicate detection
  const existingRates = await getLaborRatesByOrg(orgId);
  const existingDrafts = await listDraftRecords<LaborRateDraft>('LABOR_RATE', orgId);
  console.log(`[Duplicate Detection] Found ${existingRates.length} existing labor rates, ${existingDrafts.length} existing drafts`);
  if (existingRates.length > 0) {
    console.log(`[Duplicate Detection] Existing positions: ${existingRates.map(r => r.position).join(', ')}`);
  }
  const allExistingRates = [
    ...existingRates.map(r => ({
      position: r.position,
      baseRate: r.baseRate,
      fullyLoadedRate: r.fullyLoadedRate,
    })),
    ...existingDrafts.map(d => ({
      position: d.position,
      baseRate: d.baseRate,
      fullyLoadedRate: d.fullyLoadedRate,
    })),
  ];

  for (const rawRate of extractedRates) {
    const validated = ExtractedLaborRateSchema.safeParse(rawRate);
    if (!validated.success) {
      console.warn('Labor rate failed validation:', validated.error.issues);
      continue;
    }

    const rate = validated.data;
    try {
      const now = new Date().toISOString();
      
      // Check for duplicate
      const duplicateWarning = checkDuplicateLaborRate(rate.position, allExistingRates);
      
      const draft = await createDraftLaborRateRecord({
        orgId,
        position: rate.position,
        baseRate: rate.baseRate ?? rate.fullyLoadedRate ?? 0,
        overhead: rate.overhead ?? 0,
        ga: rate.ga ?? 0,
        profit: rate.profit ?? 0,
        fullyLoadedRate: rate.fullyLoadedRate ?? rate.baseRate ?? 0,
        effectiveDate: rate.effectiveDate ?? now.split('T')[0],
        expirationDate: rate.expirationDate ?? undefined,
        rateSource: rate.rateSource ?? `Extracted from ${fileName}`,
        extractionSource: {
          sourceType: 'DIRECT_UPLOAD',
          sourceDocumentKey: s3Key,
          sourceDocumentName: fileName,
          extractionJobId: input.jobId,
          extractedAt: now,
          extractedBy: input.userId,
        },
        fieldConfidence: {
          position: 85,
          baseRate: 80,
          overall: 82,
        },
        duplicateWarning,
      });

      draftIds.push(draft.draftId);
      const duplicateNote = duplicateWarning.isDuplicate ? ' [WILL OVERWRITE EXISTING]' : '';
      console.log(`Created labor rate DRAFT: ${draft.draftId} - "${rate.position}"${duplicateNote}`);
      
      // Add to tracking for next duplicate check
      allExistingRates.push({
        position: rate.position,
        baseRate: rate.baseRate ?? rate.fullyLoadedRate ?? 0,
        fullyLoadedRate: rate.fullyLoadedRate ?? rate.baseRate ?? 0,
      });
    } catch (createErr) {
      console.error(`Failed to create labor rate draft for ${rate.position}:`, createErr);
    }
  }

  console.log(`Created ${draftIds.length} labor rate DRAFTS from ${fileName}`);
  return draftIds;
};

export type ExtractBOMItemsInput = ExtractPastPerformanceInput;

/**
 * Extracts BOM items from a document (quotes, invoices, material lists)
 * Returns array of created BOM item IDs
 */
export const extractBOMItemsFromDocument = async (
  input: ExtractBOMItemsInput
): Promise<string[]> => {
  const { orgId, s3Key, fileName } = input;
  const documentsBucket = requireEnv('DOCUMENTS_BUCKET');

  console.log(`Extracting BOM items from ${fileName} (${s3Key})`);

  const docText = await loadDocumentText(documentsBucket, s3Key, fileName);
  if (!docText || docText.trim().length === 0) {
    console.warn(`Document ${fileName} is empty or could not be parsed`);
    return [];
  }
  console.log(`Loaded document text: ${docText.length} characters`);

  const textContent = await callBedrockForExtraction(
    BOM_EXTRACTION_SYSTEM_PROMPT,
    createBOMExtractionUserPrompt(docText)
  );
  if (!textContent) {
    console.warn('No text content in Bedrock response');
    return [];
  }

  console.log('AI raw response (first 1000 chars):', textContent.slice(0, 1000));
  
  const extractedItems = parseJsonFromResponse(textContent);
  if (!extractedItems) {
    console.error('Failed to parse extraction response');
    return [];
  }
  console.log(`Extracted ${extractedItems.length} BOM items from document`);

  const draftIds: string[] = [];

  for (const rawItem of extractedItems) {
    const validated = ExtractedBOMItemSchema.safeParse(rawItem);
    if (!validated.success) {
      console.warn('BOM item failed validation:', validated.error.issues);
      continue;
    }

    const item = validated.data;
    try {
      const now = new Date().toISOString();
      const draft = await createDraftBOMItemRecord({
        orgId,
        name: item.name,
        description: item.description ?? '',
        category: item.category,
        unitCost: item.unitCost,
        unit: 'each',
        quantity: item.quantity ?? 1,
        vendor: item.vendor,
        partNumber: item.partNumber,
        extractionSource: {
          sourceType: 'DIRECT_UPLOAD',
          sourceDocumentKey: s3Key,
          sourceDocumentName: fileName,
          extractionJobId: input.jobId,
          extractedAt: now,
          extractedBy: input.userId,
        },
        fieldConfidence: {
          name: 85,
          unitCost: 80,
          category: 75,
          overall: 80,
        },
      });

      draftIds.push(draft.draftId);
      console.log(`Created BOM item DRAFT: ${draft.draftId} - "${item.name}"`);
    } catch (createErr) {
      console.error(`Failed to create BOM item draft for ${item.name}:`, createErr);
    }
  }

  console.log(`Created ${draftIds.length} BOM item DRAFTS from ${fileName}`);
  return draftIds;
};
