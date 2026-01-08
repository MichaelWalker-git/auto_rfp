import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
export interface StorageStackProps extends cdk.StackProps {
    stage: string;
}
export declare class StorageStack extends cdk.Stack {
    readonly documentsBucket: s3.Bucket;
    readonly websiteBucket: s3.Bucket;
    constructor(scope: Construct, id: string, props: StorageStackProps);
}
