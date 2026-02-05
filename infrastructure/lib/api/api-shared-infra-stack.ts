import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class ApiSharedInfraStack extends cdk.Stack {
  public readonly commonEnv: Record<string, string>;
  public readonly commonLambdaRole: iam.Role;

  constructor(scope: Construct, id: string, props: cdk.StackProps & {
    stage: string;
    commonEnv: Record<string, string>;
  }) {
    super(scope, id, props);

    this.commonEnv = props.commonEnv;

    this.commonLambdaRole = new iam.Role(this, 'CommonLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `auto-rfp-api-orchestrator-lambda-role-${props.stage}`,
    });

    this.commonLambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );

    // Add your existing giant policy statements here (same as today)

    new cdk.CfnOutput(this, 'CommonLambdaRoleArn', {
      value: this.commonLambdaRole.roleArn,
    });
  }
}