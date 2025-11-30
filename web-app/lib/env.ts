// Environment variables configuration
export const env = {
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  BASE_API_URL: process.env.NEXT_PUBLIC_BASE_API_URL || '',
};

// Function to validate required environment variables
export function validateEnv() {
  const requiredVars = [
    { key: 'BASE_API_URL', value: env.BASE_API_URL }
  ];

  const missingVars = requiredVars.filter(v => !v.value);
  
  if (missingVars.length > 0) {
    console.error(`
      Missing required environment variables:
      ${missingVars.map(v => `- ${v.key}`).join('\n      ')}
      
      Please set these in your .env.local file
    `);
    return false;
  }
  
  return true;
} 