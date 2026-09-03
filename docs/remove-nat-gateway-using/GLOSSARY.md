# Glossary — NAT Gateway removal work

Definitions specific to this migration.

- **NAT Gateway** — AWS-managed network address translation service. Sits in a public subnet, gives private-subnet resources outbound-only internet access. Billed per-hour + per-GB processed.
- **NAT instance** — a self-managed EC2 instance performing the same role via iptables MASQUERADE + IP forwarding. Cheaper at low-to-moderate throughput, but requires HA / monitoring the user has to run themselves.
- **fck-nat** — a community-maintained AMI + CDK/Terraform construct that packages the NAT-instance pattern with sensible defaults (health checks, automatic route-table failover, ARM/Graviton, CloudWatch metrics). The de-facto "NAT-instance done right" option.
- **`blueprint-checker-vpc-dev`** — the shared VPC (id `vpc-0e8bca582530ec949`, owned by another team) that AutoRFP consumes via `Vpc.fromLookup`. Hosts the NAT Gateway AutoRFP currently depends on.
- **`IndexDocumentLambda`** — the single AutoRFP Lambda currently attached to a VPC. Defined in `packages/infra/document-pipeline-step-function.ts:223-247`. Embeds document chunks (Bedrock Titan v2) and writes them to Pinecone.
- **VPC-attached Lambda** — a Lambda whose network interface lives in a VPC subnet. Loses the AWS-managed default internet path; must reach the internet through the VPC's route tables (NAT Gateway or NAT instance).
- **VPC Interface Endpoint** — an ENI inside a VPC that routes AWS API traffic (Bedrock, Secrets Manager, etc.) directly to the service without going through the internet or a NAT. Paid per-hour + per-GB. Considered and rejected as a middle-ground alternative (see ADR-001, Alternative B).
- **VPC Gateway Endpoint** — the free variant for S3 and DynamoDB only. Adds a route-table entry, no ENI.
- **AOSS / `aoss:APIAccessAll`** — OpenSearch Serverless API permission granted to `IndexDocumentLambda` but currently unused. Its presence is the main "future intent" flag to check before removing the VPC attachment.
- **Pinecone** — external vector-database SaaS. Public HTTPS API. Not hosted in any of our VPCs.
- **`AWSLambdaVPCAccessExecutionRole`** — the AWS-managed IAM policy that lets Lambda create/delete ENIs in a VPC. Required for VPC-attached Lambdas; useless (and slightly noisy) once the Lambda leaves the VPC.
- **ENI (Elastic Network Interface)** — the virtual NIC AWS creates for a VPC-attached Lambda. Attachment adds cold-start latency; removal is the main perf win of this change.
