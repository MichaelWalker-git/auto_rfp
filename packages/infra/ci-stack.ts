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

export class CiStack extends cdk.Stack {
  public readonly deploymentRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const { websiteBucket, documentsBucket, distribution } = props;

    this.deploymentRole = new iam.Role(this, 'DeploymentRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
              resources: [
                websiteBucket.bucketArn,
                `${websiteBucket.bucketArn}/*`,
                documentsBucket.bucketArn,
                `${documentsBucket.bucketArn}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['cloudfront:CreateInvalidation'],
              resources: [distribution.distributionArn],
            }),
          ],
        }),
      },
    });
  }
}
