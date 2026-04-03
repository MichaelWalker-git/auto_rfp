---
name: review-performance
description: Performance review of changed code - regex efficiency, memory, network calls, bundle impact, Lambda cold starts
---

# Performance Review

Analyze changed code for performance issues across backend and frontend.

## Process

1. Get the diff: `git diff develop...HEAD`
2. Identify performance-sensitive code paths

### Regex Analysis
- Flag regexes with nested quantifiers: `(a+)+`, `(a|b)*c*` — ReDoS risk
- Flag regexes using `[\s\S]*?` or `.*?` across large HTML strings — O(n^2) risk
- Check if regex is called in a loop or on user-controlled input
- Suggest `indexOf`/`includes` when simpler string methods suffice

### Memory & CPU
- Large string concatenation in loops — suggest array `.join()`
- Repeated `.replace()` chains on the same string — suggest single-pass approach
- Unnecessary full-document re-parsing when incremental updates suffice
- Creating large intermediate arrays/objects that could be streamed

### Network & I/O
- Sequential AWS SDK calls that could be parallelized (`Promise.all`)
- N+1 query patterns (fetching related items in a loop)
- Missing caching for repeated lookups
- Unnecessary S3/DynamoDB round trips

### Frontend Specific
- Heavy re-renders: `useEffect` without proper deps, state updates in loops
- Large event handler registrations on every render
- Missing `useMemo`/`useCallback` for expensive computations passed as props
- Bundle size: new large dependencies imported synchronously

### Lambda Specific
- New top-level imports that increase cold start time
- Puppeteer/Chromium double-render patterns — measure if second pass is necessary
- Buffer operations on large documents — streaming alternatives?

## Output

For each finding:
```
**[SEVERITY] Title**
- File: `path:line`
- Impact: [estimated impact — cold start +Xms, O(n) → O(n^2), etc.]
- Issue: [description]
- Fix: [concrete optimization]
```