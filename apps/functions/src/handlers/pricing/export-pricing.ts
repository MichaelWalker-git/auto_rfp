import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { getCostEstimateById, getLaborRatesByOrg, getStaffingPlansByOpportunity } from '@/helpers/pricing';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import type { CostEstimate, LaborRate, StaffingPlan } from '@auto-rfp/core';

const s3Client = new S3Client({ region: requireEnv('REGION', 'us-east-1') });

const ExportPricingRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  estimateId: z.string().uuid(),
  format: z.enum(['CSV', 'JSON']).default('CSV'),
});

/**
 * Build CSV content from a cost estimate with labor rates and staffing plans.
 */
const buildCsvExport = (
  estimate: CostEstimate,
  laborRates: LaborRate[],
  staffingPlans: StaffingPlan[],
): string => {
  const lines: string[] = [];

  // Header
  lines.push('COST ESTIMATE EXPORT');
  lines.push(`Estimate: ${estimate.name}`);
  lines.push(`Strategy: ${estimate.strategy}`);
  lines.push(`Date: ${estimate.createdAt}`);
  lines.push('');

  // Summary
  lines.push('=== COST SUMMARY ===');
  lines.push(`Total Direct Cost,$${estimate.totalDirectCost.toFixed(2)}`);
  lines.push(`Total Indirect Cost,$${estimate.totalIndirectCost.toFixed(2)}`);
  lines.push(`Total Cost,$${estimate.totalCost.toFixed(2)}`);
  lines.push(`Margin,${estimate.margin}%`);
  lines.push(`Total Price,$${estimate.totalPrice.toFixed(2)}`);
  if (estimate.competitivePosition) {
    lines.push(`Competitive Position,${estimate.competitivePosition}`);
  }
  lines.push('');

  // Labor Costs
  if (estimate.laborCosts.length > 0) {
    lines.push('=== LABOR COSTS ===');
    lines.push('Category,Name,Quantity (Hours),Unit Cost ($/hr),Total Cost');
    for (const item of estimate.laborCosts) {
      lines.push(`${item.category},${item.name},${item.quantity},$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)}`);
    }
    lines.push('');
  }

  // Material Costs
  if (estimate.materialCosts.length > 0) {
    lines.push('=== MATERIAL / BOM COSTS ===');
    lines.push('Category,Name,Quantity,Unit Cost,Total Cost');
    for (const item of estimate.materialCosts) {
      lines.push(`${item.category},${item.name},${item.quantity},$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)}`);
    }
    lines.push('');
  }

  // Travel Costs
  if (estimate.travelCosts.length > 0) {
    lines.push('=== TRAVEL COSTS ===');
    lines.push('Category,Name,Quantity,Unit Cost,Total Cost');
    for (const item of estimate.travelCosts) {
      lines.push(`${item.category},${item.name},${item.quantity},$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)}`);
    }
    lines.push('');
  }

  // Subcontractor Costs
  if (estimate.subcontractorCosts.length > 0) {
    lines.push('=== SUBCONTRACTOR COSTS ===');
    lines.push('Category,Name,Quantity,Unit Cost,Total Cost');
    for (const item of estimate.subcontractorCosts) {
      lines.push(`${item.category},${item.name},${item.quantity},$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)}`);
    }
    lines.push('');
  }

  // ODC Costs
  if (estimate.odcCosts.length > 0) {
    lines.push('=== OTHER DIRECT COSTS ===');
    lines.push('Category,Name,Quantity,Unit Cost,Total Cost');
    for (const item of estimate.odcCosts) {
      lines.push(`${item.category},${item.name},${item.quantity},$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)}`);
    }
    lines.push('');
  }

  // Labor Rate Table
  if (laborRates.length > 0) {
    lines.push('=== LABOR RATE TABLE ===');
    lines.push('Position,Base Rate,Overhead %,G&A %,Profit %,Fully Loaded Rate,Effective Date,Justification');
    for (const rate of laborRates) {
      lines.push(
        `${rate.position},$${rate.baseRate.toFixed(2)},${rate.overhead}%,${rate.ga}%,${rate.profit}%,$${rate.fullyLoadedRate.toFixed(2)},${rate.effectiveDate},${rate.rateJustification || ''}`,
      );
    }
    lines.push('');
  }

  // Staffing Plans
  if (staffingPlans.length > 0) {
    for (const plan of staffingPlans) {
      lines.push(`=== STAFFING PLAN: ${plan.name} ===`);
      lines.push('Position,Hours,Rate ($/hr),Total Cost,Phase');
      for (const item of plan.laborItems) {
        lines.push(
          `${item.position},${item.hours},$${item.rate.toFixed(2)},$${item.totalCost.toFixed(2)},${item.phase || ''}`,
        );
      }
      lines.push(`Total Labor Cost,,,,$${plan.totalLaborCost.toFixed(2)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
};

/**
 * Build JSON export with all pricing data.
 */
const buildJsonExport = (
  estimate: CostEstimate,
  laborRates: LaborRate[],
  staffingPlans: StaffingPlan[],
): string => {
  return JSON.stringify(
    {
      exportDate: nowIso(),
      estimate,
      laborRates,
      staffingPlans,
    },
    null,
    2,
  );
};

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = ExportPricingRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    // Load all pricing data
    const estimate = await getCostEstimateById(
      data.orgId,
      data.projectId,
      data.opportunityId,
      data.estimateId,
    );

    if (!estimate) {
      return apiResponse(404, { message: 'Cost estimate not found' });
    }

    const [laborRates, staffingPlans] = await Promise.all([
      getLaborRatesByOrg(data.orgId),
      getStaffingPlansByOpportunity(data.orgId, data.projectId, data.opportunityId),
    ]);

    // Build export content
    const isJson = data.format === 'JSON';
    const content = isJson
      ? buildJsonExport(estimate, laborRates, staffingPlans)
      : buildCsvExport(estimate, laborRates, staffingPlans);

    const contentType = isJson ? 'application/json' : 'text/csv';
    const extension = isJson ? 'json' : 'csv';
    const fileName = `pricing-export-${data.estimateId}.${extension}`;

    // Upload to S3
    const bucket = requireEnv('DOCUMENTS_BUCKET');
    const key = `exports/pricing/${data.orgId}/${data.projectId}/${fileName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${fileName}"`,
      }),
    );

    // Generate presigned URL (expires in 1 hour)
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 },
    );

    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    return apiResponse(200, {
      downloadUrl,
      format: data.format,
      expiresAt,
    });
  } catch (err: unknown) {
    console.error('Error in exportPricing handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('pricing:read'))
    .use(httpErrorMiddleware()),
);
