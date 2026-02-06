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

    this.api = new apigw.RestApi(this, 'AutoRfpApi', {
      restApiName: `AutoRFP API (${props.stage})`,
      deploy: false, // We'll handle deployment manually
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

    // Create deployment that will be updated when routes change
    this.deployment = new apigw.Deployment(this, 'Deployment', {
      api: this.api,
      description: `Deployment for ${props.stage} stage`,
    });

    // Create stage with deployment
    new apigw.Stage(this, 'Stage', {
      deployment: this.deployment,
      stageName: props.stage,
      metricsEnabled: true,
      loggingLevel: apigw.MethodLoggingLevel.INFO,
      dataTraceEnabled: true,
    });

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
