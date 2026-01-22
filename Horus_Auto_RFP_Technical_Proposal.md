# **Horus Auto\_RFP Technical Design Document**

## **AI-Powered Government RFP Response Platform**

**Version:** 2.1  
 **Date:** November 26, 2025  
 **Audience:** Development Team

---

## **1\. Problem Statement**

### **The Pain Point**

Responding to government RFPs is one of the most time-consuming and resource-intensive activities in government contracting. Industry data shows:

* **23 hours average** to complete a single RFP response  
* **9 people** typically involved per response  
* **$35,000 \- $65,000** cost per RFP response  
* **44% average win rate** (meaning most of that effort results in losses)

  ### **Current State at Horus**

Brennen and the Ecuador team currently process RFPs using a manual workflow:

1. Search Vendorline for opportunities (California, Bidding stage, keywords)  
2. Register on PlanetBids and download RFP documents  
3. Upload documents to ChatGPT/Gemini with certifications from Google Drive  
4. Manually prompt AI to generate Executive Opportunity Brief  
5. Make Go/No-Go decision  
6. If Go: move to "00 To be approved" folder, create Linear ticket  
7. If No-Go: move to "03 Not approved" folder

**This process takes days to weeks per RFP.** We need to reduce it to hours.

### **What We're Building**

An AI-powered platform that automates RFP response generation by:

1. Ingesting RFP documents (PDF, Word, Excel, PowerPoint)  
2. Extracting structured requirements and questions  
3. Querying Horus's knowledge base (certifications, case studies, resumes, past proposals)  
4. Generating contextual, citation-backed responses using RAG  
5. Producing Executive Opportunity Briefs for rapid Go/No-Go decisions  
6. Exporting formatted proposal documents

**Target:** 70%+ time reduction (industry benchmark for RFP automation tools)

---

## **2\. Competitive Landscape**

Before building, we analyzed what the market leaders offer. This informs our feature priorities.

### **Key Competitors**

| Platform | Notable Features | Pricing |
| ----- | ----- | ----- |
| **Inventive AI** (YC) | Context Engine, stale content detection, competitive research agent | Enterprise custom |
| **Loopio** | Centralized content library, auto-fill, Salesforce/Slack integrations | $300-$5,000+/mo |
| **AutoRFP.ai** | Trust Scores, semantic search, export to original format | Custom |
| **V7 Labs** | Visual source linking, 200+ page support | Custom |
| **Responsive** | RAG \+ LLMs, content library, source citations | Custom |

### **Industry Claims**

* Inventive AI: 70%+ efficiency gain, 50%+ win rate improvement  
* Loopio: 28% turnaround reduction  
* Responsive: 50% content maintenance reduction, 80% time savings

  ### **What They All Have (Table Stakes)**

These features appear across all major competitors:

* Centralized content library with search  
* Answer auto-fill from past responses  
* Stale/duplicate content detection  
* Team collaboration and task assignment  
* Project timeline tracking  
* Multiple export formats  
* Source attribution/citations  
  ---

  ## **3\. Feature Gap Analysis**

  ### **What Our Current Plan Covers**

| Feature | Status |
| ----- | ----- |
| Document upload (PDF, Word, Excel, PPTX) | ✅ Planned |
| Question/requirement extraction | ✅ Planned |
| Knowledge base integration (Google Drive) | ✅ Planned |
| RAG-based response generation | ✅ Planned |
| Source attribution/citations | ✅ Planned |
| Executive Opportunity Brief (Go/No-Go) | ✅ Planned |
| Word document export | ✅ Planned |
| Linear integration | ✅ Planned |
| AWS Bedrock (Claude) | ✅ Planned |

  ### **What We're Missing (Critical Gaps)**

**P0 \- Must Have for Competitive Parity:**

| Feature | Why It Matters |
| ----- | ----- |
| **Centralized Content Library** | Every competitor has this. Stores approved Q\&A pairs, templates, past responses for reuse. |
| **Answer Auto-Fill** | Match new questions to existing approved answers automatically. Massive time saver. |
| **Stale Content Detection** | Flag outdated, duplicate, or conflicting content before it goes into proposals. |

**P1 \- High Priority:**

| Feature | Why It Matters |
| ----- | ----- |
| **Trust/Confidence Scores** | Shows AI confidence per answer. Helps reviewers prioritize what needs human attention. |
| **Semantic Search** | Context-aware retrieval, not just keyword matching. Critical for RAG quality. |
| **AI Writing Assistant** | Redraft answers for tone, length, professionalism. Polish before export. |
| **Team Task Assignment** | Assign sections to SMEs, track completion. Essential for collaboration. |
| **Project Timeline Tracking** | Milestones, deadlines, owner assignments. |

**P2 \- Future Enhancements:**

* CRM integration (Salesforce/HubSpot)  
* Slack integration  
* Browser extension  
* Analytics dashboard  
* Procurement portal imports (PlanetBids, SAP Ariba)  
* Multi-tenant architecture (for VRC and other clients)

  ### **Revised Roadmap**

**MVP (Weeks 1-11):** Core platform \+ Trust scores  
 **V1.1 (Post-MVP):** Content library, auto-fill, stale detection  
 **V1.2:** Semantic search improvements, AI writing assistant  
 **V2.0:** CRM integrations, multi-tenant, analytics

---

## **4\. Reference Implementation Analysis**

We analyzed the open-source [LlamaIndex auto\_rfp](https://github.com/run-llama/auto_rfp) project to understand proven patterns.

### **Their Architecture**

| Component | Their Tech | Our Replacement |
| ----- | ----- | ----- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind | Same |
| Auth | Supabase Auth (Magic Link) | AWS Cognito |
| Database | PostgreSQL \+ Prisma | DynamoDB |
| AI/LLM | OpenAI GPT-4o, LlamaCloud | AWS Bedrock (Claude) |
| Doc Processing | LlamaParse | Textract \+ python-docx |
| Storage | Supabase Storage | S3 |
| Vector DB | LlamaCloud indexes | OpenSearch Serverless |

### **Their Core Workflow**

```
1. Document Upload → Parse Word/PDF/Excel/PPTX
2. Question Extraction → AI extracts structured requirements
3. Knowledge Base Query → Search indexed org documents
4. Response Generation → Multi-step AI synthesis
5. Human Review → Edit/refine in UI
6. Export → Generate final document
```

### **What We'll Adopt**

* Multi-step response generation (analyze → search → extract → synthesize)  
* Source attribution and citation tracking  
* Project-based organization  
* Real-time response editing interface

  ### **What We'll Change**

| Change | Rationale |
| ----- | ----- |
| LlamaCloud → AWS Bedrock | Aligns with Horus AWS infrastructure; Claude offers higher accuracy for formal writing |
| Supabase → AWS services | Existing Horus patterns; GovCloud path for government deployments |
| Add Executive Brief | Go/No-Go decision support unique to our workflow |
| Add Linear integration | Matches Horus project management workflow |
| Add Content Library | Table-stakes feature missing from reference impl |
| Add Confidence Scores | Helps prioritize human review effort |

  ---

  ## **5\. System Architecture**

  ### **High-Level Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│              Next.js 15 / React 19 / TypeScript                 │
│                    (AWS Amplify Hosting)                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway + Lambda                        │
│                    (Serverless API Layer)                        │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐    ┌───────────────────┐    ┌───────────────┐
│  AWS Cognito  │    │   Step Functions  │    │   DynamoDB    │
│    (Auth)     │    │  (Orchestration)  │    │  (Metadata)   │
└───────────────┘    └───────────────────┘    └───────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐    ┌───────────────────┐    ┌───────────────┐
│  S3 Buckets   │    │   AWS Bedrock     │    │  OpenSearch   │
│  (Documents)  │    │    (Claude)       │    │  Serverless   │
└───────────────┘    └───────────────────┘    │ (Vector DB)   │
                                              └───────────────┘
```

  ### **Tech Stack Summary**

| Layer | Technology | Purpose |
| ----- | ----- | ----- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind | User interface |
| Hosting | AWS Amplify | Deployment, CI/CD |
| Auth | AWS Cognito | User management, team access |
| API | API Gateway \+ Lambda | Serverless endpoints |
| AI | AWS Bedrock (Claude Sonnet) | Question extraction, response generation |
| Vector DB | OpenSearch Serverless | Knowledge base indexing, semantic search |
| Database | DynamoDB | Projects, questions, answers, content library |
| Storage | S3 | Documents, parsed content |
| Orchestration | Step Functions | Multi-step processing workflow |

  ### **Why These Choices?**

**AWS Bedrock over OpenAI/LlamaCloud:**

* Aligns with existing Horus AWS infrastructure  
* Path to GovCloud for future government deployments  
* Claude consistently outperforms GPT for formal/technical writing  
* No data leaves AWS (security/compliance)

**OpenSearch Serverless over Pinecone/Weaviate:**

* AWS-native, simpler ops  
* Cost-effective (pay per OCU, no cluster management)  
* Supports both vector and keyword search

**DynamoDB over PostgreSQL:**

* Serverless, scales automatically  
* Matches existing Horus patterns  
* Simpler than RDS for document-oriented data

**Step Functions over custom orchestration:**

* Built-in retry/error handling  
* Visual workflow debugging  
* Native Lambda integration  
  ---

  ## **6\. Processing Pipeline**

  ### **Stage 1: Document Ingestion**

```
Input: RFP document (PDF, DOCX, XLSX, PPTX)
Output: Parsed text + metadata in S3/DynamoDB

Flow:
1. User uploads via UI or S3 bucket trigger
2. Lambda receives upload event
3. Route by file type:
   - PDF → Textract (OCR + layout)
   - DOCX → python-docx
   - XLSX → openpyxl
   - PPTX → python-pptx
4. Store raw file in S3
5. Store parsed text + metadata in DynamoDB
6. Trigger Step Functions workflow
```

  ### **Stage 2: Requirement Extraction**

```
Input: Parsed document text
Output: Structured questions/requirements JSON

Flow:
1. Send document to Claude with extraction prompt
2. Claude returns structured JSON:
   {
     "sections": [...],
     "questions": [
       {
         "id": "Q1",
         "text": "Describe your security controls...",
         "section": "Security",
         "page_limit": 2,
         "mandatory": true
       }
     ],
     "page_limits": {...},
     "submission_deadline": "2025-12-15"
   }
3. Generate compliance matrix
4. Store in DynamoDB
```

**Key Prompt Engineering:**

* Extract ALL questions (explicit and implied)  
* Identify section structure and page limits  
* Flag mandatory vs optional requirements  
* Extract evaluation criteria weights

  ### **Stage 3: Knowledge Base Query**

```
Input: Extracted question
Output: Relevant context chunks with sources

Flow:
1. Embed question using Bedrock Titan
2. Query OpenSearch for similar chunks
3. Also check Content Library for matching Q&A pairs
4. Return top-k results with source metadata
5. Track attribution for citations
```

**Knowledge Base Contents:**

* Certifications (from 04 Certifications folder)  
* Case studies (from Government Contracting drive)  
* Team resumes and bios  
* Past proposals and responses  
* Company boilerplate (win themes, differentiators)

  ### **Stage 4: Response Generation**

```
Input: Question + retrieved context
Output: Generated response + confidence score + sources

Flow:
1. Construct prompt with question + context chunks
2. Include Horus win themes and messaging guidelines
3. Call Claude for response synthesis
4. Calculate confidence score based on:
   - Context relevance (embedding similarity)
   - Source recency
   - Coverage of question requirements
5. Return response with sources and score
```

**Confidence Score Logic:**

* 90-100%: High confidence, minimal review needed  
* 70-89%: Medium confidence, should verify  
* Below 70%: Low confidence, requires human attention

  ### **Stage 5: Human Review & Export**

```
Input: Generated responses
Output: Final proposal document

Flow:
1. Present responses in editable UI
2. Show confidence scores and source citations
3. Allow section-by-section editing
4. AI Writing Assistant for polish (future)
5. Generate Word document with formatting
6. Create Linear ticket if Go decision
```

  ---

  ## **7\. Data Models**

  ### **DynamoDB Tables**

**Projects Table**

```ts
interface Project {
  projectId: string;          // Partition key
  userId: string;             // GSI for user's projects
  name: string;
  status: 'draft' | 'in_progress' | 'review' | 'submitted';
  rfpDocumentKey: string;     // S3 key
  submissionDeadline?: string;
  goNoGoDecision?: 'go' | 'no_go' | 'pending';
  createdAt: string;
  updatedAt: string;
}
```

**Questions Table**

```ts
interface Question {
  questionId: string;         // Partition key
  projectId: string;          // GSI
  text: string;
  section: string;
  pageLimit?: number;
  mandatory: boolean;
  status: 'pending' | 'generated' | 'reviewed' | 'approved';
  generatedResponse?: string;
  editedResponse?: string;
  confidenceScore?: number;
  sources: Source[];
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}
```

**ContentLibrary Table**

```ts
interface ContentEntry {
  entryId: string;            // Partition key
  question: string;           // Canonical question
  alternativeQuestions: string[];
  answer: string;
  category: string;
  tags: string[];
  lastReviewedAt: string;
  lastUsedAt: string;
  usageCount: number;
  status: 'active' | 'stale' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### **S3 Bucket Structure**

```
horus-autorfp-{env}/
├── uploads/
│   └── {projectId}/
│       └── {original-filename}
├── parsed/
│   └── {projectId}/
│       └── {documentId}.json
├── knowledge-base/
│   ├── certifications/
│   ├── case-studies/
│   ├── resumes/
│   └── proposals/
└── exports/
    └── {projectId}/
        └── {export-filename}.docx
```

---

## **8\. API Design**

### **Core Endpoints**

**Projects**

```
POST   /projects                 Create new project
GET    /projects                 List user's projects
GET    /projects/{id}            Get project details
PUT    /projects/{id}            Update project
DELETE /projects/{id}            Delete project
POST   /projects/{id}/upload     Upload RFP document
POST   /projects/{id}/process    Trigger processing
GET    /projects/{id}/questions  Get extracted questions
POST   /projects/{id}/export     Generate Word export
```

**Questions**

```
GET    /questions/{id}           Get question details
PUT    /questions/{id}           Update response
POST   /questions/{id}/regenerate Regenerate AI response
PUT    /questions/{id}/assign    Assign to team member
```

**Content Library**

```
GET    /library                  List entries (paginated)
POST   /library                  Create entry
GET    /library/{id}             Get entry
PUT    /library/{id}             Update entry
DELETE /library/{id}             Archive entry
POST   /library/search           Semantic search
GET    /library/stale            Get stale entries
```

**Knowledge Base**

```
POST   /knowledge/sync           Sync from Google Drive
GET    /knowledge/status         Get sync status
POST   /knowledge/search         Query knowledge base
```

---

## **9\. Key Implementation Details**

### **Claude Prompt Templates**

**Question Extraction Prompt:**

```
You are an expert at analyzing government RFP documents. Extract all questions and requirements from the following document.

For each item, identify:
1. The exact question or requirement text
2. Which section it belongs to
3. Any page/word limits
4. Whether it's mandatory or optional
5. Evaluation criteria if mentioned

Return as JSON array. Include implied questions (e.g., if they ask for "team qualifications", that implies questions about each team member).

Document:
{document_text}
```

**Response Generation Prompt:**

```
You are a government proposal writer for Horus Technology, an AWS partner specializing in cloud solutions for government agencies.

Question: {question}

Context from our knowledge base:
{retrieved_chunks}

Write a professional, compliant response that:
1. Directly addresses all parts of the question
2. Incorporates specific evidence from the context
3. Highlights our AWS expertise and government experience
4. Uses formal proposal language
5. Stays within {page_limit} pages if specified

Key win themes to incorporate where relevant:
- FedRAMP High compliance experience
- Southern California presence and responsiveness
- Small business agility with enterprise capabilities
- Proven government track record

Cite sources using [Source: filename] notation.
```

### **OpenSearch Index Configuration**

```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100
    }
  },
  "mappings": {
    "properties": {
      "embedding": {
        "type": "knn_vector",
        "dimension": 1536,
        "method": {
          "name": "hnsw",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 128,
            "m": 24
          }
        }
      },
      "text": { "type": "text" },
      "source": { "type": "keyword" },
      "category": { "type": "keyword" },
      "updated_at": { "type": "date" }
    }
  }
}
```

### **Step Functions Workflow**

```json
{
  "StartAt": "ParseDocument",
  "States": {
    "ParseDocument": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:parse-document",
      "Next": "ExtractQuestions",
      "Retry": [{"ErrorEquals": ["States.ALL"], "MaxAttempts": 3}]
    },
    "ExtractQuestions": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:extract-questions",
      "Next": "ProcessQuestions"
    },
    "ProcessQuestions": {
      "Type": "Map",
      "ItemsPath": "$.questions",
      "Iterator": {
        "StartAt": "QueryKnowledgeBase",
        "States": {
          "QueryKnowledgeBase": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:...:query-kb",
            "Next": "GenerateResponse"
          },
          "GenerateResponse": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:...:generate-response",
            "End": true
          }
        }
      },
      "Next": "GenerateExecutiveBrief"
    },
    "GenerateExecutiveBrief": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:generate-brief",
      "End": true
    }
  }
}
```

---

## **10\. Development Plan**

### **Phase 0: Initial (Weeks 1-2) — 26 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| HOR-1311HOR-1270 | AWS Infrastructure Setup (CDK/SAM)  | 8 |
| HOR-1312NEW | Organization CRUD | 4 |
| NEW | Project CRUD | 4 |
| NEW | User CRUD | 4 |
| HOR-1286NEW | Documents Upload S3 Presign URL for Questions | 4 |
| HOR-1276NEW | Documents Upload S3 Presign URL for KnolageBase (opensearch indexing) | 8 |
| NEW | Question Document Processing | 8 |
| NEW | Response Generating (take top n files from knolagebase and process using badrock) | 8 |

### **Phase 1: Infrastructure (Weeks 1-2) — 26 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| HOR-1270 | AWS Infrastructure Setup (CDK/SAM) | 8 |
| HOR-1271 | Bedrock Claude Integration | 4 |
| HOR-1272 | Next.js Project Scaffolding | 4 |
| HOR-1273 | Amplify Deployment Pipeline | 4 |
| HOR-1274 | OpenSearch Serverless Setup | 6 |

**Deliverable:** Infrastructure deployed, basic app running on Amplify

### **Phase 2: Document Processing (Weeks 3-5) — 50 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| NEW | Document Upload API (S3 presigned URLs) | 8 |
| NEW | PDF Parser (Textract) | 8 |
| NEW | Word Parser (python-docx) | 4 |
| HOR-1275 | Question Extraction Prompts | 12 |
| NEW | Compliance Matrix Generator | 8 |
| NEW | Step Functions Orchestration | 10 |

**Deliverable:** Upload RFP → Extract structured questions

### **Phase 3: Knowledge Base & RAG (Weeks 6-8) — 64 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| HOR-1276 | Knowledge Base Indexer | 12 |
| NEW | Vector Embedding Pipeline | 8 |
| NEW | Semantic Search API | 8 |
| HOR-1277 | Response Generation Engine | 16 |
| NEW | Source Attribution | 6 |
| NEW | Confidence Score System | 6 |
| NEW | Win Theme Integration | 8 |

**Deliverable:** RAG pipeline generating contextual responses

### **Phase 4: UI Development (Weeks 9-11) — 74 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| HOR-1281 | Document Upload UI | 8 |
| HOR-1279 | Project Dashboard | 10 |
| NEW | Requirements Review Interface | 10 |
| HOR-1280 | Response Editor | 12 |
| HOR-1278 | Executive Brief Generator | 8 |
| HOR-1283 | Word Export | 8 |
| NEW | Auth Flow (Cognito) | 6 |
| NEW | Content Library MVP | 12 |

**Deliverable:** Full application UI

### **Phase 5: Integration & Testing (Weeks 12-14) — 50 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| HOR-1282 | Linear Integration | 6 |
| NEW | Google Drive Sync | 8 |
| NEW | E2E Tests (Playwright) | 12 |
| NEW | Performance Optimization | 8 |
| HOR-1284 | UAT with Brennen/Ecuador | 16 |

**Deliverable:** Tested, integrated system

### **Phase 6: Deployment (Weeks 15-16) — 32 hours**

| Ticket | Task | Hours |
| ----- | ----- | ----- |
| NEW | Production Environment | 8 |
| NEW | User Documentation | 8 |
| NEW | Technical Documentation | 8 |
| NEW | Training Session | 4 |
| NEW | Monitoring & Alerts | 4 |

**Deliverable:** Production launch

---

## **11\. Cost Estimates**

### **AWS Monthly Costs**

| Service | Monthly Cost |
| ----- | ----- |
| Bedrock (Claude) | $100 \- $500 |
| OpenSearch Serverless | $50 \- $150 |
| Lambda \+ API Gateway | $20 \- $50 |
| S3 \+ DynamoDB | $10 \- $30 |
| Cognito \+ Amplify | $15 \- $40 |
| **TOTAL** | **$195 \- $770** |

### **ROI Analysis**

**Current State:**

* \~40 hours per RFP response  
* $75/hr average labor cost  
* $3,000 per RFP response  
* 20 RFPs/year \= $60,000 annual cost

**With Auto\_RFP (70% reduction):**

* \~12 hours per RFP response  
* $900 per RFP response  
* 20 RFPs/year \= $18,000 annual cost  
* **$42,000 annual savings**

**Breakeven:** \~8-10 months

---

## **12\. Open Questions & Risks**

### **Technical Risks**

| Risk | Mitigation |
| ----- | ----- |
| Claude extraction accuracy | Extensive prompt engineering; iterative refinement with real RFPs |
| OpenSearch cold starts | Use provisioned OCUs for production |
| Large document handling | Chunking strategy; async processing |
| Google Drive API limits | Batch syncing; caching |

### **Product Risks**

| Risk | Mitigation |
| ----- | ----- |
| User adoption | Involve Brennen early; match existing workflow |
| Content library cold start | Pre-populate from past proposals |
| Response quality | Confidence scores; human review workflow |

### **Open Questions**

1. **Multi-tenant for VRC:** Build now or later? Current plan: P3 (future)  
2. **FedRAMP path:** Do we need Private AI deployment? Current plan: Monitor need  
3. **PlanetBids integration:** Direct API or manual download? Current plan: Manual (P2)  
4. **Offline access:** Required for any users? Current plan: No  
   ---

   ## **13\. Resources**

   ### **Competitor Platforms**

* [Inventive AI](https://www.inventive.ai/)  
* [Loopio](https://loopio.com/)  
* [AutoRFP.ai](https://autorfp.ai/)  
* [V7 Labs RFP Agent](https://www.v7labs.com/agents/rfp-response-generation-agent)  
* [Responsive](https://www.responsive.io/)

   ### **Industry Best Practices (from Local Docs)**

* [10 Deadly Proposal Mistakes](local-docs/10%20Deadly%20Proposal%20Mistakes%20That%20Kill%20Government%20Contract%20Wins.md)
* [Bid/No-Bid Decision Framework](local-docs/How%20to%20Make%20Quick%20Bid%20or%20No-Bid%20Decisions.txt)
* [10 Essential AI Prompts](local-docs/10%20AI%20Prompts%20for%20Easy%20Government%20Contracting%20clean.md)

  ### **Technical References**

* [LlamaIndex Auto\_RFP (GitHub)](https://github.com/run-llama/auto_rfp)  
* [LlamaCloud RFP Demo](https://github.com/run-llama/llamacloud-demo)  
* [RAG for RFP Automation](https://www.griddynamics.com/blog/retrieval-augmented-generation-llm)

  ### **Government Contracting**

* [SBA: How to Win Contracts](https://www.sba.gov/federal-contracting/contracting-guide/how-win-contracts)  
* [SAM.gov](https://sam.gov/)

  ### **Industry Statistics**

* Average RFP: 23 hours, 9 people (MarketingProfs)  
* RFP cost: $35K-$65K (LinkedIn)  
* Average win rate: 44% (OpenAsset)  
* RFP tools improve win rate 45% vs 41% (WebinarCare)  
  ---

  ## **14\. Executive Opportunity Brief Schema**

The Executive Opportunity Brief is a critical feature that enables rapid Go/No-Go decisions. Based on industry best practices, every RFP analysis must produce a structured brief that answers: "Should we bid on this?"

### **Data Model**

```typescript
interface ExecutiveOpportunityBrief {
  // Quick Overview
  summary: {
    title: string;
    agency: string;
    solicitationNumber: string;
    naicsCode: string;
    contractType: string;  // FFP, T&M, CPFF, IDIQ, etc.
    estimatedValue: string;
    setAside: string | null;  // "Small Business", "8(a)", "HUBZone", "WOSB", etc.
    opportunityStage: 'Sources Sought' | 'RFI' | 'RFP' | 'RFQ';
  };
  
  // Bid/No-Bid Decision Framework (Industry Standard Criteria)
  bidDecisionCriteria: {
    technicalFit: {
      score: 1 | 2 | 3 | 4 | 5;  // 1=Poor, 5=Excellent
      canMeetRequirements: boolean;
      gaps: string[];  // What capabilities are we missing?
      subcontractorNeeds: string[];  // What expertise should we partner for?
    };
    
    pastPerformanceRelevance: {
      score: 1 | 2 | 3 | 4 | 5;
      relevantProjects: Array<{
        title: string;
        agency: string;
        year: string;
        relevanceScore: number;
      }>;
      needsSubcontractor: boolean;
      subcontractorStrategy?: string;
    };
    
    pricingPosition: {
      score: 1 | 2 | 3 | 4 | 5;
      estimatedCost: number;
      competitiveRange: { min: number; max: number };
      marginViable: boolean;
      pricingStrategy: 'Lowest Price' | 'Best Value' | 'Negotiated';
    };
    
    strategicAlignment: {
      score: 1 | 2 | 3 | 4 | 5;
      buildsPortfolio: boolean;
      targetNiche: boolean;
      futureOpportunities: string[];  // What doors does this open?
    };
    
    incumbentRisk: {
      isRecompete: boolean;
      incumbentName?: string;
      incumbentPerformance: 'strong' | 'weak' | 'unknown';
      winProbability: 'high' | 'medium' | 'low';
      riskMitigation?: string;
    };
  };
  
  // Comprehensive Deadline Management
  criticalDates: {
    questionDeadline?: {
      date: string;
      daysUntil: number;
      warningLevel: 'urgent' | 'upcoming' | 'future';
    };
    
    siteVisitDate?: {
      date: string;
      location: string;
      registrationRequired: boolean;
      daysUntil: number;
    };
    
    submissionDeadline: {
      date: string;
      time: string;
      timezone: string;
      submissionMethod: 'SAM.gov' | 'Email' | 'Portal' | 'Physical';
      daysUntil: number;
      recommendedSubmitBy: string;  // 24 hours early
    };
    
    estimatedAwardDate?: string;
    performanceStartDate?: string;
    postAwardSubmittals?: Array<{
      requirement: string;
      dueDate: string;
    }>;
  };
  
  // Detailed Requirements Summary
  requirements: {
    scope: string;  // High-level summary
    deliverables: Array<{
      item: string;
      quantity?: number;
      deadline?: string;
    }>;
    
    keyMilestones: Array<{
      milestone: string;
      date?: string;
      criticality: 'high' | 'medium' | 'low';
    }>;
    
    evaluationCriteria: Array<{
      criterion: string;
      weight: number;  // Percentage or point value
      description: string;
    }>;
    
    certifications: string[];  // Required certifications
    clearances: string[];  // Security clearance requirements
  };
  
  // Differentiated Contact Information
  contacts: {
    contractingOfficer: {
      name: string;
      email: string;
      phone?: string;
      role: 'Primary Contact';
    };
    
    technicalQuestions: {
      name: string;
      email: string;
      phone?: string;
      role: 'COR' | 'Technical POC';
    };
    
    proposalSubmission: {
      email: string;
      instructions: string;
      role: 'Submission Point';
    };
  };
  
  // Risk Analysis (Critical for Early Filtering)
  riskAssessment: {
    redFlags: Array<{
      flag: string;
      severity: 'high' | 'medium' | 'low';
      mitigation?: string;
    }>;
    
    unclearAreas: Array<{
      issue: string;
      questionToAsk: string;
    }>;
    
    overallRisk: 'low' | 'medium' | 'high';
    riskNotes: string;
  };
  
  // Submission Compliance Requirements
  submissionRequirements: {
    formatRequirements: {
      fileType: string[];  // ["PDF", "Word"]
      pageLimit?: number;
      fontRequirements?: string;
      marginRequirements?: string;
    };
    
    requiredDocuments: Array<{
      document: string;
      mandatory: boolean;
    }>;
    
    specialInstructions: string[];
  };
  
  // Final Recommendation
  recommendation: {
    decision: 'GO' | 'NO-GO' | 'NEEDS-REVIEW';
    overallScore: number;  // Composite of all criteria scores
    confidence: number;  // 0-100
    reasoning: string;
    
    nextSteps: Array<{
      action: string;
      deadline?: string;
      owner?: string;
    }>;
    
    winningStrategy?: string;  // If GO, what's the approach?
  };
  
  // Metadata
  metadata: {
    generatedAt: string;
    lastUpdated: string;
    documentVersion: string;
    aiConfidence: number;
  };
}
```

### **Example Executive Brief**

```json
{
  "summary": {
    "title": "Cloud Infrastructure Modernization",
    "agency": "Department of Veterans Affairs",
    "solicitationNumber": "36C10B23Q0045",
    "naicsCode": "518210",
    "contractType": "FFP",
    "estimatedValue": "$2.5M - $5M",
    "setAside": "Small Business",
    "opportunityStage": "RFP"
  },
  "bidDecisionCriteria": {
    "technicalFit": {
      "score": 5,
      "canMeetRequirements": true,
      "gaps": [],
      "subcontractorNeeds": []
    },
    "pastPerformanceRelevance": {
      "score": 4,
      "relevantProjects": [
        {
          "title": "AWS Migration - DHS",
          "agency": "Department of Homeland Security",
          "year": "2024",
          "relevanceScore": 0.95
        }
      ],
      "needsSubcontractor": false
    },
    "pricingPosition": {
      "score": 4,
      "estimatedCost": 3200000,
      "competitiveRange": { "min": 2500000, "max": 5000000 },
      "marginViable": true,
      "pricingStrategy": "Best Value"
    },
    "strategicAlignment": {
      "score": 5,
      "buildsPortfolio": true,
      "targetNiche": true,
      "futureOpportunities": ["VA IDIQ", "Cloud SaaS contracts"]
    },
    "incumbentRisk": {
      "isRecompete": false,
      "winProbability": "high"
    }
  },
  "recommendation": {
    "decision": "GO",
    "overallScore": 4.5,
    "confidence": 87,
    "reasoning": "Strong technical fit, relevant past performance, competitive pricing, strategic alignment with VA portfolio. No incumbent risk.",
    "nextSteps": [
      { "action": "Submit questions by Dec 15", "deadline": "2025-12-15" },
      { "action": "Schedule site visit", "deadline": "2025-12-18" },
      { "action": "Finalize pricing with subcontractors", "deadline": "2025-12-20" }
    ],
    "winningStrategy": "Emphasize FedRAMP High experience, VA-specific cloud modernizations, small business responsiveness"
  }
}
```

---

## **15\. AI Prompt Templates**

These prompts are derived from industry best practices (see local-docs) and represent the essential questions that Auto_RFP must answer for every opportunity.

### **1\. Requirements & Deliverables Extraction**

```
SYSTEM: You are an expert at analyzing government RFP documents.

TASK: Extract the main requirements and deliverables from this solicitation.

Include:
- Scope of work summary
- Specific deliverables with quantities
- Performance requirements
- Technical specifications
- Compliance requirements (certifications, clearances, registrations)
- Staffing or personnel requirements
- Equipment or infrastructure requirements

Format as structured JSON.

DOCUMENT: {rfp_text}
```

### **2\. Comprehensive Deadline Extraction**

```
SYSTEM: You are a deadline tracking specialist for government contracts.

TASK: Find ALL dates and deadlines in this solicitation, not just the submission deadline.

Extract:
- Questions submission deadline (date, time, timezone)
- Site visit dates and registration requirements
- Proposal due date and time (with timezone)
- Estimated award date
- Contract start date
- Performance period dates
- Key milestone deadlines
- Post-award submittal requirements and deadlines
- Q&A response dates

CRITICAL: Many opportunities have multiple deadlines. Missing any can be disqualifying.

DOCUMENT: {rfp_text}
```

### **3\. Budget & Contract Value Analysis**

```
SYSTEM: You are a pricing analyst for government contracts.

TASK: Find any information about contract value, budget, or funding.

Look for:
- Stated contract value or range
- Estimated budget
- IDIQ ceiling amounts
- Option year values
- Funding source references
- Contract type (FFP, T&M, CPFF, etc.)
- Payment terms

Note: Forecasts typically include budget ranges. RFPs may not disclose budgets.

DOCUMENT: {rfp_text}
```

### **4\. Eligibility & Set-Aside Requirements**

```
SYSTEM: You are an expert on government contracting eligibility requirements.

TASK: Determine who is eligible to bid on this opportunity.

Extract:
- Set-aside type (Small Business, 8(a), HUBZone, WOSB, SDVOSB, etc.)
- NAICS code and size standard
- Required registrations (SAM.gov, CAGE code, etc.)
- Required certifications (ISO, CMMI, FedRAMP, etc.)
- Security clearances required
- Geographic restrictions
- Subcontracting restrictions or requirements

DOCUMENT: {rfp_text}
```

### **5\. Contact Information Extraction**

```
SYSTEM: You are mapping the contact structure for a government solicitation.

TASK: Find ALL contact information and clarify roles.

Different contacts may handle:
- Technical questions (COR, Technical POC)
- Contractual questions (Contracting Officer)
- Proposal submission (may be different email/portal)
- Site visit coordination
- Q&A responses

Extract:
- Name, title, email, phone for each contact
- Specific responsibilities of each contact
- Submission method and address

IMPORTANT: Sending questions to wrong contact causes delays.

DOCUMENT: {rfp_text}
```

### **6\. Required Documentation Checklist**

```
SYSTEM: You are creating a submission checklist.

TASK: List ALL documents required for proposal submission.

Include:
- Technical proposal components
- Price proposal format
- Past performance references (quantity, format)
- Certifications and representations
- Subcontracting plans
- Small business documentation
- Resumes or personnel qualifications
- Corporate experience
- Any forms or templates

Note format requirements (PDF, Word, page limits, font, margins).

DOCUMENT: {rfp_text}
```

### **7\. Evaluation Criteria Analysis**

```
SYSTEM: You are an evaluation criteria specialist.

TASK: Extract how proposals will be evaluated and scored.

Find:
- Evaluation factors (technical, price, past performance, etc.)
- Relative weights or point values for each factor
- Subfactors and their weights
- Evaluation methodology (Lowest Price Technically Acceptable, Best Value, etc.)
- Technical acceptability thresholds
- Scoring details

CRITICAL: Proposals must directly address weighted criteria to be competitive.

DOCUMENT: {rfp_text}
```

### **8\. Risk & Red Flag Detection**

```
SYSTEM: You are a risk assessment analyst for government contracts.

TASK: Identify potential risks, red flags, or concerning elements in this solicitation.

Look for:
- Unrealistic timelines
- Vague or contradictory requirements
- Incumbent advantages (if recompete)
- Unusually low budget for scope
- Missing critical information
- Complex compliance requirements
- Short response time
- Restrictive eligibility criteria
- Unclear evaluation criteria
- Intellectual property concerns

Rate overall risk: LOW, MEDIUM, HIGH

DOCUMENT: {rfp_text}
```

### **9\. Incumbent & Recompete Analysis**

```
SYSTEM: You are analyzing whether this is a new contract or recompete.

TASK: Determine if there is an incumbent contractor and assess recompete risk.

Find:
- Is this explicitly a recompete?
- Is an incumbent contractor mentioned?
- What is known about incumbent performance?
- Are there references to "current contractor" or "existing contract"?
- Contract numbers for predecessor contracts
- Transition requirements

Assess win probability considering incumbent advantage.

DOCUMENT: {rfp_text}
```

### **10\. Winning Strategy Recommendation**

```
SYSTEM: You are an experienced government contracting strategist.

TASK: Based on this solicitation analysis, recommend a winning strategy.

Consider:
- What evaluation criteria should we emphasize?
- What differentiators should we highlight?
- What past performance is most relevant?
- Should we partner with subcontractors? For what capabilities?
- What questions should we ask during Q&A?
- What are the must-win discriminators?
- How should we position pricing?

Provide specific, actionable recommendations.

OPPORTUNITY ANALYSIS: {brief_summary}
COMPANY PROFILE: {company_data}
```

---

## **16\. Submission Compliance Checker**

Before any proposal is submitted, it must pass automated compliance checks. This feature prevents common "killer mistakes" that lead to disqualification.

### **Compliance Check Data Model**

```typescript
interface SubmissionComplianceCheck {
  // Format Compliance
  formatRequirements: {
    checks: Array<{
      requirement: string;
      required: string;  // Expected value
      actual: string;    // What was submitted
      compliant: boolean;
      severity: 'critical' | 'warning';
    }>;
    
    fileType: {
      required: string[];  // ["PDF", "Word"]
      submitted: string;
      compliant: boolean;
    };
    
    pageLimit: {
      required: number;
      submitted: number;
      compliant: boolean;
    };
    
    fontRequirements?: {
      required: string;
      compliant: boolean;
    };
    
    marginRequirements?: {
      required: string;
      compliant: boolean;
    };
  };
  
  // Document Completeness
  requiredDocuments: Array<{
    document: string;
    mandatory: boolean;
    submitted: boolean;
    compliant: boolean;
    issues?: string[];
  }>;
  
  // Content Validation
  contentValidation: {
    allQuestionsAnswered: {
      total: number;
      answered: number;
      unanswered: string[];
      compliant: boolean;
    };
    
    evaluationCriteriaAddressed: {
      total: number;
      addressed: number;
      missing: string[];
      compliant: boolean;
    };
    
    certificationsIncluded: {
      required: string[];
      included: string[];
      missing: string[];
      compliant: boolean;
    };
    
    pricingFormatCorrect: {
      formatRequired: string;
      compliant: boolean;
      issues?: string[];
    };
    
    pageLimitsRespected: Array<{
      section: string;
      limit: number;
      actual: number;
      compliant: boolean;
    }>;
  };
  
  // Quality Checks (Non-Critical)
  qualityChecks: {
    grammarErrors: number;
    spellingErrors: number;
    suggestions: string[];
    readabilityScore?: number;
  };
  
  // Overall Compliance Status
  overallStatus: {
    compliant: boolean;
    criticalIssues: number;
    warnings: number;
    readyToSubmit: boolean;
    blockers: string[];  // What must be fixed before submission
  };
  
  // Submission Readiness Checklist
  submissionChecklist: Array<{
    item: string;
    complete: boolean;
    required: boolean;
  }>;
}
```

### **Compliance Check Process**

```
1. Pre-Submission Validation:
   - Run compliance check 24 hours before deadline
   - Flag critical issues that prevent submission
   - Warn about non-critical quality issues

2. Format Validation:
   - File type matches requirements
   - Page count within limits
   - Font, margins, spacing meet specs
   - File naming conventions followed

3. Content Completeness:
   - All questions have responses
   - All evaluation criteria addressed
   - Required certifications included
   - Pricing format matches RFP template

4. Quality Validation:
   - Grammar and spelling check
   - Professional polish
   - Consistent formatting
   - No copy-paste artifacts

5. Final Checklist:
   - SAM.gov registration active
   - Representations & certifications current
   - Past performance references provided
   - Subcontracting plan (if required)
   - Signed cover letter
```

### **Implementation Notes**

* Run compliance checks incrementally as proposal sections are completed
* Provide real-time feedback during editing
* Block submission if critical issues exist
* Generate compliance report for review
* Track compliance history for continuous improvement

---

## **17\. Updated Development Plan**

### **Phase 0: Revised (with New Insights)**

| Ticket | Task | Hours | Priority |
|--------|------|-------|----------|
| NEW | Executive Brief Schema | 8 | P0 |
| NEW | Bid/No-Bid Scoring Engine | 12 | P0 |
| NEW | Comprehensive Deadline Tracker | 8 | P0 |
| NEW | Risk Flag Detection | 6 | P0 |
| NEW | Contact Directory Management | 4 | P1 |
| NEW | Compliance Checker Backend | 10 | P1 |

### **Updated Feature Priorities**

**P0 - Must Have for Competitive Parity:**

| Feature | Reason (from Industry Research) |
|---------|--------------------------------|
| **Executive Brief Generation** | Core Go/No-Go decision support; $15k average bid cost makes fast decisions critical |
| **Bid/No-Bid Scoring Framework** | 5 criteria framework (technical fit, past performance, pricing, strategy, incumbent risk) |
| **Comprehensive Deadline Tracking** | Submit 24 hours early; track ALL deadlines (questions, site visits, submittals, not just final deadline) |
| **Risk Flag Detection** | Identify disqualifying issues in first 5 minutes to save time |
| **Contact Directory** | Different contacts for questions vs submission; wrong contact = delays |
| **Submission Compliance Checker** | Format, page count, document requirements validation prevents disqualification |

**P1 - High Value Features:**

| Feature | Reason |
|---------|---------|
| **Incumbent Analysis** | Recompete risk assessment critical for win probability |
| **Q&A Window Tracker** | Questions deadline often separate from submission |
| **Grammar/Polish Checker** | Professional appearance impacts evaluator bias |
| **Evaluation Criteria Mapper** | Responses must address weighted criteria |
| **Budget Range Analyzer** | Pricing strategy depends on estimated value |

---

## **18\. Next Steps**

1. **Review and approve** updated technical design with new sections (15-17)
2. **Create Linear tickets** for new P0 features:
   - Executive Brief Generation
   - Bid/No-Bid Scoring Engine
   - Comprehensive Deadline Tracker
   - Risk Flag Detection
   - Compliance Checker
3. **Update existing prompts** to match 10 essential prompt templates
4. **Implement Executive Brief schema** in DynamoDB
5. **Build compliance checker** validation logic
6. **Integrate deadline calendar** with notifications
7. **Test with real RFPs** from Brennen's pipeline
   
---

*Document maintained in: Linear Project [Auto\_RFP](https://linear.app/horustech/project/auto-rfp-d8d38042069c)*

*Last Updated: December 11, 2025*
*Version: 3.0 (Incorporating Industry Best Practices)*

*
