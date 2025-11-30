"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
// Initialize AWS clients
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
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
        const bedrockCommand = new client_bedrock_runtime_1.InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-sonnet-20240229-v1:0',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw0RUFBMkY7QUFFM0YseUJBQXlCO0FBQ3pCLE1BQU0sYUFBYSxHQUFHLElBQUksNkNBQW9CLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQUVsRyxlQUFlO0FBQ2YsTUFBTSxXQUFXLEdBQUc7SUFDbEIsNkJBQTZCLEVBQUUsR0FBRztJQUNsQyw4QkFBOEIsRUFBRSw2QkFBNkI7SUFDN0QsOEJBQThCLEVBQUUsaUNBQWlDO0NBQ2xFLENBQUM7QUFFRix5Q0FBeUM7QUFDekMsU0FBUyxjQUFjLENBQUMsVUFBa0IsRUFBRSxJQUFTO0lBQ25ELE9BQU87UUFDTCxVQUFVO1FBQ1YsT0FBTyxFQUFFO1lBQ1AsY0FBYyxFQUFFLGtCQUFrQjtZQUNsQyxHQUFHLFdBQVc7U0FDZjtRQUNELElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQztLQUMzQixDQUFDO0FBQ0osQ0FBQztBQUVELDJDQUEyQztBQUMzQyxTQUFTLGFBQWE7SUFDcEIsT0FBTztRQUNMLFVBQVUsRUFBRSxHQUFHO1FBQ2YsT0FBTyxFQUFFLFdBQVc7UUFDcEIsSUFBSSxFQUFFLEVBQUU7S0FDVCxDQUFDO0FBQ0osQ0FBQztBQUVELHVEQUF1RDtBQUN2RCxLQUFLLFVBQVUsbUJBQW1CLENBQUMsS0FBMkI7SUFDNUQsT0FBTyxjQUFjLENBQUMsR0FBRyxFQUFFO1FBQ3pCLE9BQU8sRUFBRSx1REFBdUQ7UUFDaEUsYUFBYSxFQUFFLEVBQUU7S0FDbEIsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVELEtBQUssVUFBVSxjQUFjLENBQUMsS0FBMkI7SUFDdkQsT0FBTyxjQUFjLENBQUMsR0FBRyxFQUFFO1FBQ3pCLE9BQU8sRUFBRSxrREFBa0Q7UUFDM0QsUUFBUSxFQUFF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LENBQUMsQ0FBQztZQUMvQixPQUFPLGVBQWUsQ0FBQyxLQUFLLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDM0MsQ0FBQztRQUVELElBQUksSUFBSSxLQUFLLDBCQUEwQixFQUFFLENBQUM7WUFDeEMsT0FBTyx3QkFBd0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN6QyxDQUFDO1FBRUQsZ0NBQWdDO1FBQ2hDLE9BQU8sY0FBYyxDQUFDLEdBQUcsRUFBRTtZQUN6QixLQUFLLEVBQUUsV0FBVztZQUNsQixJQUFJLEVBQUUsSUFBSTtZQUNWLGVBQWUsRUFBRTtnQkFDZixhQUFhO2dCQUNiLG9CQUFvQjtnQkFDcEIsZUFBZTtnQkFDZiw0QkFBNEI7Z0JBQzVCLDBCQUEwQjthQUMzQjtTQUNGLENBQUMsQ0FBQztJQUVMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM5QyxPQUFPLGNBQWMsQ0FBQyxHQUFHLEVBQUU7WUFDekIsS0FBSyxFQUFFLHVCQUF1QjtZQUM5QixPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtTQUNsRSxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBekRXLFFBQUEsT0FBTyxXQXlEbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBCZWRyb2NrUnVudGltZUNsaWVudCwgSW52b2tlTW9kZWxDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZSc7XG5cbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcbmNvbnN0IGJlZHJvY2tDbGllbnQgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5cbi8vIENPUlMgaGVhZGVyc1xuY29uc3QgY29yc0hlYWRlcnMgPSB7XG4gICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbicsXG4gICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxufTtcblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBBUEkgcmVzcG9uc2VcbmZ1bmN0aW9uIGNyZWF0ZVJlc3BvbnNlKHN0YXR1c0NvZGU6IG51bWJlciwgYm9keTogYW55KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXNDb2RlLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAuLi5jb3JzSGVhZGVycyxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICB9O1xufVxuXG4vLyBIYW5kbGUgT1BUSU9OUyByZXF1ZXN0cyAoQ09SUyBwcmVmbGlnaHQpXG5mdW5jdGlvbiBoYW5kbGVPcHRpb25zKCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gIHJldHVybiB7XG4gICAgc3RhdHVzQ29kZTogMjAwLFxuICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxuICAgIGJvZHk6ICcnLFxuICB9O1xufVxuXG4vLyBQbGFjZWhvbGRlciBoYW5kbGVycyBmb3IgZnV0dXJlIGRhdGFiYXNlIGludGVncmF0aW9uXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVPcmdhbml6YXRpb25zKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gIHJldHVybiBjcmVhdGVSZXNwb25zZSgyMDAsIHsgXG4gICAgbWVzc2FnZTogJ09yZ2FuaXphdGlvbnMgZW5kcG9pbnQgLSBkYXRhYmFzZSBpbnRlZ3JhdGlvbiBwZW5kaW5nJyxcbiAgICBvcmdhbml6YXRpb25zOiBbXSBcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVByb2plY3RzKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gIHJldHVybiBjcmVhdGVSZXNwb25zZSgyMDAsIHsgXG4gICAgbWVzc2FnZTogJ1Byb2plY3RzIGVuZHBvaW50IC0gZGF0YWJhc2UgaW50ZWdyYXRpb24gcGVuZGluZycsXG4gICAgcHJvamVjdHM6IFtdIFxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlUXVlc3Rpb25zKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCwgcHJvamVjdElkOiBzdHJpbmcpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuICByZXR1cm4gY3JlYXRlUmVzcG9uc2UoMjAwLCB7IFxuICAgIG1lc3NhZ2U6IGBRdWVzdGlvbnMgZW5kcG9pbnQgZm9yIHByb2plY3QgJHtwcm9qZWN0SWR9IC0gZGF0YWJhc2UgaW50ZWdyYXRpb24gcGVuZGluZ2AsXG4gICAgcXVlc3Rpb25zOiBbXSBcbiAgfSk7XG59XG5cbi8vIERvY3VtZW50IHByb2Nlc3Npbmcgd2l0aCBCZWRyb2NrXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVEb2N1bWVudFByb2Nlc3NpbmcoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgdHJ5IHtcbiAgICBpZiAoZXZlbnQuaHR0cE1ldGhvZCAhPT0gJ1BPU1QnKSB7XG4gICAgICByZXR1cm4gY3JlYXRlUmVzcG9uc2UoNDA1LCB7IGVycm9yOiAnTWV0aG9kIG5vdCBhbGxvd2VkJyB9KTtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSBtdWx0aXBhcnQgZm9ybSBkYXRhIChzaW1wbGlmaWVkIGltcGxlbWVudGF0aW9uKVxuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gZXZlbnQuaGVhZGVyc1snY29udGVudC10eXBlJ10gfHwgZXZlbnQuaGVhZGVyc1snQ29udGVudC1UeXBlJ107XG4gICAgaWYgKCFjb250ZW50VHlwZT8uaW5jbHVkZXMoJ211bHRpcGFydC9mb3JtLWRhdGEnKSkge1xuICAgICAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDQwMCwgeyBlcnJvcjogJ0ludmFsaWQgY29udGVudCB0eXBlIC0gbXVsdGlwYXJ0L2Zvcm0tZGF0YSBleHBlY3RlZCcgfSk7XG4gICAgfVxuXG4gICAgLy8gRm9yIG5vdywgcmV0dXJuIGEgcGxhY2Vob2xkZXIgcmVzcG9uc2Ugc2luY2UgcGFyc2luZyBtdWx0aXBhcnQgZGF0YSBpbiBMYW1iZGEgaXMgY29tcGxleFxuICAgIC8vIEluIGEgcmVhbCBpbXBsZW1lbnRhdGlvbiwgeW91J2QgdXNlIGEgbGlicmFyeSBsaWtlICdidXNib3knIHRvIHBhcnNlIHRoZSBmb3JtIGRhdGFcbiAgICBjb25zdCBvcGVyYXRpb24gPSAncWEnOyAvLyBXb3VsZCBiZSBleHRyYWN0ZWQgZnJvbSBmb3JtIGRhdGFcbiAgICBjb25zdCBxdWVzdGlvbiA9ICdXaGF0IGFyZSB0aGUgbWFpbiByZXF1aXJlbWVudHM/JzsgLy8gV291bGQgYmUgZXh0cmFjdGVkIGZyb20gZm9ybSBkYXRhXG4gICAgXG4gICAgLy8gTW9jayBkb2N1bWVudCBjb250ZW50IGZvciB0ZXN0aW5nXG4gICAgY29uc3QgZG9jdW1lbnRDb250ZW50ID0gYFxuICAgICAgVGVzdCBSRlAgRG9jdW1lbnRcbiAgICAgIFxuICAgICAgUHJvamVjdCBSZXF1aXJlbWVudHM6XG4gICAgICAtIFdlYiBhcHBsaWNhdGlvbiBkZXZlbG9wbWVudFxuICAgICAgLSBEYXRhYmFzZSBpbnRlZ3JhdGlvblxuICAgICAgLSBBUEkgZGV2ZWxvcG1lbnRcbiAgICAgIC0gQ2xvdWQgZGVwbG95bWVudCBvbiBBV1NcbiAgICAgIC0gVGltZWxpbmU6IDYgbW9udGhzXG4gICAgICAtIEJ1ZGdldDogJDEwMCwwMDBcbiAgICAgIFxuICAgICAgQ29tcGFueSBJbmZvcm1hdGlvbjpcbiAgICAgIC0gQ29tcGFueTogVGVzdCBDb3JwXG4gICAgICAtIENvbnRhY3Q6IEpvaG4gU21pdGhcbiAgICAgIC0gRW1haWw6IGpvaG5AdGVzdGNvcnAuY29tXG4gICAgICAtIER1ZSBEYXRlOiBNYXJjaCAxNSwgMjAyNVxuICAgICAgXG4gICAgICBUZWNobmljYWwgUmVxdWlyZW1lbnRzOlxuICAgICAgLSBSZWFjdCBmcm9udGVuZFxuICAgICAgLSBOb2RlLmpzIGJhY2tlbmRcbiAgICAgIC0gUG9zdGdyZVNRTCBkYXRhYmFzZVxuICAgICAgLSBBV1MgZGVwbG95bWVudFxuICAgICAgLSBDSS9DRCBwaXBlbGluZVxuICAgIGA7XG5cbiAgICAvLyBQcm9jZXNzIHdpdGggQmVkcm9jayBDbGF1ZGUgMy41IFNvbm5ldFxuICAgIGxldCBwcm9tcHQgPSAnJztcbiAgICBpZiAob3BlcmF0aW9uID09PSAncWEnKSB7XG4gICAgICBwcm9tcHQgPSBgQmFzZWQgb24gdGhlIGZvbGxvd2luZyBkb2N1bWVudCwgcGxlYXNlIGFuc3dlciB0aGlzIHF1ZXN0aW9uOiBcIiR7cXVlc3Rpb259XCJcbiAgICAgIFxuICAgICAgRG9jdW1lbnQ6XG4gICAgICAke2RvY3VtZW50Q29udGVudH1cbiAgICAgIFxuICAgICAgUGxlYXNlIHByb3ZpZGUgYSBjbGVhciBhbmQgY29uY2lzZSBhbnN3ZXIgYmFzZWQgb25seSBvbiB0aGUgaW5mb3JtYXRpb24gaW4gdGhlIGRvY3VtZW50LmA7XG4gICAgfSBlbHNlIGlmIChvcGVyYXRpb24gPT09ICdzdW1tYXJpemUnKSB7XG4gICAgICBwcm9tcHQgPSBgUGxlYXNlIHByb3ZpZGUgYSAyLTMgcGFyYWdyYXBoIHN1bW1hcnkgb2YgdGhlIGZvbGxvd2luZyBSRlAgZG9jdW1lbnQ6XG4gICAgICBcbiAgICAgICR7ZG9jdW1lbnRDb250ZW50fWA7XG4gICAgfSBlbHNlIGlmIChvcGVyYXRpb24gPT09ICdleHRyYWN0X2VudGl0aWVzJykge1xuICAgICAgcHJvbXB0ID0gYEV4dHJhY3Qga2V5IGVudGl0aWVzIGZyb20gdGhlIGZvbGxvd2luZyBkb2N1bWVudCBpbmNsdWRpbmcgY29tcGFuaWVzLCBwZW9wbGUsIGRhdGVzLCB0ZWNobm9sb2dpZXMsIGFuZCByZXF1aXJlbWVudHM6XG4gICAgICBcbiAgICAgICR7ZG9jdW1lbnRDb250ZW50fVxuICAgICAgXG4gICAgICBQbGVhc2UgZm9ybWF0IHRoZSByZXNwb25zZSBhcyBhIEpTT04gb2JqZWN0IHdpdGggY2F0ZWdvcmllcy5gO1xuICAgIH1cblxuICAgIGNvbnN0IGJlZHJvY2tDb21tYW5kID0gbmV3IEludm9rZU1vZGVsQ29tbWFuZCh7XG4gICAgICBtb2RlbElkOiAndXMuYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowJyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgYW50aHJvcGljX3ZlcnNpb246ICdiZWRyb2NrLTIwMjMtMDUtMzEnLFxuICAgICAgICBtYXhfdG9rZW5zOiAxMDAwLFxuICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHJvbGU6ICd1c2VyJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IHByb21wdFxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSksXG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYmVkcm9ja1Jlc3BvbnNlID0gYXdhaXQgYmVkcm9ja0NsaWVudC5zZW5kKGJlZHJvY2tDb21tYW5kKTtcbiAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShiZWRyb2NrUmVzcG9uc2UuYm9keSkpO1xuICAgIGNvbnN0IGFpUmVzcG9uc2UgPSByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0O1xuXG4gICAgLy8gRm9ybWF0IHJlc3BvbnNlIGJhc2VkIG9uIG9wZXJhdGlvblxuICAgIGxldCByZXN1bHQ6IGFueSA9IHt9O1xuICAgIGlmIChvcGVyYXRpb24gPT09ICdxYScpIHtcbiAgICAgIHJlc3VsdC5hbnN3ZXIgPSBhaVJlc3BvbnNlO1xuICAgIH0gZWxzZSBpZiAob3BlcmF0aW9uID09PSAnc3VtbWFyaXplJykge1xuICAgICAgcmVzdWx0LnN1bW1hcnkgPSBhaVJlc3BvbnNlO1xuICAgIH0gZWxzZSBpZiAob3BlcmF0aW9uID09PSAnZXh0cmFjdF9lbnRpdGllcycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc3VsdC5lbnRpdGllcyA9IEpTT04ucGFyc2UoYWlSZXNwb25zZSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmVzdWx0LmVudGl0aWVzID0geyB0ZXh0OiBhaVJlc3BvbnNlIH07XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5yZXN1bHQgPSBhaVJlc3BvbnNlO1xuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVSZXNwb25zZSgyMDAsIHtcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAuLi5yZXN1bHQsXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBkb2N1bWVudExlbmd0aDogZG9jdW1lbnRDb250ZW50Lmxlbmd0aCxcbiAgICAgICAgcHJvY2Vzc2luZ1RpbWU6IERhdGUubm93KCksXG4gICAgICAgIG1vZGVsOiAnY2xhdWRlLTMtNS1zb25uZXQnXG4gICAgICB9XG4gICAgfSk7XG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdEb2N1bWVudCBwcm9jZXNzaW5nIGVycm9yOicsIGVycm9yKTtcbiAgICByZXR1cm4gY3JlYXRlUmVzcG9uc2UoNTAwLCB7IFxuICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLCBcbiAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InIFxuICAgIH0pO1xuICB9XG59XG5cbi8vIEhlYWx0aCBjaGVjayBoYW5kbGVyXG5mdW5jdGlvbiBoYW5kbGVIZWFsdGgoKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDIwMCwgeyBcbiAgICBzdGF0dXM6ICdoZWFsdGh5JyxcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50J1xuICB9KTtcbn1cblxuLy8gTWFpbiBMYW1iZGEgaGFuZGxlclxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcbiAgY29udGV4dDogQ29udGV4dFxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAgY29uc29sZS5sb2coJ0V2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgLy8gSGFuZGxlIENPUlMgcHJlZmxpZ2h0IHJlcXVlc3RzXG4gIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gaGFuZGxlT3B0aW9ucygpO1xuICB9XG5cbiAgY29uc3QgcGF0aCA9IGV2ZW50LnBhdGg7XG4gIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgdHJ5IHtcbiAgICAvLyBSb3V0ZSBoYW5kbGluZ1xuICAgIGlmIChwYXRoID09PSAnL2FwaS9oZWFsdGgnIHx8IHBhdGggPT09ICcvaGVhbHRoJykge1xuICAgICAgcmV0dXJuIGhhbmRsZUhlYWx0aCgpO1xuICAgIH1cbiAgICBcbiAgICBpZiAocGF0aCA9PT0gJy9hcGkvb3JnYW5pemF0aW9ucycgJiYgcGF0aFBhcnRzLmxlbmd0aCA9PT0gMikge1xuICAgICAgcmV0dXJuIGhhbmRsZU9yZ2FuaXphdGlvbnMoZXZlbnQpO1xuICAgIH1cbiAgICBcbiAgICBpZiAocGF0aCA9PT0gJy9hcGkvcHJvamVjdHMnICYmIHBhdGhQYXJ0cy5sZW5ndGggPT09IDIpIHtcbiAgICAgIHJldHVybiBoYW5kbGVQcm9qZWN0cyhldmVudCk7XG4gICAgfVxuICAgIFxuICAgIGlmIChwYXRoUGFydHNbMV0gPT09ICdxdWVzdGlvbnMnICYmIHBhdGhQYXJ0cy5sZW5ndGggPT09IDMpIHtcbiAgICAgIGNvbnN0IHByb2plY3RJZCA9IHBhdGhQYXJ0c1syXTtcbiAgICAgIHJldHVybiBoYW5kbGVRdWVzdGlvbnMoZXZlbnQsIHByb2plY3RJZCk7XG4gICAgfVxuICAgIFxuICAgIGlmIChwYXRoID09PSAnL2FwaS9kb2N1bWVudC1wcm9jZXNzaW5nJykge1xuICAgICAgcmV0dXJuIGhhbmRsZURvY3VtZW50UHJvY2Vzc2luZyhldmVudCk7XG4gICAgfVxuICAgIFxuICAgIC8vIEZhbGxiYWNrIGZvciBvdGhlciBBUEkgcm91dGVzXG4gICAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDQwNCwgeyBcbiAgICAgIGVycm9yOiAnTm90IGZvdW5kJyxcbiAgICAgIHBhdGg6IHBhdGgsXG4gICAgICBhdmFpbGFibGVSb3V0ZXM6IFtcbiAgICAgICAgJy9hcGkvaGVhbHRoJyxcbiAgICAgICAgJy9hcGkvb3JnYW5pemF0aW9ucycsXG4gICAgICAgICcvYXBpL3Byb2plY3RzJywgXG4gICAgICAgICcvYXBpL3F1ZXN0aW9ucy97cHJvamVjdElkfScsXG4gICAgICAgICcvYXBpL2RvY3VtZW50LXByb2Nlc3NpbmcnXG4gICAgICBdXG4gICAgfSk7XG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdMYW1iZGEgaGFuZGxlciBlcnJvcjonLCBlcnJvcik7XG4gICAgcmV0dXJuIGNyZWF0ZVJlc3BvbnNlKDUwMCwgeyBcbiAgICAgIGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yJyxcbiAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXG4gICAgfSk7XG4gIH1cbn07XG4iXX0=