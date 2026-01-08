"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.deleteOrganization = deleteOrganization;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const organization_1 = require("../constants/organization");
const common_1 = require("../constants/common");
const api_1 = require("../helpers/api");
// --- DynamoDB setup ---
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
// --- Lambda handler ---
// Expected API Gateway route: DELETE /organizations/{id}
const handler = async (event) => {
    try {
        const orgId = event.pathParameters?.id ||
            event.pathParameters?.orgId; // support either {id} or {orgId}
        if (!orgId) {
            return (0, api_1.apiResponse)(400, { message: 'Missing required path parameter: id' });
        }
        await deleteOrganization(orgId);
        return (0, api_1.apiResponse)(200, {
            success: true,
            message: 'Organization deleted successfully',
            id: orgId,
        });
    }
    catch (err) {
        console.error('Error in deleteOrganization handler:', err);
        // If the org doesn't exist, ConditionalCheckFailedException will be thrown
        if (err?.name === 'ConditionalCheckFailedException') {
            return (0, api_1.apiResponse)(404, { message: 'Organization not found' });
        }
        return (0, api_1.apiResponse)(500, {
            message: 'Internal server error',
            error: err instanceof Error ? err.message : 'Unknown error',
        });
    }
};
exports.handler = handler;
// --- Business logic function ---
async function deleteOrganization(orgId) {
    const key = {
        [common_1.PK_NAME]: organization_1.ORG_PK,
        [common_1.SK_NAME]: `ORG#${orgId}`,
    };
    const command = new lib_dynamodb_1.DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        // Only delete if item exists
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        ExpressionAttributeNames: {
            '#pk': common_1.PK_NAME,
            '#sk': common_1.SK_NAME,
        },
    });
    await docClient.send(command);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLW9yZ2FuaXphdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRlbGV0ZS1vcmdhbml6YXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBZ0VBLGdEQWtCQztBQTlFRCw4REFBMEQ7QUFDMUQsd0RBRytCO0FBQy9CLDREQUFtRDtBQUNuRCxnREFBdUQ7QUFDdkQsd0NBQTZDO0FBRTdDLHlCQUF5QjtBQUN6QixNQUFNLFNBQVMsR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDekMsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRTtJQUN2RCxlQUFlLEVBQUU7UUFDZixxQkFBcUIsRUFBRSxJQUFJO0tBQzVCO0NBQ0YsQ0FBQyxDQUFDO0FBRUgsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7QUFFaEQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ25CLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztBQUNuRSxDQUFDO0FBRUQseUJBQXlCO0FBQ3pCLHlEQUF5RDtBQUNsRCxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTZCLEVBQ0ssRUFBRTtJQUNwQyxJQUFJLENBQUM7UUFDSCxNQUFNLEtBQUssR0FDVCxLQUFLLENBQUMsY0FBYyxFQUFFLEVBQUU7WUFDeEIsS0FBSyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsQ0FBQyxpQ0FBaUM7UUFFaEUsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ1gsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLHFDQUFxQyxFQUFFLENBQUMsQ0FBQztRQUM5RSxDQUFDO1FBRUQsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVoQyxPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7WUFDdEIsT0FBTyxFQUFFLElBQUk7WUFDYixPQUFPLEVBQUUsbUNBQW1DO1lBQzVDLEVBQUUsRUFBRSxLQUFLO1NBQ1YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUFDLE9BQU8sR0FBUSxFQUFFLENBQUM7UUFDbEIsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUUzRCwyRUFBMkU7UUFDM0UsSUFBSSxHQUFHLEVBQUUsSUFBSSxLQUFLLGlDQUFpQyxFQUFFLENBQUM7WUFDcEQsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLENBQUMsQ0FBQztRQUNqRSxDQUFDO1FBRUQsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO1lBQ3RCLE9BQU8sRUFBRSx1QkFBdUI7WUFDaEMsS0FBSyxFQUFFLEdBQUcsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7U0FDNUQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztBQUNILENBQUMsQ0FBQztBQWhDVyxRQUFBLE9BQU8sV0FnQ2xCO0FBRUYsa0NBQWtDO0FBQzNCLEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxLQUFhO0lBQ3BELE1BQU0sR0FBRyxHQUFHO1FBQ1YsQ0FBQyxnQkFBTyxDQUFDLEVBQUUscUJBQU07UUFDakIsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsT0FBTyxLQUFLLEVBQUU7S0FDMUIsQ0FBQztJQUVGLE1BQU0sT0FBTyxHQUFHLElBQUksNEJBQWEsQ0FBQztRQUNoQyxTQUFTLEVBQUUsYUFBYTtRQUN4QixHQUFHLEVBQUUsR0FBRztRQUNSLDZCQUE2QjtRQUM3QixtQkFBbUIsRUFBRSxpREFBaUQ7UUFDdEUsd0JBQXdCLEVBQUU7WUFDeEIsS0FBSyxFQUFFLGdCQUFPO1lBQ2QsS0FBSyxFQUFFLGdCQUFPO1NBQ2Y7S0FDRixDQUFDLENBQUM7SUFFSCxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDaEMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsXG4gIEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyLFxufSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7XG4gIER5bmFtb0RCRG9jdW1lbnRDbGllbnQsXG4gIERlbGV0ZUNvbW1hbmQsXG59IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyBPUkdfUEsgfSBmcm9tICcuLi9jb25zdGFudHMvb3JnYW5pemF0aW9uJztcbmltcG9ydCB7IFBLX05BTUUsIFNLX05BTUUgfSBmcm9tICcuLi9jb25zdGFudHMvY29tbW9uJztcbmltcG9ydCB7IGFwaVJlc3BvbnNlIH0gZnJvbSAnLi4vaGVscGVycy9hcGknO1xuXG4vLyAtLS0gRHluYW1vREIgc2V0dXAgLS0tXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGRkYkNsaWVudCwge1xuICBtYXJzaGFsbE9wdGlvbnM6IHtcbiAgICByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsXG4gIH0sXG59KTtcblxuY29uc3QgREJfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRCX1RBQkxFX05BTUU7XG5cbmlmICghREJfVEFCTEVfTkFNRSkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ0RCX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldCcpO1xufVxuXG4vLyAtLS0gTGFtYmRhIGhhbmRsZXIgLS0tXG4vLyBFeHBlY3RlZCBBUEkgR2F0ZXdheSByb3V0ZTogREVMRVRFIC9vcmdhbml6YXRpb25zL3tpZH1cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnRWMlxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHRWMj4gPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IG9yZ0lkID1cbiAgICAgIGV2ZW50LnBhdGhQYXJhbWV0ZXJzPy5pZCB8fFxuICAgICAgZXZlbnQucGF0aFBhcmFtZXRlcnM/Lm9yZ0lkOyAvLyBzdXBwb3J0IGVpdGhlciB7aWR9IG9yIHtvcmdJZH1cblxuICAgIGlmICghb3JnSWQpIHtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHsgbWVzc2FnZTogJ01pc3NpbmcgcmVxdWlyZWQgcGF0aCBwYXJhbWV0ZXI6IGlkJyB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCBkZWxldGVPcmdhbml6YXRpb24ob3JnSWQpO1xuXG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDIwMCwge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG1lc3NhZ2U6ICdPcmdhbml6YXRpb24gZGVsZXRlZCBzdWNjZXNzZnVsbHknLFxuICAgICAgaWQ6IG9yZ0lkLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGRlbGV0ZU9yZ2FuaXphdGlvbiBoYW5kbGVyOicsIGVycik7XG5cbiAgICAvLyBJZiB0aGUgb3JnIGRvZXNuJ3QgZXhpc3QsIENvbmRpdGlvbmFsQ2hlY2tGYWlsZWRFeGNlcHRpb24gd2lsbCBiZSB0aHJvd25cbiAgICBpZiAoZXJyPy5uYW1lID09PSAnQ29uZGl0aW9uYWxDaGVja0ZhaWxlZEV4Y2VwdGlvbicpIHtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDQsIHsgbWVzc2FnZTogJ09yZ2FuaXphdGlvbiBub3QgZm91bmQnIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgZXJyb3I6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSk7XG4gIH1cbn07XG5cbi8vIC0tLSBCdXNpbmVzcyBsb2dpYyBmdW5jdGlvbiAtLS1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVPcmdhbml6YXRpb24ob3JnSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBrZXkgPSB7XG4gICAgW1BLX05BTUVdOiBPUkdfUEssXG4gICAgW1NLX05BTUVdOiBgT1JHIyR7b3JnSWR9YCxcbiAgfTtcblxuICBjb25zdCBjb21tYW5kID0gbmV3IERlbGV0ZUNvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogREJfVEFCTEVfTkFNRSxcbiAgICBLZXk6IGtleSxcbiAgICAvLyBPbmx5IGRlbGV0ZSBpZiBpdGVtIGV4aXN0c1xuICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfZXhpc3RzKCNwaykgQU5EIGF0dHJpYnV0ZV9leGlzdHMoI3NrKScsXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAnI3BrJzogUEtfTkFNRSxcbiAgICAgICcjc2snOiBTS19OQU1FLFxuICAgIH0sXG4gIH0pO1xuXG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKGNvbW1hbmQpO1xufVxuIl19