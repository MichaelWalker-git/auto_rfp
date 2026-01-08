"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.listDocuments = listDocuments;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const api_1 = require("../helpers/api");
const common_1 = require("../constants/common");
const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) {
    throw new Error("DB_TABLE_NAME environment variable is not set");
}
const ddbClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});
const handler = async (event) => {
    try {
        const kbId = event.queryStringParameters?.kbId ||
            event.pathParameters?.kbId;
        if (!kbId) {
            return (0, api_1.apiResponse)(400, {
                message: "Missing required query parameter: kbId",
            });
        }
        const documents = await listDocuments(kbId);
        return (0, api_1.apiResponse)(200, documents);
    }
    catch (err) {
        console.error("Error in get-documents handler:", err);
        return (0, api_1.apiResponse)(500, {
            message: "Internal server error",
            error: err instanceof Error ? err.message : "Unknown error",
        });
    }
};
exports.handler = handler;
// ----------------------------------------------------
// Core: Query all documents for a KnowledgeBase
// ----------------------------------------------------
async function listDocuments(knowledgeBaseId) {
    const items = [];
    let ExclusiveStartKey = undefined;
    // SK pattern: "KB#<kbId>#DOC#<id>"
    const skPrefix = `KB#${knowledgeBaseId}#DOC#`;
    do {
        const res = await docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: DB_TABLE_NAME,
            KeyConditionExpression: "#pk = :pkValue AND begins_with(#sk, :skPrefix)",
            ExpressionAttributeNames: {
                "#pk": common_1.PK_NAME,
                "#sk": common_1.SK_NAME,
            },
            ExpressionAttributeValues: {
                ":pkValue": "DOCUMENT",
                ":skPrefix": skPrefix,
            },
            ExclusiveStartKey,
        }));
        if (res.Items && res.Items.length > 0) {
            items.push(...res.Items);
        }
        ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    // Extract documentId from SK
    return items.map((item) => {
        const sk = item[common_1.SK_NAME];
        // Format: KB#<kbId>#DOC#<documentId>
        const parts = sk.split("#");
        const documentId = parts[3];
        return {
            ...item,
            id: documentId,
        };
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2V0LWRvY3VtZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdldC1kb2N1bWVudHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbURBLHNDQWdEQztBQWpHRCw4REFBMEQ7QUFDMUQsd0RBQThFO0FBRTlFLHdDQUE2QztBQUM3QyxnREFBdUQ7QUFFdkQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7QUFFaEQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ25CLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztBQUNuRSxDQUFDO0FBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFO1FBQ2YscUJBQXFCLEVBQUUsSUFBSTtLQUM1QjtDQUNGLENBQUMsQ0FBQztBQUVJLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBNkIsRUFDSyxFQUFFO0lBQ3BDLElBQUksQ0FBQztRQUNILE1BQU0sSUFBSSxHQUNSLEtBQUssQ0FBQyxxQkFBcUIsRUFBRSxJQUFJO1lBQ2pDLEtBQUssQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDO1FBRTdCLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNWLE9BQU8sSUFBQSxpQkFBVyxFQUFDLEdBQUcsRUFBRTtnQkFDdEIsT0FBTyxFQUFFLHdDQUF3QzthQUNsRCxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFNUMsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ3JDLENBQUM7SUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUV0RCxPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7WUFDdEIsT0FBTyxFQUFFLHVCQUF1QjtZQUNoQyxLQUFLLEVBQUUsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtTQUM1RCxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBekJXLFFBQUEsT0FBTyxXQXlCbEI7QUFFRix1REFBdUQ7QUFDdkQsZ0RBQWdEO0FBQ2hELHVEQUF1RDtBQUNoRCxLQUFLLFVBQVUsYUFBYSxDQUNqQyxlQUF1QjtJQUV2QixNQUFNLEtBQUssR0FBVSxFQUFFLENBQUM7SUFDeEIsSUFBSSxpQkFBaUIsR0FBb0MsU0FBUyxDQUFDO0lBRW5FLG1DQUFtQztJQUNuQyxNQUFNLFFBQVEsR0FBRyxNQUFNLGVBQWUsT0FBTyxDQUFDO0lBRTlDLEdBQUcsQ0FBQztRQUNGLE1BQU0sR0FBRyxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDOUIsSUFBSSwyQkFBWSxDQUFDO1lBQ2YsU0FBUyxFQUFFLGFBQWE7WUFDeEIsc0JBQXNCLEVBQ3BCLGdEQUFnRDtZQUNsRCx3QkFBd0IsRUFBRTtnQkFDeEIsS0FBSyxFQUFFLGdCQUFPO2dCQUNkLEtBQUssRUFBRSxnQkFBTzthQUNmO1lBQ0QseUJBQXlCLEVBQUU7Z0JBQ3pCLFVBQVUsRUFBRSxVQUFVO2dCQUN0QixXQUFXLEVBQUUsUUFBUTthQUN0QjtZQUNELGlCQUFpQjtTQUNsQixDQUFDLENBQ0gsQ0FBQztRQUVGLElBQUksR0FBRyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0QyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzNCLENBQUM7UUFFRCxpQkFBaUIsR0FBRyxHQUFHLENBQUMsZ0JBRVgsQ0FBQztJQUNoQixDQUFDLFFBQVEsaUJBQWlCLEVBQUU7SUFFNUIsNkJBQTZCO0lBQzdCLE9BQU8sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFO1FBQ3hCLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxnQkFBTyxDQUFXLENBQUM7UUFDbkMscUNBQXFDO1FBQ3JDLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDNUIsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRTVCLE9BQU87WUFDTCxHQUFHLElBQUk7WUFDUCxFQUFFLEVBQUUsVUFBVTtTQUNmLENBQUM7SUFDSixDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudFYyLCBBUElHYXRld2F5UHJveHlSZXN1bHRWMiwgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUXVlcnlDb21tYW5kLCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5cbmltcG9ydCB7IGFwaVJlc3BvbnNlIH0gZnJvbSAnLi4vaGVscGVycy9hcGknO1xuaW1wb3J0IHsgUEtfTkFNRSwgU0tfTkFNRSB9IGZyb20gJy4uL2NvbnN0YW50cy9jb21tb24nO1xuXG5jb25zdCBEQl9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuREJfVEFCTEVfTkFNRTtcblxuaWYgKCFEQl9UQUJMRV9OQU1FKSB7XG4gIHRocm93IG5ldyBFcnJvcihcIkRCX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldFwiKTtcbn1cblxuY29uc3QgZGRiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkZGJDbGllbnQsIHtcbiAgbWFyc2hhbGxPcHRpb25zOiB7XG4gICAgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlLFxuICB9LFxufSk7XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnRWMlxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHRWMj4gPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGtiSWQgPVxuICAgICAgZXZlbnQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzPy5rYklkIHx8XG4gICAgICBldmVudC5wYXRoUGFyYW1ldGVycz8ua2JJZDtcblxuICAgIGlmICgha2JJZCkge1xuICAgICAgcmV0dXJuIGFwaVJlc3BvbnNlKDQwMCwge1xuICAgICAgICBtZXNzYWdlOiBcIk1pc3NpbmcgcmVxdWlyZWQgcXVlcnkgcGFyYW1ldGVyOiBrYklkXCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2N1bWVudHMgPSBhd2FpdCBsaXN0RG9jdW1lbnRzKGtiSWQpO1xuXG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDIwMCwgZG9jdW1lbnRzKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcihcIkVycm9yIGluIGdldC1kb2N1bWVudHMgaGFuZGxlcjpcIiwgZXJyKTtcblxuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6IFwiSW50ZXJuYWwgc2VydmVyIGVycm9yXCIsXG4gICAgICBlcnJvcjogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFwiVW5rbm93biBlcnJvclwiLFxuICAgIH0pO1xuICB9XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb3JlOiBRdWVyeSBhbGwgZG9jdW1lbnRzIGZvciBhIEtub3dsZWRnZUJhc2Vcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsaXN0RG9jdW1lbnRzKFxuICBrbm93bGVkZ2VCYXNlSWQ6IHN0cmluZ1xuKTogUHJvbWlzZTxhbnlbXT4ge1xuICBjb25zdCBpdGVtczogYW55W10gPSBbXTtcbiAgbGV0IEV4Y2x1c2l2ZVN0YXJ0S2V5OiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuXG4gIC8vIFNLIHBhdHRlcm46IFwiS0IjPGtiSWQ+I0RPQyM8aWQ+XCJcbiAgY29uc3Qgc2tQcmVmaXggPSBgS0IjJHtrbm93bGVkZ2VCYXNlSWR9I0RPQyNgO1xuXG4gIGRvIHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChcbiAgICAgIG5ldyBRdWVyeUNvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246XG4gICAgICAgICAgXCIjcGsgPSA6cGtWYWx1ZSBBTkQgYmVnaW5zX3dpdGgoI3NrLCA6c2tQcmVmaXgpXCIsXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xuICAgICAgICAgIFwiI3BrXCI6IFBLX05BTUUsXG4gICAgICAgICAgXCIjc2tcIjogU0tfTkFNRSxcbiAgICAgICAgfSxcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgICAgIFwiOnBrVmFsdWVcIjogXCJET0NVTUVOVFwiLFxuICAgICAgICAgIFwiOnNrUHJlZml4XCI6IHNrUHJlZml4LFxuICAgICAgICB9LFxuICAgICAgICBFeGNsdXNpdmVTdGFydEtleSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGlmIChyZXMuSXRlbXMgJiYgcmVzLkl0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgIGl0ZW1zLnB1c2goLi4ucmVzLkl0ZW1zKTtcbiAgICB9XG5cbiAgICBFeGNsdXNpdmVTdGFydEtleSA9IHJlcy5MYXN0RXZhbHVhdGVkS2V5IGFzXG4gICAgICB8IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgICAgIHwgdW5kZWZpbmVkO1xuICB9IHdoaWxlIChFeGNsdXNpdmVTdGFydEtleSk7XG5cbiAgLy8gRXh0cmFjdCBkb2N1bWVudElkIGZyb20gU0tcbiAgcmV0dXJuIGl0ZW1zLm1hcCgoaXRlbSkgPT4ge1xuICAgIGNvbnN0IHNrID0gaXRlbVtTS19OQU1FXSBhcyBzdHJpbmc7XG4gICAgLy8gRm9ybWF0OiBLQiM8a2JJZD4jRE9DIzxkb2N1bWVudElkPlxuICAgIGNvbnN0IHBhcnRzID0gc2suc3BsaXQoXCIjXCIpO1xuICAgIGNvbnN0IGRvY3VtZW50SWQgPSBwYXJ0c1szXTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5pdGVtLFxuICAgICAgaWQ6IGRvY3VtZW50SWQsXG4gICAgfTtcbiAgfSk7XG59XG4iXX0=