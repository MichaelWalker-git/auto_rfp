# Answer Pipeline Redesign — Deployment Steps

## Summary

Redesigned the answer generation Step Function to use **AWS Step Functions Distributed Map with S3** to avoid the 256 KB payload size limit that was occurring with large projects.

## What Changed

### Before
- PrepareQuestions returned an array of questions in the Step Function payload
- Hit 256 KB limit with 1000+ questions
- Used inline Map state

### After
- PrepareQuestions writes questions to S3 as JSONL (JSON Lines)
- Returns only S3 location (s3Bucket, s3Key) — ~100 bytes
- Uses Distributed Map to read from S3
- No payload size limits

## Files Modified

| File | Changes |
|------|---------|
| `apps/functions/src/handlers/answer-pipeline/prepare-questions.ts` | - Added S3Client import<br>- Write questions to S3 as JSONL<br>- Return S3 location instead of questions array<br>- Added mastersCount, unclusteredCount, membersCount to response |
| `packages/infra/answer-generation-step-function.ts` | - Replaced sfn.Map with sfn.DistributedMap<br>- Added S3JsonItemReader<br>- Grant S3 read/write permissions<br>- Increased timeout to 120 minutes<br>- Increased concurrency to 10 |
| `apps/functions/src/handlers/answer-pipeline/prepare-questions.test.ts` | - Added S3 mock<br>- Updated all assertions to check S3 results<br>- Verify JSONL content and structure |

## New Files

| File | Purpose |
|------|---------|
| `packages/infra/answer-generation-step-function.test.ts` | CDK stack tests for Distributed Map |
| `ANSWER-PIPELINE-REDESIGN.md` | Detailed architecture documentation |
| `DEPLOYMENT-STEPS.md` | This file |

## Deployment Steps

### 1. Review Changes
```bash
git diff develop
```

### 2. Run Tests Locally
```bash
# Test Lambda handlers
cd apps/functions
pnpm test prepare-questions

# Test CDK infrastructure (optional)
cd ../../packages/infra
pnpm test
```

### 3. Deploy Infrastructure
```bash
cd packages/infra
npm run deploy -- --profile your-aws-profile
```

**Expected changes:**
- Updated Step Function definition (Distributed Map)
- Updated PrepareQuestions Lambda (S3 write permission)
- Step Function gains S3 read permission

### 4. Verify Deployment

**Check CloudFormation:**
```bash
aws cloudformation describe-stacks \
  --stack-name AutoRfp-<stage>-AnswerGen \
  --profile your-aws-profile
```

**Check Step Function:**
- Go to AWS Console → Step Functions
- Find `AutoRfp-<stage>-AnswerGen-Pipeline`
- View definition → should see "ItemReader" with S3 configuration

### 5. Test with Real Data

**Trigger answer generation for a test project:**
```bash
aws stepfunctions start-execution \
  --state-machine-arn <state-machine-arn> \
  --input '{"projectId":"test-project-id","orgId":"test-org-id"}' \
  --profile your-aws-profile
```

**Monitor execution:**
- Check S3 bucket for `answer-pipeline/<projectId>/<timestamp>-questions.jsonl`
- Check Step Functions execution logs
- Verify Distributed Map child executions

### 6. Monitor for Issues

**CloudWatch Metrics to watch:**
- Step Functions: `ExecutionsFailed`, `ExecutionThrottled`
- Lambda: `Errors`, `Throttles`, `ConcurrentExecutions`
- S3: `4xxErrors`, `5xxErrors`

**CloudWatch Logs:**
- PrepareQuestions: Look for "Wrote N questions to s3://..."
- GenerateAnswer: Individual question processing logs

## Rollback Plan

If issues occur:

1. **Revert code changes:**
   ```bash
   git revert <commit-hash>
   ```

2. **Redeploy previous version:**
   ```bash
   cd packages/infra
   npm run deploy -- --profile your-aws-profile
   ```

3. **Clean up S3 files (optional):**
   ```bash
   aws s3 rm s3://<bucket>/answer-pipeline/ --recursive
   ```

## Testing Checklist

- [ ] Unit tests pass locally
- [ ] Infrastructure deploys successfully
- [ ] Step Function definition updated (visible in console)
- [ ] Small project (< 100 questions) processes correctly
- [ ] Large project (1000+ questions) processes without payload errors
- [ ] S3 JSONL files created and cleaned up
- [ ] Cluster masters/members processed in correct order
- [ ] CopyClusterAnswers step still works correctly

## Success Criteria

✅ No "payload size exceeded" errors for large projects
✅ Questions are written to S3 as JSONL
✅ Distributed Map reads from S3 and processes questions
✅ Answer generation completes successfully
✅ Performance is comparable or better than before

## Cost Impact

**Minimal increase:**
- +$0.000005 per S3 PutObject (1 per execution)
- +$0.0000004 per S3 GetObject (1 per execution)
- +$0.000025 per Distributed Map state transition

**Example:** 1000 questions = ~$0.01 additional cost per execution

## Support

If you encounter issues:
1. Check CloudWatch Logs for the PrepareQuestions Lambda
2. Check Step Functions execution history for failed states
3. Verify S3 bucket permissions
4. Review `ANSWER-PIPELINE-REDESIGN.md` for detailed architecture

## Next Steps

After successful deployment:
1. Monitor executions for 24-48 hours
2. Update user documentation if needed
3. Consider adding CloudWatch alarms for execution failures
4. Archive this document for future reference
