// Jest setup file
// Add any global test setup here

// Increase timeout for async tests
jest.setTimeout(15000);

// Mock AWS credential provider to avoid real AWS calls during tests
jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn(() => () =>
    Promise.resolve({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      sessionToken: 'test-session-token',
    })
  ),
}), { virtual: true });

// Set default environment variables for tests
process.env.DB_TABLE_NAME = process.env.DB_TABLE_NAME || 'test-table';
process.env.DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || 'test-bucket';
process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.BEDROCK_EMBEDDING_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';
process.env.REGION = process.env.REGION || 'us-east-1';
