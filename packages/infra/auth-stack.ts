import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface AuthStackProps extends cdk.StackProps {
  stage: string;
  callbackUrls: string[];
  logoutUrl?: string;
  domainPrefixBase?: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { stage, callbackUrls, logoutUrl, domainPrefixBase } = props;

    const accountId = cdk.Stack.of(this).account;
    const base = domainPrefixBase ?? 'auto-rfp';
    const domainPrefix = `${base}-${stage}-${accountId}`.toLowerCase();

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `auto-rfp-users-${stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,

      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },

      customAttributes: {
        orgId: new cognito.StringAttribute({ mutable: true, minLen: 1, maxLen: 36 }),
        userId: new cognito.StringAttribute({ mutable: true, minLen: 1, maxLen: 36 }),
        roles: new cognito.StringAttribute({ mutable: true, minLen: 1, maxLen: 2048 }),
        role: new cognito.StringAttribute({ mutable: true, minLen: 1, maxLen: 2048 }),
      },

      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },

      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `auto-rfp-client-${stage}`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [...callbackUrls],
        logoutUrls: [...callbackUrls, logoutUrl || 'http://localhost:3000'],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: { domainPrefix },
    });

    new cdk.CfnOutput(this, 'Stage', { value: stage });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
      description: 'Cognito Hosted UI domain',
    });
  }
}