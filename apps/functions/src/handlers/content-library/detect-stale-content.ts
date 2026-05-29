import { requireEnv } from '@/helpers/env';
import {
  detectStaleContentLibrary,
  detectStaleKBDocuments,
  sendStaleNotifications,
} from './stale-content.service';
import type { DetectionSummary } from './stale-content.service';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');
const SNS_TOPIC_ARN = process.env.STALE_CONTENT_SNS_TOPIC_ARN || '';

/**
 * EventBridge-triggered handler — daily at 2am UTC.
 * Scans both Content Library items AND KB Documents for staleness.
 * Delegates all business logic to stale-content.service.ts.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  console.log('Starting stale content detection job...');
  const now = new Date();

  try {
    // 1. Detect stale content library items (all 4 rules)
    const clResults = await detectStaleContentLibrary(TABLE_NAME, now);

    // 2. Detect stale KB documents (age-based staleness)
    const kbResults = await detectStaleKBDocuments(TABLE_NAME, now);

    const allResults = [...clResults, ...kbResults];

    // 3. Send notifications for newly detected stale/warning items
    const newlyFlagged = allResults.filter(
      (r) => r.previousStatus === 'ACTIVE' && (r.newStatus === 'STALE' || r.newStatus === 'WARNING'),
    );
    await sendStaleNotifications(SNS_TOPIC_ARN, newlyFlagged);

    const summary: DetectionSummary = {
      totalScanned: clResults.length + kbResults.length,
      contentLibraryScanned: clResults.length,
      kbDocumentsScanned: kbResults.length,
      staleDetected: allResults.filter((r) => r.newStatus === 'STALE').length,
      warningDetected: allResults.filter((r) => r.newStatus === 'WARNING').length,
      notificationsSent: newlyFlagged.length > 0,
    };

    console.log('Stale content detection complete:', JSON.stringify(summary));

    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (error) {
    console.error('Stale content detection failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Detection job failed', message: String(error) }) };
  }
};
