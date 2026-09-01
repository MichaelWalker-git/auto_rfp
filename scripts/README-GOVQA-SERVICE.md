# GovQA Submission Service

## Overview

This Python service provides automated submission to GovQA public records portals using the `govqa-py` library.

## Prerequisites

1. **Python 3.9+**
2. **govqa-py library**: `pip install govqa-py`
3. **CAPTCHA solving service**: 2Captcha or Anti-Captcha account
4. **AWS Lambda layer** (for Lambda deployment)

## Local Development

### Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install govqa-py twocaptcha anticaptcha-python boto3

# Set environment variables
export CAPTCHA_API_KEY="your-2captcha-api-key"
```

### Testing

```bash
# Dry run against CDFW portal (does not submit)
python govqa-submission-service.py --test-cdfw

# Test with actual CAPTCHA key
python govqa-submission-service.py --test-cdfw --captcha-key YOUR_KEY
```

## Lambda Deployment

### Option 1: Lambda Layer

Create a Lambda layer with govqa-py and its dependencies:

```bash
# Create layer directory
mkdir -p lambda-layer/python

# Install dependencies into layer
pip install govqa-py twocaptcha -t lambda-layer/python/

# Package layer
cd lambda-layer
zip -r govqa-layer.zip python/

# Upload to AWS Lambda
aws lambda publish-layer-version \
  --layer-name govqa-submission \
  --description "GovQA submission service dependencies" \
  --zip-file fileb://govqa-layer.zip \
  --compatible-runtimes python3.9 python3.10 python3.11
```

### Option 2: Container Image

Create a Dockerfile for the Lambda function:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Copy requirements
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy service code
COPY govqa-submission-service.py ${LAMBDA_TASK_ROOT}/

CMD ["govqa-submission-service.lambda_handler"]
```

Build and push:

```bash
docker build -t govqa-submission .
docker tag govqa-submission:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/govqa-submission:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/govqa-submission:latest
```

### Lambda Configuration

Environment variables:
- `CAPTCHA_API_KEY`: Your 2Captcha or Anti-Captcha API key
- `CAPTCHA_PROVIDER`: Either `2captcha` or `anticaptcha`

Timeout: 60 seconds (CAPTCHA solving can take 20-30 seconds)

Memory: 512 MB

IAM Role: Lambda basic execution role

### Invoking from Node.js

```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({ region: 'us-east-1' });

const result = await lambda.send(new InvokeCommand({
  FunctionName: 'govqa-submission-service',
  Payload: JSON.stringify({
    portal_url: 'https://californiadfw.govqa.us',
    record_type_field: 'type_of_record_requested',
    record_type_value: 'California Department of Fish and Wildlife',
    form_data: {
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone: '555-1234',
      address: '123 Main St, City, CA 90000',
      organization: 'Acme Corp',
      request_description: 'Request description...',
      fee_limit: '100'
    },
    captcha_config: {
      provider: '2captcha',
      api_key: process.env.CAPTCHA_API_KEY
    }
  })
}));

const response = JSON.parse(new TextDecoder().decode(result.Payload));
```

## CAPTCHA Solving

### 2Captcha Integration

1. Sign up at https://2captcha.com
2. Get API key from dashboard
3. Pricing: ~$2.99 per 1000 CAPTCHAs

```python
from twocaptcha import TwoCaptcha

solver = TwoCaptcha(api_key)

# For reCAPTCHA v2
result = solver.recaptcha(
    sitekey='6Le-...',
    url='https://portal.govqa.us/form'
)

# For hCaptcha
result = solver.hcaptcha(
    sitekey='10000000-...',
    url='https://portal.govqa.us/form'
)
```

### Anti-Captcha Integration

1. Sign up at https://anti-captcha.com
2. Get API key from dashboard
3. Pricing: ~$2.00 per 1000 CAPTCHAs

```python
from anticaptchaofficial.recaptchav2proxyless import recaptchaV2Proxyless

solver = recaptchaV2Proxyless()
solver.set_key(api_key)
solver.set_website_url('https://portal.govqa.us/form')
solver.set_website_key('6Le-...')

token = solver.solve_and_return_solution()
```

## Error Handling

The service returns a structured response:

```json
{
  "success": true,
  "confirmation_number": "REQ-2026-001234"
}
```

Or on failure:

```json
{
  "success": false,
  "error": "CAPTCHA solving failed",
  "requires_manual_review": true
}
```

When `requires_manual_review` is true, the Node.js handler should:
1. Update FOIA request status to `MANUAL_REVIEW`
2. Send notification to admin
3. Provide portal URL in admin dashboard for manual submission

## Testing Strategy

### Unit Tests

Test individual functions without actual portal submission:

```python
import pytest
from govqa_submission_service import GovQASubmissionService

def test_form_data_mapping():
    service = GovQASubmissionService()
    mapped = service.map_form_data({
        'requesterName': 'John Doe',
        'requesterEmail': 'john@example.com'
    })
    assert mapped['first_name'] == 'John'
    assert mapped['last_name'] == 'Doe'
```

### Integration Tests

Test against live portal with test data:

1. Create a test account on CDFW portal
2. Submit a clearly marked test request
3. Verify confirmation number is returned
4. Verify request appears in portal
5. Immediately withdraw the test request

**IMPORTANT**: Always mark test submissions with "TEST REQUEST - DO NOT PROCESS" in the description.

### Smoke Test Checklist

- [ ] Python environment set up (venv, dependencies)
- [ ] CAPTCHA API key configured
- [ ] govqa-py library installed
- [ ] Test submission to CDFW portal succeeds
- [ ] Confirmation number received
- [ ] Request visible in portal
- [ ] Test request withdrawn
- [ ] Lambda deployment tested (if using Lambda)
- [ ] Error handling verified (invalid data, portal down, CAPTCHA failure)

## Monitoring

### CloudWatch Metrics

Track:
- Submission success rate
- CAPTCHA solve time
- CAPTCHA solve success rate
- Average submission time
- Error rate by type

### CloudWatch Alarms

Alert on:
- Success rate < 90% (5 minute window)
- CAPTCHA failure rate > 20%
- Lambda errors > 10 (5 minute window)

### Logging

Log levels:
- **INFO**: Successful submissions, confirmation numbers
- **WARN**: CAPTCHA retries, slow responses
- **ERROR**: Submission failures, CAPTCHA failures, portal errors

## Cost Estimates

Per submission:
- **Lambda execution**: ~$0.0001 (60s @ 512MB)
- **CAPTCHA solving**: ~$0.003 (2Captcha)
- **Total**: ~$0.0031 per submission

Monthly cost for 1000 submissions:
- Lambda: ~$0.10
- CAPTCHA: ~$3.00
- **Total**: ~$3.10

## Security

### Secrets Management

Store sensitive data in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name govqa-captcha-api-key \
  --secret-string "your-api-key"
```

Retrieve in Lambda:

```python
import boto3

secrets = boto3.client('secretsmanager')
response = secrets.get_secret_value(SecretId='govqa-captcha-api-key')
api_key = response['SecretString']
```

### Rate Limiting

Implement rate limiting to avoid IP blocks:
- Max 10 submissions per minute per portal
- Use SQS queue for submission jobs
- Implement exponential backoff on failures

### Data Sanitization

Always sanitize form inputs:
- Strip HTML tags
- Escape special characters
- Validate email format
- Validate phone format

## Troubleshooting

### CAPTCHA Failures

If CAPTCHA solving consistently fails:
1. Verify API key is valid
2. Check CAPTCHA service balance
3. Try alternative CAPTCHA service
4. Enable manual review fallback

### Portal Structure Changes

If form submission fails with "field not found":
1. GovQA likely updated their form structure
2. Inspect portal HTML to identify new field names
3. Update field mapping in service
4. Test with new mapping
5. Deploy updated service

### Network Timeouts

If Lambda times out:
1. Increase Lambda timeout to 90 seconds
2. Implement CAPTCHA timeout (30 seconds max)
3. Add retry logic with exponential backoff
4. Fall back to manual review after 2 failures

## Support

For issues with:
- **govqa-py library**: https://github.com/govqa/govqa-py
- **2Captcha**: support@2captcha.com
- **Anti-Captcha**: https://anti-captcha.com/support
- **This service**: Contact AutoRFP team

## License

This service is part of the AutoRFP platform and follows the same license.
