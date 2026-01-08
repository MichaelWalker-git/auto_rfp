#!/bin/bash

PROFILE="michael-primary"
REGIONS=("us-west-2" "eu-central-1")
DRY_RUN=true

echo "========================================="
echo "AWS SAGEMAKER AUTO-SHUTDOWN SCHEDULER"
echo "Profile: $PROFILE"
echo "Date: $(date)"
echo "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes will be made)' || echo 'LIVE MODE (will create EventBridge rules)')"
echo "========================================="
echo ""

if [ "$DRY_RUN" = false ]; then
    echo "⚠️  WARNING: This script will create EventBridge rules and Lambda functions!"
    echo ""
    read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi
    echo ""
fi

# Schedule: Stop at 6pm (18:00) weekdays, start at 8am next day
# Stop all weekend (Friday 6pm - Monday 8am)
STOP_SCHEDULE="cron(0 18 ? * MON-FRI *)"  # 6pm UTC weekdays
START_SCHEDULE="cron(0 8 ? * MON-FRI *)"   # 8am UTC weekdays

echo "### SCHEDULE CONFIGURATION ###"
echo "Stop Time: 6:00 PM UTC (Mon-Fri)"
echo "Start Time: 8:00 AM UTC (Mon-Fri)"
echo "Weekend: All endpoints stopped (Fri 6pm - Mon 8am)"
echo ""
echo "Expected Savings: ~68% reduction = ~\$1,504/month for 2 endpoints"
echo ""

for region in "${REGIONS[@]}"; do
    echo "### Region: $region ###"
    echo ""
    
    # Get all SageMaker endpoints
    endpoints=$(aws sagemaker list-endpoints --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Endpoints[]?.EndpointName')
    
    if [ -z "$endpoints" ]; then
        echo "  No SageMaker endpoints found"
        echo ""
        continue
    fi
    
    for endpoint in $endpoints; do
        echo "  Endpoint: $endpoint"
        
        if [ "$DRY_RUN" = true ]; then
            echo "    [DRY RUN] Would create:"
            echo "      - EventBridge rule: sagemaker-stop-${endpoint}"
            echo "      - EventBridge rule: sagemaker-start-${endpoint}"
            echo "      - Lambda function: sagemaker-scheduler-${region}"
            echo ""
        else
            # Create Lambda function for starting/stopping endpoints (if doesn't exist)
            lambda_name="sagemaker-scheduler-${region}"
            
            # Check if Lambda exists
            lambda_exists=$(aws lambda get-function --profile $PROFILE --region $region --function-name $lambda_name 2>/dev/null)
            
            if [ -z "$lambda_exists" ]; then
                echo "    Creating Lambda function: $lambda_name"
                
                # Create Lambda execution role (if doesn't exist)
                role_name="sagemaker-scheduler-role-${region}"
                role_arn=$(aws iam get-role --profile $PROFILE --role-name $role_name 2>/dev/null | jq -r '.Role.Arn')
                
                if [ -z "$role_arn" ]; then
                    echo "    Creating IAM role: $role_name"
                    
                    # Create trust policy
                    cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
                    
                    aws iam create-role --profile $PROFILE \
                        --role-name $role_name \
                        --assume-role-policy-document file:///tmp/trust-policy.json
                    
                    # Attach necessary policies
                    aws iam attach-role-policy --profile $PROFILE \
                        --role-name $role_name \
                        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
                    
                    # Create inline policy for SageMaker
                    cat > /tmp/sagemaker-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sagemaker:StopEndpoint",
        "sagemaker:StartEndpoint",
        "sagemaker:DescribeEndpoint"
      ],
      "Resource": "*"
    }
  ]
}
EOF
                    
                    aws iam put-role-policy --profile $PROFILE \
                        --role-name $role_name \
                        --policy-name SageMakerSchedulerPolicy \
                        --policy-document file:///tmp/sagemaker-policy.json
                    
                    # Wait for role to propagate
                    sleep 10
                    
                    role_arn=$(aws iam get-role --profile $PROFILE --role-name $role_name | jq -r '.Role.Arn')
                fi
                
                # Create Lambda function code
                cat > /tmp/lambda_function.py <<'EOF'
import boto3
import json

def lambda_handler(event, context):
    sagemaker = boto3.client('sagemaker')
    
    endpoint_name = event['endpoint_name']
    action = event['action']  # 'stop' or 'start'
    
    try:
        if action == 'stop':
            # Stop endpoint by updating to zero instances
            response = sagemaker.update_endpoint(
                EndpointName=endpoint_name,
                EndpointConfigName=endpoint_name,
                RetainAllVariantProperties=True
            )
            return {
                'statusCode': 200,
                'body': json.dumps(f'Stopped endpoint: {endpoint_name}')
            }
        elif action == 'start':
            # Start endpoint by updating back to original config
            response = sagemaker.update_endpoint(
                EndpointName=endpoint_name,
                EndpointConfigName=endpoint_name,
                RetainAllVariantProperties=True
            )
            return {
                'statusCode': 200,
                'body': json.dumps(f'Started endpoint: {endpoint_name}')
            }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }
EOF
                
                # Zip the Lambda code
                cd /tmp && zip lambda_function.zip lambda_function.py
                
                # Create Lambda function
                aws lambda create-function --profile $PROFILE --region $region \
                    --function-name $lambda_name \
                    --runtime python3.11 \
                    --role $role_arn \
                    --handler lambda_function.lambda_handler \
                    --zip-file fileb:///tmp/lambda_function.zip \
                    --timeout 60
                
                echo "    ✅ Lambda function created"
            fi
            
            lambda_arn=$(aws lambda get-function --profile $PROFILE --region $region --function-name $lambda_name | jq -r '.Configuration.FunctionArn')
            
            # Create EventBridge rules
            # Stop rule
            echo "    Creating stop rule..."
            aws events put-rule --profile $PROFILE --region $region \
                --name "sagemaker-stop-${endpoint}" \
                --schedule-expression "$STOP_SCHEDULE" \
                --state ENABLED
            
            # Add Lambda permission for stop rule
            aws lambda add-permission --profile $PROFILE --region $region \
                --function-name $lambda_name \
                --statement-id "sagemaker-stop-${endpoint}" \
                --action lambda:InvokeFunction \
                --principal events.amazonaws.com \
                --source-arn "arn:aws:events:${region}:$(aws sts get-caller-identity --profile $PROFILE --output json | jq -r '.Account'):rule/sagemaker-stop-${endpoint}" \
                2>/dev/null || true
            
            # Add target to stop rule
            aws events put-targets --profile $PROFILE --region $region \
                --rule "sagemaker-stop-${endpoint}" \
                --targets "Id=1,Arn=${lambda_arn},Input={\\\"endpoint_name\\\":\\\"${endpoint}\\\",\\\"action\\\":\\\"stop\\\"}"
            
            # Start rule
            echo "    Creating start rule..."
            aws events put-rule --profile $PROFILE --region $region \
                --name "sagemaker-start-${endpoint}" \
                --schedule-expression "$START_SCHEDULE" \
                --state ENABLED
            
            # Add Lambda permission for start rule
            aws lambda add-permission --profile $PROFILE --region $region \
                --function-name $lambda_name \
                --statement-id "sagemaker-start-${endpoint}" \
                --action lambda:InvokeFunction \
                --principal events.amazonaws.com \
                --source-arn "arn:aws:events:${region}:$(aws sts get-caller-identity --profile $PROFILE --output json | jq -r '.Account'):rule/sagemaker-start-${endpoint}" \
                2>/dev/null || true
            
            # Add target to start rule
            aws events put-targets --profile $PROFILE --region $region \
                --rule "sagemaker-start-${endpoint}" \
                --targets "Id=1,Arn=${lambda_arn},Input={\\\"endpoint_name\\\":\\\"${endpoint}\\\",\\\"action\\\":\\\"start\\\"}"
            
            echo "    ✅ Scheduler created for $endpoint"
            echo ""
        fi
    done
done

echo "========================================="
echo "SCHEDULER SETUP COMPLETE"
echo "========================================="

if [ "$DRY_RUN" = true ]; then
    echo "This was a DRY RUN - no changes were made."
    echo ""
    echo "To actually create the scheduler, run:"
    echo "  DRY_RUN=false ./aws-sagemaker-scheduler.sh"
    echo ""
    echo "WHAT WILL BE CREATED:"
    echo "1. Lambda function (per region) to stop/start endpoints"
    echo "2. IAM role with SageMaker permissions"
    echo "3. EventBridge rules for stop schedule (6pm UTC Mon-Fri)"
    echo "4. EventBridge rules for start schedule (8am UTC Mon-Fri)"
    echo ""
    echo "NOTE: This script creates basic start/stop. For production,"
    echo "consider using AWS Instance Scheduler or similar solutions."
else
    echo "Scheduler has been created successfully!"
    echo ""
    echo "VERIFICATION:"
    echo "1. Check EventBridge console for rules"
    echo "2. Check Lambda console for functions"
    echo "3. Monitor CloudWatch Logs for execution"
    echo ""
    echo "TO DISABLE:"
    echo "  aws events disable-rule --profile $PROFILE --region <region> --name sagemaker-stop-<endpoint>"
    echo "  aws events disable-rule --profile $PROFILE --region <region> --name sagemaker-start-<endpoint>"
    echo ""
    echo "TO DELETE:"
    echo "  aws events remove-targets --profile $PROFILE --region <region> --rule sagemaker-stop-<endpoint> --ids 1"
    echo "  aws events delete-rule --profile $PROFILE --region <region> --name sagemaker-stop-<endpoint>"
    echo "  (repeat for start rule)"
fi
echo "========================================="
