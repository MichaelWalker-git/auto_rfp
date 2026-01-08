"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.createOrganization = createOrganization;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const organization_1 = require("../constants/organization");
const common_1 = require("../constants/common");
const api_1 = require("../helpers/api");
const uuid_1 = require("uuid");
const organization_2 = require("../schemas/organization");
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
// --- Main Handler ---
const handler = async (event) => {
    if (!event.body) {
        return (0, api_1.apiResponse)(400, { message: 'Request body is missing' });
    }
    try {
        const rawBody = JSON.parse(event.body);
        // 1. Runtime Validation using Zod
        const validationResult = organization_2.CreateOrganizationSchema.safeParse(rawBody);
        if (!validationResult.success) {
            // Zod handles all validation details and provides a clean error object
            const errorDetails = validationResult.error.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message,
            }));
            return (0, api_1.apiResponse)(400, {
                message: 'Validation failed',
                errors: errorDetails,
            });
        }
        // The data is now guaranteed to match the CreateOrganizationDTO type
        const validatedOrgData = validationResult.data;
        const newOrganization = await createOrganization(validatedOrgData);
        return (0, api_1.apiResponse)(201, newOrganization);
    }
    catch (err) {
        console.error('Error in createOrganization handler:', err);
        if (err instanceof SyntaxError) {
            return (0, api_1.apiResponse)(400, { message: 'Invalid JSON in request body' });
        }
        return (0, api_1.apiResponse)(500, {
            message: 'Internal server error',
            error: err instanceof Error ? err.message : 'Unknown error',
        });
    }
};
exports.handler = handler;
// --- Business Logic Function ---
// The input is guaranteed to be a CreateOrganizationDTO thanks to Zod validation
async function createOrganization(orgData) {
    const now = new Date().toISOString();
    const orgId = (0, uuid_1.v4)();
    const organizationItem = {
        [common_1.PK_NAME]: organization_1.ORG_PK,
        [common_1.SK_NAME]: `ORG#${orgId}`,
        ...orgData, // Spread the validated { name, description } fields
        createdAt: now,
        updatedAt: now,
    }; // Type assertion is safe here because Zod schema matches
    const command = new lib_dynamodb_1.PutCommand({
        TableName: DB_TABLE_NAME,
        Item: organizationItem,
    });
    await docClient.send(command);
    return { ...organizationItem, id: orgId };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLW9yZ2FuaXphdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNyZWF0ZS1vcmdhbml6YXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBc0VBLGdEQW9CQztBQXpGRCw4REFBMEQ7QUFDMUQsd0RBQTRFO0FBQzVFLDREQUFtRDtBQUNuRCxnREFBdUQ7QUFDdkQsd0NBQTZDO0FBQzdDLCtCQUFvQztBQUNwQywwREFBNkc7QUFFN0csTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFO1FBQ2YscUJBQXFCLEVBQUUsSUFBSTtLQUM1QjtDQUNGLENBQUMsQ0FBQztBQUVILE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO0FBRWhELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLCtDQUErQyxDQUFDLENBQUM7QUFDbkUsQ0FBQztBQUVELHVCQUF1QjtBQUNoQixNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBNkIsRUFBb0MsRUFBRTtJQUMvRixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2hCLE9BQU8sSUFBQSxpQkFBVyxFQUFDLEdBQUcsRUFBRSxFQUFFLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxDQUFDLENBQUM7SUFDbEUsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXZDLGtDQUFrQztRQUNsQyxNQUFNLGdCQUFnQixHQUFHLHVDQUF3QixDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVyRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDOUIsdUVBQXVFO1lBQ3ZFLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDL0QsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztnQkFDMUIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO2FBQ3ZCLENBQUMsQ0FBQyxDQUFDO1lBQ0osT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO2dCQUN0QixPQUFPLEVBQUUsbUJBQW1CO2dCQUM1QixNQUFNLEVBQUUsWUFBWTthQUNyQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQscUVBQXFFO1FBQ3JFLE1BQU0sZ0JBQWdCLEdBQTBCLGdCQUFnQixDQUFDLElBQUksQ0FBQztRQUV0RSxNQUFNLGVBQWUsR0FBRyxNQUFNLGtCQUFrQixDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFFbkUsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBRTNDLENBQUM7SUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUUzRCxJQUFJLEdBQUcsWUFBWSxXQUFXLEVBQUUsQ0FBQztZQUMvQixPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsOEJBQThCLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7UUFFRCxPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7WUFDdEIsT0FBTyxFQUFFLHVCQUF1QjtZQUNoQyxLQUFLLEVBQUUsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtTQUM1RCxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBMUNXLFFBQUEsT0FBTyxXQTBDbEI7QUFHRixrQ0FBa0M7QUFDbEMsaUZBQWlGO0FBQzFFLEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxPQUE4QjtJQUNyRSxNQUFNLEdBQUcsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sS0FBSyxHQUFHLElBQUEsU0FBTSxHQUFFLENBQUM7SUFFdkIsTUFBTSxnQkFBZ0IsR0FBcUI7UUFDekMsQ0FBQyxnQkFBTyxDQUFDLEVBQUUscUJBQU07UUFDakIsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsT0FBTyxLQUFLLEVBQUU7UUFDekIsR0FBRyxPQUFPLEVBQUUsb0RBQW9EO1FBQ2hFLFNBQVMsRUFBRSxHQUFHO1FBQ2QsU0FBUyxFQUFFLEdBQUc7S0FDSyxDQUFDLENBQUMseURBQXlEO0lBRWhGLE1BQU0sT0FBTyxHQUFHLElBQUkseUJBQVUsQ0FBQztRQUM3QixTQUFTLEVBQUUsYUFBYTtRQUN4QixJQUFJLEVBQUUsZ0JBQWdCO0tBQ3ZCLENBQUMsQ0FBQztJQUVILE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUU5QixPQUFPLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFDNUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsIEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyLCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgT1JHX1BLIH0gZnJvbSAnLi4vY29uc3RhbnRzL29yZ2FuaXphdGlvbic7XG5pbXBvcnQgeyBQS19OQU1FLCBTS19OQU1FIH0gZnJvbSAnLi4vY29uc3RhbnRzL2NvbW1vbic7XG5pbXBvcnQgeyBhcGlSZXNwb25zZSB9IGZyb20gJy4uL2hlbHBlcnMvYXBpJztcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xuaW1wb3J0IHsgQ3JlYXRlT3JnYW5pemF0aW9uRFRPLCBDcmVhdGVPcmdhbml6YXRpb25TY2hlbWEsIE9yZ2FuaXphdGlvbkl0ZW0sIH0gZnJvbSAnLi4vc2NoZW1hcy9vcmdhbml6YXRpb24nO1xuXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGRkYkNsaWVudCwge1xuICBtYXJzaGFsbE9wdGlvbnM6IHtcbiAgICByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsXG4gIH0sXG59KTtcblxuY29uc3QgREJfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRCX1RBQkxFX05BTUU7XG5cbmlmICghREJfVEFCTEVfTkFNRSkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ0RCX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldCcpO1xufVxuXG4vLyAtLS0gTWFpbiBIYW5kbGVyIC0tLVxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyPiA9PiB7XG4gIGlmICghZXZlbnQuYm9keSkge1xuICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHsgbWVzc2FnZTogJ1JlcXVlc3QgYm9keSBpcyBtaXNzaW5nJyB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgcmF3Qm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XG5cbiAgICAvLyAxLiBSdW50aW1lIFZhbGlkYXRpb24gdXNpbmcgWm9kXG4gICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IENyZWF0ZU9yZ2FuaXphdGlvblNjaGVtYS5zYWZlUGFyc2UocmF3Qm9keSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQuc3VjY2Vzcykge1xuICAgICAgLy8gWm9kIGhhbmRsZXMgYWxsIHZhbGlkYXRpb24gZGV0YWlscyBhbmQgcHJvdmlkZXMgYSBjbGVhbiBlcnJvciBvYmplY3RcbiAgICAgIGNvbnN0IGVycm9yRGV0YWlscyA9IHZhbGlkYXRpb25SZXN1bHQuZXJyb3IuaXNzdWVzLm1hcChpc3N1ZSA9PiAoe1xuICAgICAgICBwYXRoOiBpc3N1ZS5wYXRoLmpvaW4oJy4nKSxcbiAgICAgICAgbWVzc2FnZTogaXNzdWUubWVzc2FnZSxcbiAgICAgIH0pKTtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHtcbiAgICAgICAgbWVzc2FnZTogJ1ZhbGlkYXRpb24gZmFpbGVkJyxcbiAgICAgICAgZXJyb3JzOiBlcnJvckRldGFpbHMsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBUaGUgZGF0YSBpcyBub3cgZ3VhcmFudGVlZCB0byBtYXRjaCB0aGUgQ3JlYXRlT3JnYW5pemF0aW9uRFRPIHR5cGVcbiAgICBjb25zdCB2YWxpZGF0ZWRPcmdEYXRhOiBDcmVhdGVPcmdhbml6YXRpb25EVE8gPSB2YWxpZGF0aW9uUmVzdWx0LmRhdGE7XG5cbiAgICBjb25zdCBuZXdPcmdhbml6YXRpb24gPSBhd2FpdCBjcmVhdGVPcmdhbml6YXRpb24odmFsaWRhdGVkT3JnRGF0YSk7XG5cbiAgICByZXR1cm4gYXBpUmVzcG9uc2UoMjAxLCBuZXdPcmdhbml6YXRpb24pO1xuXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGNyZWF0ZU9yZ2FuaXphdGlvbiBoYW5kbGVyOicsIGVycik7XG5cbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgU3ludGF4RXJyb3IpIHtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHsgbWVzc2FnZTogJ0ludmFsaWQgSlNPTiBpbiByZXF1ZXN0IGJvZHknIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgZXJyb3I6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSk7XG4gIH1cbn07XG5cblxuLy8gLS0tIEJ1c2luZXNzIExvZ2ljIEZ1bmN0aW9uIC0tLVxuLy8gVGhlIGlucHV0IGlzIGd1YXJhbnRlZWQgdG8gYmUgYSBDcmVhdGVPcmdhbml6YXRpb25EVE8gdGhhbmtzIHRvIFpvZCB2YWxpZGF0aW9uXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlT3JnYW5pemF0aW9uKG9yZ0RhdGE6IENyZWF0ZU9yZ2FuaXphdGlvbkRUTyk6IFByb21pc2U8T3JnYW5pemF0aW9uSXRlbT4ge1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIGNvbnN0IG9yZ0lkID0gdXVpZHY0KCk7XG5cbiAgY29uc3Qgb3JnYW5pemF0aW9uSXRlbTogT3JnYW5pemF0aW9uSXRlbSA9IHtcbiAgICBbUEtfTkFNRV06IE9SR19QSyxcbiAgICBbU0tfTkFNRV06IGBPUkcjJHtvcmdJZH1gLFxuICAgIC4uLm9yZ0RhdGEsIC8vIFNwcmVhZCB0aGUgdmFsaWRhdGVkIHsgbmFtZSwgZGVzY3JpcHRpb24gfSBmaWVsZHNcbiAgICBjcmVhdGVkQXQ6IG5vdyxcbiAgICB1cGRhdGVkQXQ6IG5vdyxcbiAgfSBhcyBPcmdhbml6YXRpb25JdGVtOyAvLyBUeXBlIGFzc2VydGlvbiBpcyBzYWZlIGhlcmUgYmVjYXVzZSBab2Qgc2NoZW1hIG1hdGNoZXNcblxuICBjb25zdCBjb21tYW5kID0gbmV3IFB1dENvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogREJfVEFCTEVfTkFNRSxcbiAgICBJdGVtOiBvcmdhbml6YXRpb25JdGVtLFxuICB9KTtcblxuICBhd2FpdCBkb2NDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICByZXR1cm4geyAuLi5vcmdhbml6YXRpb25JdGVtLCBpZDogb3JnSWQgfTtcbn0iXX0=