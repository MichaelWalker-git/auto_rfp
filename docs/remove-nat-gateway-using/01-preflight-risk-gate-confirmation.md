# 01 — Pre-flight risk-gate confirmation

**What to build:** Not code — a documented sign-off, obtained before any implementation work starts, confirming none of the three risks flagged in ADR-001 block removing `IndexDocumentLambda`'s VPC attachment:

1. The Pinecone account owner confirms no IP allowlist is tied to the shared `blueprint-checker-vpc-dev` NAT Gateway's Elastic IP.
2. No near-term plan exists to call a private-endpoint OpenSearch Serverless collection from this pipeline (the unused `aoss:APIAccessAll` IAM grant on `IndexDocumentLambda` is the signal prompting this check).
3. No organizational egress-control policy mandates VPC + security-group egress filtering for data-touching Lambdas.

If any of the three comes back "yes" or stays unresolved, this migration is blocked — revisit ADR-001 Alternatives A (EC2 NAT instances / fck-nat in the shared VPC) or B (VPC Interface/Gateway Endpoints) instead of proceeding to ticket 02.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Pinecone account owner has confirmed, in writing, no IP allowlist is tied to the shared VPC's NAT Elastic IP
- [ ] Confirmed no near-term (this quarter) plan requires a private-endpoint OpenSearch Serverless collection on the document-indexing pipeline
- [ ] Confirmed no org egress-control policy requires VPC-scoped security-group egress filtering for data-touching Lambdas
- [ ] All three confirmations are recorded (e.g. linked in this ticket or the PR for ticket 02) so ticket 02 can reference them
