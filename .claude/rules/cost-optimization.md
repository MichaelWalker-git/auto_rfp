When generating AWS CDK infrastructure, you MUST strictly optimize for minimal monthly cost.

Follow these rules:

1. Networking:
- NEVER create a NAT Gateway.
- NEVER create a VPC unless explicitly required.
- If VPC is required, do NOT attach Lambda to private subnets unless absolutely necessary.
- Prefer public services over VPC-attached services.

2. Compute:
- Use AWS Lambda instead of EC2.
- Do NOT create EC2 instances.
- Do NOT create ECS, EKS, or Fargate unless explicitly requested.
- Set Lambda memory to 128MB by default unless higher is required.
- Set short timeouts (<= 10 seconds unless required).

3. API Layer:
- Use API Gateway HTTP API (v2), NOT REST API.
- Avoid custom domain setup unless explicitly requested.

4. Database:
- Use DynamoDB with billing mode PAY_PER_REQUEST.
- NEVER provision fixed capacity.
- NEVER create RDS unless explicitly required.
- NEVER create Aurora unless explicitly required.

5. Storage:
- Use S3 with:
    - Intelligent tiering OR
    - Standard (no replication)
- Disable versioning unless explicitly required.
- Disable cross-region replication.

6. Logs & Monitoring:
- Set CloudWatch log retention to 3–7 days.
- Do NOT enable detailed monitoring.
- Do NOT enable X-Ray unless explicitly requested.

7. Scaling:
- Avoid provisioned concurrency.
- Avoid auto scaling groups.
- Avoid reserved capacity.

8. Security:
- Use minimal IAM permissions (least privilege).
- Avoid complex networking that increases cost.

9. Defaults:
- Assume low traffic (<100k requests/month).
- Optimize for <$5/month total infrastructure cost.
- Prefer serverless-first architecture.

If a design choice increases fixed monthly cost, explain why and provide a cheaper alternative.