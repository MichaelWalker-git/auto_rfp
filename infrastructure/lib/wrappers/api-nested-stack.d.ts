import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
export interface ApiNestedStackProps extends cdk.NestedStackProps {
    /**
     * Shared API Gateway for this service (like in your example stack).
     */
    api: apigw.IRestApi;
    /**
     * Base path segment for this “bounded context”.
     * e.g. 'organization' → /organization/...
     */
    basePath: string;
    /**
     * Common Lambda role for all functions in this nested stack
     * (similar to CommonLambdaRole in your example).
     */
    lambdaRole: iam.IRole;
    /**
     * Environment variables shared by all lambdas in this nested stack.
     */
    commonEnv: Record<string, string>;
    userPool: IUserPool;
}
export declare class ApiNestedStack extends cdk.NestedStack {
    readonly api: apigw.IRestApi;
    readonly stage: apigw.Stage;
    private readonly baseResource;
    private readonly authorizer;
    private lambdaIndex;
    constructor(scope: Construct, id: string, props: ApiNestedStackProps);
    /**
     * Add a route + Lambda in this nested stack.
     *
     * path: '/get-organizations', '/{id}', '/create', etc.
     * method: 'GET' | 'POST' | 'PUT' | 'DELETE' | ...
     * handlerEntry: path to lambda file (NodejsFunction.entry)
     * extraEnv: per-function environment overrides
     */
    addRoute(path: string, method: string, handlerEntry: string, extraEnv?: Record<string, string>): void;
    private addCdkNagSuppressions;
}
