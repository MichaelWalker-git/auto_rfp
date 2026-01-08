import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
export interface CiStackProps extends cdk.StackProps {
    websiteBucket: s3.IBucket;
    documentsBucket: s3.IBucket;
    distribution: cloudfront.IDistribution;
}
export declare class CiStack extends cdk.Stack {
    readonly deploymentRole: iam.Role;
    constructor(scope: Construct, id: string, props: CiStackProps);
}
