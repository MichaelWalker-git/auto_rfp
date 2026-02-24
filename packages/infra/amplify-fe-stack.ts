import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from '@aws-cdk/aws-amplify-alpha';

export interface AmplifyFeStackProps extends cdk.StackProps {
  stage: string;
  owner: string; // MichaelWalker-git
  repository: string; // "auto_rfp"
  branch: string;     // "develop" | "main"
  githubToken: cdk.SecretValue;

  cognitoUserPoolId: string;
  cognitoUserPoolClientId: string;
  cognitoDomainUrl: string;
  baseApiUrl: string;
  region: string;

  sentryDNS: string;

  /** Custom domain to attach to the main branch (e.g. 'rfp.horustech.dev') */
  customDomain?: string;
}

export class AmplifyFeStack extends cdk.Stack {
  public readonly amplifyApp: amplify.App;

  constructor(scope: Construct, id: string, props: AmplifyFeStackProps) {
    super(scope, id, props);

    const {
      stage,
      owner,
      repository,
      branch,
      githubToken,
      cognitoUserPoolId,
      cognitoUserPoolClientId,
      cognitoDomainUrl,
      baseApiUrl,
      region,
      sentryDNS,
      customDomain,
    } = props;

    this.amplifyApp = new amplify.App(this, 'NextJsAmplifyApp', {
      appName: `auto-rfp-fe-${stage}`,

      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner,
        repository,
        oauthToken: githubToken,
      }),

      platform: amplify.Platform.WEB_COMPUTE,

      environmentVariables: {
        AMPLIFY_MONOREPO_APP_ROOT: 'apps/web',

        AMPLIFY_ENABLE_BACKEND_BUILD: 'false',
        AMPLIFY_DIFF_DEPLOY: 'false',

        NEXT_PUBLIC_STAGE: stage,
        NEXT_PUBLIC_AWS_REGION: region,
        NEXT_PUBLIC_COGNITO_USER_POOL_ID: cognitoUserPoolId,
        NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID: cognitoUserPoolClientId,
        NEXT_PUBLIC_COGNITO_DOMAIN: cognitoDomainUrl,
        NEXT_PUBLIC_BASE_API_URL: baseApiUrl.replace(/\/$/, ''),
        NEXT_PUBLIC_SENTRY_DSN: sentryDNS,
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: stage,
      }
    });

    const amplifyBranch = this.amplifyApp.addBranch(branch, {
      branchName: branch,
      environmentVariables: {
        NEXT_PUBLIC_STAGE: stage,
      },
    });

    // ── Custom domain (e.g. rfp.horustech.dev) ────────────────────────────────
    // Attaches the custom domain to the branch. After deployment, you must add
    // a CNAME record in your DNS provider:
    //   rfp.horustech.dev  →  <amplify-app-id>.amplifyapp.com
    // AWS will issue an ACM certificate automatically.
    if (customDomain) {
      // Parse subdomain vs root domain
      // e.g. 'rfp.horustech.dev' → domainName='horustech.dev', prefix='rfp'
      const parts = customDomain.split('.');
      const domainName = parts.slice(-2).join('.');   // horustech.dev
      const subdomainPrefix = parts.slice(0, -2).join('.'); // rfp

      const domain = this.amplifyApp.addDomain(domainName, {
        enableAutoSubdomain: false,
        autoSubdomainCreationPatterns: [],
      });

      // Map the subdomain prefix to the branch
      domain.mapSubDomain(amplifyBranch, subdomainPrefix);

      new cdk.CfnOutput(this, 'CustomDomainUrl', {
        value: `https://${customDomain}`,
        description: `Custom domain for the ${branch} branch`,
      });

      new cdk.CfnOutput(this, 'CustomDomainInstructions', {
        value: `Add CNAME: ${customDomain} → ${this.amplifyApp.defaultDomain}`,
        description: 'DNS record to add in your DNS provider',
      });
    }

    new cdk.CfnOutput(this, 'AmplifyBranchUrl', {
      value: `https://${amplifyBranch.branchName}.${this.amplifyApp.defaultDomain}`,
      description: 'Use this URL as Cognito redirect URL',
    });
  }
}
