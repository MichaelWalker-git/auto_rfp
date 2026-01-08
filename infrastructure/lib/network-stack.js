"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
class NetworkStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { existingVpcId, existingVpcName, } = props;
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
    createOrLookupVpc(existingVpcId, existingVpcName) {
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
exports.NetworkStack = NetworkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmV0d29yay1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm5ldHdvcmstc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQWtCM0MsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFLekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF3QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQ0osYUFBYSxFQUNiLGVBQWUsR0FDaEIsR0FBRyxLQUFLLENBQUM7UUFFVix3REFBd0Q7UUFDeEQsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsYUFBYSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBRWxFLGlDQUFpQztRQUNqQyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUM1RSxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUc7WUFDYixXQUFXLEVBQUUsNkNBQTZDO1lBQzFELGdCQUFnQixFQUFFLElBQUk7U0FDdkIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3BFLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztZQUNiLFdBQVcsRUFBRSxxQ0FBcUM7WUFDbEQsZ0JBQWdCLEVBQUUsS0FBSztTQUN4QixDQUFDLENBQUM7SUFFTCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssaUJBQWlCLENBQ3ZCLGFBQXNCLEVBQ3RCLGVBQXdCO1FBRXhCLElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsbUJBQW1CO1lBQ25CLE9BQU8sR0FBRyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO2dCQUNqRCxLQUFLLEVBQUUsYUFBYTthQUNyQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNwQixxQkFBcUI7WUFDckIsT0FBTyxHQUFHLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7Z0JBQ25ELE9BQU8sRUFBRSxlQUFlO2FBQ3pCLENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCw2QkFBNkI7UUFDN0IsT0FBTyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNyQyxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxlQUFlO29CQUNyQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNO2lCQUNsQzthQUNGO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBbEVELG9DQWtFQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBOZXR3b3JrU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqXG4gICAqIE9wdGlvbmFsIGV4cGxpY2l0IFZQQyBJRCB0byByZXVzZS5cbiAgICogRXhhbXBsZTogdnBjLTAxMjM0NTY3ODlhYmNkZWYwXG4gICAqL1xuICBleGlzdGluZ1ZwY0lkPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBWUEMgbmFtZSB0YWcgdG8gbG9va3VwLlxuICAgKiBFeGFtcGxlOiAnbWFpbi12cGMnXG4gICAqL1xuICBleGlzdGluZ1ZwY05hbWU/OiBzdHJpbmc7XG5cbn1cblxuZXhwb3J0IGNsYXNzIE5ldHdvcmtTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuICBwdWJsaWMgcmVhZG9ubHkgbGFtYmRhU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG4gIHB1YmxpYyByZWFkb25seSBkYlNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBOZXR3b3JrU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3Qge1xuICAgICAgZXhpc3RpbmdWcGNJZCxcbiAgICAgIGV4aXN0aW5nVnBjTmFtZSxcbiAgICB9ID0gcHJvcHM7XG5cbiAgICAvLyAxLiBFaXRoZXIgbG9vayB1cCBhbiBleGlzdGluZyBWUEMgb3IgY3JlYXRlIGEgbmV3IG9uZVxuICAgIHRoaXMudnBjID0gdGhpcy5jcmVhdGVPckxvb2t1cFZwYyhleGlzdGluZ1ZwY0lkLCBleGlzdGluZ1ZwY05hbWUpO1xuXG4gICAgLy8gMi4gU2VjdXJpdHkgZ3JvdXBzIGluIHRoYXQgVlBDXG4gICAgdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdMYW1iZGFTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIEF1dG9SRlAgTGFtYmRhIGZ1bmN0aW9ucycsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgdGhpcy5kYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0RiU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBBdXRvUkZQIGRhdGFiYXNlJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gIH1cblxuICAvKipcbiAgICogVHJ5IHRvIHVzZSBhbiBleGlzdGluZyBWUEMgKGlkIG9yIG5hbWUpLiBJZiBuZWl0aGVyIGlzIHByb3ZpZGVkLFxuICAgKiBjcmVhdGUgYSBuZXcgVlBDLlxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVPckxvb2t1cFZwYyhcbiAgICBleGlzdGluZ1ZwY0lkPzogc3RyaW5nLFxuICAgIGV4aXN0aW5nVnBjTmFtZT86IHN0cmluZyxcbiAgKTogZWMyLklWcGMge1xuICAgIGlmIChleGlzdGluZ1ZwY0lkKSB7XG4gICAgICAvLyBMb29rdXAgYnkgVlBDIElEXG4gICAgICByZXR1cm4gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdFeGlzdGluZ1ZwY0J5SWQnLCB7XG4gICAgICAgIHZwY0lkOiBleGlzdGluZ1ZwY0lkLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nVnBjTmFtZSkge1xuICAgICAgLy8gTG9va3VwIGJ5IE5hbWUgdGFnXG4gICAgICByZXR1cm4gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdFeGlzdGluZ1ZwY0J5TmFtZScsIHtcbiAgICAgICAgdnBjTmFtZTogZXhpc3RpbmdWcGNOYW1lLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2s6IGNyZWF0ZSBhIG5ldyBWUENcbiAgICByZXR1cm4gbmV3IGVjMi5WcGModGhpcywgJ0F1dG9SZnBWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMCxcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHVibGljLXN1Ym5ldCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgfVxufVxuIl19