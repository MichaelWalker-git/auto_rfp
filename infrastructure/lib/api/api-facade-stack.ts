import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface ApiFacadeStackProps extends cdk.StackProps {
  stage: string;
  userPoolId?: string;
}

export class ApiFacadeStack extends cdk.Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer | undefined;
  public readonly deployment: apigw.Deployment;

  constructor(scope: Construct, id: string, props: ApiFacadeStackProps) {
    super(scope, id, props);

    // Create the API Gateway REST API with automatic deployment enabled
    // This is the simplest approach that avoids circular dependencies
    this.api = new apigw.RestApi(this, 'AutoRfpApi', {
      restApiName: `AutoRFP API (${props.stage})`,
      deployOptions: {
        stageName: props.stage,
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
    });

    // Get the automatically created deployment
    // We need to expose this so route stacks can add dependencies
    this.deployment = this.api.latestDeployment!;

    // Create Cognito authorizer if userPoolId is provided
    if (props.userPoolId) {
      const userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', props.userPoolId);
      this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
        cognitoUserPools: [userPool],
        authorizerName: `${props.stage}-cognito-authorizer`,
      });
    }

    new cdk.CfnOutput(this, 'RestApiId', { value: this.api.restApiId });
    new cdk.CfnOutput(this, 'RootResourceId', { value: this.api.restApiRootResourceId });
    new cdk.CfnOutput(this, 'ApiBaseUrl', { value: this.api.url });
  }
}
