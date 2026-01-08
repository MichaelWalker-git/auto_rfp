"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.deleteProject = deleteProject;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const common_1 = require("../constants/common");
const organization_1 = require("../constants/organization");
const api_1 = require("../helpers/api");
const ddbClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});
const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) {
    throw new Error('DB_TABLE_NAME environment variable is not set');
}
const handler = async (event) => {
    try {
        const projectId = event.pathParameters?.projectId || event.pathParameters?.id;
        const { orgId } = event.queryStringParameters || {};
        if (!orgId || !projectId) {
            return (0, api_1.apiResponse)(400, {
                message: 'Missing required query parameters: orgId and projectId',
            });
        }
        await deleteProject(orgId, projectId);
        return (0, api_1.apiResponse)(200, {
            success: true,
            message: 'Project deleted successfully',
            orgId,
            projectId,
        });
    }
    catch (err) {
        console.error('Error in deleteProject handler:', err);
        if (err?.name === 'ConditionalCheckFailedException') {
            return (0, api_1.apiResponse)(404, { message: 'Project not found' });
        }
        return (0, api_1.apiResponse)(500, {
            message: 'Internal server error',
            error: err instanceof Error ? err.message : 'Unknown error',
        });
    }
};
exports.handler = handler;
// --- Business logic ---
async function deleteProject(orgId, projectId) {
    const key = {
        [common_1.PK_NAME]: organization_1.PROJECT_PK,
        [common_1.SK_NAME]: `${orgId}#${projectId}`, // same composite SK as in createProject
    };
    const cmd = new lib_dynamodb_1.DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        // Only delete if item exists
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        ExpressionAttributeNames: {
            '#pk': common_1.PK_NAME,
            '#sk': common_1.SK_NAME,
        },
    });
    await docClient.send(cmd);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLXByb2plY3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZWxldGUtcHJvamVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUErREEsc0NBc0JDO0FBakZELDhEQUEwRDtBQUMxRCx3REFHK0I7QUFDL0IsZ0RBQXVEO0FBQ3ZELDREQUF1RDtBQUN2RCx3Q0FBNkM7QUFFN0MsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFO1FBQ2YscUJBQXFCLEVBQUUsSUFBSTtLQUM1QjtDQUNGLENBQUMsQ0FBQztBQUVILE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO0FBRWhELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLCtDQUErQyxDQUFDLENBQUM7QUFDbkUsQ0FBQztBQUVNLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBNkIsRUFDSyxFQUFFO0lBQ3BDLElBQUksQ0FBQztRQUNILE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxjQUFjLEVBQUUsU0FBUyxJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsRUFBRSxDQUFDO1FBQzlFLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxLQUFLLENBQUMscUJBQXFCLElBQUksRUFBRSxDQUFDO1FBRXBELElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUN6QixPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7Z0JBQ3RCLE9BQU8sRUFBRSx3REFBd0Q7YUFDbEUsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sYUFBYSxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQztRQUV0QyxPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7WUFDdEIsT0FBTyxFQUFFLElBQUk7WUFDYixPQUFPLEVBQUUsOEJBQThCO1lBQ3ZDLEtBQUs7WUFDTCxTQUFTO1NBQ1YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUFDLE9BQU8sR0FBUSxFQUFFLENBQUM7UUFDbEIsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUV0RCxJQUFJLEdBQUcsRUFBRSxJQUFJLEtBQUssaUNBQWlDLEVBQUUsQ0FBQztZQUNwRCxPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsbUJBQW1CLEVBQUUsQ0FBQyxDQUFDO1FBQzVELENBQUM7UUFFRCxPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7WUFDdEIsT0FBTyxFQUFFLHVCQUF1QjtZQUNoQyxLQUFLLEVBQUUsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtTQUM1RCxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBakNXLFFBQUEsT0FBTyxXQWlDbEI7QUFFRix5QkFBeUI7QUFFbEIsS0FBSyxVQUFVLGFBQWEsQ0FDakMsS0FBYSxFQUNiLFNBQWlCO0lBRWpCLE1BQU0sR0FBRyxHQUFHO1FBQ1YsQ0FBQyxnQkFBTyxDQUFDLEVBQUUseUJBQVU7UUFDckIsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsR0FBRyxLQUFLLElBQUksU0FBUyxFQUFFLEVBQUUsd0NBQXdDO0tBQzdFLENBQUM7SUFFRixNQUFNLEdBQUcsR0FBRyxJQUFJLDRCQUFhLENBQUM7UUFDNUIsU0FBUyxFQUFFLGFBQWE7UUFDeEIsR0FBRyxFQUFFLEdBQUc7UUFDUiw2QkFBNkI7UUFDN0IsbUJBQW1CLEVBQ2pCLGlEQUFpRDtRQUNuRCx3QkFBd0IsRUFBRTtZQUN4QixLQUFLLEVBQUUsZ0JBQU87WUFDZCxLQUFLLEVBQUUsZ0JBQU87U0FDZjtLQUNGLENBQUMsQ0FBQztJQUVILE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUM1QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgQVBJR2F0ZXdheVByb3h5RXZlbnRWMixcbiAgQVBJR2F0ZXdheVByb3h5UmVzdWx0VjIsXG59IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHtcbiAgRHluYW1vREJEb2N1bWVudENsaWVudCxcbiAgRGVsZXRlQ29tbWFuZCxcbn0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcbmltcG9ydCB7IFBLX05BTUUsIFNLX05BTUUgfSBmcm9tICcuLi9jb25zdGFudHMvY29tbW9uJztcbmltcG9ydCB7IFBST0pFQ1RfUEsgfSBmcm9tICcuLi9jb25zdGFudHMvb3JnYW5pemF0aW9uJztcbmltcG9ydCB7IGFwaVJlc3BvbnNlIH0gZnJvbSAnLi4vaGVscGVycy9hcGknO1xuXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGRkYkNsaWVudCwge1xuICBtYXJzaGFsbE9wdGlvbnM6IHtcbiAgICByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsXG4gIH0sXG59KTtcblxuY29uc3QgREJfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRCX1RBQkxFX05BTUU7XG5cbmlmICghREJfVEFCTEVfTkFNRSkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ0RCX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldCcpO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyPiA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcHJvamVjdElkID0gZXZlbnQucGF0aFBhcmFtZXRlcnM/LnByb2plY3RJZCB8fCBldmVudC5wYXRoUGFyYW1ldGVycz8uaWQ7XG4gICAgY29uc3QgeyBvcmdJZCB9ID0gZXZlbnQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IHt9O1xuXG4gICAgaWYgKCFvcmdJZCB8fCAhcHJvamVjdElkKSB7XG4gICAgICByZXR1cm4gYXBpUmVzcG9uc2UoNDAwLCB7XG4gICAgICAgIG1lc3NhZ2U6ICdNaXNzaW5nIHJlcXVpcmVkIHF1ZXJ5IHBhcmFtZXRlcnM6IG9yZ0lkIGFuZCBwcm9qZWN0SWQnLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXdhaXQgZGVsZXRlUHJvamVjdChvcmdJZCwgcHJvamVjdElkKTtcblxuICAgIHJldHVybiBhcGlSZXNwb25zZSgyMDAsIHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnUHJvamVjdCBkZWxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICBvcmdJZCxcbiAgICAgIHByb2plY3RJZCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBkZWxldGVQcm9qZWN0IGhhbmRsZXI6JywgZXJyKTtcblxuICAgIGlmIChlcnI/Lm5hbWUgPT09ICdDb25kaXRpb25hbENoZWNrRmFpbGVkRXhjZXB0aW9uJykge1xuICAgICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwNCwgeyBtZXNzYWdlOiAnUHJvamVjdCBub3QgZm91bmQnIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgZXJyb3I6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSk7XG4gIH1cbn07XG5cbi8vIC0tLSBCdXNpbmVzcyBsb2dpYyAtLS1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZVByb2plY3QoXG4gIG9yZ0lkOiBzdHJpbmcsXG4gIHByb2plY3RJZDogc3RyaW5nLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGtleSA9IHtcbiAgICBbUEtfTkFNRV06IFBST0pFQ1RfUEssXG4gICAgW1NLX05BTUVdOiBgJHtvcmdJZH0jJHtwcm9qZWN0SWR9YCwgLy8gc2FtZSBjb21wb3NpdGUgU0sgYXMgaW4gY3JlYXRlUHJvamVjdFxuICB9O1xuXG4gIGNvbnN0IGNtZCA9IG5ldyBEZWxldGVDb21tYW5kKHtcbiAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgS2V5OiBrZXksXG4gICAgLy8gT25seSBkZWxldGUgaWYgaXRlbSBleGlzdHNcbiAgICBDb25kaXRpb25FeHByZXNzaW9uOlxuICAgICAgJ2F0dHJpYnV0ZV9leGlzdHMoI3BrKSBBTkQgYXR0cmlidXRlX2V4aXN0cygjc2spJyxcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICcjcGsnOiBQS19OQU1FLFxuICAgICAgJyNzayc6IFNLX05BTUUsXG4gICAgfSxcbiAgfSk7XG5cbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQoY21kKTtcbn1cbiJdfQ==