"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.saveAnswer = saveAnswer;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const uuid_1 = require("uuid");
const common_1 = require("../constants/common");
const api_1 = require("../helpers/api");
const answer_1 = require("../schemas/answer");
const answer_2 = require("../constants/answer");
// --- Dynamo client setup ---
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
    if (!event.body) {
        return (0, api_1.apiResponse)(400, { message: 'Request body is missing' });
    }
    try {
        const rawBody = JSON.parse(event.body);
        // 1. Runtime validation with Zod
        const validationResult = answer_1.CreateAnswerDTOSchema.safeParse(rawBody);
        if (!validationResult.success) {
            const errorDetails = validationResult.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            }));
            return (0, api_1.apiResponse)(400, {
                message: 'Validation failed',
                errors: errorDetails,
            });
        }
        const dto = validationResult.data;
        // 2. Upsert answer item in Dynamo
        const savedAnswer = await saveAnswer(dto);
        return (0, api_1.apiResponse)(200, savedAnswer);
    }
    catch (err) {
        console.error('Error in saveAnswer handler:', err);
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
// --- Business Logic ---
// Upsert answer by (projectId, questionId)
async function saveAnswer(dto) {
    const now = new Date().toISOString();
    const { questionId, text, projectId, organizationId } = dto;
    // We treat "one answer per (projectId, questionId)" as upsert target.
    // SK pattern when creating: `${projectId}#${questionId}#${answerId}`
    const skPrefix = `${projectId}#${questionId}#`;
    // 1) Try to find existing answer for this (projectId, questionId)
    const queryRes = await docClient.send(new lib_dynamodb_1.QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
            '#pk': common_1.PK_NAME,
            '#sk': common_1.SK_NAME,
        },
        ExpressionAttributeValues: {
            ':pk': answer_2.ANSWER_PK,
            ':skPrefix': skPrefix,
        },
        Limit: 1, // we only care about first match
    }));
    const existing = queryRes.Items?.[0] ?? undefined;
    if (existing) {
        // 2) UPDATE existing answer
        const key = {
            [common_1.PK_NAME]: existing[common_1.PK_NAME],
            [common_1.SK_NAME]: existing[common_1.SK_NAME],
        };
        const updateRes = await docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: DB_TABLE_NAME,
            Key: key,
            UpdateExpression: 'SET #text = :text, #organizationId = :organizationId, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
                '#text': 'text',
                '#organizationId': 'organizationId',
                '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
                ':text': text,
                ':organizationId': organizationId ?? null,
                ':updatedAt': now,
            },
            ReturnValues: 'ALL_NEW',
        }));
        return updateRes.Attributes;
    }
    // 3) CREATE new answer if none exists
    const answerId = (0, uuid_1.v4)();
    const sortKey = `${projectId}#${questionId}#${answerId}`;
    const answerItem = {
        [common_1.PK_NAME]: answer_2.ANSWER_PK,
        [common_1.SK_NAME]: sortKey,
        id: answerId,
        questionId,
        projectId,
        organizationId,
        text,
        source: 'manual', // still a manual answer
        createdAt: now,
        updatedAt: now,
    };
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: DB_TABLE_NAME,
        Item: answerItem,
    }));
    return answerItem;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2F2ZS1hbnN3ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzYXZlLWFuc3dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUF3RUEsZ0NBd0ZDO0FBL0pELDhEQUEwRDtBQUMxRCx3REFBeUc7QUFDekcsK0JBQW9DO0FBRXBDLGdEQUF1RDtBQUN2RCx3Q0FBNkM7QUFDN0MsOENBQXdGO0FBQ3hGLGdEQUFnRDtBQUVoRCw4QkFBOEI7QUFDOUIsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFO1FBQ2YscUJBQXFCLEVBQUUsSUFBSTtLQUM1QjtDQUNGLENBQUMsQ0FBQztBQUVILE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO0FBRWhELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLCtDQUErQyxDQUFDLENBQUM7QUFDbkUsQ0FBQztBQUVNLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBNkIsRUFDSyxFQUFFO0lBQ3BDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDaEIsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLHlCQUF5QixFQUFFLENBQUMsQ0FBQztJQUNsRSxDQUFDO0lBRUQsSUFBSSxDQUFDO1FBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFdkMsaUNBQWlDO1FBQ2pDLE1BQU0sZ0JBQWdCLEdBQUcsOEJBQXFCLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRWxFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUM5QixN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LCtFQUErRTtZQUNqRix3QkFBd0IsRUFBRTtnQkFDeEIsT0FBTyxFQUFFLE1BQU07Z0JBQ2YsaUJBQWlCLEVBQUUsZ0JBQWdCO2dCQUNuQyxZQUFZLEVBQUUsV0FBVzthQUMxQjtZQUNELHlCQUF5QixFQUFFO2dCQUN6QixPQUFPLEVBQUUsSUFBSTtnQkFDYixpQkFBaUIsRUFBRSxjQUFjLElBQUksSUFBSTtnQkFDekMsWUFBWSxFQUFFLEdBQUc7YUFDbEI7WUFDRCxZQUFZLEVBQUUsU0FBUztTQUN4QixDQUFDLENBQ0gsQ0FBQztRQUVGLE9BQU8sU0FBUyxDQUFDLFVBQXdCLENBQUM7SUFDNUMsQ0FBQztJQUVELHNDQUFzQztJQUN0QyxNQUFNLFFBQVEsR0FBRyxJQUFBLFNBQU0sR0FBRSxDQUFDO0lBQzFCLE1BQU0sT0FBTyxHQUFHLEdBQUcsU0FBUyxJQUFJLFVBQVUsSUFBSSxRQUFRLEVBQUUsQ0FBQztJQUV6RCxNQUFNLFVBQVUsR0FBcUM7UUFDbkQsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsa0JBQVM7UUFDcEIsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsT0FBTztRQUVsQixFQUFFLEVBQUUsUUFBUTtRQUNaLFVBQVU7UUFDVixTQUFTO1FBQ1QsY0FBYztRQUNkLElBQUk7UUFDSixNQUFNLEVBQUUsUUFBUSxFQUFFLHdCQUF3QjtRQUUxQyxTQUFTLEVBQUUsR0FBRztRQUNkLFNBQVMsRUFBRSxHQUFHO0tBQ2YsQ0FBQztJQUVGLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBSSx5QkFBVSxDQUFDO1FBQ2IsU0FBUyxFQUFFLGFBQWE7UUFDeEIsSUFBSSxFQUFFLFVBQVU7S0FDakIsQ0FBQyxDQUNILENBQUM7SUFFRixPQUFPLFVBQXdCLENBQUM7QUFDbEMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsIEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyLCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgUXVlcnlDb21tYW5kLCBVcGRhdGVDb21tYW5kLCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tICd1dWlkJztcblxuaW1wb3J0IHsgUEtfTkFNRSwgU0tfTkFNRSB9IGZyb20gJy4uL2NvbnN0YW50cy9jb21tb24nO1xuaW1wb3J0IHsgYXBpUmVzcG9uc2UgfSBmcm9tICcuLi9oZWxwZXJzL2FwaSc7XG5pbXBvcnQgeyBBbnN3ZXJJdGVtLCBDcmVhdGVBbnN3ZXJEVE8sIENyZWF0ZUFuc3dlckRUT1NjaGVtYSwgfSBmcm9tICcuLi9zY2hlbWFzL2Fuc3dlcic7XG5pbXBvcnQgeyBBTlNXRVJfUEsgfSBmcm9tICcuLi9jb25zdGFudHMvYW5zd2VyJztcblxuLy8gLS0tIER5bmFtbyBjbGllbnQgc2V0dXAgLS0tXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGRkYkNsaWVudCwge1xuICBtYXJzaGFsbE9wdGlvbnM6IHtcbiAgICByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsXG4gIH0sXG59KTtcblxuY29uc3QgREJfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRCX1RBQkxFX05BTUU7XG5cbmlmICghREJfVEFCTEVfTkFNRSkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ0RCX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldCcpO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyPiA9PiB7XG4gIGlmICghZXZlbnQuYm9keSkge1xuICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHsgbWVzc2FnZTogJ1JlcXVlc3QgYm9keSBpcyBtaXNzaW5nJyB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgcmF3Qm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XG5cbiAgICAvLyAxLiBSdW50aW1lIHZhbGlkYXRpb24gd2l0aCBab2RcbiAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gQ3JlYXRlQW5zd2VyRFRPU2NoZW1hLnNhZmVQYXJzZShyYXdCb2R5KTtcblxuICAgIGlmICghdmFsaWRhdGlvblJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICBjb25zdCBlcnJvckRldGFpbHMgPSB2YWxpZGF0aW9uUmVzdWx0LmVycm9yLmlzc3Vlcy5tYXAoKGlzc3VlKSA9PiAoe1xuICAgICAgICBwYXRoOiBpc3N1ZS5wYXRoLmpvaW4oJy4nKSxcbiAgICAgICAgbWVzc2FnZTogaXNzdWUubWVzc2FnZSxcbiAgICAgIH0pKTtcblxuICAgICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwMCwge1xuICAgICAgICBtZXNzYWdlOiAnVmFsaWRhdGlvbiBmYWlsZWQnLFxuICAgICAgICBlcnJvcnM6IGVycm9yRGV0YWlscyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGR0bzogQ3JlYXRlQW5zd2VyRFRPID0gdmFsaWRhdGlvblJlc3VsdC5kYXRhO1xuXG4gICAgLy8gMi4gVXBzZXJ0IGFuc3dlciBpdGVtIGluIER5bmFtb1xuICAgIGNvbnN0IHNhdmVkQW5zd2VyID0gYXdhaXQgc2F2ZUFuc3dlcihkdG8pO1xuXG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDIwMCwgc2F2ZWRBbnN3ZXIpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBzYXZlQW5zd2VyIGhhbmRsZXI6JywgZXJyKTtcblxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBTeW50YXhFcnJvcikge1xuICAgICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwMCwgeyBtZXNzYWdlOiAnSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDUwMCwge1xuICAgICAgbWVzc2FnZTogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICBlcnJvcjogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICB9KTtcbiAgfVxufTtcblxuLy8gLS0tIEJ1c2luZXNzIExvZ2ljIC0tLVxuLy8gVXBzZXJ0IGFuc3dlciBieSAocHJvamVjdElkLCBxdWVzdGlvbklkKVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2F2ZUFuc3dlcihcbiAgZHRvOiBDcmVhdGVBbnN3ZXJEVE8sXG4pOiBQcm9taXNlPEFuc3dlckl0ZW0+IHtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICBjb25zdCB7IHF1ZXN0aW9uSWQsIHRleHQsIHByb2plY3RJZCwgb3JnYW5pemF0aW9uSWQgfSA9IGR0bztcblxuICAvLyBXZSB0cmVhdCBcIm9uZSBhbnN3ZXIgcGVyIChwcm9qZWN0SWQsIHF1ZXN0aW9uSWQpXCIgYXMgdXBzZXJ0IHRhcmdldC5cbiAgLy8gU0sgcGF0dGVybiB3aGVuIGNyZWF0aW5nOiBgJHtwcm9qZWN0SWR9IyR7cXVlc3Rpb25JZH0jJHthbnN3ZXJJZH1gXG4gIGNvbnN0IHNrUHJlZml4ID0gYCR7cHJvamVjdElkfSMke3F1ZXN0aW9uSWR9I2A7XG5cbiAgLy8gMSkgVHJ5IHRvIGZpbmQgZXhpc3RpbmcgYW5zd2VyIGZvciB0aGlzIChwcm9qZWN0SWQsIHF1ZXN0aW9uSWQpXG4gIGNvbnN0IHF1ZXJ5UmVzID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQoXG4gICAgbmV3IFF1ZXJ5Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnI3BrID0gOnBrIEFORCBiZWdpbnNfd2l0aCgjc2ssIDpza1ByZWZpeCknLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICcjcGsnOiBQS19OQU1FLFxuICAgICAgICAnI3NrJzogU0tfTkFNRSxcbiAgICAgIH0sXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICc6cGsnOiBBTlNXRVJfUEssXG4gICAgICAgICc6c2tQcmVmaXgnOiBza1ByZWZpeCxcbiAgICAgIH0sXG4gICAgICBMaW1pdDogMSwgLy8gd2Ugb25seSBjYXJlIGFib3V0IGZpcnN0IG1hdGNoXG4gICAgfSksXG4gICk7XG5cbiAgY29uc3QgZXhpc3RpbmcgPSAocXVlcnlSZXMuSXRlbXM/LlswXSBhc1xuICAgIHwgKEFuc3dlckl0ZW0gJiBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgIHwgdW5kZWZpbmVkKSA/PyB1bmRlZmluZWQ7XG5cbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgLy8gMikgVVBEQVRFIGV4aXN0aW5nIGFuc3dlclxuICAgIGNvbnN0IGtleSA9IHtcbiAgICAgIFtQS19OQU1FXTogZXhpc3RpbmdbUEtfTkFNRV0sXG4gICAgICBbU0tfTkFNRV06IGV4aXN0aW5nW1NLX05BTUVdLFxuICAgIH07XG5cbiAgICBjb25zdCB1cGRhdGVSZXMgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChcbiAgICAgIG5ldyBVcGRhdGVDb21tYW5kKHtcbiAgICAgICAgVGFibGVOYW1lOiBEQl9UQUJMRV9OQU1FLFxuICAgICAgICBLZXk6IGtleSxcbiAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjpcbiAgICAgICAgICAnU0VUICN0ZXh0ID0gOnRleHQsICNvcmdhbml6YXRpb25JZCA9IDpvcmdhbml6YXRpb25JZCwgI3VwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICAgICAnI3RleHQnOiAndGV4dCcsXG4gICAgICAgICAgJyNvcmdhbml6YXRpb25JZCc6ICdvcmdhbml6YXRpb25JZCcsXG4gICAgICAgICAgJyN1cGRhdGVkQXQnOiAndXBkYXRlZEF0JyxcbiAgICAgICAgfSxcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgICAgICc6dGV4dCc6IHRleHQsXG4gICAgICAgICAgJzpvcmdhbml6YXRpb25JZCc6IG9yZ2FuaXphdGlvbklkID8/IG51bGwsXG4gICAgICAgICAgJzp1cGRhdGVkQXQnOiBub3csXG4gICAgICAgIH0sXG4gICAgICAgIFJldHVyblZhbHVlczogJ0FMTF9ORVcnLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHJldHVybiB1cGRhdGVSZXMuQXR0cmlidXRlcyBhcyBBbnN3ZXJJdGVtO1xuICB9XG5cbiAgLy8gMykgQ1JFQVRFIG5ldyBhbnN3ZXIgaWYgbm9uZSBleGlzdHNcbiAgY29uc3QgYW5zd2VySWQgPSB1dWlkdjQoKTtcbiAgY29uc3Qgc29ydEtleSA9IGAke3Byb2plY3RJZH0jJHtxdWVzdGlvbklkfSMke2Fuc3dlcklkfWA7XG5cbiAgY29uc3QgYW5zd2VySXRlbTogQW5zd2VySXRlbSAmIFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgW1BLX05BTUVdOiBBTlNXRVJfUEssXG4gICAgW1NLX05BTUVdOiBzb3J0S2V5LFxuXG4gICAgaWQ6IGFuc3dlcklkLFxuICAgIHF1ZXN0aW9uSWQsXG4gICAgcHJvamVjdElkLFxuICAgIG9yZ2FuaXphdGlvbklkLFxuICAgIHRleHQsXG4gICAgc291cmNlOiAnbWFudWFsJywgLy8gc3RpbGwgYSBtYW51YWwgYW5zd2VyXG5cbiAgICBjcmVhdGVkQXQ6IG5vdyxcbiAgICB1cGRhdGVkQXQ6IG5vdyxcbiAgfTtcblxuICBhd2FpdCBkb2NDbGllbnQuc2VuZChcbiAgICBuZXcgUHV0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICBJdGVtOiBhbnN3ZXJJdGVtLFxuICAgIH0pLFxuICApO1xuXG4gIHJldHVybiBhbnN3ZXJJdGVtIGFzIEFuc3dlckl0ZW07XG59XG4iXX0=