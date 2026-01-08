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
exports.AmplifyFeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const amplify = __importStar(require("@aws-cdk/aws-amplify-alpha"));
class AmplifyFeStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { stage, owner, repository, branch, githubToken, cognitoUserPoolId, cognitoUserPoolClientId, cognitoDomainUrl, baseApiUrl, region, } = props;
        this.amplifyApp = new amplify.App(this, 'NextJsAmplifyApp', {
            appName: `auto-rfp-fe-${stage}`,
            sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
                owner,
                repository,
                oauthToken: githubToken,
            }),
            platform: amplify.Platform.WEB_COMPUTE,
            environmentVariables: {
                AMPLIFY_MONOREPO_APP_ROOT: 'web-app',
                AMPLIFY_ENABLE_BACKEND_BUILD: 'false',
                AMPLIFY_DIFF_DEPLOY: 'false',
                NEXT_PUBLIC_STAGE: stage,
                NEXT_PUBLIC_AWS_REGION: region,
                NEXT_PUBLIC_COGNITO_USER_POOL_ID: cognitoUserPoolId,
                NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID: cognitoUserPoolClientId,
                NEXT_PUBLIC_COGNITO_DOMAIN: cognitoDomainUrl,
                NEXT_PUBLIC_BASE_API_URL: baseApiUrl.replace(/\/$/, ''),
            }
        });
        const amplifyBranch = this.amplifyApp.addBranch(branch, {
            branchName: branch,
            environmentVariables: {
                NEXT_PUBLIC_STAGE: stage,
            },
        });
        new cdk.CfnOutput(this, 'AmplifyBranchUrl', {
            value: `https://${amplifyBranch.branchName}.${this.amplifyApp.defaultDomain}`,
            description: 'Use this URL as Cognito redirect URL',
        });
    }
}
exports.AmplifyFeStack = AmplifyFeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1wbGlmeS1mZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFtcGxpZnktZmUtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLG9FQUFzRDtBQWdCdEQsTUFBYSxjQUFlLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFHM0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEwQjtRQUNsRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQ0osS0FBSyxFQUNMLEtBQUssRUFDTCxVQUFVLEVBQ1YsTUFBTSxFQUNOLFdBQVcsRUFDWCxpQkFBaUIsRUFDakIsdUJBQXVCLEVBQ3ZCLGdCQUFnQixFQUNoQixVQUFVLEVBQ1YsTUFBTSxHQUNQLEdBQUcsS0FBSyxDQUFDO1FBRVYsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFELE9BQU8sRUFBRSxlQUFlLEtBQUssRUFBRTtZQUUvQixrQkFBa0IsRUFBRSxJQUFJLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQztnQkFDdkQsS0FBSztnQkFDTCxVQUFVO2dCQUNWLFVBQVUsRUFBRSxXQUFXO2FBQ3hCLENBQUM7WUFFRixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVEsQ0FBQyxXQUFXO1lBRXRDLG9CQUFvQixFQUFFO2dCQUNwQix5QkFBeUIsRUFBRSxTQUFTO2dCQUVwQyw0QkFBNEIsRUFBRSxPQUFPO2dCQUNyQyxtQkFBbUIsRUFBRSxPQUFPO2dCQUU1QixpQkFBaUIsRUFBRSxLQUFLO2dCQUN4QixzQkFBc0IsRUFBRSxNQUFNO2dCQUM5QixnQ0FBZ0MsRUFBRSxpQkFBaUI7Z0JBQ25ELHVDQUF1QyxFQUFFLHVCQUF1QjtnQkFDaEUsMEJBQTBCLEVBQUUsZ0JBQWdCO2dCQUM1Qyx3QkFBd0IsRUFBRSxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUM7YUFDeEQ7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUU7WUFDdEQsVUFBVSxFQUFFLE1BQU07WUFDbEIsb0JBQW9CLEVBQUU7Z0JBQ3BCLGlCQUFpQixFQUFFLEtBQUs7YUFDekI7U0FDRixDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxXQUFXLGFBQWEsQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxhQUFhLEVBQUU7WUFDN0UsV0FBVyxFQUFFLHNDQUFzQztTQUNwRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF6REQsd0NBeURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgYW1wbGlmeSBmcm9tICdAYXdzLWNkay9hd3MtYW1wbGlmeS1hbHBoYSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW1wbGlmeUZlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgc3RhZ2U6IHN0cmluZztcbiAgb3duZXI6IHN0cmluZzsgLy8gTWljaGFlbFdhbGtlci1naXRcbiAgcmVwb3NpdG9yeTogc3RyaW5nOyAvLyBcImF1dG9fcmZwXCJcbiAgYnJhbmNoOiBzdHJpbmc7ICAgICAvLyBcImRldmVsb3BcIiB8IFwibWFpblwiXG4gIGdpdGh1YlRva2VuOiBjZGsuU2VjcmV0VmFsdWU7XG5cbiAgY29nbml0b1VzZXJQb29sSWQ6IHN0cmluZztcbiAgY29nbml0b1VzZXJQb29sQ2xpZW50SWQ6IHN0cmluZztcbiAgY29nbml0b0RvbWFpblVybDogc3RyaW5nO1xuICBiYXNlQXBpVXJsOiBzdHJpbmc7XG4gIHJlZ2lvbjogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQW1wbGlmeUZlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgYW1wbGlmeUFwcDogYW1wbGlmeS5BcHA7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEFtcGxpZnlGZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHtcbiAgICAgIHN0YWdlLFxuICAgICAgb3duZXIsXG4gICAgICByZXBvc2l0b3J5LFxuICAgICAgYnJhbmNoLFxuICAgICAgZ2l0aHViVG9rZW4sXG4gICAgICBjb2duaXRvVXNlclBvb2xJZCxcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbENsaWVudElkLFxuICAgICAgY29nbml0b0RvbWFpblVybCxcbiAgICAgIGJhc2VBcGlVcmwsXG4gICAgICByZWdpb24sXG4gICAgfSA9IHByb3BzO1xuXG4gICAgdGhpcy5hbXBsaWZ5QXBwID0gbmV3IGFtcGxpZnkuQXBwKHRoaXMsICdOZXh0SnNBbXBsaWZ5QXBwJywge1xuICAgICAgYXBwTmFtZTogYGF1dG8tcmZwLWZlLSR7c3RhZ2V9YCxcblxuICAgICAgc291cmNlQ29kZVByb3ZpZGVyOiBuZXcgYW1wbGlmeS5HaXRIdWJTb3VyY2VDb2RlUHJvdmlkZXIoe1xuICAgICAgICBvd25lcixcbiAgICAgICAgcmVwb3NpdG9yeSxcbiAgICAgICAgb2F1dGhUb2tlbjogZ2l0aHViVG9rZW4sXG4gICAgICB9KSxcblxuICAgICAgcGxhdGZvcm06IGFtcGxpZnkuUGxhdGZvcm0uV0VCX0NPTVBVVEUsXG5cbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgIEFNUExJRllfTU9OT1JFUE9fQVBQX1JPT1Q6ICd3ZWItYXBwJyxcblxuICAgICAgICBBTVBMSUZZX0VOQUJMRV9CQUNLRU5EX0JVSUxEOiAnZmFsc2UnLFxuICAgICAgICBBTVBMSUZZX0RJRkZfREVQTE9ZOiAnZmFsc2UnLFxuXG4gICAgICAgIE5FWFRfUFVCTElDX1NUQUdFOiBzdGFnZSxcbiAgICAgICAgTkVYVF9QVUJMSUNfQVdTX1JFR0lPTjogcmVnaW9uLFxuICAgICAgICBORVhUX1BVQkxJQ19DT0dOSVRPX1VTRVJfUE9PTF9JRDogY29nbml0b1VzZXJQb29sSWQsXG4gICAgICAgIE5FWFRfUFVCTElDX0NPR05JVE9fVVNFUl9QT09MX0NMSUVOVF9JRDogY29nbml0b1VzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIE5FWFRfUFVCTElDX0NPR05JVE9fRE9NQUlOOiBjb2duaXRvRG9tYWluVXJsLFxuICAgICAgICBORVhUX1BVQkxJQ19CQVNFX0FQSV9VUkw6IGJhc2VBcGlVcmwucmVwbGFjZSgvXFwvJC8sICcnKSxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGFtcGxpZnlCcmFuY2ggPSB0aGlzLmFtcGxpZnlBcHAuYWRkQnJhbmNoKGJyYW5jaCwge1xuICAgICAgYnJhbmNoTmFtZTogYnJhbmNoLFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgTkVYVF9QVUJMSUNfU1RBR0U6IHN0YWdlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbXBsaWZ5QnJhbmNoVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7YW1wbGlmeUJyYW5jaC5icmFuY2hOYW1lfS4ke3RoaXMuYW1wbGlmeUFwcC5kZWZhdWx0RG9tYWlufWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VzZSB0aGlzIFVSTCBhcyBDb2duaXRvIHJlZGlyZWN0IFVSTCcsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==