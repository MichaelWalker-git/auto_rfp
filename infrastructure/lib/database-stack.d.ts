import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
export interface DatabaseStackProps extends cdk.StackProps {
    /**
     * Stage name: e.g. "dev", "test", "prod"
     */
    stage: string;
}
export declare class DatabaseStack extends cdk.Stack {
    readonly tableName: dynamodb.Table;
    constructor(scope: Construct, id: string, props: DatabaseStackProps);
}
