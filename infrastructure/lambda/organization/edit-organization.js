"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.editOrganization = editOrganization;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const organization_1 = require("../constants/organization");
const common_1 = require("../constants/common");
const api_1 = require("../helpers/api");
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
    const orgId = event.pathParameters?.id;
    if (!orgId) {
        return (0, api_1.apiResponse)(400, { message: 'Missing required path parameter: orgId' });
    }
    if (!event.body) {
        return (0, api_1.apiResponse)(400, { message: 'Request body is missing' });
    }
    try {
        const rawBody = JSON.parse(event.body);
        // 1. Runtime Validation using Zod (partial update)
        const validationResult = organization_2.UpdateOrganizationSchema.safeParse(rawBody);
        if (!validationResult.success) {
            const errorDetails = validationResult.error.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message,
            }));
            return (0, api_1.apiResponse)(400, {
                message: 'Validation failed',
                errors: errorDetails,
            });
        }
        const validatedOrgData = validationResult.data;
        // 2. Perform update
        const updatedOrganization = await editOrganization(orgId, validatedOrgData);
        return (0, api_1.apiResponse)(200, updatedOrganization);
    }
    catch (err) {
        console.error('Error in updateOrganization handler:', err);
        if (err instanceof SyntaxError) {
            return (0, api_1.apiResponse)(400, { message: 'Invalid JSON in request body' });
        }
        // Conditional check failed → organization not found
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
// --- Business Logic Function ---
// orgData is partial (PATCH-like) thanks to UpdateOrganizationSchema
async function editOrganization(orgId, orgData) {
    const now = new Date().toISOString();
    const key = {
        [common_1.PK_NAME]: organization_1.ORG_PK,
        [common_1.SK_NAME]: `ORG#${orgId}`,
    };
    // Build a dynamic UpdateExpression so you can update any subset of fields
    const expressionAttributeNames = {
        '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues = {
        ':updatedAt': now,
    };
    const setExpressions = ['#updatedAt = :updatedAt'];
    // Example for common fields; add more as needed
    if (orgData.name !== undefined) {
        expressionAttributeNames['#name'] = 'name';
        expressionAttributeValues[':name'] = orgData.name;
        setExpressions.push('#name = :name');
    }
    if (orgData.description !== undefined) {
        expressionAttributeNames['#description'] = 'description';
        expressionAttributeValues[':description'] = orgData.description;
        setExpressions.push('#description = :description');
    }
    if (setExpressions.length === 1) {
        // Only updatedAt would be updated – you can decide to allow or block this
        // For now, we allow it, so no early return.
    }
    const command = new lib_dynamodb_1.UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        UpdateExpression: 'SET ' + setExpressions.join(', '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        // Ensure the org exists; otherwise throw ConditionalCheckFailedException
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        ReturnValues: 'ALL_NEW',
    });
    const result = await docClient.send(command);
    return result.Attributes;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdC1vcmdhbml6YXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlZGl0LW9yZ2FuaXphdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFnRkEsNENBcURDO0FBcElELDhEQUEwRDtBQUMxRCx3REFBK0U7QUFDL0UsNERBQW1EO0FBQ25ELGdEQUF1RDtBQUN2RCx3Q0FBNkM7QUFDN0MsMERBQTZHO0FBRTdHLE1BQU0sU0FBUyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN6QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO0lBQ3ZELGVBQWUsRUFBRTtRQUNmLHFCQUFxQixFQUFFLElBQUk7S0FDNUI7Q0FDRixDQUFDLENBQUM7QUFFSCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztBQUVoRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO0FBQ25FLENBQUM7QUFFRCx1QkFBdUI7QUFDaEIsTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUMxQixLQUE2QixFQUNLLEVBQUU7SUFDcEMsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUM7SUFFdkMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1gsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLHdDQUF3QyxFQUFFLENBQUMsQ0FBQztJQUNqRixDQUFDO0lBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNoQixPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUseUJBQXlCLEVBQUUsQ0FBQyxDQUFDO0lBQ2xFLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDSCxNQUFNLE9BQU8sR0FBRyxJQUFJ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QUFDO0lBRUQsSUFBSSxPQUFPLENBQUMsV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQ3RDLHdCQUF3QixDQUFDLGNBQWMsQ0FBQyxHQUFHLGFBQWEsQ0FBQztRQUN6RCx5QkFBeUIsQ0FBQyxjQUFjLENBQUMsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDO1FBQ2hFLGNBQWMsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQsSUFBSSxjQUFjLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ2hDLDBFQUEwRTtRQUMxRSw0Q0FBNEM7SUFDOUMsQ0FBQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUksNEJBQWEsQ0FBQztRQUNoQyxTQUFTLEVBQUUsYUFBYTtRQUN4QixHQUFHLEVBQUUsR0FBRztRQUNSLGdCQUFnQixFQUFFLE1BQU0sR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztRQUNwRCx3QkFBd0IsRUFBRSx3QkFBd0I7UUFDbEQseUJBQXlCLEVBQUUseUJBQXlCO1FBQ3BELHlFQUF5RTtRQUN6RSxtQkFBbUIsRUFBRSxpREFBaUQ7UUFDdEUsWUFBWSxFQUFFLFNBQVM7S0FDeEIsQ0FBQyxDQUFDO0lBRUgsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRTdDLE9BQU8sTUFBTSxDQUFDLFVBQThCLENBQUM7QUFDL0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsIEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyLCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgVXBkYXRlQ29tbWFuZCwgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgT1JHX1BLIH0gZnJvbSAnLi4vY29uc3RhbnRzL29yZ2FuaXphdGlvbic7XG5pbXBvcnQgeyBQS19OQU1FLCBTS19OQU1FIH0gZnJvbSAnLi4vY29uc3RhbnRzL2NvbW1vbic7XG5pbXBvcnQgeyBhcGlSZXNwb25zZSB9IGZyb20gJy4uL2hlbHBlcnMvYXBpJztcbmltcG9ydCB7IE9yZ2FuaXphdGlvbkl0ZW0sIFVwZGF0ZU9yZ2FuaXphdGlvbkRUTywgVXBkYXRlT3JnYW5pemF0aW9uU2NoZW1hLCB9IGZyb20gJy4uL3NjaGVtYXMvb3JnYW5pemF0aW9uJztcblxuY29uc3QgZGRiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkZGJDbGllbnQsIHtcbiAgbWFyc2hhbGxPcHRpb25zOiB7XG4gICAgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlLFxuICB9LFxufSk7XG5cbmNvbnN0IERCX1RBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5EQl9UQUJMRV9OQU1FO1xuXG5pZiAoIURCX1RBQkxFX05BTUUpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdEQl9UQUJMRV9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQnKTtcbn1cblxuLy8gLS0tIE1haW4gSGFuZGxlciAtLS1cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnRWMlxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHRWMj4gPT4ge1xuICBjb25zdCBvcmdJZCA9IGV2ZW50LnBhdGhQYXJhbWV0ZXJzPy5pZDtcblxuICBpZiAoIW9yZ0lkKSB7XG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwMCwgeyBtZXNzYWdlOiAnTWlzc2luZyByZXF1aXJlZCBwYXRoIHBhcmFtZXRlcjogb3JnSWQnIH0pO1xuICB9XG5cbiAgaWYgKCFldmVudC5ib2R5KSB7XG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwMCwgeyBtZXNzYWdlOiAnUmVxdWVzdCBib2R5IGlzIG1pc3NpbmcnIH0pO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByYXdCb2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcblxuICAgIC8vIDEuIFJ1bnRpbWUgVmFsaWRhdGlvbiB1c2luZyBab2QgKHBhcnRpYWwgdXBkYXRlKVxuICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBVcGRhdGVPcmdhbml6YXRpb25TY2hlbWEuc2FmZVBhcnNlKHJhd0JvZHkpO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIGNvbnN0IGVycm9yRGV0YWlscyA9IHZhbGlkYXRpb25SZXN1bHQuZXJyb3IuaXNzdWVzLm1hcChpc3N1ZSA9PiAoe1xuICAgICAgICBwYXRoOiBpc3N1ZS5wYXRoLmpvaW4oJy4nKSxcbiAgICAgICAgbWVzc2FnZTogaXNzdWUubWVzc2FnZSxcbiAgICAgIH0pKTtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHtcbiAgICAgICAgbWVzc2FnZTogJ1ZhbGlkYXRpb24gZmFpbGVkJyxcbiAgICAgICAgZXJyb3JzOiBlcnJvckRldGFpbHMsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCB2YWxpZGF0ZWRPcmdEYXRhOiBVcGRhdGVPcmdhbml6YXRpb25EVE8gPSB2YWxpZGF0aW9uUmVzdWx0LmRhdGE7XG5cbiAgICAvLyAyLiBQZXJmb3JtIHVwZGF0ZVxuICAgIGNvbnN0IHVwZGF0ZWRPcmdhbml6YXRpb24gPSBhd2FpdCBlZGl0T3JnYW5pemF0aW9uKG9yZ0lkLCB2YWxpZGF0ZWRPcmdEYXRhKTtcblxuICAgIHJldHVybiBhcGlSZXNwb25zZSgyMDAsIHVwZGF0ZWRPcmdhbml6YXRpb24pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiB1cGRhdGVPcmdhbml6YXRpb24gaGFuZGxlcjonLCBlcnIpO1xuXG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIFN5bnRheEVycm9yKSB7XG4gICAgICByZXR1cm4gYXBpUmVzcG9uc2UoNDAwLCB7IG1lc3NhZ2U6ICdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5JyB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBjaGVjayBmYWlsZWQg4oaSIG9yZ2FuaXphdGlvbiBub3QgZm91bmRcbiAgICBpZiAoKGVyciBhcyBhbnkpPy5uYW1lID09PSAnQ29uZGl0aW9uYWxDaGVja0ZhaWxlZEV4Y2VwdGlvbicpIHtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDQsIHsgbWVzc2FnZTogJ09yZ2FuaXphdGlvbiBub3QgZm91bmQnIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgZXJyb3I6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSk7XG4gIH1cbn07XG5cblxuLy8gLS0tIEJ1c2luZXNzIExvZ2ljIEZ1bmN0aW9uIC0tLVxuLy8gb3JnRGF0YSBpcyBwYXJ0aWFsIChQQVRDSC1saWtlKSB0aGFua3MgdG8gVXBkYXRlT3JnYW5pemF0aW9uU2NoZW1hXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZWRpdE9yZ2FuaXphdGlvbihcbiAgb3JnSWQ6IHN0cmluZyxcbiAgb3JnRGF0YTogVXBkYXRlT3JnYW5pemF0aW9uRFRPXG4pOiBQcm9taXNlPE9yZ2FuaXphdGlvbkl0ZW0+IHtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gIGNvbnN0IGtleSA9IHtcbiAgICBbUEtfTkFNRV06IE9SR19QSyxcbiAgICBbU0tfTkFNRV06IGBPUkcjJHtvcmdJZH1gLFxuICB9O1xuXG4gIC8vIEJ1aWxkIGEgZHluYW1pYyBVcGRhdGVFeHByZXNzaW9uIHNvIHlvdSBjYW4gdXBkYXRlIGFueSBzdWJzZXQgb2YgZmllbGRzXG4gIGNvbnN0IGV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAnI3VwZGF0ZWRBdCc6ICd1cGRhdGVkQXQnLFxuICB9O1xuICBjb25zdCBleHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICc6dXBkYXRlZEF0Jzogbm93LFxuICB9O1xuXG4gIGNvbnN0IHNldEV4cHJlc3Npb25zOiBzdHJpbmdbXSA9IFsnI3VwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnXTtcblxuICAvLyBFeGFtcGxlIGZvciBjb21tb24gZmllbGRzOyBhZGQgbW9yZSBhcyBuZWVkZWRcbiAgaWYgKG9yZ0RhdGEubmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzWycjbmFtZSddID0gJ25hbWUnO1xuICAgIGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXNbJzpuYW1lJ10gPSBvcmdEYXRhLm5hbWU7XG4gICAgc2V0RXhwcmVzc2lvbnMucHVzaCgnI25hbWUgPSA6bmFtZScpO1xuICB9XG5cbiAgaWYgKG9yZ0RhdGEuZGVzY3JpcHRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgIGV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lc1snI2Rlc2NyaXB0aW9uJ10gPSAnZGVzY3JpcHRpb24nO1xuICAgIGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXNbJzpkZXNjcmlwdGlvbiddID0gb3JnRGF0YS5kZXNjcmlwdGlvbjtcbiAgICBzZXRFeHByZXNzaW9ucy5wdXNoKCcjZGVzY3JpcHRpb24gPSA6ZGVzY3JpcHRpb24nKTtcbiAgfVxuXG4gIGlmIChzZXRFeHByZXNzaW9ucy5sZW5ndGggPT09IDEpIHtcbiAgICAvLyBPbmx5IHVwZGF0ZWRBdCB3b3VsZCBiZSB1cGRhdGVkIOKAkyB5b3UgY2FuIGRlY2lkZSB0byBhbGxvdyBvciBibG9jayB0aGlzXG4gICAgLy8gRm9yIG5vdywgd2UgYWxsb3cgaXQsIHNvIG5vIGVhcmx5IHJldHVybi5cbiAgfVxuXG4gIGNvbnN0IGNvbW1hbmQgPSBuZXcgVXBkYXRlQ29tbWFuZCh7XG4gICAgVGFibGVOYW1lOiBEQl9UQUJMRV9OQU1FLFxuICAgIEtleToga2V5LFxuICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgJyArIHNldEV4cHJlc3Npb25zLmpvaW4oJywgJyksXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiBleHByZXNzaW9uQXR0cmlidXRlTmFtZXMsXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczogZXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlcyxcbiAgICAvLyBFbnN1cmUgdGhlIG9yZyBleGlzdHM7IG90aGVyd2lzZSB0aHJvdyBDb25kaXRpb25hbENoZWNrRmFpbGVkRXhjZXB0aW9uXG4gICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9leGlzdHMoI3BrKSBBTkQgYXR0cmlidXRlX2V4aXN0cygjc2spJyxcbiAgICBSZXR1cm5WYWx1ZXM6ICdBTExfTkVXJyxcbiAgfSk7XG5cbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQoY29tbWFuZCk7XG5cbiAgcmV0dXJuIHJlc3VsdC5BdHRyaWJ1dGVzIGFzIE9yZ2FuaXphdGlvbkl0ZW07XG59XG4iXX0=