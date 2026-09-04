# Fix Solution Plan generation failures under load

## Context

Solution Plan generation fails on opportunities with multiple solicitation documents in both `Test` and `Dev` environments.

Root cause is in the shared Tech Lead / Griller tool-loop, not in text loading or context size:

1. **Empty assistant content** — `apps/functions/src/helpers/bedrock-tool-loop.ts:145` and `:218` push `{ role: 'assistant', content: [] }` when Claude returns an empty content array. The next `invokeModel` call is rejected by Anthropic with `400 messages: text content blocks must be non-empty` (seen on opportunity `96fb680e-…` in Test).
2. **Final round throws instead of salvaging** — `bedrock-tool-loop.ts:231-233` throws `Model returned no text content after all rounds` when the last iteration produces no text. The SQS queue is configured `maxReceiveCount: 1` (`packages/infra/api/api-orchestrator-stack.ts:249`), so the plan is DLQ'd immediately (seen on opportunity `f2e4b41c-…` in Dev).
3. **Transient Bedrock 5xx is fatal** — `bedrock-http-client.ts:69-72,141-153` retries `429/ThrottlingException` with backoff `[2s, 5s, 12s]`, but 500/502/503/504 fall through as `TransientServiceError` on the first attempt. With `maxReceiveCount: 1`, the plan flips to `FAILED` and the user must re-init the whole run (seen as the `503 Service Unavailable` stored on the Test plan).

The intended outcome: a single burst of empty responses, transient 5xx, or a slow round no longer leaves the Solution Plan permanently `FAILED`; users can run generation successfully in one shot even with 5–10 solicitation documents.

## Fix 1 — Empty-content guard in `bedrock-tool-loop.ts`

**File:** `apps/functions/src/helpers/bedrock-tool-loop.ts`

At the two call sites that push assistant messages back into the conversation (`:145` in the `max_tokens` retry branch and `:218` in the empty-text branch), replace direct `messages.push({ role: 'assistant', content })` with a small helper:

```ts
const nonEmptyAssistantContent = (content: ContentBlock[]): ContentBlock[] =>
  content.length > 0 ? content : [{ type: 'text', text: '(no content in previous turn)' }];
```

Push `nonEmptyAssistantContent(content)` in both places. This prevents the Anthropic `400 text content blocks must be non-empty` error without changing the loop's semantics.

## Fix 2 — Retry transient Bedrock 5xx in `bedrock-http-client.ts`

**File:** `apps/functions/src/helpers/bedrock-http-client.ts`

Extend the existing throttle-retry loop at `:141-153` to also cover transient 5xx responses (500, 502, 503, 504). The infrastructure is already there — `THROTTLE_RETRY_DELAYS_MS = [2000, 5000, 12000]` and the loop at `:141` — we just widen the predicate:

```ts
const isTransientError = (statusCode: number | undefined, body: string): boolean =>
  isThrottleError(statusCode, body) ||
  (statusCode !== undefined && statusCode >= 500 && statusCode < 600);
```

Update the loop's condition from `isThrottleError(...)` to `isTransientError(...)`, and rename the warn log from `ThrottlingException on attempt` to `transient error (${statusCode}) on attempt`. Behavior for 429 is unchanged; 5xx now gets the same 3-retry exponential backoff before surfacing as `TransientServiceError`.

## Fix 3 — Final-round salvage in `bedrock-tool-loop.ts`

**File:** `apps/functions/src/helpers/bedrock-tool-loop.ts`

Replace the raw throw at `:231-233` with one last salvage call using a fresh conversation (no tools, no polluted history), similar to the existing JSON-repair pattern at `:242-257`:

```ts
if (!rawText.trim()) {
  console.warn('[bedrock-tool-loop] No text after all rounds — attempting final salvage with fresh context');

  const salvageMessages: Message[] = [{
    role: 'user',
    content: [{
      type: 'text',
      text: `${user}\n\nRespond with ONLY the raw JSON object matching the required schema. No tools, no explanation, no markdown.`,
    }],
  }];
  const salvageBody = {
    anthropic_version: 'bedrock-2023-05-31',
    system: [{ type: 'text', text: system }],
    messages: salvageMessages,
    max_tokens: maxTokens,
    temperature: 0,
  };
  const salvageResponse = await invokeModel(modelId, JSON.stringify(salvageBody), orgId);
  const salvageParsed = JSON.parse(new TextDecoder('utf-8').decode(salvageResponse)) as { content?: ContentBlock[] };
  rawText = extractText(salvageParsed.content ?? []);

  if (!rawText.trim()) {
    throw new Error('[bedrock-tool-loop] Model returned no text content after all rounds (including salvage)');
  }
}
```

Reuse the existing `Message`/`ContentBlock` types and the existing `extractText` helper — no new abstractions.

## Tests

**File:** `apps/functions/src/helpers/bedrock-tool-loop.test.ts`

Add three tests following the existing pattern (see `:52-193`) — mocking `invokeModel` via `mockInvokeModel` and `encodeResponse`:

1. `does not push empty assistant content back into the conversation` — mock two rounds where the first returns `content: []` with `stop_reason: 'end_turn'`, then the model returns valid JSON. Assert the second `invokeModel` call's `messages` array contains no assistant message with `content: []` (walk the JSON body of the second call and check every assistant `content` array is non-empty).
2. `salvages a final answer when all tool rounds return empty content` — mock every scripted round to return empty content, so the loop exits its main `while` without a `rawText`. The salvage call then returns valid JSON. Assert the result is parsed, not thrown.
3. `still throws when salvage also returns empty` — mock every round including the salvage call to return empty content. Assert the error message contains `including salvage`.

**File:** `apps/functions/src/helpers/bedrock-http-client.test.ts`

Add one test for the extended retry:

4. `retries transient 5xx responses with backoff and then succeeds` — mock two 503 responses followed by a 200. Use fake timers to advance through `THROTTLE_RETRY_DELAYS_MS` and assert the final result is the 200 body. Follow the existing mocking style — the file already stubs `TransientServiceError` at `:19` and mocks `https.request`.

No new test files are needed; both target files already exist with the mocking scaffolding.

## Non-goals

- **Not** deduping solicitation documents in `loadAllSolicitationTexts` (a real issue on Dev — `WEBSMemo.pdf` appears twice — but out of scope for this PR).
- **Not** raising SQS `maxReceiveCount` above 1 (behavior change that touches infra and error semantics — separate discussion).
- **Not** changing `markPlanFailed` / `withGuardedPlan` in `solution-plan-worker.ts` — with fixes 1–3 the tool loop stops producing spurious fatal errors, so the existing FAILED-on-throw semantics are correct for the errors that remain.

## Verification

1. `cd apps/functions && pnpm test -- --testPathPattern="bedrock-tool-loop|bedrock-http-client"` — new tests pass, existing ones stay green.
2. `cd apps/functions && pnpm build` — no type errors.
3. Manual smoke test in Dev:
   - Redeploy `SolutionPlanWorker-Dev` with `pnpm deploy:dev:hotswap` (worker Lambda only).
   - Re-init the Solution Plan on opportunity `f2e4b41c-bc11-40b8-93b0-9c2c3dfd40be` with `restart: true`.
   - Tail `/aws/lambda/auto-rfp-solution-plan-worker-Dev` — expect the run to reach `SYNTHESIZE` and the plan to end `READY`, not `FAILED`.
4. Manual smoke in Test: same procedure on opportunity `96fb680e-7889-418a-be25-1dd62e529481` after the fix is promoted to `main` branch.