/**
 * Configuration for AWS-based RAG index (Bedrock + KB/Kendra/OpenSearch/etc.)
 */
export interface AwsIndexConfig {
  /**
   * AWS region where Bedrock / search services are deployed, e.g. "us-east-1"
   */
  region: string;

  /**
   * Bedrock model ID, e.g. "anthropic.claude-3-5-sonnet-20241022-v2:0"
   */
  bedrockModelId: string;

  /**
   * Optional Bedrock Knowledge Base ID (if you use Bedrock KB)
   */
  knowledgeBaseId?: string;

  /**
   * Optional list of search index identifiers (e.g. Kendra index IDs,
   * OpenSearch collection names, etc.)
   */
  indexIds?: string[];
}

/**
 * Generic source metadata enriched with AWS-related fields.
 */
export interface AwsSourceMetadata {
  file_name?: string;
  file_path?: string;
  page_label?: string;
  start_page_label?: string;
  document_id?: string;

  // Common AWS-specific metadata (all optional)
  s3_bucket?: string;
  s3_key?: string;
  kendra_index_id?: string;
  bedrock_knowledge_base_id?: string;
  [key: string]: any;
}

/**
 * Node returned from retrieval (e.g. Kendra / OpenSearch / Bedrock KB),
 * including text and metadata.
 */
export interface AwsSourceNode {
  node: {
    text?: string;
    metadata: AwsSourceMetadata;
  };
  score?: number;
}

/**
 * Normalized source info that you expose to the frontend / callers.
 */
export interface AwsResponseSource {
  id: number;
  fileName: string;
  filePath?: string;
  pageNumber?: string;
  documentId?: string;
  relevance?: number;
  textContent?: string;

  // Optional: AWS-specific location
  s3Uri?: string;               // e.g. "s3://bucket/key"
  knowledgeBaseId?: string;     // Bedrock KB ID
  indexId?: string;             // Kendra index ID or similar
}

/**
 * Options for how to generate a response from AWS-backed indexes.
 */
export interface AwsGenerateResponseOptions {
  /**
   * Limit retrieval to specific document IDs (e.g. source metadata document_id)
   */
  documentIds?: string[];

  /**
   * Restrict retrieval to specific index IDs (Kendra/OpenSearch/KB data sources)
   */
  selectedIndexIds?: string[];

  /**
   * If true, use all configured indexes / knowledge bases
   */
  useAllIndexes?: boolean;
}

/**
 * Final result of a Bedrock+retrieval pipeline.
 */
export interface AwsResponseResult {
  /**
   * Generated answer from Bedrock model
   */
  response: string;

  /**
   * Retrieved sources that supported this answer
   */
  sources: AwsResponseSource[];

  /**
   * Confidence score (your own heuristic / model output)
   */
  confidence: number;

  /**
   * ISO timestamp when the response was generated
   */
  generatedAt: string;
}

/**
 * Interface for an AWS-based index/RAG service.
 * Implementation will typically:
 *  - run retrieval (Kendra / OpenSearch / Bedrock KB)
 *  - call Bedrock model with retrieved context
 *  - return normalized AwsResponseResult
 */
export interface IAwsIndexService {
  generateResponse(
    question: string,
    options?: AwsGenerateResponseOptions
  ): Promise<AwsResponseResult>;

  generateDefaultResponse(question: string): Promise<AwsResponseResult>;
}
