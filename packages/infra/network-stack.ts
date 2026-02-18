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

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const {
      existingVpcId,
      existingVpcName,
    } = props;

    // 1. Either look up an existing VPC or create a new one
    this.vpc = this.createOrLookupVpc(existingVpcId, existingVpcName);

    // 2. Security groups in that VPC
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for AutoRFP Lambda functions',
      allowAllOutbound: true,
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for AutoRFP database',
      allowAllOutbound: false,
    });

  }

  /**
   * Try to use an existing VPC (id or name). If neither is provided,
   * create a new VPC.
   */
  private createOrLookupVpc(
    existingVpcId?: string,
    existingVpcName?: string,
  ): ec2.IVpc {
    if (existingVpcId) {
      // Lookup by VPC ID
      return ec2.Vpc.fromLookup(this, 'ExistingVpcById', {
        vpcId: existingVpcId,
      });
    }

    if (existingVpcName) {
      // Lookup by Name tag
      return ec2.Vpc.fromLookup(this, 'ExistingVpcByName', {
        vpcName: existingVpcName,
      });
    }

    // Fallback: create a new VPC
    return new ec2.Vpc(this, 'AutoRfpVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
  }
}
