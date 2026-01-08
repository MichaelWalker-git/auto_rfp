"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const common_1 = require("../constants/common");
const api_1 = require("../helpers/api");
const organization_1 = require("../constants/organization");
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
        const { orgId, kbId } = event.pathParameters || {};
        const sk = `${orgId}#${kbId}`;
        try {
            await docClient.send(new lib_dynamodb_1.DeleteCommand({
                TableName: DB_TABLE_NAME,
                Key: {
                    [common_1.PK_NAME]: organization_1.KNOWLEDGE_BASE_PK,
                    [common_1.SK_NAME]: sk,
                },
                ConditionExpression: 'attribute_exists(#pk)',
                ExpressionAttributeNames: {
                    '#pk': common_1.PK_NAME,
                },
            }));
        }
        catch (err) {
            // ConditionalCheckFailedException -> item not found
            if (err?.name === 'ConditionalCheckFailedException') {
                return (0, api_1.apiResponse)(404, {
                    message: 'Knowledge base not found',
                    orgId,
                    kbId,
                });
            }
            console.error('Error deleting knowledge base:', err);
            return (0, api_1.apiResponse)(500, {
                message: 'Failed to delete knowledge base',
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }
        return (0, api_1.apiResponse)(200, {
            message: 'Knowledge base deleted successfully',
            orgId,
            kbId,
        });
    }
    catch (err) {
        console.error('Unhandled error in deleteKnowledgeBase handler:', err);
        return (0, api_1.apiResponse)(500, {
            message: 'Internal server error',
            error: err instanceof Error ? err.message : 'Unknown error',
        });
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLWtub3dsZWRnZWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZWxldGUta25vd2xlZGdlYmFzZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQStFO0FBRS9FLGdEQUF1RDtBQUN2RCx3Q0FBNkM7QUFDN0MsNERBQThEO0FBRTlELE1BQU0sU0FBUyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN6QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO0lBQ3ZELGVBQWUsRUFBRTtRQUNmLHFCQUFxQixFQUFFLElBQUk7S0FDNUI7Q0FDRixDQUFDLENBQUM7QUFFSCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztBQUVoRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO0FBQ25FLENBQUM7QUFFTSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTZCLEVBQ0ssRUFBRTtJQUNwQyxJQUFJLENBQUM7UUFDSCxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDO1FBRW5ELE1BQU0sRUFBRSxHQUFHLEdBQUcsS0FBSyxJQUFJLElBQUksRUFBRSxDQUFDO1FBRTlCLElBQUksQ0FBQztZQUNILE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBSSw0QkFBYSxDQUFDO2dCQUNoQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsR0FBRyxFQUFFO29CQUNILENBQUMsZ0JBQU8sQ0FBQyxFQUFFLGdDQUFpQjtvQkFDNUIsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsRUFBRTtpQkFDZDtnQkFDRCxtQkFBbUIsRUFBRSx1QkFBdUI7Z0JBQzVDLHdCQUF3QixFQUFFO29CQUN4QixLQUFLLEVBQUUsZ0JBQU87aUJBQ2Y7YUFDRixDQUFDLENBQ0gsQ0FBQztRQUNKLENBQUM7UUFBQyxPQUFPLEdBQVEsRUFBRSxDQUFDO1lBQ2xCLG9EQUFvRDtZQUNwRCxJQUFJLEdBQUcsRUFBRSxJQUFJLEtBQUssaUNBQWlDLEVBQUUsQ0FBQztnQkFDcEQsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO29CQUN0QixPQUFPLEVBQUUsMEJBQTBCO29CQUNuQyxLQUFLO29CQUNMLElBQUk7aUJBQ0wsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztZQUVELE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDckQsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO2dCQUN0QixPQUFPLEVBQUUsaUNBQWlDO2dCQUMxQyxLQUFLLEVBQUUsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTthQUM1RCxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO1lBQ3RCLE9BQU8sRUFBRSxxQ0FBcUM7WUFDOUMsS0FBSztZQUNMLElBQUk7U0FDTCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztRQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsaURBQWlELEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDdEUsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO1lBQ3RCLE9BQU8sRUFBRSx1QkFBdUI7WUFDaEMsS0FBSyxFQUFFLEdBQUcsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7U0FDNUQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztBQUNILENBQUMsQ0FBQztBQW5EVyxRQUFBLE9BQU8sV0FtRGxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnRWMiwgQVBJR2F0ZXdheVByb3h5UmVzdWx0VjIsIH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBEZWxldGVDb21tYW5kLCBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5cbmltcG9ydCB7IFBLX05BTUUsIFNLX05BTUUgfSBmcm9tICcuLi9jb25zdGFudHMvY29tbW9uJztcbmltcG9ydCB7IGFwaVJlc3BvbnNlIH0gZnJvbSAnLi4vaGVscGVycy9hcGknO1xuaW1wb3J0IHsgS05PV0xFREdFX0JBU0VfUEsgfSBmcm9tICcuLi9jb25zdGFudHMvb3JnYW5pemF0aW9uJztcblxuY29uc3QgZGRiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkZGJDbGllbnQsIHtcbiAgbWFyc2hhbGxPcHRpb25zOiB7XG4gICAgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlLFxuICB9LFxufSk7XG5cbmNvbnN0IERCX1RBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5EQl9UQUJMRV9OQU1FO1xuXG5pZiAoIURCX1RBQkxFX05BTUUpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdEQl9UQUJMRV9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQnKTtcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudFYyLFxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHRWMj4gPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IHsgb3JnSWQsIGtiSWQgfSA9IGV2ZW50LnBhdGhQYXJhbWV0ZXJzIHx8IHt9O1xuXG4gICAgY29uc3Qgc2sgPSBgJHtvcmdJZH0jJHtrYklkfWA7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQoXG4gICAgICAgIG5ldyBEZWxldGVDb21tYW5kKHtcbiAgICAgICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICAgICAgS2V5OiB7XG4gICAgICAgICAgICBbUEtfTkFNRV06IEtOT1dMRURHRV9CQVNFX1BLLFxuICAgICAgICAgICAgW1NLX05BTUVdOiBzayxcbiAgICAgICAgICB9LFxuICAgICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfZXhpc3RzKCNwayknLFxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xuICAgICAgICAgICAgJyNwayc6IFBLX05BTUUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAvLyBDb25kaXRpb25hbENoZWNrRmFpbGVkRXhjZXB0aW9uIC0+IGl0ZW0gbm90IGZvdW5kXG4gICAgICBpZiAoZXJyPy5uYW1lID09PSAnQ29uZGl0aW9uYWxDaGVja0ZhaWxlZEV4Y2VwdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwNCwge1xuICAgICAgICAgIG1lc3NhZ2U6ICdLbm93bGVkZ2UgYmFzZSBub3QgZm91bmQnLFxuICAgICAgICAgIG9yZ0lkLFxuICAgICAgICAgIGtiSWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBkZWxldGluZyBrbm93bGVkZ2UgYmFzZTonLCBlcnIpO1xuICAgICAgcmV0dXJuIGFwaVJlc3BvbnNlKDUwMCwge1xuICAgICAgICBtZXNzYWdlOiAnRmFpbGVkIHRvIGRlbGV0ZSBrbm93bGVkZ2UgYmFzZScsXG4gICAgICAgIGVycm9yOiBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDIwMCwge1xuICAgICAgbWVzc2FnZTogJ0tub3dsZWRnZSBiYXNlIGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgIG9yZ0lkLFxuICAgICAga2JJZCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcignVW5oYW5kbGVkIGVycm9yIGluIGRlbGV0ZUtub3dsZWRnZUJhc2UgaGFuZGxlcjonLCBlcnIpO1xuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxuICAgICAgZXJyb3I6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSk7XG4gIH1cbn07XG4iXX0=