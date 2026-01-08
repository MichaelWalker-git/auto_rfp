"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const bedrock_http_client_1 = require("../helpers/bedrock-http-client");
const client_s3_1 = require("@aws-sdk/client-s3");
const signature_v4_1 = require("@aws-sdk/signature-v4");
const sha256_js_1 = require("@aws-crypto/sha256-js");
const credential_provider_node_1 = require("@aws-sdk/credential-provider-node");
const protocol_http_1 = require("@aws-sdk/protocol-http");
const https_1 = __importDefault(require("https"));
const crypto_1 = require("crypto");
const api_1 = require("../helpers/api");
const common_1 = require("../constants/common");
const document_1 = require("../constants/document");
const embeddings_1 = require("../helpers/embeddings");
const organization_1 = require("../constants/organization");
const ddbClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
});
const s3Client = new client_s3_1.S3Client({});
const REGION = process.env.REGION ||
    process.env.AWS_REGION ||
    process.env.BEDROCK_REGION ||
    'us-east-1';
const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const BEDROCK_EMBEDDING_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;
if (!DB_TABLE_NAME) {
    throw new Error('DB_TABLE_NAME env var is not set');
}
if (!DOCUMENTS_BUCKET) {
    throw new Error('DOCUMENTS_BUCKET env var is not set');
}
if (!OPENSEARCH_ENDPOINT) {
    throw new Error('OPENSEARCH_ENDPOINT env var is not set');
}
async function streamToString(stream) {
    return await new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });
    });
}
// --- Helper: semantic search in OpenSearch ---
async function semanticSearchDocuments(embedding, indexName, k) {
    const endpointUrl = new URL(OPENSEARCH_ENDPOINT);
    const payload = JSON.stringify({
        size: k,
        query: {
            knn: {
                embedding: {
                    vector: embedding,
                    k,
                },
            },
        },
        _source: ['documentId'],
    });
    const request = new protocol_http_1.HttpRequest({
        method: 'POST',
        protocol: endpointUrl.protocol,
        hostname: endpointUrl.hostname,
        path: `/${indexName}/_search`,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload).toString(),
            host: endpointUrl.hostname,
        },
        body: payload,
    });
    const signer = new signature_v4_1.SignatureV4({
        service: 'aoss',
        region: REGION,
        credentials: (0, credential_provider_node_1.defaultProvider)(),
        sha256: sha256_js_1.Sha256,
    });
    const signed = await signer.sign(request);
    const bodyStr = await new Promise((resolve, reject) => {
        const req = https_1.default.request({
            method: signed.method,
            hostname: signed.hostname,
            path: signed.path,
            headers: signed.headers,
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(text);
                }
                else {
                    reject(new Error(`OpenSearch search error: ${res.statusCode} ${res.statusMessage} - ${text}`));
                }
            });
        });
        req.on('error', reject);
        if (signed.body) {
            req.write(signed.body);
        }
        req.end();
    });
    const json = JSON.parse(bodyStr);
    const hits = json.hits?.hits ?? [];
    return hits;
}
// --- Helper: find DocumentItem in Dynamo by documentId (PK = DOCUMENT_PK, SK endsWith "#DOC#<id>") ---
async function getDocumentItemById(documentId) {
    const skSuffix = `#DOC#${documentId}`;
    const queryRes = await docClient.send(new lib_dynamodb_1.QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: {
            '#pk': common_1.PK_NAME,
        },
        ExpressionAttributeValues: {
            ':pk': document_1.DOCUMENT_PK,
        },
    }));
    const items = (queryRes.Items || []);
    const docItem = items.find((it) => String(it[common_1.SK_NAME]).endsWith(skSuffix));
    if (!docItem) {
        throw new Error(`Document not found for PK=${document_1.DOCUMENT_PK} and SK ending with ${skSuffix}`);
    }
    return docItem;
}
// --- Helper: load document text from S3 via textFileKey (fallback to fileKey) ---
async function loadDocumentText(docItem) {
    const textKey = docItem.textFileKey || docItem.fileKey;
    if (!textKey) {
        throw new Error('Document has no textFileKey or fileKey');
    }
    const res = await s3Client.send(new client_s3_1.GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: textKey,
    }));
    if (!res.Body) {
        throw new Error(`S3 object ${textKey} has no body`);
    }
    const text = await streamToString(res.Body);
    return text;
}
// --- Helper: load question by questionId from Dynamo ---
async function getQuestionItemById(projectId, questionId) {
    const res = await docClient.send(new lib_dynamodb_1.GetCommand({
        TableName: DB_TABLE_NAME,
        Key: {
            [common_1.PK_NAME]: organization_1.QUESTION_PK,
            [common_1.SK_NAME]: `${projectId}#${questionId}`,
        },
    }));
    if (!res.Item) {
        throw new Error(`Question not found for PK=${organization_1.QUESTION_PK}, SK=${questionId}`);
    }
    const item = res.Item;
    if (!item.questionText) {
        throw new Error(`Question item for SK=${questionId} has no "question" field`);
    }
    return item;
}
async function answerWithBedrockLLM(question, docText) {
    const systemPrompt = `
You are an assistant that answers questions strictly based on the provided document.

Rules:
- If the document does not contain the answer, you MUST set "found" to false and "answer" to an empty string.
- Do NOT invent or guess information that is not clearly supported by the document.
- Do NOT repeat the question in the answer.
- Do NOT begin with, based on ..., just answer.
- Answer concisely, without unnecessary "water" or filler.

Output format:
Return ONLY a single JSON object, no additional text, in this exact shape:

{"answer":"string","confidence":0.0,"found":true}

Where:
- "answer" is the final answer text when found=true, otherwise an empty string "".
- "confidence" is a number between 0.0 and 1.0 that reflects how sure you are based on the document.
- "found" is:
  - true  — when the answer is clearly supported by the document;
  - false — when the answer cannot be found in the document or is too uncertain.
`.trim();
    const userPrompt = [
        'Document:',
        '"""',
        docText,
        '"""',
        '',
        `Question: ${question}`,
    ].join('\n');
    const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 512,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
            {
                role: 'user',
                content: [{ type: 'text', text: userPrompt }],
            },
        ],
    };
    const responseBody = await (0, bedrock_http_client_1.invokeModel)(BEDROCK_MODEL_ID, JSON.stringify(payload), 'application/json', 'application/json');
    const raw = new TextDecoder('utf-8').decode(responseBody);
    console.log('Raw: ', raw);
    let outer;
    try {
        outer = JSON.parse(raw);
    }
    catch (err) {
        console.error('Invalid JSON envelope from Bedrock:', raw);
        throw new Error('Invalid JSON envelope from Bedrock');
    }
    const text = outer?.content?.[0]?.text;
    if (!text) {
        console.error('Unexpected QA response structure:', JSON.stringify(outer).slice(0, 500));
        throw new Error('Model returned no text content');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Model output does not contain a JSON object');
    }
    const slice = text.slice(start, end + 1);
    const parsed = JSON.parse(slice.replace(/\n/g, '\\n'));
    const result = {
        answer: typeof parsed.answer === 'string' ? parsed.answer : '',
        confidence: typeof parsed.confidence === 'number'
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0,
        found: typeof parsed.found === 'boolean' ? parsed.found : false,
    };
    if (!result.found) {
        result.answer = '';
    }
    return result;
}
async function storeAnswer(documentId, question, answer, confidence, found, existingQuestionId) {
    const now = new Date().toISOString();
    const questionId = existingQuestionId ?? (0, crypto_1.randomUUID)();
    const item = {
        [common_1.PK_NAME]: 'ANSWER',
        [common_1.SK_NAME]: `DOC#${documentId}#Q#${questionId}`,
        questionId,
        documentId,
        question,
        answer,
        createdAt: now,
        confidence,
        found,
    };
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: DB_TABLE_NAME,
        Item: item,
    }));
    return {
        questionId,
        documentId,
        question,
        answer,
        createdAt: now,
        confidence,
        found,
    };
}
const handler = async (event) => {
    console.log('answer-question event:', JSON.stringify(event));
    if (!event.body) {
        return (0, api_1.apiResponse)(400, { message: 'Request body is required' });
    }
    let body;
    try {
        body = JSON.parse(event.body);
    }
    catch {
        return (0, api_1.apiResponse)(400, { message: 'Invalid JSON body' });
    }
    const topK = body.topK && body.topK > 0 ? body.topK : 3;
    let questionText;
    const { questionId, projectId } = body;
    try {
        // 0) Resolve question text:
        //    - If questionId is provided: load from Dynamo
        //    - Else: fallback to raw question text from body
        if (questionId) {
            const questionItem = await getQuestionItemById(projectId, questionId);
            questionText = questionItem.questionText;
            console.log(`Loaded question from Dynamo. questionId=${questionId}, question="${questionText}"`);
        }
        else {
            questionText = body.question?.trim();
            if (!questionText) {
                return (0, api_1.apiResponse)(400, {
                    message: 'Either questionId (preferred) or question text must be provided',
                });
            }
            // no questionId provided => we will generate one when storing answer
            console.log(`Using inline question from request. question="${questionText}"`);
        }
        // 1) Embed question text
        // Note: getEmbedding now uses invokeModel internally, no need to pass client
        const questionEmbedding = await (0, embeddings_1.getEmbedding)(null, // bedrockClient no longer needed but signature maintained for compatibility
        BEDROCK_EMBEDDING_MODEL_ID, questionText);
        // 2) Semantic search in OpenSearch (index "documents")
        const hits = await semanticSearchDocuments(questionEmbedding, 'documents', topK);
        console.log('Hits:', JSON.stringify(hits));
        if (!hits.length) {
            return (0, api_1.apiResponse)(404, {
                message: 'No matching documents found for this question',
            });
        }
        const documentId = hits[0]._source?.documentId || '';
        // 3) Load document metadata from DynamoDB, then text from S3
        const topTexts = await mergeAllTexts("", hits);
        console.log('Question and doc text', questionText, topTexts);
        // 4) Ask Bedrock LLM
        const { answer, confidence, found } = await answerWithBedrockLLM(questionText, topTexts);
        // 5) Store Q&A in Dynamo (re-use questionId if we had one)
        const qaItem = await storeAnswer(documentId, questionText, answer || '', confidence || 0, found || false, questionId);
        // 6) Return response
        return (0, api_1.apiResponse)(200, {
            documentId,
            questionId: qaItem.questionId,
            answer,
            confidence,
            found,
        });
    }
    catch (err) {
        console.error('Error in answer-question handler:', err);
        return (0, api_1.apiResponse)(500, {
            message: 'Failed to answer question',
            error: err instanceof Error ? err.message : 'Unknown error',
        });
    }
};
exports.handler = handler;
const mergeAllTexts = async (acc, hits) => {
    if (!hits.length) {
        return acc;
    }
    const [first, ...rest] = hits;
    const documentId = first._source?.documentId;
    if (!documentId) {
        return mergeAllTexts(acc, rest);
    }
    const docItem = await getDocumentItemById(documentId);
    const docText = await loadDocumentText(docItem);
    return mergeAllTexts(`${acc}\n${docText}`, rest);
};
function extractValidJson(text) {
    // 1. Find JSON boundaries
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
        throw new Error("Model response contains no JSON object");
    }
    // 2. Slice raw JSON
    let jsonSlice = text.slice(start, end + 1);
    // 3. Replace *illegal* bare newlines inside quotes with escaped ones
    jsonSlice = jsonSlice.replace(/"\s*([^"]*?)\n([^"]*?)\s*"/g, (match) => {
        return match.replace(/\n/g, "\\n");
    });
    // 4. Now parse safely
    try {
        return JSON.parse(jsonSlice);
    }
    catch (err) {
        console.error("Failed JSON:", jsonSlice);
        throw err;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGUtYW5zd2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZ2VuZXJhdGUtYW5zd2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUVBLDhEQUEwRDtBQUMxRCx3REFBc0c7QUFFdEcsd0VBQTZEO0FBRTdELGtEQUFnRTtBQUVoRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFDckQsa0RBQTBCO0FBQzFCLG1DQUFvQztBQUVwQyx3Q0FBNkM7QUFDN0MsZ0RBQXVEO0FBQ3ZELG9EQUFvRDtBQUVwRCxzREFBcUQ7QUFDckQsNERBQXdEO0FBRXhELE1BQU0sU0FBUyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN6QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO0lBQ3ZELGVBQWUsRUFBRSxFQUFFLHFCQUFxQixFQUFFLElBQUksRUFBRTtDQUNqRCxDQUFDLENBQUM7QUFFSCxNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7QUFFbEMsTUFBTSxNQUFNLEdBQ1YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNO0lBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVTtJQUN0QixPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWM7SUFDMUIsV0FBVyxDQUFDO0FBRWQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7QUFDaEQsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDO0FBQ3RELE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztBQUU1RCxNQUFNLDBCQUEwQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLElBQUksOEJBQThCLENBQUM7QUFFNUcsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDO0FBRXRELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUM7QUFDdEQsQ0FBQztBQUNELElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO0lBQ3RCLE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQztBQUN6RCxDQUFDO0FBQ0QsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7SUFDekIsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO0FBQzVELENBQUM7QUF3Q0QsS0FBSyxVQUFVLGNBQWMsQ0FBQyxNQUFXO0lBQ3ZDLE9BQU8sTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUMzQyxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7UUFDNUIsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFhLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUN6RCxNQUFNLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUMzQixNQUFNLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUU7WUFDcEIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDbkQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxnREFBZ0Q7QUFDaEQsS0FBSyxVQUFVLHVCQUF1QixDQUNwQyxTQUFtQixFQUNuQixTQUFpQixFQUNqQixDQUFTO0lBRVQsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsbUJBQW9CLENBQUMsQ0FBQztJQUNsRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBQzdCLElBQUksRUFBRSxDQUFDO1FBQ1AsS0FBSyxFQUFFO1lBQ0wsR0FBRyxFQUFFO2dCQUNILFNBQVMsRUFBRTtvQkFDVCxNQUFNLEVBQUUsU0FBUztvQkFDakIsQ0FBQztpQkFDRjthQUNGO1NBQ0Y7UUFDRCxPQUFPLEVBQUUsQ0FBQyxZQUFZLENBQUM7S0FDeEIsQ0FBQyxDQUFDO0lBRUgsTUFBTSxPQUFPLEdBQUcsSUFBSSwyQkFBVyxDQUFDO1FBQzlCLE1BQU0sRUFBRSxNQUFNO1FBQ2QsUUFBUSxFQUFFLFdBQVcsQ0FBQyxRQUFRO1FBQzlCLFFBQVEsRUFBRSxXQUFXLENBQUMsUUFBUTtRQUM5QixJQUFJLEVBQUUsSUFBSSxTQUFTLFVBQVU7UUFDN0IsT0FBTyxFQUFFO1lBQ1AsY0FBYyxFQUFFLGtCQUFrQjtZQUNsQyxnQkFBZ0IsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsRUFBRTtZQUN2RCxJQUFJLEVBQUUsV0FBVyxDQUFDLFFBQVE7U0FDM0I7UUFDRCxJQUFJLEVBQUUsT0FBTztLQUNkLENBQUMsQ0FBQztJQUVILE1BQU0sTUFBTSxHQUFHLElBQUksMEJBQVcsQ0FBQztRQUM3QixPQUFPLEVBQUUsTUFBTTtRQUNmLE1BQU0sRUFBRSxNQUFNO1FBQ2QsV0FBVyxFQUFFLElBQUEsMENBQWUsR0FBRTtRQUM5QixNQUFNLEVBQUUsa0JBQU07S0FDZixDQUFDLENBQUM7SUFFSCxNQUFNLE1BQU0sR0FBRyxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFMUMsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLE9BQU8sQ0FBUyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUM1RCxNQUFNLEdBQUcsR0FBRyxlQUFLLENBQUMsT0FBTyxDQUN2QjtZQUNFLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTtZQUNyQixRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7WUFDekIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJO1lBQ2pCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBYztTQUMvQixFQUNELENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDTixNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7WUFDNUIsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUM5QyxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUU7Z0JBQ2pCLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUNyRCxJQUFJLEdBQUcsQ0FBQyxVQUFVLElBQUksR0FBRyxDQUFDLFVBQVUsSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsR0FBRyxHQUFHLEVBQUUsQ0FBQztvQkFDcEUsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNoQixDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxDQUNKLElBQUksS0FBSyxDQUNQLDRCQUE0QixHQUFHLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQyxhQUFhLE1BQU0sSUFBSSxFQUFFLENBQzVFLENBQ0YsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQ0YsQ0FBQztRQUVGLEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3hCLElBQUksTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2hCLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3pCLENBQUM7UUFDRCxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDWixDQUFDLENBQUMsQ0FBQztJQUVILE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsTUFBTSxJQUFJLEdBQW9CLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQztJQUNwRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFFRCx3R0FBd0c7QUFFeEcsS0FBSyxVQUFVLG1CQUFtQixDQUNoQyxVQUFrQjtJQU9sQixNQUFNLFFBQVEsR0FBRyxRQUFRLFVBQVUsRUFBRSxDQUFDO0lBRXRDLE1BQU0sUUFBUSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDbkMsSUFBSSwyQkFBWSxDQUFDO1FBQ2YsU0FBUyxFQUFFLGFBQWE7UUFDeEIsc0JBQXNCLEVBQUUsV0FBVztRQUNuQyx3QkFBd0IsRUFBRTtZQUN4QixLQUFLLEVBQUUsZ0JBQU87U0FDZjtRQUNELHlCQUF5QixFQUFFO1lBQ3pCLEtBQUssRUFBRSxzQkFBVztTQUNuQjtLQUNGLENBQUMsQ0FDSCxDQUFDO0lBRUYsTUFBTSxLQUFLLEdBQ1QsQ0FBQyxRQUFRLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FHakIsQ0FBQztJQUVQLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUNoQyxNQUFNLENBQUMsRUFBRSxDQUFDLGdCQUFPLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FDdkMsQ0FBQztJQUVGLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNiLE1BQU0sSUFBSSxLQUFLLENBQ2IsNkJBQTZCLHNCQUFXLHVCQUF1QixRQUFRLEVBQUUsQ0FDMUUsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPLE9BQU8sQ0FBQztBQUNqQixDQUFDO0FBRUQsbUZBQW1GO0FBRW5GLEtBQUssVUFBVSxnQkFBZ0IsQ0FBQyxPQUFxQjtJQUNuRCxNQUFNLE9BQU8sR0FBSSxPQUFlLENBQUMsV0FBVyxJQUFLLE9BQWUsQ0FBQyxPQUFPLENBQUM7SUFDekUsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2IsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQzdCLElBQUksNEJBQWdCLENBQUM7UUFDbkIsTUFBTSxFQUFFLGdCQUFnQjtRQUN4QixHQUFHLEVBQUUsT0FBTztLQUNiLENBQUMsQ0FDSCxDQUFDO0lBRUYsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxPQUFPLGNBQWMsQ0FBQyxDQUFDO0lBQ3RELENBQUM7SUFFRCxNQUFNLElBQUksR0FBRyxNQUFNLGNBQWMsQ0FBQyxHQUFHLENBQUMsSUFBVyxDQUFDLENBQUM7SUFDbkQsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDO0FBRUQsMERBQTBEO0FBRTFELEtBQUssVUFBVSxtQkFBbUIsQ0FDaEMsU0FBaUIsRUFDakIsVUFBa0I7SUFFbEIsTUFBTSxHQUFHLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUM5QixJQUFJLHlCQUFVLENBQUM7UUFDYixTQUFTLEVBQUUsYUFBYTtRQUN4QixHQUFHLEVBQUU7WUFDSCxDQUFDLGdCQUFPLENBQUMsRUFBRSwwQkFBVztZQUN0QixDQUFDLGdCQUFPLENBQUMsRUFBRSxHQUFHLFNBQVMsSUFBSSxVQUFVLEVBQUU7U0FDeEM7S0FDRixDQUFDLENBQ0gsQ0FBQztJQUVGLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDZCxNQUFNLElBQUksS0FBSyxDQUNiLDZCQUE2QiwwQkFBVyxRQUFRLFVBQVUsRUFBRSxDQUM3RCxDQUFDO0lBQ0osQ0FBQztJQUVELE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxJQUEwQixDQUFDO0lBRTVDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDdkIsTUFBTSxJQUFJLEtBQUssQ0FDYix3QkFBd0IsVUFBVSwwQkFBMEIsQ0FDN0QsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFFRCxLQUFLLFVBQVUsb0JBQW9CLENBQ2pDLFFBQWdCLEVBQ2hCLE9BQWU7SUFFZixNQUFNLFlBQVksR0FBRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBcUJ0QixDQUFDLElBQUksRUFBRSxDQUFDO0lBRVAsTUFBTSxVQUFVLEdBQUc7UUFDakIsV0FBVztRQUNYLEtBQUs7UUFDTCxPQUFPO1FBQ1AsS0FBSztRQUNMLEVBQUU7UUFDRixhQUFhLFFBQVEsRUFBRTtLQUN4QixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUViLE1BQU0sT0FBTyxHQUFHO1FBQ2QsaUJBQWlCLEVBQUUsb0JBQW9CO1FBQ3ZDLFVBQVUsRUFBRSxHQUFHO1FBQ2YsV0FBVyxFQUFFLEdBQUc7UUFDaEIsTUFBTSxFQUFFLFlBQVk7UUFDcEIsUUFBUSxFQUFFO1lBQ1I7Z0JBQ0UsSUFBSSxFQUFFLE1BQU07Z0JBQ1osT0FBTyxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsQ0FBQzthQUM5QztTQUNGO0tBQ0YsQ0FBQztJQUVGLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBQSxpQ0FBVyxFQUNwQyxnQkFBaUIsRUFDakIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsRUFDdkIsa0JBQWtCLEVBQ2xCLGtCQUFrQixDQUNuQixDQUFDO0lBRUYsTUFBTSxHQUFHLEdBQUcsSUFBSSxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBRTFELE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0lBRXpCLElBQUksS0FBVSxDQUFDO0lBQ2YsSUFBSSxDQUFDO1FBQ0gsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDMUIsQ0FBQztJQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7UUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLHFDQUFxQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQztJQUN4RCxDQUFDO0lBRUQsTUFBTSxJQUFJLEdBQXVCLEtBQUssRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUM7SUFDM0QsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ1YsT0FBTyxDQUFDLEtBQUssQ0FBQyxtQ0FBbUMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUN4RixNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDaEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNsQyxJQUFJLEtBQUssS0FBSyxDQUFDLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLElBQUksR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQy9DLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQztJQUNqRSxDQUFDO0lBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBRXpDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztJQUV2RCxNQUFNLE1BQU0sR0FBb0I7UUFDOUIsTUFBTSxFQUFFLE9BQU8sTUFBTSxDQUFDLE1BQU0sS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUU7UUFDOUQsVUFBVSxFQUNSLE9BQU8sTUFBTSxDQUFDLFVBQVUsS0FBSyxRQUFRO1lBQ25DLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDN0MsQ0FBQyxDQUFDLENBQUM7UUFDUCxLQUFLLEVBQUUsT0FBTyxNQUFNLENBQUMsS0FBSyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSztLQUNoRSxDQUFDO0lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNsQixNQUFNLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNyQixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQztBQUVELEtBQUssVUFBVSxXQUFXLENBQ3hCLFVBQWtCLEVBQ2xCLFFBQWdCLEVBQ2hCLE1BQWMsRUFDZCxVQUFrQixFQUNsQixLQUFjLEVBQ2Qsa0JBQTJCO0lBRTNCLE1BQU0sR0FBRyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDckMsTUFBTSxVQUFVLEdBQUcsa0JBQWtCLElBQUksSUFBQSxtQkFBVSxHQUFFLENBQUM7SUFFdEQsTUFBTSxJQUFJLEdBR047UUFDRixDQUFDLGdCQUFPLENBQUMsRUFBRSxRQUFRO1FBQ25CLENBQUMsZ0JBQU8sQ0FBQyxFQUFFLE9BQU8sVUFBVSxNQUFNLFVBQVUsRUFBRTtRQUM5QyxVQUFVO1FBQ1YsVUFBVTtRQUNWLFFBQVE7UUFDUixNQUFNO1FBQ04sU0FBUyxFQUFFLEdBQUc7UUFDZCxVQUFVO1FBQ1YsS0FBSztLQUNOLENBQUM7SUFFRixNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQ2xCLElBQUkseUJBQVUsQ0FBQztRQUNiLFNBQVMsRUFBRSxhQUFhO1FBQ3hCLElBQUksRUFBRSxJQUFJO0tBQ1gsQ0FBQyxDQUNILENBQUM7SUFFRixPQUFPO1FBQ0wsVUFBVTtRQUNWLFVBQVU7UUFDVixRQUFRO1FBQ1IsTUFBTTtRQUNOLFNBQVMsRUFBRSxHQUFHO1FBQ2QsVUFBVTtRQUNWLEtBQUs7S0FDTixDQUFDO0FBQ0osQ0FBQztBQUVNLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBNkIsRUFDSyxFQUFFO0lBQ3BDLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBRTdELElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDaEIsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLDBCQUEwQixFQUFFLENBQUMsQ0FBQztJQUNuRSxDQUFDO0lBRUQsSUFBSSxJQUErQixDQUFDO0lBQ3BDLElBQUksQ0FBQztRQUNILElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNoQyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLG1CQUFtQixFQUFFLENBQUMsQ0FBQztJQUM1RCxDQUFDO0lBRUQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXhELElBQUksWUFBZ0MsQ0FBQztJQUNyQyxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUd2QyxJQUFJLENBQUM7UUFDSCw0QkFBNEI7UUFDNUIsbURBQW1EO1FBQ25ELHFEQUFxRDtRQUNyRCxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2YsTUFBTSxZQUFZLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFDdEUsWUFBWSxHQUFHLFlBQVksQ0FBQyxZQUFZLENBQUM7WUFDekMsT0FBTyxDQUFDLEdBQUcsQ0FDVCwyQ0FBMkMsVUFBVSxlQUFlLFlBQVksR0FBRyxDQUNwRixDQUFDO1FBQ0osQ0FBQzthQUFNLENBQUM7WUFDTixZQUFZLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQztZQUNyQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQ2xCLE9BQU8sSUFBQSxpQkFBVyxFQUFDLEdBQUcsRUFBRTtvQkFDdEIsT0FBTyxFQUNMLGlFQUFpRTtpQkFDcEUsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztZQUNELHFFQUFxRTtZQUNyRSxPQUFPLENBQUMsR0FBRyxDQUNULGlEQUFpRCxZQUFZLEdBQUcsQ0FDakUsQ0FBQztRQUNKLENBQUM7UUFFRCx5QkFBeUI7UUFDekIsNkVBQTZFO1FBQzdFLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxJQUFBLHlCQUFZLEVBQzFDLElBQVcsRUFBRSw0RUFBNEU7UUFDekYsMEJBQTBCLEVBQzFCLFlBQVksQ0FDYixDQUFDO1FBRUYsdURBQXVEO1FBQ3ZELE1BQU0sSUFBSSxHQUFHLE1BQU0sdUJBQXVCLENBQ3hDLGlCQUFpQixFQUNqQixXQUFXLEVBQ1gsSUFBSSxDQUNMLENBQUM7UUFFRixPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFFM0MsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNqQixPQUFPLElBQUEsaUJBQVcsRUFBQyxHQUFHLEVBQUU7Z0JBQ3RCLE9BQU8sRUFBRSwrQ0FBK0M7YUFDekQsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUNELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsVUFBVSxJQUFJLEVBQUUsQ0FBQztRQUVyRCw2REFBNkQ7UUFDN0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxhQUFhLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBRTlDLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLEVBQUUsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBRTdELHFCQUFxQjtRQUNyQixNQUFNLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsR0FBRyxNQUFNLG9CQUFvQixDQUFDLFlBQVksRUFBRSxRQUFRLENBQUMsQ0FBQztRQUV6RiwyREFBMkQ7UUFDM0QsTUFBTSxNQUFNLEdBQUcsTUFBTSxXQUFXLENBQzlCLFVBQVUsRUFDVixZQUFZLEVBQ1osTUFBTSxJQUFJLEVBQUUsRUFDWixVQUFVLElBQUksQ0FBQyxFQUNmLEtBQUssSUFBSSxLQUFLLEVBQ2QsVUFBVSxDQUNYLENBQUM7UUFFRixxQkFBcUI7UUFDckIsT0FBTyxJQUFBLGlCQUFXLEVBQUMsR0FBRyxFQUFFO1lBQ3RCLFVBQVU7WUFDVixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7WUFDN0IsTUFBTTtZQUNOLFVBQVU7WUFDVixLQUFLO1NBQ04sQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7UUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3hELE9BQU8sSUFBQSxpQkFBVyxFQUFDLEdBQUcsRUFBRTtZQUN0QixPQUFPLEVBQUUsMkJBQTJCO1lBQ3BDLEtBQUssRUFBRSxHQUFHLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlO1NBQzVELENBQUMsQ0FBQztJQUNMLENBQUM7QUFDSCxDQUFDLENBQUM7QUF2R1csUUFBQSxPQUFPLFdBdUdsQjtBQUVGLE1BQU0sYUFBYSxHQUFHLEtBQUssRUFBRSxHQUFXLEVBQUUsSUFBcUIsRUFBbUIsRUFBRTtJQUNsRixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2pCLE9BQU8sR0FBRyxDQUFDO0lBQ2IsQ0FBQztJQUNELE1BQU0sQ0FBQyxLQUFLLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUM7SUFDOUIsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUM7SUFDN0MsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2hCLE9BQU8sYUFBYSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNsQyxDQUFDO0lBQ0QsTUFBTSxPQUFPLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUN0RCxNQUFNLE9BQU8sR0FBRyxNQUFNLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRWhELE9BQU8sYUFBYSxDQUFDLEdBQUcsR0FBRyxLQUFLLE9BQU8sRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0FBQ25ELENBQUMsQ0FBQztBQUdGLFNBQVMsZ0JBQWdCLENBQUMsSUFBWTtJQUNwQywwQkFBMEI7SUFDMUIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNoQyxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDLElBQUksS0FBSyxLQUFLLENBQUMsQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQy9CLE1BQU0sSUFBSSxLQUFLLENBQUMsd0NBQXdDLENBQUMsQ0FBQztJQUM1RCxDQUFDO0lBRUQsb0JBQW9CO0lBQ3BCLElBQUksU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUUzQyxxRUFBcUU7SUFDckUsU0FBUyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsNkJBQTZCLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUNyRSxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3JDLENBQUMsQ0FBQyxDQUFDO0lBRUgsc0JBQXNCO0lBQ3RCLElBQUksQ0FBQztRQUNILE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUMvQixDQUFDO0lBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztRQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3pDLE1BQU0sR0FBRyxDQUFDO0lBQ1osQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudFYyLCBBUElHYXRld2F5UHJveHlSZXN1bHRWMiwgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgR2V0Q29tbWFuZCwgUHV0Q29tbWFuZCwgUXVlcnlDb21tYW5kLCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5cbmltcG9ydCB7IGludm9rZU1vZGVsIH0gZnJvbSAnLi4vaGVscGVycy9iZWRyb2NrLWh0dHAtY2xpZW50JztcblxuaW1wb3J0IHsgR2V0T2JqZWN0Q29tbWFuZCwgUzNDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuXG5pbXBvcnQgeyBTaWduYXR1cmVWNCB9IGZyb20gJ0Bhd3Mtc2RrL3NpZ25hdHVyZS12NCc7XG5pbXBvcnQgeyBTaGEyNTYgfSBmcm9tICdAYXdzLWNyeXB0by9zaGEyNTYtanMnO1xuaW1wb3J0IHsgZGVmYXVsdFByb3ZpZGVyIH0gZnJvbSAnQGF3cy1zZGsvY3JlZGVudGlhbC1wcm92aWRlci1ub2RlJztcbmltcG9ydCB7IEh0dHBSZXF1ZXN0IH0gZnJvbSAnQGF3cy1zZGsvcHJvdG9jb2wtaHR0cCc7XG5pbXBvcnQgaHR0cHMgZnJvbSAnaHR0cHMnO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5cbmltcG9ydCB7IGFwaVJlc3BvbnNlIH0gZnJvbSAnLi4vaGVscGVycy9hcGknO1xuaW1wb3J0IHsgUEtfTkFNRSwgU0tfTkFNRSB9IGZyb20gJy4uL2NvbnN0YW50cy9jb21tb24nO1xuaW1wb3J0IHsgRE9DVU1FTlRfUEsgfSBmcm9tICcuLi9jb25zdGFudHMvZG9jdW1lbnQnO1xuaW1wb3J0IHsgRG9jdW1lbnRJdGVtIH0gZnJvbSAnLi4vc2NoZW1hcy9kb2N1bWVudCc7XG5pbXBvcnQgeyBnZXRFbWJlZGRpbmcgfSBmcm9tICcuLi9oZWxwZXJzL2VtYmVkZGluZ3MnO1xuaW1wb3J0IHsgUVVFU1RJT05fUEsgfSBmcm9tICcuLi9jb25zdGFudHMvb3JnYW5pemF0aW9uJztcblxuY29uc3QgZGRiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkZGJDbGllbnQsIHtcbiAgbWFyc2hhbGxPcHRpb25zOiB7IHJlbW92ZVVuZGVmaW5lZFZhbHVlczogdHJ1ZSB9LFxufSk7XG5cbmNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHt9KTtcblxuY29uc3QgUkVHSU9OID1cbiAgcHJvY2Vzcy5lbnYuUkVHSU9OIHx8XG4gIHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHxcbiAgcHJvY2Vzcy5lbnYuQkVEUk9DS19SRUdJT04gfHxcbiAgJ3VzLWVhc3QtMSc7XG5cbmNvbnN0IERCX1RBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5EQl9UQUJMRV9OQU1FO1xuY29uc3QgRE9DVU1FTlRTX0JVQ0tFVCA9IHByb2Nlc3MuZW52LkRPQ1VNRU5UU19CVUNLRVQ7XG5jb25zdCBPUEVOU0VBUkNIX0VORFBPSU5UID0gcHJvY2Vzcy5lbnYuT1BFTlNFQVJDSF9FTkRQT0lOVDtcblxuY29uc3QgQkVEUk9DS19FTUJFRERJTkdfTU9ERUxfSUQgPSBwcm9jZXNzLmVudi5CRURST0NLX0VNQkVERElOR19NT0RFTF9JRCB8fCAnYW1hem9uLnRpdGFuLWVtYmVkLXRleHQtdjI6MCc7XG5cbmNvbnN0IEJFRFJPQ0tfTU9ERUxfSUQgPSBwcm9jZXNzLmVudi5CRURST0NLX01PREVMX0lEO1xuXG5pZiAoIURCX1RBQkxFX05BTUUpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdEQl9UQUJMRV9OQU1FIGVudiB2YXIgaXMgbm90IHNldCcpO1xufVxuaWYgKCFET0NVTUVOVFNfQlVDS0VUKSB7XG4gIHRocm93IG5ldyBFcnJvcignRE9DVU1FTlRTX0JVQ0tFVCBlbnYgdmFyIGlzIG5vdCBzZXQnKTtcbn1cbmlmICghT1BFTlNFQVJDSF9FTkRQT0lOVCkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ09QRU5TRUFSQ0hfRU5EUE9JTlQgZW52IHZhciBpcyBub3Qgc2V0Jyk7XG59XG5cbi8vIC0tLSBUeXBlcyAtLS1cbmludGVyZmFjZSBBbnN3ZXJRdWVzdGlvblJlcXVlc3RCb2R5IHtcbiAgcHJvamVjdElkOiBzdHJpbmc7XG4gIHF1ZXN0aW9uSWQ/OiBzdHJpbmc7XG4gIHF1ZXN0aW9uPzogc3RyaW5nO1xuICB0b3BLPzogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgT3BlblNlYXJjaEhpdCB7XG4gIF9zb3VyY2U/OiB7XG4gICAgZG9jdW1lbnRJZD86IHN0cmluZztcbiAgICB0ZXh0Pzogc3RyaW5nO1xuICAgIFtrZXk6IHN0cmluZ106IGFueTtcbiAgfTtcblxuICBba2V5OiBzdHJpbmddOiBhbnk7XG59XG5cbmludGVyZmFjZSBRQUl0ZW0ge1xuICBxdWVzdGlvbklkOiBzdHJpbmc7XG4gIGRvY3VtZW50SWQ6IHN0cmluZztcbiAgcXVlc3Rpb246IHN0cmluZztcbiAgYW5zd2VyOiBzdHJpbmc7XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICBjb25maWRlbmNlOiBudW1iZXI7XG4gIGZvdW5kOiBib29sZWFuO1xufVxuXG4vLyBTaGFwZSBvZiBxdWVzdGlvbiByZWNvcmQgaW4gRHluYW1vIChhZGp1c3QgdG8geW91ciBhY3R1YWwgc2NoZW1hKVxuaW50ZXJmYWNlIFF1ZXN0aW9uSXRlbUR5bmFtbyB7XG4gIFtQS19OQU1FXTogc3RyaW5nO1xuICBbU0tfTkFNRV06IHN0cmluZztcbiAgaWQ/OiBzdHJpbmc7ICAgICAgICAvLyB5b3VyIENVSUQgaWRcbiAgcXVlc3Rpb25UZXh0OiBzdHJpbmc7ICAgLy8gdGhlIHF1ZXN0aW9uIHRleHRcbiAgLy8geW91IGNhbiBhZGQgYW5zd2VyLCBzb3VyY2VzLCBldGMuIGhlcmUgbGF0ZXJcbiAgW2tleTogc3RyaW5nXTogYW55O1xufVxuXG5hc3luYyBmdW5jdGlvbiBzdHJlYW1Ub1N0cmluZyhzdHJlYW06IGFueSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2h1bmtzOiBCdWZmZXJbXSA9IFtdO1xuICAgIHN0cmVhbS5vbignZGF0YScsIChjaHVuazogQnVmZmVyKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgIHN0cmVhbS5vbignZXJyb3InLCByZWplY3QpO1xuICAgIHN0cmVhbS5vbignZW5kJywgKCkgPT4ge1xuICAgICAgcmVzb2x2ZShCdWZmZXIuY29uY2F0KGNodW5rcykudG9TdHJpbmcoJ3V0Zi04JykpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLy8gLS0tIEhlbHBlcjogc2VtYW50aWMgc2VhcmNoIGluIE9wZW5TZWFyY2ggLS0tXG5hc3luYyBmdW5jdGlvbiBzZW1hbnRpY1NlYXJjaERvY3VtZW50cyhcbiAgZW1iZWRkaW5nOiBudW1iZXJbXSxcbiAgaW5kZXhOYW1lOiBzdHJpbmcsXG4gIGs6IG51bWJlcixcbik6IFByb21pc2U8T3BlblNlYXJjaEhpdFtdPiB7XG4gIGNvbnN0IGVuZHBvaW50VXJsID0gbmV3IFVSTChPUEVOU0VBUkNIX0VORFBPSU5UISk7XG4gIGNvbnN0IHBheWxvYWQgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgc2l6ZTogayxcbiAgICBxdWVyeToge1xuICAgICAga25uOiB7XG4gICAgICAgIGVtYmVkZGluZzoge1xuICAgICAgICAgIHZlY3RvcjogZW1iZWRkaW5nLFxuICAgICAgICAgIGssXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgX3NvdXJjZTogWydkb2N1bWVudElkJ10sXG4gIH0pO1xuXG4gIGNvbnN0IHJlcXVlc3QgPSBuZXcgSHR0cFJlcXVlc3Qoe1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIHByb3RvY29sOiBlbmRwb2ludFVybC5wcm90b2NvbCxcbiAgICBob3N0bmFtZTogZW5kcG9pbnRVcmwuaG9zdG5hbWUsXG4gICAgcGF0aDogYC8ke2luZGV4TmFtZX0vX3NlYXJjaGAsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdDb250ZW50LUxlbmd0aCc6IEJ1ZmZlci5ieXRlTGVuZ3RoKHBheWxvYWQpLnRvU3RyaW5nKCksXG4gICAgICBob3N0OiBlbmRwb2ludFVybC5ob3N0bmFtZSxcbiAgICB9LFxuICAgIGJvZHk6IHBheWxvYWQsXG4gIH0pO1xuXG4gIGNvbnN0IHNpZ25lciA9IG5ldyBTaWduYXR1cmVWNCh7XG4gICAgc2VydmljZTogJ2Fvc3MnLFxuICAgIHJlZ2lvbjogUkVHSU9OLFxuICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcbiAgICBzaGEyNTY6IFNoYTI1NixcbiAgfSk7XG5cbiAgY29uc3Qgc2lnbmVkID0gYXdhaXQgc2lnbmVyLnNpZ24ocmVxdWVzdCk7XG5cbiAgY29uc3QgYm9keVN0ciA9IGF3YWl0IG5ldyBQcm9taXNlPHN0cmluZz4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHJlcSA9IGh0dHBzLnJlcXVlc3QoXG4gICAgICB7XG4gICAgICAgIG1ldGhvZDogc2lnbmVkLm1ldGhvZCxcbiAgICAgICAgaG9zdG5hbWU6IHNpZ25lZC5ob3N0bmFtZSxcbiAgICAgICAgcGF0aDogc2lnbmVkLnBhdGgsXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZC5oZWFkZXJzIGFzIGFueSxcbiAgICAgIH0sXG4gICAgICAocmVzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNodW5rczogQnVmZmVyW10gPSBbXTtcbiAgICAgICAgcmVzLm9uKCdkYXRhJywgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICByZXMub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBjb25zdCB0ZXh0ID0gQnVmZmVyLmNvbmNhdChjaHVua3MpLnRvU3RyaW5nKCd1dGYtOCcpO1xuICAgICAgICAgIGlmIChyZXMuc3RhdHVzQ29kZSAmJiByZXMuc3RhdHVzQ29kZSA+PSAyMDAgJiYgcmVzLnN0YXR1c0NvZGUgPCAzMDApIHtcbiAgICAgICAgICAgIHJlc29sdmUodGV4dCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBPcGVuU2VhcmNoIHNlYXJjaCBlcnJvcjogJHtyZXMuc3RhdHVzQ29kZX0gJHtyZXMuc3RhdHVzTWVzc2FnZX0gLSAke3RleHR9YCxcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHJlcS5vbignZXJyb3InLCByZWplY3QpO1xuICAgIGlmIChzaWduZWQuYm9keSkge1xuICAgICAgcmVxLndyaXRlKHNpZ25lZC5ib2R5KTtcbiAgICB9XG4gICAgcmVxLmVuZCgpO1xuICB9KTtcblxuICBjb25zdCBqc29uID0gSlNPTi5wYXJzZShib2R5U3RyKTtcbiAgY29uc3QgaGl0czogT3BlblNlYXJjaEhpdFtdID0ganNvbi5oaXRzPy5oaXRzID8/IFtdO1xuICByZXR1cm4gaGl0cztcbn1cblxuLy8gLS0tIEhlbHBlcjogZmluZCBEb2N1bWVudEl0ZW0gaW4gRHluYW1vIGJ5IGRvY3VtZW50SWQgKFBLID0gRE9DVU1FTlRfUEssIFNLIGVuZHNXaXRoIFwiI0RPQyM8aWQ+XCIpIC0tLVxuXG5hc3luYyBmdW5jdGlvbiBnZXREb2N1bWVudEl0ZW1CeUlkKFxuICBkb2N1bWVudElkOiBzdHJpbmcsXG4pOiBQcm9taXNlPFxuICBEb2N1bWVudEl0ZW0gJiB7XG4gIFtQS19OQU1FXTogc3RyaW5nO1xuICBbU0tfTkFNRV06IHN0cmluZztcbn1cbj4ge1xuICBjb25zdCBza1N1ZmZpeCA9IGAjRE9DIyR7ZG9jdW1lbnRJZH1gO1xuXG4gIGNvbnN0IHF1ZXJ5UmVzID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQoXG4gICAgbmV3IFF1ZXJ5Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnI3BrID0gOnBrJyxcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xuICAgICAgICAnI3BrJzogUEtfTkFNRSxcbiAgICAgIH0sXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICc6cGsnOiBET0NVTUVOVF9QSyxcbiAgICAgIH0sXG4gICAgfSksXG4gICk7XG5cbiAgY29uc3QgaXRlbXMgPVxuICAgIChxdWVyeVJlcy5JdGVtcyB8fCBbXSkgYXMgKERvY3VtZW50SXRlbSAmIHtcbiAgICAgIFtQS19OQU1FXTogc3RyaW5nO1xuICAgICAgW1NLX05BTUVdOiBzdHJpbmc7XG4gICAgfSlbXTtcblxuICBjb25zdCBkb2NJdGVtID0gaXRlbXMuZmluZCgoaXQpID0+XG4gICAgU3RyaW5nKGl0W1NLX05BTUVdKS5lbmRzV2l0aChza1N1ZmZpeCksXG4gICk7XG5cbiAgaWYgKCFkb2NJdGVtKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYERvY3VtZW50IG5vdCBmb3VuZCBmb3IgUEs9JHtET0NVTUVOVF9QS30gYW5kIFNLIGVuZGluZyB3aXRoICR7c2tTdWZmaXh9YCxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIGRvY0l0ZW07XG59XG5cbi8vIC0tLSBIZWxwZXI6IGxvYWQgZG9jdW1lbnQgdGV4dCBmcm9tIFMzIHZpYSB0ZXh0RmlsZUtleSAoZmFsbGJhY2sgdG8gZmlsZUtleSkgLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWREb2N1bWVudFRleHQoZG9jSXRlbTogRG9jdW1lbnRJdGVtKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgdGV4dEtleSA9IChkb2NJdGVtIGFzIGFueSkudGV4dEZpbGVLZXkgfHwgKGRvY0l0ZW0gYXMgYW55KS5maWxlS2V5O1xuICBpZiAoIXRleHRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0RvY3VtZW50IGhhcyBubyB0ZXh0RmlsZUtleSBvciBmaWxlS2V5Jyk7XG4gIH1cblxuICBjb25zdCByZXMgPSBhd2FpdCBzM0NsaWVudC5zZW5kKFxuICAgIG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICAgIEJ1Y2tldDogRE9DVU1FTlRTX0JVQ0tFVCxcbiAgICAgIEtleTogdGV4dEtleSxcbiAgICB9KSxcbiAgKTtcblxuICBpZiAoIXJlcy5Cb2R5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBTMyBvYmplY3QgJHt0ZXh0S2V5fSBoYXMgbm8gYm9keWApO1xuICB9XG5cbiAgY29uc3QgdGV4dCA9IGF3YWl0IHN0cmVhbVRvU3RyaW5nKHJlcy5Cb2R5IGFzIGFueSk7XG4gIHJldHVybiB0ZXh0O1xufVxuXG4vLyAtLS0gSGVscGVyOiBsb2FkIHF1ZXN0aW9uIGJ5IHF1ZXN0aW9uSWQgZnJvbSBEeW5hbW8gLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGdldFF1ZXN0aW9uSXRlbUJ5SWQoXG4gIHByb2plY3RJZDogc3RyaW5nLFxuICBxdWVzdGlvbklkOiBzdHJpbmcsXG4pOiBQcm9taXNlPFF1ZXN0aW9uSXRlbUR5bmFtbz4ge1xuICBjb25zdCByZXMgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChcbiAgICBuZXcgR2V0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICBLZXk6IHtcbiAgICAgICAgW1BLX05BTUVdOiBRVUVTVElPTl9QSyxcbiAgICAgICAgW1NLX05BTUVdOiBgJHtwcm9qZWN0SWR9IyR7cXVlc3Rpb25JZH1gLFxuICAgICAgfSxcbiAgICB9KSxcbiAgKTtcblxuICBpZiAoIXJlcy5JdGVtKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYFF1ZXN0aW9uIG5vdCBmb3VuZCBmb3IgUEs9JHtRVUVTVElPTl9QS30sIFNLPSR7cXVlc3Rpb25JZH1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBpdGVtID0gcmVzLkl0ZW0gYXMgUXVlc3Rpb25JdGVtRHluYW1vO1xuXG4gIGlmICghaXRlbS5xdWVzdGlvblRleHQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgUXVlc3Rpb24gaXRlbSBmb3IgU0s9JHtxdWVzdGlvbklkfSBoYXMgbm8gXCJxdWVzdGlvblwiIGZpZWxkYCxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIGl0ZW07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFuc3dlcldpdGhCZWRyb2NrTExNKFxuICBxdWVzdGlvbjogc3RyaW5nLFxuICBkb2NUZXh0OiBzdHJpbmcsXG4pOiBQcm9taXNlPFBhcnRpYWw8UUFJdGVtPj4ge1xuICBjb25zdCBzeXN0ZW1Qcm9tcHQgPSBgXG5Zb3UgYXJlIGFuIGFzc2lzdGFudCB0aGF0IGFuc3dlcnMgcXVlc3Rpb25zIHN0cmljdGx5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBkb2N1bWVudC5cblxuUnVsZXM6XG4tIElmIHRoZSBkb2N1bWVudCBkb2VzIG5vdCBjb250YWluIHRoZSBhbnN3ZXIsIHlvdSBNVVNUIHNldCBcImZvdW5kXCIgdG8gZmFsc2UgYW5kIFwiYW5zd2VyXCIgdG8gYW4gZW1wdHkgc3RyaW5nLlxuLSBEbyBOT1QgaW52ZW50IG9yIGd1ZXNzIGluZm9ybWF0aW9uIHRoYXQgaXMgbm90IGNsZWFybHkgc3VwcG9ydGVkIGJ5IHRoZSBkb2N1bWVudC5cbi0gRG8gTk9UIHJlcGVhdCB0aGUgcXVlc3Rpb24gaW4gdGhlIGFuc3dlci5cbi0gRG8gTk9UIGJlZ2luIHdpdGgsIGJhc2VkIG9uIC4uLiwganVzdCBhbnN3ZXIuXG4tIEFuc3dlciBjb25jaXNlbHksIHdpdGhvdXQgdW5uZWNlc3NhcnkgXCJ3YXRlclwiIG9yIGZpbGxlci5cblxuT3V0cHV0IGZvcm1hdDpcblJldHVybiBPTkxZIGEgc2luZ2xlIEpTT04gb2JqZWN0LCBubyBhZGRpdGlvbmFsIHRleHQsIGluIHRoaXMgZXhhY3Qgc2hhcGU6XG5cbntcImFuc3dlclwiOlwic3RyaW5nXCIsXCJjb25maWRlbmNlXCI6MC4wLFwiZm91bmRcIjp0cnVlfVxuXG5XaGVyZTpcbi0gXCJhbnN3ZXJcIiBpcyB0aGUgZmluYWwgYW5zd2VyIHRleHQgd2hlbiBmb3VuZD10cnVlLCBvdGhlcndpc2UgYW4gZW1wdHkgc3RyaW5nIFwiXCIuXG4tIFwiY29uZmlkZW5jZVwiIGlzIGEgbnVtYmVyIGJldHdlZW4gMC4wIGFuZCAxLjAgdGhhdCByZWZsZWN0cyBob3cgc3VyZSB5b3UgYXJlIGJhc2VkIG9uIHRoZSBkb2N1bWVudC5cbi0gXCJmb3VuZFwiIGlzOlxuICAtIHRydWUgIOKAlCB3aGVuIHRoZSBhbnN3ZXIgaXMgY2xlYXJseSBzdXBwb3J0ZWQgYnkgdGhlIGRvY3VtZW50O1xuICAtIGZhbHNlIOKAlCB3aGVuIHRoZSBhbnN3ZXIgY2Fubm90IGJlIGZvdW5kIGluIHRoZSBkb2N1bWVudCBvciBpcyB0b28gdW5jZXJ0YWluLlxuYC50cmltKCk7XG5cbiAgY29uc3QgdXNlclByb21wdCA9IFtcbiAgICAnRG9jdW1lbnQ6JyxcbiAgICAnXCJcIlwiJyxcbiAgICBkb2NUZXh0LFxuICAgICdcIlwiXCInLFxuICAgICcnLFxuICAgIGBRdWVzdGlvbjogJHtxdWVzdGlvbn1gLFxuICBdLmpvaW4oJ1xcbicpO1xuXG4gIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgYW50aHJvcGljX3ZlcnNpb246ICdiZWRyb2NrLTIwMjMtMDUtMzEnLFxuICAgIG1heF90b2tlbnM6IDUxMixcbiAgICB0ZW1wZXJhdHVyZTogMC4yLFxuICAgIHN5c3RlbTogc3lzdGVtUHJvbXB0LFxuICAgIG1lc3NhZ2VzOiBbXG4gICAgICB7XG4gICAgICAgIHJvbGU6ICd1c2VyJyxcbiAgICAgICAgY29udGVudDogW3sgdHlwZTogJ3RleHQnLCB0ZXh0OiB1c2VyUHJvbXB0IH1dLFxuICAgICAgfSxcbiAgICBdLFxuICB9O1xuXG4gIGNvbnN0IHJlc3BvbnNlQm9keSA9IGF3YWl0IGludm9rZU1vZGVsKFxuICAgIEJFRFJPQ0tfTU9ERUxfSUQhLFxuICAgIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAnYXBwbGljYXRpb24vanNvbidcbiAgKTtcblxuICBjb25zdCByYXcgPSBuZXcgVGV4dERlY29kZXIoJ3V0Zi04JykuZGVjb2RlKHJlc3BvbnNlQm9keSk7XG5cbiAgY29uc29sZS5sb2coJ1JhdzogJywgcmF3KVxuXG4gIGxldCBvdXRlcjogYW55O1xuICB0cnkge1xuICAgIG91dGVyID0gSlNPTi5wYXJzZShyYXcpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIEpTT04gZW52ZWxvcGUgZnJvbSBCZWRyb2NrOicsIHJhdyk7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEpTT04gZW52ZWxvcGUgZnJvbSBCZWRyb2NrJyk7XG4gIH1cblxuICBjb25zdCB0ZXh0OiBzdHJpbmcgfCB1bmRlZmluZWQgPSBvdXRlcj8uY29udGVudD8uWzBdPy50ZXh0O1xuICBpZiAoIXRleHQpIHtcbiAgICBjb25zb2xlLmVycm9yKCdVbmV4cGVjdGVkIFFBIHJlc3BvbnNlIHN0cnVjdHVyZTonLCBKU09OLnN0cmluZ2lmeShvdXRlcikuc2xpY2UoMCwgNTAwKSk7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdNb2RlbCByZXR1cm5lZCBubyB0ZXh0IGNvbnRlbnQnKTtcbiAgfVxuXG4gIGNvbnN0IHN0YXJ0ID0gdGV4dC5pbmRleE9mKCd7Jyk7XG4gIGNvbnN0IGVuZCA9IHRleHQubGFzdEluZGV4T2YoJ30nKTtcbiAgaWYgKHN0YXJ0ID09PSAtMSB8fCBlbmQgPT09IC0xIHx8IGVuZCA8PSBzdGFydCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTW9kZWwgb3V0cHV0IGRvZXMgbm90IGNvbnRhaW4gYSBKU09OIG9iamVjdCcpO1xuICB9XG5cbiAgY29uc3Qgc2xpY2UgPSB0ZXh0LnNsaWNlKHN0YXJ0LCBlbmQgKyAxKTtcblxuICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHNsaWNlLnJlcGxhY2UoL1xcbi9nLCAnXFxcXG4nKSk7XG5cbiAgY29uc3QgcmVzdWx0OiBQYXJ0aWFsPFFBSXRlbT4gPSB7XG4gICAgYW5zd2VyOiB0eXBlb2YgcGFyc2VkLmFuc3dlciA9PT0gJ3N0cmluZycgPyBwYXJzZWQuYW5zd2VyIDogJycsXG4gICAgY29uZmlkZW5jZTpcbiAgICAgIHR5cGVvZiBwYXJzZWQuY29uZmlkZW5jZSA9PT0gJ251bWJlcidcbiAgICAgICAgPyBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCBwYXJzZWQuY29uZmlkZW5jZSkpXG4gICAgICAgIDogMCxcbiAgICBmb3VuZDogdHlwZW9mIHBhcnNlZC5mb3VuZCA9PT0gJ2Jvb2xlYW4nID8gcGFyc2VkLmZvdW5kIDogZmFsc2UsXG4gIH07XG5cbiAgaWYgKCFyZXN1bHQuZm91bmQpIHtcbiAgICByZXN1bHQuYW5zd2VyID0gJyc7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBzdG9yZUFuc3dlcihcbiAgZG9jdW1lbnRJZDogc3RyaW5nLFxuICBxdWVzdGlvbjogc3RyaW5nLFxuICBhbnN3ZXI6IHN0cmluZyxcbiAgY29uZmlkZW5jZTogbnVtYmVyLFxuICBmb3VuZDogYm9vbGVhbixcbiAgZXhpc3RpbmdRdWVzdGlvbklkPzogc3RyaW5nLFxuKTogUHJvbWlzZTxRQUl0ZW0+IHtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICBjb25zdCBxdWVzdGlvbklkID0gZXhpc3RpbmdRdWVzdGlvbklkID8/IHJhbmRvbVVVSUQoKTtcblxuICBjb25zdCBpdGVtOiBRQUl0ZW0gJiB7XG4gICAgW1BLX05BTUVdOiBzdHJpbmc7XG4gICAgW1NLX05BTUVdOiBzdHJpbmc7XG4gIH0gPSB7XG4gICAgW1BLX05BTUVdOiAnQU5TV0VSJyxcbiAgICBbU0tfTkFNRV06IGBET0MjJHtkb2N1bWVudElkfSNRIyR7cXVlc3Rpb25JZH1gLFxuICAgIHF1ZXN0aW9uSWQsXG4gICAgZG9jdW1lbnRJZCxcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgY3JlYXRlZEF0OiBub3csXG4gICAgY29uZmlkZW5jZSxcbiAgICBmb3VuZCxcbiAgfTtcblxuICBhd2FpdCBkb2NDbGllbnQuc2VuZChcbiAgICBuZXcgUHV0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERCX1RBQkxFX05BTUUsXG4gICAgICBJdGVtOiBpdGVtLFxuICAgIH0pLFxuICApO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb25JZCxcbiAgICBkb2N1bWVudElkLFxuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBjcmVhdGVkQXQ6IG5vdyxcbiAgICBjb25maWRlbmNlLFxuICAgIGZvdW5kLFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50VjIsXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdFYyPiA9PiB7XG4gIGNvbnNvbGUubG9nKCdhbnN3ZXItcXVlc3Rpb24gZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcblxuICBpZiAoIWV2ZW50LmJvZHkpIHtcbiAgICByZXR1cm4gYXBpUmVzcG9uc2UoNDAwLCB7IG1lc3NhZ2U6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pO1xuICB9XG5cbiAgbGV0IGJvZHk6IEFuc3dlclF1ZXN0aW9uUmVxdWVzdEJvZHk7XG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHsgbWVzc2FnZTogJ0ludmFsaWQgSlNPTiBib2R5JyB9KTtcbiAgfVxuXG4gIGNvbnN0IHRvcEsgPSBib2R5LnRvcEsgJiYgYm9keS50b3BLID4gMCA/IGJvZHkudG9wSyA6IDM7XG5cbiAgbGV0IHF1ZXN0aW9uVGV4dDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBjb25zdCB7IHF1ZXN0aW9uSWQsIHByb2plY3RJZCB9ID0gYm9keTtcblxuXG4gIHRyeSB7XG4gICAgLy8gMCkgUmVzb2x2ZSBxdWVzdGlvbiB0ZXh0OlxuICAgIC8vICAgIC0gSWYgcXVlc3Rpb25JZCBpcyBwcm92aWRlZDogbG9hZCBmcm9tIER5bmFtb1xuICAgIC8vICAgIC0gRWxzZTogZmFsbGJhY2sgdG8gcmF3IHF1ZXN0aW9uIHRleHQgZnJvbSBib2R5XG4gICAgaWYgKHF1ZXN0aW9uSWQpIHtcbiAgICAgIGNvbnN0IHF1ZXN0aW9uSXRlbSA9IGF3YWl0IGdldFF1ZXN0aW9uSXRlbUJ5SWQocHJvamVjdElkLCBxdWVzdGlvbklkKTtcbiAgICAgIHF1ZXN0aW9uVGV4dCA9IHF1ZXN0aW9uSXRlbS5xdWVzdGlvblRleHQ7XG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgYExvYWRlZCBxdWVzdGlvbiBmcm9tIER5bmFtby4gcXVlc3Rpb25JZD0ke3F1ZXN0aW9uSWR9LCBxdWVzdGlvbj1cIiR7cXVlc3Rpb25UZXh0fVwiYCxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXN0aW9uVGV4dCA9IGJvZHkucXVlc3Rpb24/LnRyaW0oKTtcbiAgICAgIGlmICghcXVlc3Rpb25UZXh0KSB7XG4gICAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDAsIHtcbiAgICAgICAgICBtZXNzYWdlOlxuICAgICAgICAgICAgJ0VpdGhlciBxdWVzdGlvbklkIChwcmVmZXJyZWQpIG9yIHF1ZXN0aW9uIHRleHQgbXVzdCBiZSBwcm92aWRlZCcsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgLy8gbm8gcXVlc3Rpb25JZCBwcm92aWRlZCA9PiB3ZSB3aWxsIGdlbmVyYXRlIG9uZSB3aGVuIHN0b3JpbmcgYW5zd2VyXG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgYFVzaW5nIGlubGluZSBxdWVzdGlvbiBmcm9tIHJlcXVlc3QuIHF1ZXN0aW9uPVwiJHtxdWVzdGlvblRleHR9XCJgLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyAxKSBFbWJlZCBxdWVzdGlvbiB0ZXh0XG4gICAgLy8gTm90ZTogZ2V0RW1iZWRkaW5nIG5vdyB1c2VzIGludm9rZU1vZGVsIGludGVybmFsbHksIG5vIG5lZWQgdG8gcGFzcyBjbGllbnRcbiAgICBjb25zdCBxdWVzdGlvbkVtYmVkZGluZyA9IGF3YWl0IGdldEVtYmVkZGluZyhcbiAgICAgIG51bGwgYXMgYW55LCAvLyBiZWRyb2NrQ2xpZW50IG5vIGxvbmdlciBuZWVkZWQgYnV0IHNpZ25hdHVyZSBtYWludGFpbmVkIGZvciBjb21wYXRpYmlsaXR5XG4gICAgICBCRURST0NLX0VNQkVERElOR19NT0RFTF9JRCxcbiAgICAgIHF1ZXN0aW9uVGV4dCxcbiAgICApO1xuXG4gICAgLy8gMikgU2VtYW50aWMgc2VhcmNoIGluIE9wZW5TZWFyY2ggKGluZGV4IFwiZG9jdW1lbnRzXCIpXG4gICAgY29uc3QgaGl0cyA9IGF3YWl0IHNlbWFudGljU2VhcmNoRG9jdW1lbnRzKFxuICAgICAgcXVlc3Rpb25FbWJlZGRpbmcsXG4gICAgICAnZG9jdW1lbnRzJyxcbiAgICAgIHRvcEssXG4gICAgKTtcblxuICAgIGNvbnNvbGUubG9nKCdIaXRzOicsIEpTT04uc3RyaW5naWZ5KGhpdHMpKTtcblxuICAgIGlmICghaGl0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBhcGlSZXNwb25zZSg0MDQsIHtcbiAgICAgICAgbWVzc2FnZTogJ05vIG1hdGNoaW5nIGRvY3VtZW50cyBmb3VuZCBmb3IgdGhpcyBxdWVzdGlvbicsXG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgZG9jdW1lbnRJZCA9IGhpdHNbMF0uX3NvdXJjZT8uZG9jdW1lbnRJZCB8fCAnJztcblxuICAgIC8vIDMpIExvYWQgZG9jdW1lbnQgbWV0YWRhdGEgZnJvbSBEeW5hbW9EQiwgdGhlbiB0ZXh0IGZyb20gUzNcbiAgICBjb25zdCB0b3BUZXh0cyA9IGF3YWl0IG1lcmdlQWxsVGV4dHMoXCJcIiwgaGl0cylcblxuICAgIGNvbnNvbGUubG9nKCdRdWVzdGlvbiBhbmQgZG9jIHRleHQnLCBxdWVzdGlvblRleHQsIHRvcFRleHRzKTtcblxuICAgIC8vIDQpIEFzayBCZWRyb2NrIExMTVxuICAgIGNvbnN0IHsgYW5zd2VyLCBjb25maWRlbmNlLCBmb3VuZCB9ID0gYXdhaXQgYW5zd2VyV2l0aEJlZHJvY2tMTE0ocXVlc3Rpb25UZXh0LCB0b3BUZXh0cyk7XG5cbiAgICAvLyA1KSBTdG9yZSBRJkEgaW4gRHluYW1vIChyZS11c2UgcXVlc3Rpb25JZCBpZiB3ZSBoYWQgb25lKVxuICAgIGNvbnN0IHFhSXRlbSA9IGF3YWl0IHN0b3JlQW5zd2VyKFxuICAgICAgZG9jdW1lbnRJZCxcbiAgICAgIHF1ZXN0aW9uVGV4dCxcbiAgICAgIGFuc3dlciB8fCAnJyxcbiAgICAgIGNvbmZpZGVuY2UgfHwgMCxcbiAgICAgIGZvdW5kIHx8IGZhbHNlLFxuICAgICAgcXVlc3Rpb25JZCxcbiAgICApO1xuXG4gICAgLy8gNikgUmV0dXJuIHJlc3BvbnNlXG4gICAgcmV0dXJuIGFwaVJlc3BvbnNlKDIwMCwge1xuICAgICAgZG9jdW1lbnRJZCxcbiAgICAgIHF1ZXN0aW9uSWQ6IHFhSXRlbS5xdWVzdGlvbklkLFxuICAgICAgYW5zd2VyLFxuICAgICAgY29uZmlkZW5jZSxcbiAgICAgIGZvdW5kLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBhbnN3ZXItcXVlc3Rpb24gaGFuZGxlcjonLCBlcnIpO1xuICAgIHJldHVybiBhcGlSZXNwb25zZSg1MDAsIHtcbiAgICAgIG1lc3NhZ2U6ICdGYWlsZWQgdG8gYW5zd2VyIHF1ZXN0aW9uJyxcbiAgICAgIGVycm9yOiBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgIH0pO1xuICB9XG59O1xuXG5jb25zdCBtZXJnZUFsbFRleHRzID0gYXN5bmMgKGFjYzogc3RyaW5nLCBoaXRzOiBPcGVuU2VhcmNoSGl0W10pOiBQcm9taXNlPHN0cmluZz4gPT4ge1xuICBpZiAoIWhpdHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGFjYztcbiAgfVxuICBjb25zdCBbZmlyc3QsIC4uLnJlc3RdID0gaGl0cztcbiAgY29uc3QgZG9jdW1lbnRJZCA9IGZpcnN0Ll9zb3VyY2U/LmRvY3VtZW50SWQ7XG4gIGlmICghZG9jdW1lbnRJZCkge1xuICAgIHJldHVybiBtZXJnZUFsbFRleHRzKGFjYywgcmVzdCk7XG4gIH1cbiAgY29uc3QgZG9jSXRlbSA9IGF3YWl0IGdldERvY3VtZW50SXRlbUJ5SWQoZG9jdW1lbnRJZCk7XG4gIGNvbnN0IGRvY1RleHQgPSBhd2FpdCBsb2FkRG9jdW1lbnRUZXh0KGRvY0l0ZW0pO1xuXG4gIHJldHVybiBtZXJnZUFsbFRleHRzKGAke2FjY31cXG4ke2RvY1RleHR9YCwgcmVzdCk7XG59O1xuXG5cbmZ1bmN0aW9uIGV4dHJhY3RWYWxpZEpzb24odGV4dDogc3RyaW5nKSB7XG4gIC8vIDEuIEZpbmQgSlNPTiBib3VuZGFyaWVzXG4gIGNvbnN0IHN0YXJ0ID0gdGV4dC5pbmRleE9mKCd7Jyk7XG4gIGNvbnN0IGVuZCA9IHRleHQubGFzdEluZGV4T2YoJ30nKTtcbiAgaWYgKHN0YXJ0ID09PSAtMSB8fCBlbmQgPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTW9kZWwgcmVzcG9uc2UgY29udGFpbnMgbm8gSlNPTiBvYmplY3RcIik7XG4gIH1cblxuICAvLyAyLiBTbGljZSByYXcgSlNPTlxuICBsZXQganNvblNsaWNlID0gdGV4dC5zbGljZShzdGFydCwgZW5kICsgMSk7XG5cbiAgLy8gMy4gUmVwbGFjZSAqaWxsZWdhbCogYmFyZSBuZXdsaW5lcyBpbnNpZGUgcXVvdGVzIHdpdGggZXNjYXBlZCBvbmVzXG4gIGpzb25TbGljZSA9IGpzb25TbGljZS5yZXBsYWNlKC9cIlxccyooW15cIl0qPylcXG4oW15cIl0qPylcXHMqXCIvZywgKG1hdGNoKSA9PiB7XG4gICAgcmV0dXJuIG1hdGNoLnJlcGxhY2UoL1xcbi9nLCBcIlxcXFxuXCIpO1xuICB9KTtcblxuICAvLyA0LiBOb3cgcGFyc2Ugc2FmZWx5XG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UoanNvblNsaWNlKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCBKU09OOlwiLCBqc29uU2xpY2UpO1xuICAgIHRocm93IGVycjtcbiAgfVxufVxuIl19