#!/bin/bash

PROFILE="michael-primary"
REGIONS=("us-east-1" "us-west-2" "eu-central-1")

echo "=================================="
echo "AWS COST & RESOURCE AUDIT REPORT"
echo "Profile: $PROFILE"
echo "Date: $(date)"
echo "=================================="
echo ""

# Function to check if a command succeeded
check_error() {
    if [ $? -ne 0 ]; then
        echo "  [ERROR] Command failed"
    fi
}

# 1. COST ANALYSIS
echo "### 1. COST ANALYSIS (Last 3 Months) ###"
aws ce get-cost-and-usage --profile $PROFILE \
    --time-period Start=2024-12-01,End=2026-01-03 \
    --granularity MONTHLY \
    --metrics "BlendedCost" \
    --group-by Type=DIMENSION,Key=SERVICE \
    --output json 2>/dev/null | jq -r '.ResultsByTime[] | 
    "Month: \(.TimePeriod.Start)
Total: $\((.Groups | map(.Metrics.BlendedCost.Amount | tonumber) | add))
Top Services:
\(.Groups | sort_by(.Metrics.BlendedCost.Amount | tonumber) | reverse | .[0:5] | map("  - \(.Keys[0]): $\(.Metrics.BlendedCost.Amount)") | join("\n"))"'
echo ""

# 2. CURRENT MONTH COSTS BY REGION
echo "### 2. CURRENT MONTH COSTS BY REGION ###"
aws ce get-cost-and-usage --profile $PROFILE \
    --time-period Start=2026-01-01,End=2026-01-03 \
    --granularity MONTHLY \
    --metrics "BlendedCost" \
    --group-by Type=DIMENSION,Key=REGION \
    --output json 2>/dev/null | jq -r '.ResultsByTime[0].Groups | 
    sort_by(.Metrics.BlendedCost.Amount | tonumber) | reverse | 
    map("  \(.Keys[0]): $\(.Metrics.BlendedCost.Amount)") | join("\n")'
echo ""

# 3. SAGEMAKER RESOURCES
echo "### 3. SAGEMAKER RESOURCES (Running 24/7) ###"
for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    
    # Notebook Instances
    notebooks=$(aws sagemaker list-notebook-instances --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.NotebookInstances[]? | "  - Notebook: \(.NotebookInstanceName) [\(.NotebookInstanceStatus)] \(.InstanceType)"')
    if [ ! -z "$notebooks" ]; then
        echo "Notebooks:"
        echo "$notebooks"
    fi
    
    # Endpoints
    endpoints=$(aws sagemaker list-endpoints --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Endpoints[]?')
    if [ ! -z "$endpoints" ]; then
        echo "Endpoints:"
        echo "$endpoints" | jq -r '"  - \(.EndpointName) [\(.EndpointStatus)]"'
        
        # Get endpoint config details
        endpoint_names=$(echo "$endpoints" | jq -r '.EndpointName')
        for endpoint in $endpoint_names; do
            aws sagemaker describe-endpoint --profile $PROFILE --region $region --endpoint-name "$endpoint" --output json 2>/dev/null | \
            jq -r '"    Config: \(.EndpointConfigName)"'
            
            config_name=$(aws sagemaker describe-endpoint --profile $PROFILE --region $region --endpoint-name "$endpoint" --output json 2>/dev/null | jq -r '.EndpointConfigName')
            aws sagemaker describe-endpoint-config --profile $PROFILE --region $region --endpoint-config-name "$config_name" --output json 2>/dev/null | \
            jq -r '.ProductionVariants[] | "    Instance: \(.InstanceType) x\(.InitialInstanceCount)"'
        done
    fi
    
    if [ -z "$notebooks" ] && [ -z "$endpoints" ]; then
        echo "  No SageMaker resources found"
    fi
    echo ""
done

# 4. EC2 INSTANCES
echo "### 4. EC2 INSTANCES ###"
for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    instances=$(aws ec2 describe-instances --profile $PROFILE --region $region --output json 2>/dev/null | \
    jq -r '.Reservations[].Instances[] | "  - \(.InstanceId) [\(.State.Name)] \(.InstanceType) - \((.Tags[]? | select(.Key=="Name") | .Value) // "No Name")"')
    
    if [ ! -z "$instances" ]; then
        echo "$instances"
    else
        echo "  No EC2 instances found"
    fi
    echo ""
done

# 5. OPENSEARCH CLUSTERS
echo "### 5. OPENSEARCH CLUSTERS ###"
for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    domains=$(aws opensearch list-domain-names --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.DomainNames[]?.DomainName')
    
    if [ ! -z "$domains" ]; then
        for domain in $domains; do
            aws opensearch describe-domain --profile $PROFILE --region $region --domain-name "$domain" --output json 2>/dev/null | \
            jq -r '"  - Domain: \(.DomainStatus.DomainName)
    Instance Type: \(.DomainStatus.ClusterConfig.InstanceType) x\(.DomainStatus.ClusterConfig.InstanceCount)
    Storage: \(.DomainStatus.EBSOptions.VolumeType) \(.DomainStatus.EBSOptions.VolumeSize)GB"'
        done
    else
        echo "  No OpenSearch domains found"
    fi
    echo ""
done

# 6. ECS CLUSTERS & SERVICES
echo "### 6. ECS CLUSTERS & SERVICES ###"
for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    clusters=$(aws ecs list-clusters --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.clusterArns[]?')
    
    if [ ! -z "$clusters" ]; then
        for cluster_arn in $clusters; do
            cluster_name=$(echo $cluster_arn | awk -F'/' '{print $NF}')
            echo "  Cluster: $cluster_name"
            
            services=$(aws ecs list-services --profile $PROFILE --region $region --cluster "$cluster_name" --output json 2>/dev/null | jq -r '.serviceArns[]?')
            if [ ! -z "$services" ]; then
                for service_arn in $services; do
                    aws ecs describe-services --profile $PROFILE --region $region --cluster "$cluster_name" --services "$service_arn" --output json 2>/dev/null | \
                    jq -r '.services[] | "    - Service: \(.serviceName) [\(.status)]
      Tasks: \(.runningCount)/\(.desiredCount) running
      Launch Type: \(.launchType)"'
                done
            else
                echo "    No services running"
            fi
        done
    else
        echo "  No ECS clusters found"
    fi
    echo ""
done

# 7. UNUSED RESOURCES
echo "### 7. UNUSED RESOURCES ###"

for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    
    # Unattached EBS volumes
    echo "  Unattached EBS Volumes:"
    volumes=$(aws ec2 describe-volumes --profile $PROFILE --region $region --filters Name=status,Values=available --output json 2>/dev/null | \
    jq -r '.Volumes[] | "    - \(.VolumeId): \(.Size)GB \(.VolumeType)"')
    if [ ! -z "$volumes" ]; then
        echo "$volumes"
    else
        echo "    None found"
    fi
    
    # Unused Elastic IPs
    echo "  Unused Elastic IPs:"
    eips=$(aws ec2 describe-addresses --profile $PROFILE --region $region --output json 2>/dev/null | \
    jq -r '[.Addresses[] | select(.AssociationId == null)] | map("    - \(.PublicIp) (\(.AllocationId))") | join("\n")')
    if [ ! -z "$eips" ]; then
        echo "$eips"
    else
        echo "    None found"
    fi
    
    # NAT Gateways
    echo "  NAT Gateways:"
    nats=$(aws ec2 describe-nat-gateways --profile $PROFILE --region $region --output json 2>/dev/null | \
    jq -r '.NatGateways[] | select(.State == "available") | "    - \(.NatGatewayId) [\(.State)]"')
    if [ ! -z "$nats" ]; then
        echo "$nats"
    else
        echo "    None found"
    fi
    
    echo ""
done

# 8. KMS KEYS
echo "### 8. KMS KEYS (High Cost in Trends) ###"
for region in "${REGIONS[@]}"; do
    echo "Region: $region"
    keys=$(aws kms list-keys --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Keys | length')
    echo "  Total KMS keys: $keys"
    echo ""
done

echo "=================================="
echo "AUDIT COMPLETE"
echo "=================================="
