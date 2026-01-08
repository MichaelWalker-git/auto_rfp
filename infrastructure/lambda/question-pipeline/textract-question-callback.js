"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_sfn_1 = require("@aws-sdk/client-sfn");
const common_1 = require("../constants/common");
const question_file_1 = require("../constants/question-file");
const ddbClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
});
const stepFunctionsClient = new client_sfn_1.SFNClient({});
const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME)
    throw new Error('DB_TABLE_NAME env var is not set');
const handler = async (event, _ctx) => {
    console.log('textract-question-callback event:', JSON.stringify(event));
    for (const record of event.Records) {
        const sns = record.Sns;
        const messageStr = sns.Message;
        let message;
        try {
            message = JSON.parse(messageStr);
        }
        catch (err) {
            console.warn('SNS message is not JSON, skipping:', messageStr);
            continue;
        }
        console.log('Parsed Textract message:', JSON.stringify(message));
        const jobId = message.JobId;
        const status = message.Status;
        const jobTag = message.JobTag; // = questionFileId
        if (!jobId || !status) {
            console.warn('Missing JobId or Status in SNS message, skipping');
            continue;
        }
        if (!jobTag) {
            console.warn('No JobTag (questionFileId) in SNS message, skipping');
            continue;
        }
        const questionFileId = jobTag;
        console.log(`Textract notification for questionFileId=${questionFileId}, jobId=${jobId}, status=${status}`);
        // 1) Load question_file by PK + SK suffix
        // SK pattern: projectId#questionFileId → we scan via Query on PK and filter in code.
        let taskToken;
        let skFound;
        try {
            const queryRes = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: DB_TABLE_NAME,
                KeyConditionExpression: '#pk = :pk',
                ExpressionAttributeNames: {
                    '#pk': common_1.PK_NAME,
                },
                ExpressionAttributeValues: {
                    ':pk': question_file_1.QUESTION_FILE_PK,
                },
            }));
            const items = (queryRes.Items || []);
            const item = items.find((it) => String(it[common_1.SK_NAME]).endsWith(`#${questionFileId}`));
            if (item) {
                taskToken = item.taskToken;
                skFound = item[common_1.SK_NAME];
            }
            else {
                console.warn(`No question_file found ending with #${questionFileId}`);
            }
        }
        catch (err) {
            console.error('Error querying question_file for taskToken:', err);
        }
        if (!taskToken) {
            console.warn(`No taskToken found for questionFileId=${questionFileId}, skipping callback`);
            continue;
        }
        // 2) Notify Step Functions
        try {
            if (status === 'SUCCEEDED') {
                await stepFunctionsClient.send(new client_sfn_1.SendTaskSuccessCommand({
                    taskToken,
                    output: JSON.stringify({
                        questionFileId,
                        jobId,
                        status,
                    }),
                }));
                console.log(`Sent task success for questionFileId=${questionFileId}, jobId=${jobId}`);
            }
            else {
                await stepFunctionsClient.send(new client_sfn_1.SendTaskFailureCommand({
                    taskToken,
                    error: 'TextractFailed',
                    cause: `Textract job ${jobId} finished with status=${status}`,
                }));
                console.log(`Sent task failure for questionFileId=${questionFileId}, jobId=${jobId}`);
            }
        }
        catch (err) {
            console.error('Error calling Step Functions:', err);
            throw err;
        }
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGV4dHJhY3QtcXVlc3Rpb24tY2FsbGJhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ0ZXh0cmFjdC1xdWVzdGlvbi1jYWxsYmFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQThFO0FBQzlFLG9EQUFpRztBQUVqRyxnREFBdUQ7QUFDdkQsOERBQThEO0FBRTlELE1BQU0sU0FBUyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN6QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO0lBQ3ZELGVBQWUsRUFBRSxFQUFFLHFCQUFxQixFQUFFLElBQUksRUFBRTtDQUNqRCxDQUFDLENBQUM7QUFDSCxNQUFNLG1CQUFtQixHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUU5QyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztBQUNoRCxJQUFJLENBQUMsYUFBYTtJQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQztBQUVqRSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQWUsRUFDZixJQUFhLEVBQ0UsRUFBRTtJQUNqQixPQUFPLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztJQUV4RSxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNuQyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDO1FBQ3ZCLE1BQU0sVUFBVSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUM7UUFFL0IsSUFBSSxPQUFZLENBQUM7UUFDakIsSUFBSSxDQUFDO1lBQ0gsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkMsQ0FBQztR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QVcsS0FBSyxFQUFFLENBQ3pFLENBQUM7WUFDSixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxtQkFBbUIsQ0FBQyxJQUFJLENBQzVCLElBQUksbUNBQXNCLENBQUM7b0JBQ3pCLFNBQVM7b0JBQ1QsS0FBSyxFQUFFLGdCQUFnQjtvQkFDdkIsS0FBSyxFQUFFLGdCQUFnQixLQUFLLHlCQUF5QixNQUFNLEVBQUU7aUJBQzlELENBQUMsQ0FDSCxDQUFDO2dCQUNGLE9BQU8sQ0FBQyxHQUFHLENBQ1Qsd0NBQXdDLGNBQWMsV0FBVyxLQUFLLEVBQUUsQ0FDekUsQ0FBQztZQUNKLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsK0JBQStCLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDcEQsTUFBTSxHQUFHLENBQUM7UUFDWixDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUMsQ0FBQztBQW5IVyxRQUFBLE9BQU8sV0FtSGxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29udGV4dCwgU05TRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFF1ZXJ5Q29tbWFuZCwgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgU2VuZFRhc2tGYWlsdXJlQ29tbWFuZCwgU2VuZFRhc2tTdWNjZXNzQ29tbWFuZCwgU0ZOQ2xpZW50LCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZm4nO1xuXG5pbXBvcnQgeyBQS19OQU1FLCBTS19OQU1FIH0gZnJvbSAnLi4vY29uc3RhbnRzL2NvbW1vbic7XG5pbXBvcnQgeyBRVUVTVElPTl9GSUxFX1BLIH0gZnJvbSAnLi4vY29uc3RhbnRzL3F1ZXN0aW9uLWZpbGUnO1xuXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGRkYkNsaWVudCwge1xuICBtYXJzaGFsbE9wdGlvbnM6IHsgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlIH0sXG59KTtcbmNvbnN0IHN0ZXBGdW5jdGlvbnNDbGllbnQgPSBuZXcgU0ZOQ2xpZW50KHt9KTtcblxuY29uc3QgREJfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRCX1RBQkxFX05BTUU7XG5pZiAoIURCX1RBQkxFX05BTUUpIHRocm93IG5ldyBFcnJvcignREJfVEFCTEVfTkFNRSBlbnYgdmFyIGlzIG5vdCBzZXQnKTtcblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXG4gIGV2ZW50OiBTTlNFdmVudCxcbiAgX2N0eDogQ29udGV4dCxcbik6IFByb21pc2U8dm9pZD4gPT4ge1xuICBjb25zb2xlLmxvZygndGV4dHJhY3QtcXVlc3Rpb24tY2FsbGJhY2sgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcblxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XG4gICAgY29uc3Qgc25zID0gcmVjb3JkLlNucztcbiAgICBjb25zdCBtZXNzYWdlU3RyID0gc25zLk1lc3NhZ2U7XG5cbiAgICBsZXQgbWVzc2FnZTogYW55O1xuICAgIHRyeSB7XG4gICAgICBtZXNzYWdlID0gSlNPTi5wYXJzZShtZXNzYWdlU3RyKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUud2FybignU05TIG1lc3NhZ2UgaXMgbm90IEpTT04sIHNraXBwaW5nOicsIG1lc3NhZ2VTdHIpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coJ1BhcnNlZCBUZXh0cmFjdCBtZXNzYWdlOicsIEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcblxuICAgIGNvbnN0IGpvYklkOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBtZXNzYWdlLkpvYklkO1xuICAgIGNvbnN0IHN0YXR1czogc3RyaW5nIHwgdW5kZWZpbmVkID0gbWVzc2FnZS5TdGF0dXM7XG4gICAgY29uc3Qgam9iVGFnOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBtZXNzYWdlLkpvYlRhZzsgLy8gPSBxdWVzdGlvbkZpbGVJZFxuXG4gICAgaWYgKCFqb2JJZCB8fCAhc3RhdHVzKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ01pc3NpbmcgSm9iSWQgb3IgU3RhdHVzIGluIFNOUyBtZXNzYWdlLCBza2lwcGluZycpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKCFqb2JUYWcpIHtcbiAgICAgIGNvbnNvbGUud2FybignTm8gSm9iVGFnIChxdWVzdGlvbkZpbGVJZCkgaW4gU05TIG1lc3NhZ2UsIHNraXBwaW5nJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBxdWVzdGlvbkZpbGVJZCA9IGpvYlRhZztcbiAgICBjb25zb2xlLmxvZyhcbiAgICAgIGBUZXh0cmFjdCBub3RpZmljYXRpb24gZm9yIHF1ZXN0aW9uRmlsZUlkPSR7cXVlc3Rpb25GaWxlSWR9LCBqb2JJZD0ke2pvYklkfSwgc3RhdHVzPSR7c3RhdHVzfWAsXG4gICAgKTtcblxuICAgIC8vIDEpIExvYWQgcXVlc3Rpb25fZmlsZSBieSBQSyArIFNLIHN1ZmZpeFxuICAgIC8vIFNLIHBhdHRlcm46IHByb2plY3RJZCNxdWVzdGlvbkZpbGVJZCDihpIgd2Ugc2NhbiB2aWEgUXVlcnkgb24gUEsgYW5kIGZpbHRlciBpbiBjb2RlLlxuICAgIGxldCB0YXNrVG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgc2tGb3VuZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBxdWVyeVJlcyA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKFxuICAgICAgICBuZXcgUXVlcnlDb21tYW5kKHtcbiAgICAgICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJyNwayA9IDpwaycsXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICAgICAnI3BrJzogUEtfTkFNRSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgICAgICc6cGsnOiBRVUVTVElPTl9GSUxFX1BLLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgICAgY29uc3QgaXRlbXMgPSAocXVlcnlSZXMuSXRlbXMgfHwgW10pIGFzIGFueVtdO1xuXG4gICAgICBjb25zdCBpdGVtID0gaXRlbXMuZmluZCgoaXQpID0+XG4gICAgICAgIFN0cmluZyhpdFtTS19OQU1FXSkuZW5kc1dpdGgoYCMke3F1ZXN0aW9uRmlsZUlkfWApLFxuICAgICAgKTtcblxuICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgdGFza1Rva2VuID0gaXRlbS50YXNrVG9rZW4gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgICBza0ZvdW5kID0gaXRlbVtTS19OQU1FXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICBgTm8gcXVlc3Rpb25fZmlsZSBmb3VuZCBlbmRpbmcgd2l0aCAjJHtxdWVzdGlvbkZpbGVJZH1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgcXVlcnlpbmcgcXVlc3Rpb25fZmlsZSBmb3IgdGFza1Rva2VuOicsIGVycik7XG4gICAgfVxuXG4gICAgaWYgKCF0YXNrVG9rZW4pIHtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgYE5vIHRhc2tUb2tlbiBmb3VuZCBmb3IgcXVlc3Rpb25GaWxlSWQ9JHtxdWVzdGlvbkZpbGVJZH0sIHNraXBwaW5nIGNhbGxiYWNrYCxcbiAgICAgICk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyAyKSBOb3RpZnkgU3RlcCBGdW5jdGlvbnNcbiAgICB0cnkge1xuICAgICAgaWYgKHN0YXR1cyA9PT0gJ1NVQ0NFRURFRCcpIHtcbiAgICAgICAgYXdhaXQgc3RlcEZ1bmN0aW9uc0NsaWVudC5zZW5kKFxuICAgICAgICAgIG5ldyBTZW5kVGFza1N1Y2Nlc3NDb21tYW5kKHtcbiAgICAgICAgICAgIHRhc2tUb2tlbixcbiAgICAgICAgICAgIG91dHB1dDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBxdWVzdGlvbkZpbGVJZCxcbiAgICAgICAgICAgICAgam9iSWQsXG4gICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgICBgU2VudCB0YXNrIHN1Y2Nlc3MgZm9yIHF1ZXN0aW9uRmlsZUlkPSR7cXVlc3Rpb25GaWxlSWR9LCBqb2JJZD0ke2pvYklkfWAsXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBzdGVwRnVuY3Rpb25zQ2xpZW50LnNlbmQoXG4gICAgICAgICAgbmV3IFNlbmRUYXNrRmFpbHVyZUNvbW1hbmQoe1xuICAgICAgICAgICAgdGFza1Rva2VuLFxuICAgICAgICAgICAgZXJyb3I6ICdUZXh0cmFjdEZhaWxlZCcsXG4gICAgICAgICAgICBjYXVzZTogYFRleHRyYWN0IGpvYiAke2pvYklkfSBmaW5pc2hlZCB3aXRoIHN0YXR1cz0ke3N0YXR1c31gLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgICBgU2VudCB0YXNrIGZhaWx1cmUgZm9yIHF1ZXN0aW9uRmlsZUlkPSR7cXVlc3Rpb25GaWxlSWR9LCBqb2JJZD0ke2pvYklkfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjYWxsaW5nIFN0ZXAgRnVuY3Rpb25zOicsIGVycik7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9XG59O1xuIl19