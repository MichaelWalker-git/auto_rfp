#!/bin/bash

PROFILE="michael-primary"
REGIONS=("us-east-1" "us-west-2" "eu-central-1")
DAYS_THRESHOLD=60
DRY_RUN=true

echo "========================================="
echo "AWS KMS KEY CLEANUP SCRIPT"
echo "Profile: $PROFILE"
echo "Date: $(date)"
echo "Threshold: Keys not used in $DAYS_THRESHOLD days"
echo "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes will be made)' || echo 'LIVE MODE (will disable keys)')"
echo "========================================="
echo ""

if [ "$DRY_RUN" = false ]; then
    echo "⚠️  WARNING: This script will DISABLE unused KMS keys!"
    echo "⚠️  Disabled keys can be re-enabled within 7-30 days if needed."
    echo ""
    read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi
    echo ""
fi

# Calculate date threshold
THRESHOLD_DATE=$(date -u -v-${DAYS_THRESHOLD}d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "$DAYS_THRESHOLD days ago" +"%Y-%m-%dT%H:%M:%SZ")

total_unused=0
total_savings=0

for region in "${REGIONS[@]}"; do
    echo "### Region: $region ###"
    echo ""
    
    # Get all keys
    keys=$(aws kms list-keys --profile $PROFILE --region $region --output json 2>/dev/null | jq -r '.Keys[].KeyId')
    
    if [ -z "$keys" ]; then
        echo "  No KMS keys found"
        echo ""
        continue
    fi
    
    unused_keys=()
    
    for key_id in $keys; do
        # Get key metadata
        key_metadata=$(aws kms describe-key --profile $PROFILE --region $region --key-id "$key_id" --output json 2>/dev/null)
        key_manager=$(echo "$key_metadata" | jq -r '.KeyMetadata.KeyManager')
        key_state=$(echo "$key_metadata" | jq -r '.KeyMetadata.KeyState')
        key_arn=$(echo "$key_metadata" | jq -r '.KeyMetadata.Arn')
        creation_date=$(echo "$key_metadata" | jq -r '.KeyMetadata.CreationDate')
        
        # Skip AWS-managed keys (they're free until used)
        if [ "$key_manager" != "CUSTOMER" ]; then
            continue
        fi
        
        # Skip keys that are already disabled or pending deletion
        if [ "$key_state" != "Enabled" ]; then
            continue
        fi
        
        # Get alias
        alias=$(aws kms list-aliases --profile $PROFILE --region $region --key-id "$key_id" --output json 2>/dev/null | jq -r '.Aliases[0].AliasName // "No alias"')
        
        # Query CloudTrail for usage
        usage=$(aws cloudtrail lookup-events \
            --profile $PROFILE \
            --region $region \
            --lookup-attributes AttributeKey=ResourceName,AttributeValue=$key_arn \
            --start-time $THRESHOLD_DATE \
            --max-results 1 \
            --output json 2>/dev/null | jq '.Events | length')
        
        # Check if key has no usage in threshold period
        if [ "$usage" == "0" ]; then
            unused_keys+=("$key_id|$alias|$creation_date")
            total_unused=$((total_unused + 1))
            total_savings=$((total_savings + 1))
            
            echo "  ⚠️  Unused Key Found:"
            echo "      Key ID: $key_id"
            echo "      Alias: $alias"
            echo "      Created: $creation_date"
            echo "      Last Usage: >$DAYS_THRESHOLD days ago (or never)"
            echo "      Cost: \$1/month"
            
            if [ "$DRY_RUN" = false ]; then
                echo "      ACTION: Disabling key..."
                aws kms disable-key --profile $PROFILE --region $region --key-id "$key_id" 2>/dev/null
                if [ $? -eq 0 ]; then
                    echo "      ✅ Key disabled successfully"
                    echo "      Note: Key can be re-enabled if needed before scheduling deletion"
                else
                    echo "      ❌ Failed to disable key"
                fi
            else
                echo "      ACTION: [DRY RUN] Would disable this key"
            fi
            echo ""
        fi
    done
    
    if [ ${#unused_keys[@]} -eq 0 ]; then
        echo "  ✅ No unused customer-managed keys found in this region"
    else
        echo "  📊 Summary for $region:"
        echo "      Unused keys: ${#unused_keys[@]}"
        echo "      Potential savings: \$${#unused_keys[@]}/month"
    fi
    echo ""
done

echo "========================================="
echo "CLEANUP SUMMARY"
echo "========================================="
echo "Total unused keys across all regions: $total_unused"
echo "Total potential savings: \$$total_savings/month"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo "This was a DRY RUN - no changes were made."
    echo ""
    echo "To actually disable these keys, run:"
    echo "  DRY_RUN=false ./aws-kms-cleanup.sh"
    echo ""
    echo "IMPORTANT NOTES:"
    echo "1. Disabled keys can be re-enabled if you realize they're needed"
    echo "2. After disabling, monitor for 7-30 days before scheduling deletion"
    echo "3. To schedule deletion: aws kms schedule-key-deletion --key-id <KEY_ID> --pending-window-in-days 30"
    echo "4. Keys pending deletion can be cancelled if needed"
else
    echo "Keys have been DISABLED."
    echo ""
    echo "NEXT STEPS:"
    echo "1. Monitor your applications for 7-30 days"
    echo "2. If no issues, schedule deletion with:"
    echo "   aws kms schedule-key-deletion --profile $PROFILE --region <region> --key-id <KEY_ID> --pending-window-in-days 30"
    echo "3. If you need a key back, re-enable with:"
    echo "   aws kms enable-key --profile $PROFILE --region <region> --key-id <KEY_ID>"
fi
echo "========================================="
