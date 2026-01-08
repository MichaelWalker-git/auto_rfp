import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
interface DocumentPipelineStackProps extends StackProps {
    stage: string;
    documentsBucket: s3.IBucket;
    documentsTable: dynamodb.ITable;
    openSearchCollectionEndpoint: string;
    vpc: ec2.IVpc;
    vpcSecurityGroup: ec2.ISecurityGroup;
}
export declare class DocumentPipelineStack extends Stack {
    readonly stateMachine: sfn.StateMachine;
    constructor(scope: Construct, id: string, props: DocumentPipelineStackProps);
}
export {};
