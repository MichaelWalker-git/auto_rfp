import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface StorageStackProps extends cdk.StackProps {
  stage: string;
}

export class StorageStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly websiteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const stage = props.stage.toLowerCase();
    const account = cdk.Aws.ACCOUNT_ID;

    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      // all lowercase, includes stage
      bucketName: `auto-rfp-documents-${stage}-${account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'transition-to-ia',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedOrigins: ['*'], // tighten later
          allowedHeaders: ['*'],
          maxAge: 300,
        },
      ],
    });

    this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `auto-rfp-website-${stage}-${account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    NagSuppressions.addResourceSuppressions(
      this.documentsBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'Server access logging will be enabled for production; dev stack keeps it off for cost/simplicity.',
        },
        {
          id: 'AwsSolutions-S10',
          reason: 'Access is only via CloudFront/HTTPS in this architecture; explicit SSL bucket policy will be added for prod.',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      this.websiteBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'Server access logging will be enabled for production; dev stack keeps it off for cost/simplicity.',
        },
        {
          id: 'AwsSolutions-S10',
          reason: 'Access is only via CloudFront/HTTPS in this architecture; explicit SSL bucket policy will be added for prod.',
        },
      ],
      true,
    );
  }
}
