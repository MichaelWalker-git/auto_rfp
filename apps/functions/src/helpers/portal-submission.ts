import { PortalType } from '@auto-rfp/core';
import type { DetectedPortal } from '@/types/portal-detection';

/**
 * Portal submission result
 */
export interface PortalSubmissionResult {
  success: boolean;
  confirmationNumber?: string;
  error?: string;
  requiresManualReview?: boolean;
}

/**
 * FOIA request data for portal submission
 */
export interface FOIASubmissionData {
  // Agency information
  agencyName: string;

  // Request details
  solicitationNumber: string;
  contractTitle: string;
  description: string;
  requestedDocuments: string[];
  customDocumentRequests?: string[];

  // Requester information
  requesterName: string;
  requesterTitle: string;
  requesterEmail: string;
  requesterPhone: string;
  requesterAddress: string;
  companyName: string;

  // Award information
  awardeeName?: string;
  awardDate: string;

  // Fee limit
  feeLimit: number;
}

/**
 * Configuration for portal submission
 */
export interface PortalSubmissionConfig {
  // CAPTCHA solving service configuration
  captchaSolver?: {
    provider: 'manual' | '2captcha' | 'anticaptcha';
    apiKey?: string;
  };

  // Retry configuration
  maxRetries?: number;
  retryDelayMs?: number;

  // Timeout configuration
  timeoutMs?: number;
}

/**
 * Submit a FOIA request to a detected portal
 *
 * This is the main entry point for portal submission. It routes to the appropriate
 * submission method based on the portal type.
 */
export const submitToPortal = async (
  portalInfo: DetectedPortal,
  formData: FOIASubmissionData,
  config: PortalSubmissionConfig = {}
): Promise<PortalSubmissionResult> => {
  if (!portalInfo.detected) {
    return {
      success: false,
      error: 'No portal detected - cannot submit via portal',
      requiresManualReview: true
    };
  }

  try {
    switch (portalInfo.type) {
      case 'GovQA':
        return await submitToGovQA(portalInfo, formData, config);

      case 'NextRequest':
        return await submitToNextRequest(portalInfo, formData, config);

      case 'JustFOIA':
        return await submitToJustFOIA(portalInfo, formData, config);

      case 'GovOS':
        return await submitToGovOS(portalInfo, formData, config);

      default:
        return {
          success: false,
          error: `Unsupported portal type: ${portalInfo.type}`,
          requiresManualReview: true
        };
    }
  } catch (error) {
    console.error('Portal submission error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      requiresManualReview: true
    };
  }
};

/**
 * Submit to GovQA portal
 *
 * This uses the govqa-py Python service for submission.
 * Falls back to manual review if submission fails.
 */
const submitToGovQA = async (
  portalInfo: DetectedPortal,
  formData: FOIASubmissionData,
  config: PortalSubmissionConfig
): Promise<PortalSubmissionResult> => {
  // TODO: Implement actual GovQA submission via govqa-py service
  // For now, mark as requiring manual review

  console.log('GovQA submission requested:', {
    portal: portalInfo.baseUrl,
    recordType: portalInfo.recordTypeValue,
    requester: formData.requesterEmail
  });

  // Check if we have a Python service endpoint configured
  const pythonServiceEndpoint = process.env.GOVQA_SUBMISSION_SERVICE_URL;

  if (!pythonServiceEndpoint) {
    console.warn('GOVQA_SUBMISSION_SERVICE_URL not configured - marking for manual review');
    return {
      success: false,
      error: 'GovQA submission service not configured',
      requiresManualReview: true
    };
  }

  // TODO: Call Python service
  // const response = await fetch(pythonServiceEndpoint, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     portal_url: portalInfo.baseUrl,
  //     record_type_field: portalInfo.recordTypeField,
  //     record_type_value: portalInfo.recordTypeValue,
  //     form_data: mapToGovQAFields(formData),
  //     captcha_config: config.captchaSolver
  //   })
  // });

  return {
    success: false,
    error: 'GovQA submission not yet implemented',
    requiresManualReview: true
  };
};

/**
 * Submit to NextRequest portal
 */
const submitToNextRequest = async (
  portalInfo: DetectedPortal,
  formData: FOIASubmissionData,
  config: PortalSubmissionConfig
): Promise<PortalSubmissionResult> => {
  // TODO: Implement NextRequest submission
  console.log('NextRequest submission not yet implemented:', portalInfo.baseUrl);

  return {
    success: false,
    error: 'NextRequest submission not yet implemented',
    requiresManualReview: true
  };
};

/**
 * Submit to JustFOIA portal
 */
const submitToJustFOIA = async (
  portalInfo: DetectedPortal,
  formData: FOIASubmissionData,
  config: PortalSubmissionConfig
): Promise<PortalSubmissionResult> => {
  // TODO: Implement JustFOIA submission
  console.log('JustFOIA submission not yet implemented:', portalInfo.baseUrl);

  return {
    success: false,
    error: 'JustFOIA submission not yet implemented',
    requiresManualReview: true
  };
};

/**
 * Submit to GovOS portal
 */
const submitToGovOS = async (
  portalInfo: DetectedPortal,
  formData: FOIASubmissionData,
  config: PortalSubmissionConfig
): Promise<PortalSubmissionResult> => {
  // TODO: Implement GovOS submission
  console.log('GovOS submission not yet implemented:', portalInfo.baseUrl);

  return {
    success: false,
    error: 'GovOS submission not yet implemented',
    requiresManualReview: true
  };
};

/**
 * Map our FOIA data to GovQA form fields
 */
const mapToGovQAFields = (formData: FOIASubmissionData): Record<string, string> => {
  // Build the description text
  const description = buildRequestDescription(formData);

  return {
    // Standard GovQA fields (may vary by agency)
    'first_name': formData.requesterName.split(' ')[0],
    'last_name': formData.requesterName.split(' ').slice(1).join(' '),
    'email': formData.requesterEmail,
    'phone': formData.requesterPhone,
    'address': formData.requesterAddress,
    'organization': formData.companyName,
    'request_description': description,
    'fee_limit': formData.feeLimit.toString(),
  };
};

/**
 * Build the request description text for portal submission
 */
const buildRequestDescription = (formData: FOIASubmissionData): string => {
  const lines: string[] = [];

  lines.push(`Subject: Public Records Request - ${formData.contractTitle}`);
  lines.push(`Solicitation Number: ${formData.solicitationNumber}`);
  lines.push('');

  if (formData.awardeeName) {
    lines.push(`Contract awarded to: ${formData.awardeeName}`);
  }
  lines.push(`Award date: ${formData.awardDate}`);
  lines.push('');

  lines.push('Requested Documents:');
  formData.requestedDocuments.forEach(doc => {
    lines.push(`- ${doc}`);
  });

  if (formData.customDocumentRequests && formData.customDocumentRequests.length > 0) {
    lines.push('');
    lines.push('Additional Requests:');
    formData.customDocumentRequests.forEach(req => {
      lines.push(`- ${req}`);
    });
  }

  lines.push('');
  lines.push(`Fee limit: $${formData.feeLimit}`);
  lines.push('');
  lines.push(`Submitted by: ${formData.requesterName}`);
  lines.push(`Title: ${formData.requesterTitle}`);
  lines.push(`Organization: ${formData.companyName}`);

  return lines.join('\n');
};

/**
 * Retry a portal submission with exponential backoff
 */
export const retryPortalSubmission = async (
  portalInfo: DetectedPortal,
  formData: FOIASubmissionData,
  config: PortalSubmissionConfig,
  attemptNumber: number = 1
): Promise<PortalSubmissionResult> => {
  const maxRetries = config.maxRetries ?? 3;

  if (attemptNumber > maxRetries) {
    return {
      success: false,
      error: `Failed after ${maxRetries} attempts`,
      requiresManualReview: true
    };
  }

  const result = await submitToPortal(portalInfo, formData, config);

  if (result.success || result.requiresManualReview) {
    return result;
  }

  // Exponential backoff
  const delayMs = (config.retryDelayMs ?? 5000) * Math.pow(2, attemptNumber - 1);
  console.log(`Retry attempt ${attemptNumber} after ${delayMs}ms`);

  await new Promise(resolve => setTimeout(resolve, delayMs));

  return retryPortalSubmission(portalInfo, formData, config, attemptNumber + 1);
};
