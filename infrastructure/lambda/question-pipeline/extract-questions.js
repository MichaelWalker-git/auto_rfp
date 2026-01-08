"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const bedrock_http_client_1 = require("../helpers/bedrock-http-client");
const organization_1 = require("../constants/organization");
const common_1 = require("../constants/common");
const question_file_1 = require("../constants/question-file");
const ddbClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
});
const s3Client = new client_s3_1.S3Client({});
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;
if (!DB_TABLE_NAME)
    throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME)
    throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');
const handler = async (event, _ctx) => {
    console.log('extract-questions event:', JSON.stringify(event));
    const { questionFileId, projectId, textFileKey } = event;
    if (!questionFileId || !projectId || !textFileKey) {
        throw new Error('questionFileId, projectId, textFileKey are required');
    }
    // 1) Load text from S3
    const text = await loadTextFromS3(textFileKey);
    // 2) Call Bedrock with the same prompt/structure as in the HTTP Lambda
    const extracted = await extractQuestionsWithBedrock(text);
    // 3) Save questions (section + questions) in DynamoDB (linked to this file)
    const totalQuestions = await saveQuestionsFromSections(questionFileId, projectId, extracted);
    // 4) Update status on question_file item
    await updateStatus(questionFileId, projectId, 'questions_extracted', totalQuestions);
    return { count: totalQuestions };
};
exports.handler = handler;
async function loadTextFromS3(key) {
    const res = await s3Client.send(new client_s3_1.GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET_NAME,
        Key: key,
    }));
    const body = await res.Body?.transformToString();
    if (!body) {
        throw new Error(`Failed to read text file from S3: ${key}`);
    }
    return body;
}
async function extractQuestionsWithBedrock(content) {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(content);
    const body = {
        anthropic_version: 'bedrock-2023-05-31',
        system: systemPrompt,
        messages: [
            {
                role: 'user',
                content: userPrompt,
            },
        ],
        max_tokens: 2048,
        temperature: 0.1,
    };
    const responseBody = await (0, bedrock_http_client_1.invokeModel)(BEDROCK_MODEL_ID, JSON.stringify(body), 'application/json', 'application/json');
    const jsonTxt = new TextDecoder('utf-8').decode(responseBody);
    let outer;
    try {
        outer = JSON.parse(jsonTxt);
    }
    catch {
        console.error('Bad response JSON from Bedrock:', jsonTxt);
        throw new Error('Invalid JSON envelope from Bedrock');
    }
    const assistantText = outer?.content?.[0]?.text;
    if (!assistantText) {
        throw new Error('Model returned no text content');
    }
    let parsed;
    try {
        parsed = JSON.parse(assistantText);
    }
    catch (err) {
        console.error('Model output was not JSON:', assistantText);
        throw new Error('Invalid JSON returned by the model');
    }
    if (!Array.isArray(parsed.sections)) {
        throw new Error('Response missing required sections[]');
    }
    return parsed;
}
/**
 * Save all extracted sections + questions for a given project and questionFileId.
 *
 * PK = QUESTION_PK
 * SK = `${projectId}#${questionId}`
 *
 * Дополнительно привязываем к questionFileId и сохраняем section-метаданные.
 */
async function saveQuestionsFromSections(questionFileId, projectId, extracted) {
    const now = new Date().toISOString();
    let count = 0;
    const writes = [];
    for (const section of extracted.sections) {
        for (const q of section.questions) {
            const sortKey = `${projectId}#${q.id}`;
            const item = {
                [common_1.PK_NAME]: organization_1.QUESTION_PK,
                [common_1.SK_NAME]: sortKey,
                projectId,
                questionFileId,
                questionId: q.id,
                questionText: q.question,
                sectionId: section.id,
                sectionTitle: section.title,
                sectionDescription: section.description ?? null,
                createdAt: now,
                updatedAt: now,
            };
            writes.push(docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: DB_TABLE_NAME,
                Item: item,
            })));
            count++;
        }
    }
    await Promise.all(writes);
    return count;
}
async function updateStatus(questionFileId, projectId, status, questionCount) {
    const sk = `${projectId}#${questionFileId}`;
    const updateParts = ['#status = :status', '#updatedAt = :updatedAt'];
    const exprAttrNames = {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
    };
    const exprAttrValues = {
        ':status': status,
        ':updatedAt': new Date().toISOString(),
    };
    if (typeof questionCount === 'number') {
        updateParts.push('#questionCount = :questionCount');
        exprAttrNames['#questionCount'] = 'questionCount';
        exprAttrValues[':questionCount'] = questionCount;
    }
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
            [common_1.PK_NAME]: question_file_1.QUESTION_FILE_PK,
            [common_1.SK_NAME]: sk,
        },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeNames: exprAttrNames,
        ExpressionAttributeValues: exprAttrValues,
    }));
}
/**
 * Копия buildSystemPrompt из второй лямбды
 */
function buildSystemPrompt() {
    const timestamp = Date.now();
    return `
You are an expert at analyzing RFP (Request for Proposal) documents and extracting structured information.
Given a document that contains RFP questions, extract all sections and questions into a structured format.

Carefully identify:
1. Different sections (usually numbered like 1.1, 1.2, etc.)
2. The questions within each section
3. Any descriptive text that provides context for the section

Format the output as a JSON object with the following structure:
{
  "sections": [
    {
      "id": "section_${timestamp}_1",
      "title": "Section Title",
      "description": "Optional description text for the section",
      "questions": [
        {
          "id": "q_${timestamp}_1_1",
          "question": "The exact text of the question"
        }
      ]
    }
  ]
}

Requirements:
- Generate unique reference IDs using the format: q_${timestamp}_<section>_<question> for questions
- Generate unique reference IDs using the format: section_${timestamp}_<number> for sections  
- Preserve the exact text of questions
- Include all questions found in the document
- Group questions correctly under their sections
- If a section has subsections, create separate sections for each subsection
- The timestamp prefix (${timestamp}) ensures uniqueness across different document uploads

Return ONLY the JSON object, with no additional text.
  `.trim();
}
function buildUserPrompt(content) {
    return `Document Content:\n${content}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0cmFjdC1xdWVzdGlvbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJleHRyYWN0LXF1ZXN0aW9ucy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQTBGO0FBQzFGLGtEQUFnRTtBQUNoRSx3RUFBNkQ7QUFFN0QsNERBQXdEO0FBQ3hELGdEQUF1RDtBQUN2RCw4REFBOEQ7QUFFOUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsSUFBSSxFQUFFO0NBQ2pELENBQUMsQ0FBQztBQUVILE1BQU0sUUFBUSxHQUFHLElBQUksb0JBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUVsQyxNQUFNLGdCQUFnQixHQUNwQixPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLHdDQUF3QyxDQUFDO0FBRTNFLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO0FBQ2hELE1BQU0scUJBQXFCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQztBQUVoRSxJQUFJLENBQUMsYUFBYTtJQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQztBQUN4RSxJQUFJLENBQUMscUJBQXFCO0lBQ3hCLE1BQU0sSUFBSSxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztBQW9CdkQsTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUMxQixLQUFZLEVBQ1osSUFBYSxFQUNlLEVBQUU7SUFDOUIsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFFL0QsTUFBTSxFQUFFLGNBQWMsRUFBRSxTQUFTLEVBQUUs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QUFJLENBQ2xCLElBQUksNEJBQWEsQ0FBQztRQUNoQixTQUFTLEVBQUUsYUFBYTtRQUN4QixHQUFHLEVBQUU7WUFDSCxDQUFDLGdCQUFPLENBQUMsRUFBRSxnQ0FBZ0I7WUFDM0IsQ0FBQyxnQkFBTyxDQUFDLEVBQUUsRUFBRTtTQUNkO1FBQ0QsZ0JBQWdCLEVBQUUsT0FBTyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ2pELHdCQUF3QixFQUFFLGFBQWE7UUFDdkMseUJBQXlCLEVBQUUsY0FBYztLQUMxQyxDQUFDLENBQ0gsQ0FBQztBQUNKLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsaUJBQWlCO0lBQ3hCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUM3QixPQUFPOzs7Ozs7Ozs7Ozs7O3VCQWFjLFNBQVM7Ozs7O3FCQUtYLFNBQVM7Ozs7Ozs7OztzREFTd0IsU0FBUzs0REFDSCxTQUFTOzs7OzswQkFLM0MsU0FBUzs7O0dBR2hDLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDWCxDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsT0FBZTtJQUN0QyxPQUFPLHNCQUFzQixPQUFPLEVBQUUsQ0FBQztBQUN6QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgVXBkYXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyBHZXRPYmplY3RDb21tYW5kLCBTM0NsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XG5pbXBvcnQgeyBpbnZva2VNb2RlbCB9IGZyb20gJy4uL2hlbHBlcnMvYmVkcm9jay1odHRwLWNsaWVudCc7XG5cbmltcG9ydCB7IFFVRVNUSU9OX1BLIH0gZnJvbSAnLi4vY29uc3RhbnRzL29yZ2FuaXphdGlvbic7XG5pbXBvcnQgeyBQS19OQU1FLCBTS19OQU1FIH0gZnJvbSAnLi4vY29uc3RhbnRzL2NvbW1vbic7XG5pbXBvcnQgeyBRVUVTVElPTl9GSUxFX1BLIH0gZnJvbSAnLi4vY29uc3RhbnRzL3F1ZXN0aW9uLWZpbGUnO1xuXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGRkYkNsaWVudCwge1xuICBtYXJzaGFsbE9wdGlvbnM6IHsgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlIH0sXG59KTtcblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoe30pO1xuXG5jb25zdCBCRURST0NLX01PREVMX0lEID1cbiAgcHJvY2Vzcy5lbnYuQkVEUk9DS19NT0RFTF9JRCB8fCAnYW50aHJvcGljLmNsYXVkZS0zLWhhaWt1LTIwMjQwMzA3LXYxOjAnO1xuXG5jb25zdCBEQl9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuREJfVEFCTEVfTkFNRTtcbmNvbnN0IERPQ1VNRU5UU19CVUNLRVRfTkFNRSA9IHByb2Nlc3MuZW52LkRPQ1VNRU5UU19CVUNLRVRfTkFNRTtcblxuaWYgKCFEQl9UQUJMRV9OQU1FKSB0aHJvdyBuZXcgRXJyb3IoJ0RCX1RBQkxFX05BTUUgZW52IHZhciBpcyBub3Qgc2V0Jyk7XG5pZiAoIURPQ1VNRU5UU19CVUNLRVRfTkFNRSlcbiAgdGhyb3cgbmV3IEVycm9yKCdET0NVTUVOVFNfQlVDS0VUX05BTUUgZW52IHZhciBpcyBub3Qgc2V0Jyk7XG5cbmludGVyZmFjZSBFdmVudCB7XG4gIHF1ZXN0aW9uRmlsZUlkPzogc3RyaW5nO1xuICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIHRleHRGaWxlS2V5Pzogc3RyaW5nO1xufVxuXG50eXBlIEV4dHJhY3RlZFF1ZXN0aW9ucyA9IHtcbiAgc2VjdGlvbnM6IEFycmF5PHtcbiAgICBpZDogc3RyaW5nO1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmcgfCBudWxsO1xuICAgIHF1ZXN0aW9uczogQXJyYXk8e1xuICAgICAgaWQ6IHN0cmluZztcbiAgICAgIHF1ZXN0aW9uOiBzdHJpbmc7XG4gICAgfT47XG4gIH0+O1xufTtcblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXG4gIGV2ZW50OiBFdmVudCxcbiAgX2N0eDogQ29udGV4dCxcbik6IFByb21pc2U8eyBjb3VudDogbnVtYmVyIH0+ID0+IHtcbiAgY29uc29sZS5sb2coJ2V4dHJhY3QtcXVlc3Rpb25zIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XG5cbiAgY29uc3QgeyBxdWVzdGlvbkZpbGVJZCwgcHJvamVjdElkLCB0ZXh0RmlsZUtleSB9ID0gZXZlbnQ7XG4gIGlmICghcXVlc3Rpb25GaWxlSWQgfHwgIXByb2plY3RJZCB8fCAhdGV4dEZpbGVLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3F1ZXN0aW9uRmlsZUlkLCBwcm9qZWN0SWQsIHRleHRGaWxlS2V5IGFyZSByZXF1aXJlZCcpO1xuICB9XG5cbiAgLy8gMSkgTG9hZCB0ZXh0IGZyb20gUzNcbiAgY29uc3QgdGV4dCA9IGF3YWl0IGxvYWRUZXh0RnJvbVMzKHRleHRGaWxlS2V5KTtcblxuICAvLyAyKSBDYWxsIEJlZHJvY2sgd2l0aCB0aGUgc2FtZSBwcm9tcHQvc3RydWN0dXJlIGFzIGluIHRoZSBIVFRQIExhbWJkYVxuICBjb25zdCBleHRyYWN0ZWQgPSBhd2FpdCBleHRyYWN0UXVlc3Rpb25zV2l0aEJlZHJvY2sodGV4dCk7XG5cbiAgLy8gMykgU2F2ZSBxdWVzdGlvbnMgKHNlY3Rpb24gKyBxdWVzdGlvbnMpIGluIER5bmFtb0RCIChsaW5rZWQgdG8gdGhpcyBmaWxlKVxuICBjb25zdCB0b3RhbFF1ZXN0aW9ucyA9IGF3YWl0IHNhdmVRdWVzdGlvbnNGcm9tU2VjdGlvbnMoXG4gICAgcXVlc3Rpb25GaWxlSWQsXG4gICAgcHJvamVjdElkLFxuICAgIGV4dHJhY3RlZCxcbiAgKTtcblxuICAvLyA0KSBVcGRhdGUgc3RhdHVzIG9uIHF1ZXN0aW9uX2ZpbGUgaXRlbVxuICBhd2FpdCB1cGRhdGVTdGF0dXMocXVlc3Rpb25GaWxlSWQsIHByb2plY3RJZCwgJ3F1ZXN0aW9uc19leHRyYWN0ZWQnLCB0b3RhbFF1ZXN0aW9ucyk7XG5cbiAgcmV0dXJuIHsgY291bnQ6IHRvdGFsUXVlc3Rpb25zIH07XG59O1xuXG5hc3luYyBmdW5jdGlvbiBsb2FkVGV4dEZyb21TMyhrZXk6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IHMzQ2xpZW50LnNlbmQoXG4gICAgbmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgQnVja2V0OiBET0NVTUVOVFNfQlVDS0VUX05BTUUsXG4gICAgICBLZXk6IGtleSxcbiAgICB9KSxcbiAgKTtcblxuICBjb25zdCBib2R5ID0gYXdhaXQgcmVzLkJvZHk/LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gIGlmICghYm9keSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlYWQgdGV4dCBmaWxlIGZyb20gUzM6ICR7a2V5fWApO1xuICB9XG4gIHJldHVybiBib2R5O1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHRyYWN0UXVlc3Rpb25zV2l0aEJlZHJvY2soXG4gIGNvbnRlbnQ6IHN0cmluZyxcbik6IFByb21pc2U8RXh0cmFjdGVkUXVlc3Rpb25zPiB7XG4gIGNvbnN0IHN5c3RlbVByb21wdCA9IGJ1aWxkU3lzdGVtUHJvbXB0KCk7XG4gIGNvbnN0IHVzZXJQcm9tcHQgPSBidWlsZFVzZXJQcm9tcHQoY29udGVudCk7XG5cbiAgY29uc3QgYm9keSA9IHtcbiAgICBhbnRocm9waWNfdmVyc2lvbjogJ2JlZHJvY2stMjAyMy0wNS0zMScsXG4gICAgc3lzdGVtOiBzeXN0ZW1Qcm9tcHQsXG4gICAgbWVzc2FnZXM6IFtcbiAgICAgIHtcbiAgICAgICAgcm9sZTogJ3VzZXInLFxuICAgICAgICBjb250ZW50OiB1c2VyUHJvbXB0LFxuICAgICAgfSxcbiAgICBdLFxuICAgIG1heF90b2tlbnM6IDIwNDgsXG4gICAgdGVtcGVyYXR1cmU6IDAuMSxcbiAgfTtcblxuICBjb25zdCByZXNwb25zZUJvZHkgPSBhd2FpdCBpbnZva2VNb2RlbChcbiAgICBCRURST0NLX01PREVMX0lELFxuICAgIEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAnYXBwbGljYXRpb24vanNvbidcbiAgKTtcblxuICBjb25zdCBqc29uVHh0ID0gbmV3IFRleHREZWNvZGVyKCd1dGYtOCcpLmRlY29kZShyZXNwb25zZUJvZHkpO1xuXG4gIGxldCBvdXRlcjogYW55O1xuICB0cnkge1xuICAgIG91dGVyID0gSlNPTi5wYXJzZShqc29uVHh0KTtcbiAgfSBjYXRjaCB7XG4gICAgY29uc29sZS5lcnJvcignQmFkIHJlc3BvbnNlIEpTT04gZnJvbSBCZWRyb2NrOicsIGpzb25UeHQpO1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBKU09OIGVudmVsb3BlIGZyb20gQmVkcm9jaycpO1xuICB9XG5cbiAgY29uc3QgYXNzaXN0YW50VGV4dCA9IG91dGVyPy5jb250ZW50Py5bMF0/LnRleHQ7XG4gIGlmICghYXNzaXN0YW50VGV4dCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTW9kZWwgcmV0dXJuZWQgbm8gdGV4dCBjb250ZW50Jyk7XG4gIH1cblxuICBsZXQgcGFyc2VkOiBhbnk7XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShhc3Npc3RhbnRUZXh0KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcignTW9kZWwgb3V0cHV0IHdhcyBub3QgSlNPTjonLCBhc3Npc3RhbnRUZXh0KTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgSlNPTiByZXR1cm5lZCBieSB0aGUgbW9kZWwnKTtcbiAgfVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShwYXJzZWQuc2VjdGlvbnMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdSZXNwb25zZSBtaXNzaW5nIHJlcXVpcmVkIHNlY3Rpb25zW10nKTtcbiAgfVxuXG4gIHJldHVybiBwYXJzZWQgYXMgRXh0cmFjdGVkUXVlc3Rpb25zO1xufVxuXG4vKipcbiAqIFNhdmUgYWxsIGV4dHJhY3RlZCBzZWN0aW9ucyArIHF1ZXN0aW9ucyBmb3IgYSBnaXZlbiBwcm9qZWN0IGFuZCBxdWVzdGlvbkZpbGVJZC5cbiAqXG4gKiBQSyA9IFFVRVNUSU9OX1BLXG4gKiBTSyA9IGAke3Byb2plY3RJZH0jJHtxdWVzdGlvbklkfWBcbiAqXG4gKiDQlNC+0L/QvtC70L3QuNGC0LXQu9GM0L3QviDQv9GA0LjQstGP0LfRi9Cy0LDQtdC8INC6IHF1ZXN0aW9uRmlsZUlkINC4INGB0L7RhdGA0LDQvdGP0LXQvCBzZWN0aW9uLdC80LXRgtCw0LTQsNC90L3Ri9C1LlxuICovXG5hc3luYyBmdW5jdGlvbiBzYXZlUXVlc3Rpb25zRnJvbVNlY3Rpb25zKFxuICBxdWVzdGlvbkZpbGVJZDogc3RyaW5nLFxuICBwcm9qZWN0SWQ6IHN0cmluZyxcbiAgZXh0cmFjdGVkOiBFeHRyYWN0ZWRRdWVzdGlvbnMsXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIGxldCBjb3VudCA9IDA7XG5cbiAgY29uc3Qgd3JpdGVzOiBQcm9taXNlPGFueT5bXSA9IFtdO1xuXG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBleHRyYWN0ZWQuc2VjdGlvbnMpIHtcbiAgICBmb3IgKGNvbnN0IHEgb2Ygc2VjdGlvbi5xdWVzdGlvbnMpIHtcbiAgICAgIGNvbnN0IHNvcnRLZXkgPSBgJHtwcm9qZWN0SWR9IyR7cS5pZH1gO1xuXG4gICAgICBjb25zdCBpdGVtID0ge1xuICAgICAgICBbUEtfTkFNRV06IFFVRVNUSU9OX1BLLFxuICAgICAgICBbU0tfTkFNRV06IHNvcnRLZXksXG4gICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgcXVlc3Rpb25GaWxlSWQsXG4gICAgICAgIHF1ZXN0aW9uSWQ6IHEuaWQsXG4gICAgICAgIHF1ZXN0aW9uVGV4dDogcS5xdWVzdGlvbixcbiAgICAgICAgc2VjdGlvbklkOiBzZWN0aW9uLmlkLFxuICAgICAgICBzZWN0aW9uVGl0bGU6IHNlY3Rpb24udGl0bGUsXG4gICAgICAgIHNlY3Rpb25EZXNjcmlwdGlvbjogc2VjdGlvbi5kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgICAgICBjcmVhdGVkQXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZEF0OiBub3csXG4gICAgICB9O1xuXG4gICAgICB3cml0ZXMucHVzaChcbiAgICAgICAgZG9jQ2xpZW50LnNlbmQoXG4gICAgICAgICAgbmV3IFB1dENvbW1hbmQoe1xuICAgICAgICAgICAgVGFibGVOYW1lOiBEQl9UQUJMRV9OQU1FLFxuICAgICAgICAgICAgSXRlbTogaXRlbSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgKSxcbiAgICAgICk7XG5cbiAgICAgIGNvdW50Kys7XG4gICAgfVxuICB9XG5cbiAgYXdhaXQgUHJvbWlzZS5hbGwod3JpdGVzKTtcbiAgcmV0dXJuIGNvdW50O1xufVxuXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVTdGF0dXMoXG4gIHF1ZXN0aW9uRmlsZUlkOiBzdHJpbmcsXG4gIHByb2plY3RJZDogc3RyaW5nLFxuICBzdGF0dXM6ICdwcm9jZXNzaW5nJyB8ICd0ZXh0X3JlYWR5JyB8ICdxdWVzdGlvbnNfZXh0cmFjdGVkJyB8ICdlcnJvcicsXG4gIHF1ZXN0aW9uQ291bnQ/OiBudW1iZXIsXG4pIHtcbiAgY29uc3Qgc2sgPSBgJHtwcm9qZWN0SWR9IyR7cXVlc3Rpb25GaWxlSWR9YDtcblxuICBjb25zdCB1cGRhdGVQYXJ0czogc3RyaW5nW10gPSBbJyNzdGF0dXMgPSA6c3RhdHVzJywgJyN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0J107XG4gIGNvbnN0IGV4cHJBdHRyTmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcbiAgICAnI3VwZGF0ZWRBdCc6ICd1cGRhdGVkQXQnLFxuICB9O1xuICBjb25zdCBleHByQXR0clZhbHVlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAnOnN0YXR1cyc6IHN0YXR1cyxcbiAgICAnOnVwZGF0ZWRBdCc6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgfTtcblxuICBpZiAodHlwZW9mIHF1ZXN0aW9uQ291bnQgPT09ICdudW1iZXInKSB7XG4gICAgdXBkYXRlUGFydHMucHVzaCgnI3F1ZXN0aW9uQ291bnQgPSA6cXVlc3Rpb25Db3VudCcpO1xuICAgIGV4cHJBdHRyTmFtZXNbJyNxdWVzdGlvbkNvdW50J10gPSAncXVlc3Rpb25Db3VudCc7XG4gICAgZXhwckF0dHJWYWx1ZXNbJzpxdWVzdGlvbkNvdW50J10gPSBxdWVzdGlvbkNvdW50O1xuICB9XG5cbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQoXG4gICAgbmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiBEQl9UQUJMRV9OQU1FLFxuICAgICAgS2V5OiB7XG4gICAgICAgIFtQS19OQU1FXTogUVVFU1RJT05fRklMRV9QSyxcbiAgICAgICAgW1NLX05BTUVdOiBzayxcbiAgICAgIH0sXG4gICAgICBVcGRhdGVFeHByZXNzaW9uOiBgU0VUICR7dXBkYXRlUGFydHMuam9pbignLCAnKX1gLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiBleHByQXR0ck5hbWVzLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczogZXhwckF0dHJWYWx1ZXMsXG4gICAgfSksXG4gICk7XG59XG5cbi8qKlxuICog0JrQvtC/0LjRjyBidWlsZFN5c3RlbVByb21wdCDQuNC3INCy0YLQvtGA0L7QuSDQu9GP0LzQsdC00YtcbiAqL1xuZnVuY3Rpb24gYnVpbGRTeXN0ZW1Qcm9tcHQoKTogc3RyaW5nIHtcbiAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5ub3coKTtcbiAgcmV0dXJuIGBcbllvdSBhcmUgYW4gZXhwZXJ0IGF0IGFuYWx5emluZyBSRlAgKFJlcXVlc3QgZm9yIFByb3Bvc2FsKSBkb2N1bWVudHMgYW5kIGV4dHJhY3Rpbmcgc3RydWN0dXJlZCBpbmZvcm1hdGlvbi5cbkdpdmVuIGEgZG9jdW1lbnQgdGhhdCBjb250YWlucyBSRlAgcXVlc3Rpb25zLCBleHRyYWN0IGFsbCBzZWN0aW9ucyBhbmQgcXVlc3Rpb25zIGludG8gYSBzdHJ1Y3R1cmVkIGZvcm1hdC5cblxuQ2FyZWZ1bGx5IGlkZW50aWZ5OlxuMS4gRGlmZmVyZW50IHNlY3Rpb25zICh1c3VhbGx5IG51bWJlcmVkIGxpa2UgMS4xLCAxLjIsIGV0Yy4pXG4yLiBUaGUgcXVlc3Rpb25zIHdpdGhpbiBlYWNoIHNlY3Rpb25cbjMuIEFueSBkZXNjcmlwdGl2ZSB0ZXh0IHRoYXQgcHJvdmlkZXMgY29udGV4dCBmb3IgdGhlIHNlY3Rpb25cblxuRm9ybWF0IHRoZSBvdXRwdXQgYXMgYSBKU09OIG9iamVjdCB3aXRoIHRoZSBmb2xsb3dpbmcgc3RydWN0dXJlOlxue1xuICBcInNlY3Rpb25zXCI6IFtcbiAgICB7XG4gICAgICBcImlkXCI6IFwic2VjdGlvbl8ke3RpbWVzdGFtcH1fMVwiLFxuICAgICAgXCJ0aXRsZVwiOiBcIlNlY3Rpb24gVGl0bGVcIixcbiAgICAgIFwiZGVzY3JpcHRpb25cIjogXCJPcHRpb25hbCBkZXNjcmlwdGlvbiB0ZXh0IGZvciB0aGUgc2VjdGlvblwiLFxuICAgICAgXCJxdWVzdGlvbnNcIjogW1xuICAgICAgICB7XG4gICAgICAgICAgXCJpZFwiOiBcInFfJHt0aW1lc3RhbXB9XzFfMVwiLFxuICAgICAgICAgIFwicXVlc3Rpb25cIjogXCJUaGUgZXhhY3QgdGV4dCBvZiB0aGUgcXVlc3Rpb25cIlxuICAgICAgICB9XG4gICAgICBdXG4gICAgfVxuICBdXG59XG5cblJlcXVpcmVtZW50czpcbi0gR2VuZXJhdGUgdW5pcXVlIHJlZmVyZW5jZSBJRHMgdXNpbmcgdGhlIGZvcm1hdDogcV8ke3RpbWVzdGFtcH1fPHNlY3Rpb24+XzxxdWVzdGlvbj4gZm9yIHF1ZXN0aW9uc1xuLSBHZW5lcmF0ZSB1bmlxdWUgcmVmZXJlbmNlIElEcyB1c2luZyB0aGUgZm9ybWF0OiBzZWN0aW9uXyR7dGltZXN0YW1wfV88bnVtYmVyPiBmb3Igc2VjdGlvbnMgIFxuLSBQcmVzZXJ2ZSB0aGUgZXhhY3QgdGV4dCBvZiBxdWVzdGlvbnNcbi0gSW5jbHVkZSBhbGwgcXVlc3Rpb25zIGZvdW5kIGluIHRoZSBkb2N1bWVudFxuLSBHcm91cCBxdWVzdGlvbnMgY29ycmVjdGx5IHVuZGVyIHRoZWlyIHNlY3Rpb25zXG4tIElmIGEgc2VjdGlvbiBoYXMgc3Vic2VjdGlvbnMsIGNyZWF0ZSBzZXBhcmF0ZSBzZWN0aW9ucyBmb3IgZWFjaCBzdWJzZWN0aW9uXG4tIFRoZSB0aW1lc3RhbXAgcHJlZml4ICgke3RpbWVzdGFtcH0pIGVuc3VyZXMgdW5pcXVlbmVzcyBhY3Jvc3MgZGlmZmVyZW50IGRvY3VtZW50IHVwbG9hZHNcblxuUmV0dXJuIE9OTFkgdGhlIEpTT04gb2JqZWN0LCB3aXRoIG5vIGFkZGl0aW9uYWwgdGV4dC5cbiAgYC50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkVXNlclByb21wdChjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYERvY3VtZW50IENvbnRlbnQ6XFxuJHtjb250ZW50fWA7XG59Il19