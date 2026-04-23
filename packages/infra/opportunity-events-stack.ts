import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';

/**
 * Standalone EventBridge bus for opportunity events (POC generation).
 *
 * Deployed once, shared across all stages. The bus name is fixed so that
 * both Dev and Test (and future Prod) API stacks can reference it by name.
 */

export const OPPORTUNITY_EVENT_BUS_NAME = 'auto-rfp-opportunity-events';

export interface OpportunityEventsStackProps extends cdk.StackProps {
  /** Not used for the bus name — bus is shared across stages */
  stage: string;
}

export class OpportunityEventsStack extends cdk.Stack {
  public readonly eventBus: events.IEventBus;

  constructor(scope: Construct, id: string, props: OpportunityEventsStackProps) {
    super(scope, id, props);

    this.eventBus = new events.EventBus(this, 'OpportunityEventBus', {
      eventBusName: OPPORTUNITY_EVENT_BUS_NAME,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge bus for opportunity / POC events',
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      description: 'ARN of the opportunity EventBridge bus',
    });
  }
}
