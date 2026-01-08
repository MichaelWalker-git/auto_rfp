import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
export interface NetworkStackProps extends cdk.StackProps {
    /**
     * Optional explicit VPC ID to reuse.
     * Example: vpc-0123456789abcdef0
     */
    existingVpcId?: string;
    /**
     * Optional VPC name tag to lookup.
     * Example: 'main-vpc'
     */
    existingVpcName?: string;
}
export declare class NetworkStack extends cdk.Stack {
    readonly vpc: ec2.IVpc;
    readonly lambdaSecurityGroup: ec2.SecurityGroup;
    readonly dbSecurityGroup: ec2.SecurityGroup;
    constructor(scope: Construct, id: string, props: NetworkStackProps);
    /**
     * Try to use an existing VPC (id or name). If neither is provided,
     * create a new VPC.
     */
    private createOrLookupVpc;
}
