const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Initialize AWS clients
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

// Helper function to create API response
function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  };
}

// Handle OPTIONS requests (CORS preflight)
function handleOptions() {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: '',
  };
}

// Placeholder handlers for future database integration
async function handleOrganizations(event) {
  return createResponse(200, { 
    message: 'Organizations endpoint - database integration pending',
    organizations: [] 
  });
}

async function handleProjects(event) {
  return createResponse(200, { 
    message: 'Projects endpoint - database integration pending',
    projects: [] 
  });
}

async function handleQuestions(event, projectId) {
  return createResponse(200, { 
    message: `Questions endpoint for project ${projectId} - database integration pending`,
    questions: [] 
  });
}

// Document processing with Bedrock
async function handleDocumentProcessing(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return createResponse(405, { error: 'Method not allowed' });
    }

    // Parse multipart form data (simplified implementation)
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType?.includes('multipart/form-data')) {
      return createResponse(400, { error: 'Invalid content type - multipart/form-data expected' });
    }

    // For now, return a placeholder response since parsing multipart data in Lambda is complex
    // In a real implementation, you'd use a library like 'busboy' to parse the form data
    const operation = 'qa'; // Would be extracted from form data
    const question = 'What are the main requirements?'; // Would be extracted from form data
    
    // Mock document content for testing
    const documentContent = `
      Test RFP Document
      
      Project Requirements:
      - Web application development
      - Database integration
      - API development
      - Cloud deployment on AWS
      - Timeline: 6 months
      - Budget: $100,000
      
      Company Information:
      - Company: Test Corp
      - Contact: John Smith
      - Email: john@testcorp.com
      - Due Date: March 15, 2025
      
      Technical Requirements:
      - React frontend
      - Node.js backend
      - PostgreSQL database
      - AWS deployment
      - CI/CD pipeline
    `;

    // Process with Bedrock Claude 3 Sonnet
    let prompt = '';
    if (operation === 'qa') {
      prompt = `Based on the following document, please answer this question: "${question}"
      
      Document:
      ${documentContent}
      
      Please provide a clear and concise answer based only on the information in the document.`;
    } else if (operation === 'summarize') {
      prompt = `Please provide a 2-3 paragraph summary of the following RFP document:
      
      ${documentContent}`;
    } else if (operation === 'extract_entities') {
      prompt = `Extract key entities from the following document including companies, people, dates, technologies, and requirements:
      
      ${documentContent}
      
      Please format the response as a JSON object with categories.`;
    }

    const bedrockCommand = new InvokeModelCommand({
      modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      contentType: 'application/json',
    });

    const bedrockResponse = await bedrockClient.send(bedrockCommand);
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const aiResponse = responseBody.content[0].text;

    // Format response based on operation
    let result = {};
    if (operation === 'qa') {
      result.answer = aiResponse;
    } else if (operation === 'summarize') {
      result.summary = aiResponse;
    } else if (operation === 'extract_entities') {
      try {
        result.entities = JSON.parse(aiResponse);
      } catch {
        result.entities = { text: aiResponse };
      }
    } else {
      result.result = aiResponse;
    }

    return createResponse(200, {
      operation,
      success: true,
      ...result,
      metadata: {
        documentLength: documentContent.length,
        processingTime: Date.now(),
        model: 'claude-3-sonnet'
      }
    });

  } catch (error) {
    console.error('Document processing error:', error);
    return createResponse(500, { 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}

// Health check handler
function handleHealth() {
  return createResponse(200, { 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
}

// Main Lambda handler
exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return handleOptions();
  }

  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  try {
    // Route handling
    if (path === '/api/health' || path === '/health') {
      return handleHealth();
    }
    
    if (path === '/api/organizations' && pathParts.length === 2) {
      return handleOrganizations(event);
    }
    
    if (path === '/api/projects' && pathParts.length === 2) {
      return handleProjects(event);
    }
    
    if (pathParts[1] === 'questions' && pathParts.length === 3) {
      const projectId = pathParts[2];
      return handleQuestions(event, projectId);
    }
    
    if (path === '/api/document-processing') {
      return handleDocumentProcessing(event);
    }
    
    // Fallback for other API routes
    return createResponse(404, { 
      error: 'Not found',
      path: path,
      availableRoutes: [
        '/api/health',
        '/api/organizations',
        '/api/projects', 
        '/api/questions/{projectId}',
        '/api/document-processing'
      ]
    });

  } catch (error) {
    console.error('Lambda handler error:', error);
    return createResponse(500, { 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
