import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { AdvancedSecurityMode } from 'aws-cdk-lib/aws-cognito';

export interface AuthStackProps extends cdk.StackProps {
  /**
   * Stage name: e.g. "dev", "test", "prod"
   */
  stage: string;

  /**
   * Redirect URL(s) for your frontend.
   * Amplify can still use the hosted UI if you want, but it’s optional.
   * Example: "http://localhost:3000" or "https://app.example.com"
   */
  callbackUrls: string[];

  /**
   * Optional logout URL (defaults to callbackUrl)
   */
  logoutUrl?: string;

  /**
   * Base prefix for Cognito domain, will become "<domainPrefixBase>-<stage>-<account>"
   */
  domainPrefixBase?: string;
}

/**
 * Minimal Cognito auth stack for use with Amplify:
 * - User Pool
 * - User Pool Client
 * - Hosted UI domain (for Amplify if you want to use it)
 *
 */
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

    // 1. User Pool (simple, Amplify-friendly)
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `auto-rfp-users-${stage}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      signInCaseSensitive: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // change to RETAIN for prod
      advancedSecurityMode: AdvancedSecurityMode.ENFORCED
    });

    // 2. User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `auto-rfp-client-${stage}`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [...callbackUrls],
        logoutUrls: [...callbackUrls, logoutUrl || 'http://localhost:3000'],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });


    // 3. Hosted UI domain (Amplify can use this if you choose hosted UI)
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix,
      },
    });

    // 4. Outputs (IDs only, no login URL)
    new cdk.CfnOutput(this, 'Stage', {
      value: stage,
      description: 'Deployment stage',
    });

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
