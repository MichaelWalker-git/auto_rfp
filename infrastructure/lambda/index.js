"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const bedrock_http_client_1 = require("./helpers/bedrock-http-client");
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
        // Process with Bedrock Claude 3.5 Sonnet
        let prompt = '';
        if (operation === 'qa') {
            prompt = `Based on the following document, please answer this question: "${question}"
      
      Document:
      ${documentContent}
      
      Please provide a clear and concise answer based only on the information in the document.`;
        }
        else if (operation === 'summarize') {
            prompt = `Please provide a 2-3 paragraph summary of the following RFP document:
      
      ${documentContent}`;
        }
        else if (operation === 'extract_entities') {
            prompt = `Extract key entities from the following document including companies, people, dates, technologies, and requirements:
      
      ${documentContent}
      
      Please format the response as a JSON object with categories.`;
        }
        const body = JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1000,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        });
        const bedrockResponseBody = await (0, bedrock_http_client_1.invokeModel)('us.anthropic.claude-3-sonnet-20240229-v1:0', body, 'application/json', 'application/json');
        const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponseBody));
        const aiResponse = responseBody.content[0].text;
        // Format response based on operation
        let result = {};
        if (operation === 'qa') {
            result.answer = aiResponse;
        }
        else if (operation === 'summarize') {
            result.summary = aiResponse;
        }
        else if (operation === 'extract_entities') {
            try {
                result.entities = JSON.parse(aiResponse);
            }
            catch {
                result.entities = { text: aiResponse };
            }
        }
        else {
            result.result = aiResponse;
        }
        return createResponse(200, {
            operation,
            success: true,
            ...result,
            metadata: {
                documentLength: documentContent.length,
                processingTime: Date.now(),
                model: 'claude-3-5-sonnet'
            }
        });
    }
    catch (error) {
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
const handler = async (event, context) => {
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
    }
    catch (error) {
        console.error('Lambda handler error:', error);
        return createResponse(500, {
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSx1RUFBNEQ7QUFFNUQsZUFBZTtBQUNmLE1BQU0sV0FBVyxHQUFHO0lBQ2xCLDZCQUE2QixFQUFFLEdBQUc7SUFDbEMsOEJBQThCLEVBQUUsNkJBQTZCO0lBQzdELDhCQUE4QixFQUFFLGlDQUFpQztDQUNsRSxDQUFDO0FBRUYseUNBQXlDO0FBQ3pDLFNBQVMsY0FBYyxDQUFDLFVBQWtCLEVBQUUsSUFBUztJQUNuRCxPQUFPO1FBQ0wsVUFBVTtRQUNWLE9BQU8sRUFBRTtZQUNQLGNBQWMsRUFBRSxrQkFBa0I7WUFDbEMsR0FBRyxXQUFXO1NBQ2Y7UUFDRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7S0FDM0IsQ0FBQztBQUNKLENBQUM7QUFFRCwyQ0FBMkM7QUFDM0MsU0FBUyxhQUFhO0lBQ3BCLE9BQU87UUFDTCxVQUFVLEVBQUUsR0FBRztRQUNmLE9BQU8sRUFBRSxXQUFXO1FBQ3BCLElBQUksRUFBRSxFQUFFO0tBQ1QsQ0FBQztBQUNKLENBQUM7QUFFRCx1REFBdUQ7QUFDdkQsS0FBSyxVQUFVLG1CQUFtQixDQUFDLEtBQTJCO0lBQzVELE9BQU8sY0FBYyxDQUFDLEdBQUcsRUFBRTtRQUN6QixPQUFPLEVBQUUsdURBQXVEO1FBQ2hFLGFBQWEsRUFBRSxFQUFFO0tBQ2xCLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxLQUFLLFVBQVUsY0FBYyxDQUFDLEtBQTJCO0lBQ3ZELE9BQU8sY0FBYyxDQUFDLEdBQUcsRUFBRTtRQUN6QixPQUFPLEVBQUUsa0RBQWtEO1FBQzNELFFBQVEsRUFBRSxFQUFFO0tBQ2IsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVELEtBQUssVUFBVSxlQUFlLENBQUMsS0FBMkIsRUFBRSxTQUFpQjtJQUMzRSxPQUFPLGNBQWMsQ0FBQyxHQUFHLEVBQUU7UUFDekIsT0FBTyxF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YyxDQUFDLEdBQUcsRUFBRTtZQUN6QixLQUFLLEVBQUUsV0FBVztZQUNsQixJQUFJLEVBQUUsSUFBSTtZQUNWLGVBQWUsRUFBRTtnQkFDZixhQUFhO2dCQUNiLG9CQUFvQjtnQkFDcEIsZUFBZTtnQkFDZiw0QkFBNEI7Z0JBQzVCLDBCQUEwQjthQUMzQjtTQUNGLENBQUMsQ0FBQztJQUVMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM5QyxPQUFPLGNBQWMsQ0FBQyxHQUFHLEVBQUU7WUFDekIsS0FBSyxFQUFFLHVCQUF1QjtZQUM5QixPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtTQUNsRSxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBekRXLFFBQUEsT0FBTyxXQXlEbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBpbnZva2VNb2RlbCB9IGZyb20gJy4vaGVscGVycy9iZWRyb2NrLWh0dHAtY2xpZW50JztcblxuLy8gQ09SUyBoZWFkZXJzXG5jb25zdCBjb3JzSGVhZGVycyA9IHtcbiAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uJyxcbiAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG59O1xuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIEFQSSByZXNwb25zZVxuZnVuY3Rpb24gY3JlYXRlUmVzcG9uc2Uoc3RhdHVzQ29kZTogbnVtYmVyLCBib2R5OiBhbnkpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICByZXR1cm4ge1xuICAgIHN0YXR1c0NvZGUsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIC4uLmNvcnNIZWFkZXJzLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH07XG59XG5cbi8vIEhhbmRsZSBPUFRJT05TIHJlcXVlc3RzIChDT1JTIHByZWZsaWdodClcbmZ1bmN0aW9uIGhhbmRsZU9wdGlvbnMoKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgYm9keTogJycsXG4gIH07XG59XG5cbi8vIFBsYWNlaG9sZGVyIGhhbmRsZXJzIGZvciBmdXR1cmUgZGF0YWJhc2UgaW50ZWdyYXRpb25cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZU9yZ2FuaXphdGlvbnMoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDIwMCwgeyBcbiAgICBtZXNzYWdlOiAnT3JnYW5pemF0aW9ucyBlbmRwb2ludCAtIGRhdGFiYXNlIGludGVncmF0aW9uIHBlbmRpbmcnLFxuICAgIG9yZ2FuaXphdGlvbnM6IFtdIFxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlUHJvamVjdHMoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDIwMCwgeyBcbiAgICBtZXNzYWdlOiAnUHJvamVjdHMgZW5kcG9pbnQgLSBkYXRhYmFzZSBpbnRlZ3JhdGlvbiBwZW5kaW5nJyxcbiAgICBwcm9qZWN0czogW10gXG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVRdWVzdGlvbnMoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBwcm9qZWN0SWQ6IHN0cmluZyk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gIHJldHVybiBjcmVhdGVSZXNwb25zZSgyMDAsIHsgXG4gICAgbWVzc2FnZTogYFF1ZXN0aW9ucyBlbmRwb2ludCBmb3IgcHJvamVjdCAke3Byb2plY3RJZH0gLSBkYXRhYmFzZSBpbnRlZ3JhdGlvbiBwZW5kaW5nYCxcbiAgICBxdWVzdGlvbnM6IFtdIFxuICB9KTtcbn1cblxuLy8gRG9jdW1lbnQgcHJvY2Vzc2luZyB3aXRoIEJlZHJvY2tcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZURvY3VtZW50UHJvY2Vzc2luZyhldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuICB0cnkge1xuICAgIGlmIChldmVudC5odHRwTWV0aG9kICE9PSAnUE9TVCcpIHtcbiAgICAgIHJldHVybiBjcmVhdGVSZXNwb25zZSg0MDUsIHsgZXJyb3I6ICdNZXRob2Qgbm90IGFsbG93ZWQnIH0pO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIG11bHRpcGFydCBmb3JtIGRhdGEgKHNpbXBsaWZpZWQgaW1wbGVtZW50YXRpb24pXG4gICAgY29uc3QgY29udGVudFR5cGUgPSBldmVudC5oZWFkZXJzWydjb250ZW50LXR5cGUnXSB8fCBldmVudC5oZWFkZXJzWydDb250ZW50LVR5cGUnXTtcbiAgICBpZiAoIWNvbnRlbnRUeXBlPy5pbmNsdWRlcygnbXVsdGlwYXJ0L2Zvcm0tZGF0YScpKSB7XG4gICAgICByZXR1cm4gY3JlYXRlUmVzcG9uc2UoNDAwLCB7IGVycm9yOiAnSW52YWxpZCBjb250ZW50IHR5cGUgLSBtdWx0aXBhcnQvZm9ybS1kYXRhIGV4cGVjdGVkJyB9KTtcbiAgICB9XG5cbiAgICAvLyBGb3Igbm93LCByZXR1cm4gYSBwbGFjZWhvbGRlciByZXNwb25zZSBzaW5jZSBwYXJzaW5nIG11bHRpcGFydCBkYXRhIGluIExhbWJkYSBpcyBjb21wbGV4XG4gICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3UnZCB1c2UgYSBsaWJyYXJ5IGxpa2UgJ2J1c2JveScgdG8gcGFyc2UgdGhlIGZvcm0gZGF0YVxuICAgIGNvbnN0IG9wZXJhdGlvbiA9ICdxYSc7IC8vIFdvdWxkIGJlIGV4dHJhY3RlZCBmcm9tIGZvcm0gZGF0YVxuICAgIGNvbnN0IHF1ZXN0aW9uID0gJ1doYXQgYXJlIHRoZSBtYWluIHJlcXVpcmVtZW50cz8nOyAvLyBXb3VsZCBiZSBleHRyYWN0ZWQgZnJvbSBmb3JtIGRhdGFcbiAgICBcbiAgICAvLyBNb2NrIGRvY3VtZW50IGNvbnRlbnQgZm9yIHRlc3RpbmdcbiAgICBjb25zdCBkb2N1bWVudENvbnRlbnQgPSBgXG4gICAgICBUZXN0IFJGUCBEb2N1bWVudFxuICAgICAgXG4gICAgICBQcm9qZWN0IFJlcXVpcmVtZW50czpcbiAgICAgIC0gV2ViIGFwcGxpY2F0aW9uIGRldmVsb3BtZW50XG4gICAgICAtIERhdGFiYXNlIGludGVncmF0aW9uXG4gICAgICAtIEFQSSBkZXZlbG9wbWVudFxuICAgICAgLSBDbG91ZCBkZXBsb3ltZW50IG9uIEFXU1xuICAgICAgLSBUaW1lbGluZTogNiBtb250aHNcbiAgICAgIC0gQnVkZ2V0OiAkMTAwLDAwMFxuICAgICAgXG4gICAgICBDb21wYW55IEluZm9ybWF0aW9uOlxuICAgICAgLSBDb21wYW55OiBUZXN0IENvcnBcbiAgICAgIC0gQ29udGFjdDogSm9obiBTbWl0aFxuICAgICAgLSBFbWFpbDogam9obkB0ZXN0Y29ycC5jb21cbiAgICAgIC0gRHVlIERhdGU6IE1hcmNoIDE1LCAyMDI1XG4gICAgICBcbiAgICAgIFRlY2huaWNhbCBSZXF1aXJlbWVudHM6XG4gICAgICAtIFJlYWN0IGZyb250ZW5kXG4gICAgICAtIE5vZGUuanMgYmFja2VuZFxuICAgICAgLSBQb3N0Z3JlU1FMIGRhdGFiYXNlXG4gICAgICAtIEFXUyBkZXBsb3ltZW50XG4gICAgICAtIENJL0NEIHBpcGVsaW5lXG4gICAgYDtcblxuICAgIC8vIFByb2Nlc3Mgd2l0aCBCZWRyb2NrIENsYXVkZSAzLjUgU29ubmV0XG4gICAgbGV0IHByb21wdCA9ICcnO1xuICAgIGlmIChvcGVyYXRpb24gPT09ICdxYScpIHtcbiAgICAgIHByb21wdCA9IGBCYXNlZCBvbiB0aGUgZm9sbG93aW5nIGRvY3VtZW50LCBwbGVhc2UgYW5zd2VyIHRoaXMgcXVlc3Rpb246IFwiJHtxdWVzdGlvbn1cIlxuICAgICAgXG4gICAgICBEb2N1bWVudDpcbiAgICAgICR7ZG9jdW1lbnRDb250ZW50fVxuICAgICAgXG4gICAgICBQbGVhc2UgcHJvdmlkZSBhIGNsZWFyIGFuZCBjb25jaXNlIGFuc3dlciBiYXNlZCBvbmx5IG9uIHRoZSBpbmZvcm1hdGlvbiBpbiB0aGUgZG9jdW1lbnQuYDtcbiAgICB9IGVsc2UgaWYgKG9wZXJhdGlvbiA9PT0gJ3N1bW1hcml6ZScpIHtcbiAgICAgIHByb21wdCA9IGBQbGVhc2UgcHJvdmlkZSBhIDItMyBwYXJhZ3JhcGggc3VtbWFyeSBvZiB0aGUgZm9sbG93aW5nIFJGUCBkb2N1bWVudDpcbiAgICAgIFxuICAgICAgJHtkb2N1bWVudENvbnRlbnR9YDtcbiAgICB9IGVsc2UgaWYgKG9wZXJhdGlvbiA9PT0gJ2V4dHJhY3RfZW50aXRpZXMnKSB7XG4gICAgICBwcm9tcHQgPSBgRXh0cmFjdCBrZXkgZW50aXRpZXMgZnJvbSB0aGUgZm9sbG93aW5nIGRvY3VtZW50IGluY2x1ZGluZyBjb21wYW5pZXMsIHBlb3BsZSwgZGF0ZXMsIHRlY2hub2xvZ2llcywgYW5kIHJlcXVpcmVtZW50czpcbiAgICAgIFxuICAgICAgJHtkb2N1bWVudENvbnRlbnR9XG4gICAgICBcbiAgICAgIFBsZWFzZSBmb3JtYXQgdGhlIHJlc3BvbnNlIGFzIGEgSlNPTiBvYmplY3Qgd2l0aCBjYXRlZ29yaWVzLmA7XG4gICAgfVxuXG4gICAgY29uc3QgYm9keSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGFudGhyb3BpY192ZXJzaW9uOiAnYmVkcm9jay0yMDIzLTA1LTMxJyxcbiAgICAgIG1heF90b2tlbnM6IDEwMDAsXG4gICAgICBtZXNzYWdlczogW1xuICAgICAgICB7XG4gICAgICAgICAgcm9sZTogJ3VzZXInLFxuICAgICAgICAgIGNvbnRlbnQ6IHByb21wdFxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSk7XG5cbiAgICBjb25zdCBiZWRyb2NrUmVzcG9uc2VCb2R5ID0gYXdhaXQgaW52b2tlTW9kZWwoXG4gICAgICAndXMuYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowJyxcbiAgICAgIGJvZHksXG4gICAgICAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnYXBwbGljYXRpb24vanNvbidcbiAgICApO1xuICAgIFxuICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJlZHJvY2tSZXNwb25zZUJvZHkpKTtcbiAgICBjb25zdCBhaVJlc3BvbnNlID0gcmVzcG9uc2VCb2R5LmNvbnRlbnRbMF0udGV4dDtcblxuICAgIC8vIEZvcm1hdCByZXNwb25zZSBiYXNlZCBvbiBvcGVyYXRpb25cbiAgICBsZXQgcmVzdWx0OiBhbnkgPSB7fTtcbiAgICBpZiAob3BlcmF0aW9uID09PSAncWEnKSB7XG4gICAgICByZXN1bHQuYW5zd2VyID0gYWlSZXNwb25zZTtcbiAgICB9IGVsc2UgaWYgKG9wZXJhdGlvbiA9PT0gJ3N1bW1hcml6ZScpIHtcbiAgICAgIHJlc3VsdC5zdW1tYXJ5ID0gYWlSZXNwb25zZTtcbiAgICB9IGVsc2UgaWYgKG9wZXJhdGlvbiA9PT0gJ2V4dHJhY3RfZW50aXRpZXMnKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXN1bHQuZW50aXRpZXMgPSBKU09OLnBhcnNlKGFpUmVzcG9uc2UpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJlc3VsdC5lbnRpdGllcyA9IHsgdGV4dDogYWlSZXNwb25zZSB9O1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQucmVzdWx0ID0gYWlSZXNwb25zZTtcbiAgICB9XG5cbiAgICByZXR1cm4gY3JlYXRlUmVzcG9uc2UoMjAwLCB7XG4gICAgICBvcGVyYXRpb24sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgLi4ucmVzdWx0LFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgZG9jdW1lbnRMZW5ndGg6IGRvY3VtZW50Q29udGVudC5sZW5ndGgsXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lOiBEYXRlLm5vdygpLFxuICAgICAgICBtb2RlbDogJ2NsYXVkZS0zLTUtc29ubmV0J1xuICAgICAgfVxuICAgIH0pO1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRG9jdW1lbnQgcHJvY2Vzc2luZyBlcnJvcjonLCBlcnJvcik7XG4gICAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDUwMCwgeyBcbiAgICAgIGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yJywgXG4gICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyBcbiAgICB9KTtcbiAgfVxufVxuXG4vLyBIZWFsdGggY2hlY2sgaGFuZGxlclxuZnVuY3Rpb24gaGFuZGxlSGVhbHRoKCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gIHJldHVybiBjcmVhdGVSZXNwb25zZSgyMDAsIHsgXG4gICAgc3RhdHVzOiAnaGVhbHRoeScsXG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICdkZXZlbG9wbWVudCdcbiAgfSk7XG59XG5cbi8vIE1haW4gTGFtYmRhIGhhbmRsZXJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXG4gIGNvbnRleHQ6IENvbnRleHRcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gIGNvbnNvbGUubG9nKCdFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gIC8vIEhhbmRsZSBDT1JTIHByZWZsaWdodCByZXF1ZXN0c1xuICBpZiAoZXZlbnQuaHR0cE1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIGhhbmRsZU9wdGlvbnMoKTtcbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBldmVudC5wYXRoO1xuICBjb25zdCBwYXRoUGFydHMgPSBwYXRoLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuXG4gIHRyeSB7XG4gICAgLy8gUm91dGUgaGFuZGxpbmdcbiAgICBpZiAocGF0aCA9PT0gJy9hcGkvaGVhbHRoJyB8fCBwYXRoID09PSAnL2hlYWx0aCcpIHtcbiAgICAgIHJldHVybiBoYW5kbGVIZWFsdGgoKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKHBhdGggPT09ICcvYXBpL29yZ2FuaXphdGlvbnMnICYmIHBhdGhQYXJ0cy5sZW5ndGggPT09IDIpIHtcbiAgICAgIHJldHVybiBoYW5kbGVPcmdhbml6YXRpb25zKGV2ZW50KTtcbiAgICB9XG4gICAgXG4gICAgaWYgKHBhdGggPT09ICcvYXBpL3Byb2plY3RzJyAmJiBwYXRoUGFydHMubGVuZ3RoID09PSAyKSB7XG4gICAgICByZXR1cm4gaGFuZGxlUHJvamVjdHMoZXZlbnQpO1xuICAgIH1cbiAgICBcbiAgICBpZiAocGF0aFBhcnRzWzFdID09PSAncXVlc3Rpb25zJyAmJiBwYXRoUGFydHMubGVuZ3RoID09PSAzKSB7XG4gICAgICBjb25zdCBwcm9qZWN0SWQgPSBwYXRoUGFydHNbMl07XG4gICAgICByZXR1cm4gaGFuZGxlUXVlc3Rpb25zKGV2ZW50LCBwcm9qZWN0SWQpO1xuICAgIH1cbiAgICBcbiAgICBpZiAocGF0aCA9PT0gJy9hcGkvZG9jdW1lbnQtcHJvY2Vzc2luZycpIHtcbiAgICAgIHJldHVybiBoYW5kbGVEb2N1bWVudFByb2Nlc3NpbmcoZXZlbnQpO1xuICAgIH1cbiAgICBcbiAgICAvLyBGYWxsYmFjayBmb3Igb3RoZXIgQVBJIHJvdXRlc1xuICAgIHJldHVybiBjcmVhdGVSZXNwb25zZSg0MDQsIHsgXG4gICAgICBlcnJvcjogJ05vdCBmb3VuZCcsXG4gICAgICBwYXRoOiBwYXRoLFxuICAgICAgYXZhaWxhYmxlUm91dGVzOiBbXG4gICAgICAgICcvYXBpL2hlYWx0aCcsXG4gICAgICAgICcvYXBpL29yZ2FuaXphdGlvbnMnLFxuICAgICAgICAnL2FwaS9wcm9qZWN0cycsIFxuICAgICAgICAnL2FwaS9xdWVzdGlvbnMve3Byb2plY3RJZH0nLFxuICAgICAgICAnL2FwaS9kb2N1bWVudC1wcm9jZXNzaW5nJ1xuICAgICAgXVxuICAgIH0pO1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignTGFtYmRhIGhhbmRsZXIgZXJyb3I6JywgZXJyb3IpO1xuICAgIHJldHVybiBjcmVhdGVSZXNwb25zZSg1MDAsIHsgXG4gICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xuICAgIH0pO1xuICB9XG59O1xuIl19