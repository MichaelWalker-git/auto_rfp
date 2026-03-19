// Set required environment variables before any module loads.
// Jest hoists jest.mock() calls above process.env assignments in test files,
// so env vars must be set here (via setupFiles) to be available at module load time.
process.env.DB_TABLE_NAME = process.env.DB_TABLE_NAME || 'test-table';
process.env.REGION = process.env.REGION || 'us-east-1';
process.env.DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || 'test-bucket';
process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN = process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN || 'arn:aws:states:us-east-1:123456789:stateMachine:test';
process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
process.env.BEDROCK_EMBEDDING_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v1';
process.env.DIBBS_BASE_URL = process.env.DIBBS_BASE_URL || 'https://www.dibbs.bsm.dla.mil';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'test-pinecone-key';
process.env.PINECONE_INDEX = process.env.PINECONE_INDEX || 'test-index';
process.env.STAGE = process.env.STAGE || 'test';
