import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ApiSharedInfraStackProps extends cdk.NestedStackProps {
  stage: string;
  commonEnv: Record<string, string>;
}

/**
 * Creates shared infrastructure for API Lambda functions
 * This is a NestedStack to avoid cross-stack reference issues
 */
export class ApiSharedInfraStack extends cdk.NestedStack {
  public readonly commonEnv: Record<string, string>;
  public readonly commonLambdaRole: iam.Role;

  constructor(scope: Construct, id: string, props: ApiSharedInfraStackProps) {
    super(scope, id, props);

    this.commonEnv = props.commonEnv;
    const { stage } = props;

    this.commonLambdaRole = new iam.Role(this, `CommonRFPLambdaRole-${stage}`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      // Let CDK generate the role name to avoid conflicts during updates
    });

    this.commonLambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );

    // Add SSM Parameter Store permissions for retrieving secrets
    this.commonLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/auto-rfp/*`,
        ],
      }),
    );

    new cdk.CfnOutput(this, 'CommonLambdaRoleArn', {
      value: this.commonLambdaRole.roleArn,
    });
  }
}