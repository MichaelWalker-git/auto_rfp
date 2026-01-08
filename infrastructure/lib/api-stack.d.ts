import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
export interface ApiStackProps extends cdk.StackProps {
    stage: string;
    documentsBucket: s3.IBucket;
    /**
     * Single-table design that stores organizations (PK = "ORG", etc.)
     */
    mainTable: dynamodb.ITable;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
    documentPipelineStateMachineArn: string;
    questionPipelineStateMachineArn: string;
    openSearchCollectionEndpoint: string;
    vpc: ec2.IVpc;
}
export declare class ApiStack extends cdk.Stack {
    private readonly lambdaPermissions;
    private readonly policy;
    readonly api: apigw.RestApi;
    private static readonly BEDROCK_REGION;
    private readonly organizationApi;
    private readonly projectApi;
    private readonly questionApi;
    private readonly answerApi;
    private readonly presignedUrlApi;
    private readonly fileApi;
    private readonly textractApi;
    private readonly knowledgeBaseApi;
    private readonly documentApi;
    private readonly questionFileApi;
    constructor(scope: Construct, id: string, props: ApiStackProps);
    private addCdkNagSuppressions;
}
