import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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
export declare class AuthStack extends cdk.Stack {
    readonly userPool: cognito.UserPool;
    readonly userPoolClient: cognito.UserPoolClient;
    readonly userPoolDomain: cognito.UserPoolDomain;
    constructor(scope: Construct, id: string, props: AuthStackProps);
}
