import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
export interface AmplifyFeStackProps extends cdk.StackProps {
    stage: string;
    owner: string;
    repository: string;
    branch: string;
    githubToken: cdk.SecretValue;
    cognitoUserPoolId: string;
    cognitoUserPoolClientId: string;
    cognitoDomainUrl: string;
    baseApiUrl: string;
    region: string;
}
export declare class AmplifyFeStack extends cdk.Stack {
    readonly amplifyApp: amplify.App;
    constructor(scope: Construct, id: string, props: AmplifyFeStackProps);
}
