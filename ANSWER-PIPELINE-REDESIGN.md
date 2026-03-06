# Answer Pipeline Redesign — Avoiding Step Functions Payload Limits

## Problem

The answer generation Step Function was hitting AWS Step Functions' **256 KB payload limit** when processing projects with large numbers of questions. The `Generate Answers Map` state was trying to pass all question data through the state machine, causing:

```
The state/task 'Generate Answers Map' returned a result with a size exceeding
the maximum number of bytes service limit.
```

Even with minimal `QuestionReference` objects, projects with 1000+ questions exceeded the limit.

## Solution

Redesigned the pipeline to use **AWS Step Functions Distributed Map with S3**, which is the recommended pattern for large-scale processing.

### Architecture Changes

#### Before (Inline Map)
```
PrepareQuestions → returns array of questions in payload
                ↓
       Generate Answers Map (inline)
       - Iterates over $.prepareResult.questions
       - 256 KB payload limit
                ↓
       Copy Cluster Answers
```

#### After (Distributed Map with S3)
```
PrepareQuestions → writes questions to S3 as JSONL
                → returns S3 location (s3Bucket, s3Key)
                ↓
       Generate Answers Map (distributed)
       - Reads from S3 using S3JsonItemReader
       - No payload size limits
       - Processes up to 10 questions concurrently
                ↓
       Copy Cluster Answers
```

### Key Benefits

1. **No payload limits** — Questions are stored in S3, not passed through states
2. **Higher concurrency** — Distributed Map supports up to 10,000 concurrent executions (we use 10)
3. **Better scalability** — Can handle projects with unlimited questions
4. **Better observability** — Each question processing is a separate execution
5. **Cost-effective** — Only pay for actual Lambda invocations, not state transitions

## Implementation Details

### 1. PrepareQuestions Lambda

**Changed:**
- Now writes questions to S3 as JSONL (JSON Lines format)
- Returns S3 location instead of question array
- S3 path: `s3://{DOCUMENTS_BUCKET}/answer-pipeline/{projectId}/{timestamp}-questions.jsonl`

**New Response:**
```typescript
interface PrepareQuestionsResult {
  s3Bucket: string;
  s3Key: string;
  totalCount: number;
  mastersCount: number;
  unclusteredCount: number;
  membersCount: number;
  projectId: string;
  orgId: string;
  clustersCreated: number;
}
```

**JSONL Format** (one JSON object per line):
```jsonl
{"questionId":"q1","projectId":"p1","orgId":"o1","isClusterMaster":true}
{"questionId":"q2","projectId":"p1","orgId":"o1","masterQuestionId":"q1"}
```

### 2. Step Function Definition

**Changed:**
- Replaced `sfn.Map` with `sfn.DistributedMap`
- Added `S3JsonItemReader` to read questions from S3
- Increased timeout from 60 to 120 minutes
- Increased concurrency from 5 to 10

**New Map Definition:**
```typescript
const generateAnswersMap = new sfn.DistributedMap(this, 'Generate Answers Map', {
  maxConcurrency: 10,
  itemReader: new sfn.S3JsonItemReader({
    bucket: documentsBucket,
    key: sfn.JsonPath.stringAt('$.prepareResult.s3Key'),
  }),
  resultPath: sfn.JsonPath.DISCARD,
});
```

### 3. IAM Permissions

**Added:**
- `prepareQuestionsLambda`: S3 write permission to `documentsBucket`
- `stateMachine`: S3 read permission to `documentsBucket`

## Files Changed

| File | Changes |
|------|---------|
| `apps/functions/src/handlers/answer-pipeline/prepare-questions.ts` | - Import S3Client and PutObjectCommand<br>- Write questions to S3 as JSONL<br>- Return S3 location instead of questions array<br>- Add mastersCount, unclusteredCount, membersCount to response |
| `packages/infra/answer-generation-step-function.ts` | - Replace `sfn.Map` with `sfn.DistributedMap`<br>- Add `S3JsonItemReader` configuration<br>- Grant S3 permissions to Lambda and Step Function<br>- Increase timeout to 120 minutes<br>- Increase concurrency to 10 |

## Backwards Compatibility

**Breaking Changes:**
- `PrepareQuestionsResult` no longer includes `questions` array
- Callers expecting the questions array will need to read from S3

**Impact:**
- Only affects Step Function internal flow (no external API changes)
- The Step Function state machine will handle the new format automatically

## Testing Recommendations

1. **Small projects (< 100 questions)** — Verify JSONL format is correct
2. **Large projects (1000+ questions)** — Verify no payload size errors
3. **Clustering scenarios** — Verify masters/members are processed correctly
4. **Concurrency** — Verify 10 concurrent Lambda invocations don't cause throttling

## Monitoring

**CloudWatch Metrics to Watch:**
- Step Functions: `ExecutionThrottled`, `ExecutionsFailed`
- Lambda: `ConcurrentExecutions`, `Throttles`
- S3: `PutObject` requests (should be 1 per execution)

**Logs:**
- PrepareQuestions Lambda: Look for "Wrote N questions to s3://..."
- Step Functions: Distributed Map child executions show per-question processing

## Cost Impact

**Before:** State transitions for each question in the Map (N transitions)

**After:**
- 1 S3 PutObject per execution (~$0.000005)
- 1 S3 GetObject per execution (~$0.0000004)
- Distributed Map charges ($0.000025 per state transition)

**Net impact:** Minimal cost increase (~$0.01 per 1000 questions), but avoids payload errors entirely.

## Rollback Plan

If issues arise, revert to the previous implementation by:
1. Restore `sfn.Map` instead of `sfn.DistributedMap`
2. Return `questions` array from PrepareQuestions (remove S3 write)
3. Deploy infrastructure

**Note:** This will re-introduce the 256 KB limit for large projects.

## References

- [AWS Step Functions Distributed Map](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-distributed-map.html)
- [S3JsonItemReader](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-itemreader.html#input-output-itemreader-s3json)
- [Step Functions Service Quotas](https://docs.aws.amazon.com/step-functions/latest/dg/limits-overview.html)
