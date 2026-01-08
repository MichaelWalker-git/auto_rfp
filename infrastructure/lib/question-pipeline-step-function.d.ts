import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
interface Props extends StackProps {
    stage: string;
    documentsBucket: s3.IBucket;
    mainTable: dynamodb.ITable;
}
export declare class QuestionExtractionPipelineStack extends Stack {
    readonly stateMachine: sfn.StateMachine;
    constructor(scope: Construct, id: string, props: Props);
}
export {};
