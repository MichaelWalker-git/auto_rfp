#!/bin/bash

# CDK Deployment Script for Auto RFP Infrastructure
# This script handles the deployment of all CDK stacks

set -e  # Exit on error

echo "🚀 Starting CDK deployment for Auto RFP Infrastructure"
echo "=================================================="

# Check if --all flag is provided
if [ "$1" == "--all" ]; then
    echo "📦 Deploying all stacks..."
    npx cdk deploy --all --require-approval never
elif [ "$1" == "--core" ]; then
    echo "📦 Deploying core infrastructure stacks..."
    # Deploy in dependency order
    npx cdk deploy AutoRfp-Network --require-approval never
    npx cdk deploy AutoRfp-Auth-Dev --require-approval never
    npx cdk deploy AutoRfp-Storage-Dev --require-approval never
    npx cdk deploy AutoRfp-DynamoDatabase-Dev --require-approval never
    npx cdk deploy AutoRfp-DocumentPipeline-Dev --require-approval never
    npx cdk deploy AutoRfp-QuestionsPipeline-Dev --require-approval never
elif [ "$1" == "--api" ]; then
    echo "📦 Deploying API stacks..."
    # Deploy the main ApiOrchestrator stack which includes all nested stacks
    npx cdk deploy "ApiOrchestrator-Dev/*" --require-approval never
elif [ "$1" == "--frontend" ]; then
    echo "📦 Deploying frontend stack..."
    npx cdk deploy AmplifyFeStack-Dev --require-approval never
elif [ "$1" == "--cleanup" ]; then
    echo "🧹 Cleaning up failed stacks..."
    echo "This will delete stacks in ROLLBACK_COMPLETE state"
    
    # List stacks in ROLLBACK_COMPLETE state
    FAILED_STACKS=$(aws cloudformation list-stacks --stack-status-filter ROLLBACK_COMPLETE --query "StackSummaries[?starts_with(StackName, 'ApiOrchestrator') || starts_with(StackName, 'AutoRfp')].StackName" --output text)
    
    if [ -z "$FAILED_STACKS" ]; then
        echo "✅ No failed stacks found to clean up"
    else
        echo "Found failed stacks to clean up:"
        echo "$FAILED_STACKS"
        echo ""
        read -p "Do you want to delete these stacks? (y/N): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            for stack in $FAILED_STACKS; do
                echo "Deleting stack: $stack"
                aws cloudformation delete-stack --stack-name "$stack"
            done
            echo "✅ Cleanup initiated. Waiting for deletion to complete..."
            for stack in $FAILED_STACKS; do
                aws cloudformation wait stack-delete-complete --stack-name "$stack" 2>/dev/null || true
            done
            echo "✅ Cleanup completed"
        else
            echo "Cleanup cancelled"
        fi
    fi
elif [ "$1" == "--help" ] || [ -z "$1" ]; then
    echo "Usage: ./deploy.sh [option]"
    echo ""
    echo "Options:"
    echo "  --all       Deploy all stacks"
    echo "  --core      Deploy core infrastructure (Network, Auth, Storage, DB, Pipelines)"
    echo "  --api       Deploy API stacks (ApiOrchestrator and all route stacks)"
    echo "  --frontend  Deploy frontend Amplify stack"
    echo "  --cleanup   Clean up failed stacks (ROLLBACK_COMPLETE state)"
    echo "  --help      Show this help message"
    echo ""
    echo "Example:"
    echo "  ./deploy.sh --all    # Deploy everything"
    echo "  ./deploy.sh --core   # Deploy only core infrastructure"
    exit 0
else
    echo "❌ Invalid option: $1"
    echo "Run './deploy.sh --help' for usage information"
    exit 1
fi

echo "✅ Deployment completed successfully!"