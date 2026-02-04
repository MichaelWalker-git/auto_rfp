# OpenSearch to Pinecone Migration Investigation

## Current State

### OpenSearch Serverless
- **Endpoint**: `https://leb5aji6vthaxk7ft8pi.us-east-1.aoss.amazonaws.com`
- **Index**: `documents`
- **AWS Account**: 039885961427
- **Estimated Cost**: ~$700/month minimum per collection

### Current Usage
- Vector embeddings: Amazon Titan Embed Text v2 (1024 dimensions)
- Document chunks stored with embeddings for semantic search
- Used for RAG (Retrieval Augmented Generation) in answer generation

### Collections to Delete (Unused)
```bash
# These appear to be test/development collections
aws opensearchserverless delete-collection --id 0ed5ukzkae6aykjce7x5 --profile <profile>
aws opensearchserverless delete-collection --id 2aemcx03pm8wa1rqzd8l --profile <profile>
aws opensearchserverless delete-collection --id k2tv0x1hz1g8q8iazpk0 --profile <profile>
aws opensearchserverless delete-collection --id tdysglg69qpzv1pudum1 --profile <profile>
```

---

## Pinecone Overview

### Pricing Comparison

| Feature | OpenSearch Serverless | Pinecone Starter | Pinecone Standard |
|---------|----------------------|------------------|-------------------|
| **Monthly Cost** | ~$700+ | Free | $70+ |
| **Vectors** | Unlimited | 100K | 1M+ |
| **Dimensions** | Any | Up to 1536 | Up to 1536 |
| **Namespaces** | Via indices | Yes | Yes |
| **Metadata Filtering** | Yes | Yes | Yes |
| **Hybrid Search** | Yes | No | Yes |
| **Serverless** | Yes | Yes | Yes |

### Pinecone Advantages
1. **Cost**: 10x cheaper for similar workloads
2. **Simplicity**: Purpose-built for vectors, simpler API
3. **Performance**: Optimized for vector similarity search
4. **Scaling**: Pay-per-use serverless model
5. **SDKs**: First-class TypeScript/JavaScript support

### Pinecone Limitations
1. **Vendor Lock-in**: Not AWS-native
2. **Data Residency**: Limited regions (but has US options)
3. **No Full-Text Search**: Pure vector search only
4. **Metadata Size**: 40KB limit per vector

---

## Migration Architecture

### Current Architecture
```
Document → Chunk → Titan Embed → OpenSearch Index
                                      ↓
Question → Titan Embed → KNN Search → Top-K Results → Claude → Answer
```

### Proposed Architecture
```
Document → Chunk → Titan Embed → Pinecone Upsert
                                      ↓
Question → Titan Embed → Pinecone Query → Top-K Results → Claude → Answer
```

### Code Changes Required

#### 1. New Helper: `lambda/helpers/pinecone.ts`
```typescript
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.index(process.env.PINECONE_INDEX!);

export async function upsertVectors(
  vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, string>;
  }>
) {
  await index.upsert(vectors);
}

export async function queryVectors(
  queryVector: number[],
  topK: number = 5,
  filter?: Record<string, string>
) {
  const results = await index.query({
    vector: queryVector,
    topK,
    filter,
    includeMetadata: true,
  });
  return results.matches;
}

export async function deleteVectors(ids: string[]) {
  await index.deleteMany(ids);
}
```

#### 2. Update Document Indexing: `lambda/document-pipeline-steps/index-document.ts`
- Replace `aossIndexDoc()` with `upsertVectors()`
- Store document metadata (documentId, chunkKey, text preview)

#### 3. Update Semantic Search: `lambda/semantic/search.ts`
- Replace OpenSearch KNN query with Pinecone query
- Adjust response mapping

#### 4. Update Answer Generation: `lambda/answer/generate-answer.ts`
- Update context retrieval to use Pinecone

### Environment Variables
```
PINECONE_API_KEY=<from secrets manager>
PINECONE_INDEX=auto-rfp-vectors
PINECONE_ENVIRONMENT=us-east-1
```

---

## Migration Plan

### Phase 1: Setup (Day 1)
- [ ] Create Pinecone account and index
- [ ] Store API key in AWS Secrets Manager
- [ ] Add `@pinecone-database/pinecone` dependency
- [ ] Create Pinecone helper module

### Phase 2: Dual-Write (Days 2-3)
- [ ] Update indexing to write to both OpenSearch and Pinecone
- [ ] Verify data consistency
- [ ] Monitor for errors

### Phase 3: Read Migration (Days 4-5)
- [ ] Add feature flag for Pinecone reads
- [ ] Update search endpoints to use Pinecone
- [ ] A/B test search quality

### Phase 4: Cutover (Day 6)
- [ ] Disable OpenSearch writes
- [ ] Remove OpenSearch read paths
- [ ] Delete OpenSearch collection

### Phase 5: Cleanup (Day 7)
- [ ] Remove OpenSearch dependencies
- [ ] Update documentation
- [ ] Monitor costs

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Search quality regression | A/B testing during Phase 3 |
| Data loss | Dual-write ensures both systems have data |
| API rate limits | Implement retry with exponential backoff |
| Latency increase | Benchmark before cutover |

---

## Cost Projection

| Scenario | OpenSearch | Pinecone | Savings |
|----------|------------|----------|---------|
| Current (5 collections) | ~$3,500/mo | - | - |
| After cleanup (1 collection) | ~$700/mo | - | $2,800/mo |
| After Pinecone migration | - | ~$70/mo | $630/mo |
| **Total Potential Savings** | - | - | **$3,430/mo** |

---

## Next Steps

1. [ ] Confirm which AWS profile has access to account 039885961427
2. [ ] Delete the 4 unused OpenSearch collections
3. [ ] Create Pinecone account (starter tier for testing)
4. [ ] Implement Pinecone helper module
5. [ ] Begin Phase 1 of migration
