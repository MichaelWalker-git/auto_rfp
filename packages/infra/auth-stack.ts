import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface AuthStackProps extends cdk.StackProps {
  stage: string;
  callbackUrls: string[];
  logoutUrl?: string;
  domainPrefixBase?: string;
  /** The portal URL shown in invitation emails (e.g. https://rfp.horustech.dev) */
  portalUrl?: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { stage, callbackUrls, logoutUrl, domainPrefixBase, portalUrl } = props;

    const accountId = cdk.Stack.of(this).account;
    const base = domainPrefixBase ?? 'auto-rfp';
    const domainPrefix = `${base}-${stage}-${accountId}`.toLowerCase();

    // Portal URL for invitation emails — defaults to production URL
    const loginUrl = portalUrl ?? 'https://rfp.horustech.dev';
    const tempPassword = process.env.DEFAULT_TEMP_PASSWORD || 'Welcome1!';

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

      userInvitation: {
        emailSubject: 'Welcome to Auto RFP — Your Account is Ready',
        emailBody: [
          '<h2>Welcome to Auto RFP!</h2>',
          '<p>Your account has been created. Here are your login details:</p>',
          '<table style="border-collapse:collapse;margin:16px 0;">',
          '  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Portal:</td>',
          `    <td style="padding:4px 0;"><a href="${loginUrl}">${loginUrl}</a></td></tr>`,
          '  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td>',
          '    <td style="padding:4px 0;">{username}</td></tr>',
          '  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Temporary Password:</td>',
          `    <td style="padding:4px 0;"><code style="background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:14px;">${tempPassword}</code></td></tr>`,
          '</table>',
          '<h3>How to get started:</h3>',
          '<ol>',
          `  <li>Go to <a href="${loginUrl}">${loginUrl}</a></li>`,
          '  <li>Enter your email and the temporary password above</li>',
          '  <li>You will be asked to set a new password</li>',
          '  <li>That is it! You are in.</li>',
          '</ol>',
          '<p style="margin-top:16px;color:#666;">If you have any issues logging in, please contact your administrator.</p>',
          '<!-- {####} -->',
        ].join('\n'),
        // SMS is not used but Cognito requires {username} and {####} placeholders
        smsMessage: 'Your Auto RFP login: {username} password: {####}',
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