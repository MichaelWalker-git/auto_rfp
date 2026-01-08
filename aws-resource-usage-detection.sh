#!/bin/bash

PROFILE="michael-primary"
REGIONS=("us-east-1" "us-west-2" "eu-central-1")
DAYS_THRESHOLD=60

echo "========================================="
echo "AWS RESOURCE USAGE DETECTION REPORT"
echo "Profile: $PROFILE"
echo "Date: $(date)"
echo "Threshold: Resources not used in $DAYS_THRESHOLD days"
echo "========================================="
echo ""

# Calculate date threshold (60 days ago)
THRESHOLD_DATE=$(date -u -v-${DAYS_THRESHOLD}d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "$DAYS_THRESHOLD days ago" +"%Y-%m-%dT%H:%M:%SZ")

echo "Looking for resources not accessed since: $THRESHOLD_DATE"
echo ""

# ============================================
# 1. SAGEMAKER ENDPOINT USAGE
# ============================================
echo "### 1. SAGEMAKER ENDPOINT USAGE ###"
echo ""

for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    endpoints=$(aws sagemaker list-endpoints --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Endpoints[]?')
    
    if [ ! -z "$endpoints" ]; then
        endpoint_names=$(echo "$endpoints" | jq -r '.EndpointName')
        
        for endpoint in $endpoint_names; do
            # Get endpoint details
            details=$(aws sagemaker describe-endpoint --profile $PROFILE --region $region --endpoint-name "$endpoint" --output json 2>/dev/null)
            creation_time=$(echo "$details" | jq -r '.CreationTime')
            last_modified=$(echo "$details" | jq -r '.LastModifiedTime')
            
            echo "  Endpoint: $endpoint"
            echo "    Created: $creation_time"
            echo "    Last Modified: $last_modified"
            
            # Get invocation metrics from CloudWatch (last 30 days)
            end_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            start_time=$(date -u -v-30d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "30 days ago" +"%Y-%m-%dT%H:%M:%SZ")
            
            invocations=$(aws cloudwatch get-metric-statistics \
                --profile $PROFILE --region $region \
                --namespace AWS/SageMaker \
                --metric-name Invocations \
                --dimensions Name=EndpointName,Value=$endpoint Name=VariantName,Value=AllTraffic \
                --start-time $start_time \
                --end-time $end_time \
                --period 86400 \
                --statistics Sum \
                --output json 2>/dev/null | jq '.Datapoints | length')
            
            total_invocations=$(aws cloudwatch get-metric-statistics \
                --profile $PROFILE --region $region \
                --namespace AWS/SageMaker \
                --metric-name Invocations \
                --dimensions Name=EndpointName,Value=$endpoint Name=VariantName,Value=AllTraffic \
                --start-time $start_time \
                --end-time $end_time \
                --period 86400 \
                --statistics Sum \
                --output json 2>/dev/null | jq '[.Datapoints[].Sum] | add // 0')
            
            echo "    Invocations (last 30 days): $total_invocations"
            echo "    Days with activity: $invocations/30"
            
            if [ "$total_invocations" == "0" ] || [ "$total_invocations" == "null" ]; then
                echo "    ⚠️  WARNING: No invocations detected in last 30 days"
                echo "    💰 Estimated monthly cost: ~\$1,106 (ml.g5.2xlarge 24/7)"
            fi
            echo ""
        done
    else
        echo "  No SageMaker endpoints found"
    fi
    echo ""
done

# ============================================
# 2. KMS KEY USAGE (via CloudTrail)
# ============================================
echo "### 2. KMS KEY USAGE ANALYSIS ###"
echo "Note: Querying CloudTrail for last $DAYS_THRESHOLD days of KMS activity..."
echo ""

for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    
    # Get all customer-managed keys (exclude AWS-managed keys)
    keys=$(aws kms list-keys --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Keys[].KeyId')
    
    if [ -z "$keys" ]; then
        echo "  No KMS keys found"
        echo ""
        continue
    fi
    
    customer_keys=()
    for key_id in $keys; do
        key_metadata=$(aws kms describe-key --profile $PROFILE --region $region --key-id "$key_id" --output json 2>/dev/null)
        key_manager=$(echo "$key_metadata" | jq -r '.KeyMetadata.KeyManager')
        
        # Only process customer-managed keys
        if [ "$key_manager" == "CUSTOMER" ]; then
            customer_keys+=("$key_id")
        fi
    done
    
    echo "  Total keys: $(echo "$keys" | wc -w | tr -d ' ')"
    echo "  Customer-managed keys: ${#customer_keys[@]}"
    echo "  AWS-managed keys: $(($(echo "$keys" | wc -w | tr -d ' ') - ${#customer_keys[@]}))"
    echo ""
    
    unused_count=0
    
    for key_id in "${customer_keys[@]}"; do
        # Get key metadata
        key_metadata=$(aws kms describe-key --profile $PROFILE --region $region --key-id "$key_id" --output json 2>/dev/null)
        key_state=$(echo "$key_metadata" | jq -r '.KeyMetadata.KeyState')
        creation_date=$(echo "$key_metadata" | jq -r '.KeyMetadata.CreationDate')
        key_arn=$(echo "$key_metadata" | jq -r '.KeyMetadata.Arn')
        
        # Try to get alias
        alias=$(aws kms list-aliases --profile $PROFILE --region $region --key-id "$key_id" --output json 2>/dev/null | jq -r '.Aliases[0].AliasName // "No alias"')
        
        # Query CloudTrail for key usage
        # Look for Encrypt, Decrypt, GenerateDataKey events
        usage=$(aws cloudtrail lookup-events \
            --profile $PROFILE \
            --region $region \
            --lookup-attributes AttributeKey=ResourceName,AttributeValue=$key_arn \
            --start-time $THRESHOLD_DATE \
            --max-results 1 \
            --output json 2>/dev/null | jq '.Events | length')
        
        # Only report if not used in threshold period
        if [ "$usage" == "0" ]; then
            unused_count=$((unused_count + 1))
            echo "  ⚠️  Key potentially unused for $DAYS_THRESHOLD+ days:"
            echo "      Key ID: $key_id"
            echo "      Alias: $alias"
            echo "      State: $key_state"
            echo "      Created: $creation_date"
            echo "      Cost: \$1/month"
            echo ""
        fi
    done
    
    if [ $unused_count -gt 0 ]; then
        echo "  📊 Summary: $unused_count customer-managed keys with no detected usage in $DAYS_THRESHOLD days"
        echo "  💰 Potential savings: \$${unused_count}/month"
    else
        echo "  ✅ All customer-managed keys show recent usage"
    fi
    echo ""
done

# ============================================
# 3. EC2 INSTANCE UTILIZATION
# ============================================
echo "### 3. EC2 INSTANCE CPU UTILIZATION (Last 7 Days) ###"
echo ""

for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    instances=$(aws ec2 describe-instances --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Reservations[].Instances[] | select(.State.Name == "running") | .InstanceId')
    
    if [ ! -z "$instances" ]; then
        for instance_id in $instances; do
            instance_name=$(aws ec2 describe-instances --profile $PROFILE --region $region --instance-ids $instance_id --output json 2>/dev/null | jq -r '.Reservations[].Instances[].Tags[]? | select(.Key=="Name") | .Value // "No Name"')
            instance_type=$(aws ec2 describe-instances --profile $PROFILE --region $region --instance-ids $instance_id --output json 2>/dev/null | jq -r '.Reservations[].Instances[].InstanceType')
            
            # Get average CPU utilization for last 7 days
            end_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            start_time=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "7 days ago" +"%Y-%m-%dT%H:%M:%SZ")
            
            avg_cpu=$(aws cloudwatch get-metric-statistics \
                --profile $PROFILE --region $region \
                --namespace AWS/EC2 \
                --metric-name CPUUtilization \
                --dimensions Name=InstanceId,Value=$instance_id \
                --start-time $start_time \
                --end-time $end_time \
                --period 86400 \
                --statistics Average \
                --output json 2>/dev/null | jq '[.Datapoints[].Average] | add / length // 0')
            
            echo "  Instance: $instance_id ($instance_name)"
            echo "    Type: $instance_type"
            echo "    Avg CPU (7 days): $(printf '%.2f' $avg_cpu)%"
            
            if (( $(echo "$avg_cpu < 5.0" | bc -l 2>/dev/null || echo "0") )); then
                echo "    ⚠️  WARNING: Very low CPU utilization - consider stopping or downsizing"
            fi
            echo ""
        done
    else
        echo "  No running EC2 instances found"
    fi
    echo ""
done

# ============================================
# 4. OPENSEARCH CLUSTER USAGE
# ============================================
echo "### 4. OPENSEARCH CLUSTER METRICS (Last 7 Days) ###"
echo ""

for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    domains=$(aws opensearch list-domain-names --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.DomainNames[]?.DomainName')
    
    if [ ! -z "$domains" ]; then
        for domain in $domains; do
            echo "  Domain: $domain"
            
            # Get search request count
            end_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            start_time=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "7 days ago" +"%Y-%m-%dT%H:%M:%SZ")
            
            search_requests=$(aws cloudwatch get-metric-statistics \
                --profile $PROFILE --region $region \
                --namespace AWS/ES \
                --metric-name SearchRate \
                --dimensions Name=DomainName,Value=$domain Name=ClientId,Value=$(aws sts get-caller-identity --profile $PROFILE --output json 2>/dev/null | jq -r '.Account') \
                --start-time $start_time \
                --end-time $end_time \
                --period 86400 \
                --statistics Sum \
                --output json 2>/dev/null | jq '[.Datapoints[].Sum] | add // 0')
            
            echo "    Search requests (7 days): $(printf '%.0f' $search_requests)"
            
            if (( $(echo "$search_requests < 100" | bc -l 2>/dev/null || echo "0") )); then
                echo "    ⚠️  WARNING: Very low usage detected"
            fi
            echo ""
        done
    else
        echo "  No OpenSearch domains found"
    fi
    echo ""
done

echo "========================================="
echo "USAGE DETECTION COMPLETE"
echo ""
echo "NEXT STEPS:"
echo "1. Review resources marked with ⚠️  warnings"
echo "2. For KMS keys: Run 'aws-kms-cleanup.sh' to disable/schedule deletion"
echo "3. For SageMaker: Run 'aws-sagemaker-scheduler.sh' to implement auto-shutdown"
echo "4. For EC2: Consider stopping or downsizing low-utilization instances"
echo "========================================="
