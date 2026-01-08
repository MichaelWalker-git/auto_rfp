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
exports.OpenSearchServerlessStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const oss = __importStar(require("aws-cdk-lib/aws-opensearchserverless"));
/**
 * Provisions an OpenSearch Serverless SEARCH collection and
 * exposes its HTTPS endpoint.
 *
 * Use `collectionEndpoint` in your DocumentPipelineStack env:
 *   OPENSEARCH_ENDPOINT = osStack.collectionEndpoint
 */
class OpenSearchServerlessStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { stage } = props;
        // Normalized collection name (lowercase, no weird chars)
        const baseName = `auto-rfp-${stage}-docs`.toLowerCase();
        this.collectionName = baseName.replace(/[^a-z0-9-]/g, '-');
        //
        // 1) Encryption policy – must exist BEFORE the collection
        //
        const encryptionPolicy = new oss.CfnSecurityPolicy(this, 'DocumentsEncryptionPolicy', {
            name: `${this.collectionName}-enc-policy`,
            type: 'encryption',
            description: `Encryption policy for ${this.collectionName}`,
            policy: JSON.stringify({
                Rules: [
                    {
                        // Apply to all collections, including this one
                        Resource: ['collection/*'],
                        ResourceType: 'collection',
                    },
                ],
                AWSOwnedKey: true,
            }),
        });
        //
        // 2) Network policy – allow public HTTPS access but IAM-protected
        //
        const networkPolicy = new oss.CfnSecurityPolicy(this, 'DocumentsNetworkPolicy', {
            name: `${this.collectionName}-net-policy`,
            type: 'network',
            description: `Network policy for ${this.collectionName}`,
            policy: JSON.stringify([
                {
                    Description: 'Public HTTPS access to collections, restricted by IAM',
                    Rules: [
                        {
                            Resource: ['collection/*'],
                            ResourceType: 'collection',
                        },
                    ],
                    AllowFromPublic: true,
                },
            ]),
        });
        //
        // 3) Collection – depends on both policies (fixes your error)
        //
        this.collection = new oss.CfnCollection(this, 'DocumentsCollection', {
            name: this.collectionName,
            description: `Serverless collection for AutoRFP document embeddings (${stage})`,
            type: 'SEARCH',
        });
        this.collection.addDependency(encryptionPolicy);
        this.collection.addDependency(networkPolicy);
        //
        // 4) Expose endpoint for other stacks
        //
        this.collectionEndpoint = this.collection.attrCollectionEndpoint;
        new cdk.CfnOutput(this, 'CollectionName', {
            value: this.collectionName,
            exportName: `${this.stackName}-CollectionName`,
        });
        new cdk.CfnOutput(this, 'CollectionEndpoint', {
            value: this.collectionEndpoint,
            exportName: `${this.stackName}-CollectionEndpoint`,
        });
    }
}
exports.OpenSearchServerlessStack = OpenSearchServerlessStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9wZW5zZWFyY2gtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLDZDQUFnRDtBQUVoRCwwRUFBNEQ7QUFNNUQ7Ozs7OztHQU1HO0FBQ0gsTUFBYSx5QkFBMEIsU0FBUSxtQkFBSztJQUtsRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXFDO1FBQzdFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFeEIseURBQXlEO1FBQ3pELE1BQU0sUUFBUSxHQUFHLFlBQVksS0FBSyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDeEQsSUFBSSxDQUFDLGNBQWMsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUUzRCxFQUFFO1FBQ0YsMERBQTBEO1FBQzFELEVBQUU7UUFDRixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLGlCQUFpQixDQUNoRCxJQUFJLEVBQ0osMkJBQTJCLEVBQzNCO1lBQ0UsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLGNBQWMsYUFBYTtZQUN6QyxJQUFJLEVBQUUsWUFBWTtZQUNsQixXQUFXLEVBQUUseUJBQXlCLElBQUksQ0FBQyxjQUFjLEVBQUU7WUFDM0QsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3JCLEtBQUssRUFBRTtvQkFDTDt3QkFDRSwrQ0FBK0M7d0JBQy9DLFFBQVEsRUFBRSxDQUFDLGNBQWMsQ0FBQzt3QkFDMUIsWUFBWSxFQUFFLFlBQVk7cUJBQzNCO2lCQUNGO2dCQUNELFdBQVcsRUFBRSxJQUFJO2FBQ2xCLENBQUM7U0FDSCxDQUNGLENBQUM7UUFFRixFQUFFO1FBQ0Ysa0VBQWtFO1FBQ2xFLEVBQUU7UUFDRixNQUFNLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxpQkFBaUIsQ0FDN0MsSUFBSSxFQUNKLHdCQUF3QixFQUN4QjtZQUNFLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxjQUFjLGFBQWE7WUFDekMsSUFBSSxFQUFFLFNBQVM7WUFDZixXQUFXLEVBQUUsc0JBQXNCLElBQUksQ0FBQyxjQUFjLEVBQUU7WUFDeEQsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3JCO29CQUNFLFdBQVcsRUFDVCx1REFBdUQ7b0JBQ3pELEtBQUssRUFBRTt3QkFDTDs0QkFDRSxRQUFRLEVBQUUsQ0FBQyxjQUFjLENBQUM7NEJBQzFCLFlBQVksRUFBRSxZQUFZO3lCQUMzQjtxQkFDRjtvQkFDRCxlQUFlLEVBQUUsSUFBSTtpQkFDdEI7YUFDRixDQUFDO1NBQ0gsQ0FDRixDQUFDO1FBRUYsRUFBRTtRQUNGLDhEQUE4RDtRQUM5RCxFQUFFO1FBQ0YsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQ25FLElBQUksRUFBRSxJQUFJLENBQUMsY0FBYztZQUN6QixXQUFXLEVBQUUsMERBQTBELEtBQUssR0FBRztZQUMvRSxJQUFJLEVBQUUsUUFBUTtTQUNmLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDaEQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFN0MsRUFBRTtRQUNGLHNDQUFzQztRQUN0QyxFQUFFO1FBQ0YsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsc0JBQXNCLENBQUM7UUFFakUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDMUIsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsaUJBQWlCO1NBQy9DLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0I7WUFDOUIsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMscUJBQXFCO1NBQ25ELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXpGRCw4REF5RkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIG9zcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtb3BlbnNlYXJjaHNlcnZlcmxlc3MnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9wZW5TZWFyY2hTZXJ2ZXJsZXNzU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICBzdGFnZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIFByb3Zpc2lvbnMgYW4gT3BlblNlYXJjaCBTZXJ2ZXJsZXNzIFNFQVJDSCBjb2xsZWN0aW9uIGFuZFxuICogZXhwb3NlcyBpdHMgSFRUUFMgZW5kcG9pbnQuXG4gKlxuICogVXNlIGBjb2xsZWN0aW9uRW5kcG9pbnRgIGluIHlvdXIgRG9jdW1lbnRQaXBlbGluZVN0YWNrIGVudjpcbiAqICAgT1BFTlNFQVJDSF9FTkRQT0lOVCA9IG9zU3RhY2suY29sbGVjdGlvbkVuZHBvaW50XG4gKi9cbmV4cG9ydCBjbGFzcyBPcGVuU2VhcmNoU2VydmVybGVzc1N0YWNrIGV4dGVuZHMgU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgY29sbGVjdGlvbjogb3NzLkNmbkNvbGxlY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBjb2xsZWN0aW9uTmFtZTogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgY29sbGVjdGlvbkVuZHBvaW50OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE9wZW5TZWFyY2hTZXJ2ZXJsZXNzU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBzdGFnZSB9ID0gcHJvcHM7XG5cbiAgICAvLyBOb3JtYWxpemVkIGNvbGxlY3Rpb24gbmFtZSAobG93ZXJjYXNlLCBubyB3ZWlyZCBjaGFycylcbiAgICBjb25zdCBiYXNlTmFtZSA9IGBhdXRvLXJmcC0ke3N0YWdlfS1kb2NzYC50b0xvd2VyQ2FzZSgpO1xuICAgIHRoaXMuY29sbGVjdGlvbk5hbWUgPSBiYXNlTmFtZS5yZXBsYWNlKC9bXmEtejAtOS1dL2csICctJyk7XG5cbiAgICAvL1xuICAgIC8vIDEpIEVuY3J5cHRpb24gcG9saWN5IOKAkyBtdXN0IGV4aXN0IEJFRk9SRSB0aGUgY29sbGVjdGlvblxuICAgIC8vXG4gICAgY29uc3QgZW5jcnlwdGlvblBvbGljeSA9IG5ldyBvc3MuQ2ZuU2VjdXJpdHlQb2xpY3koXG4gICAgICB0aGlzLFxuICAgICAgJ0RvY3VtZW50c0VuY3J5cHRpb25Qb2xpY3knLFxuICAgICAge1xuICAgICAgICBuYW1lOiBgJHt0aGlzLmNvbGxlY3Rpb25OYW1lfS1lbmMtcG9saWN5YCxcbiAgICAgICAgdHlwZTogJ2VuY3J5cHRpb24nLFxuICAgICAgICBkZXNjcmlwdGlvbjogYEVuY3J5cHRpb24gcG9saWN5IGZvciAke3RoaXMuY29sbGVjdGlvbk5hbWV9YCxcbiAgICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgUnVsZXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgLy8gQXBwbHkgdG8gYWxsIGNvbGxlY3Rpb25zLCBpbmNsdWRpbmcgdGhpcyBvbmVcbiAgICAgICAgICAgICAgUmVzb3VyY2U6IFsnY29sbGVjdGlvbi8qJ10sXG4gICAgICAgICAgICAgIFJlc291cmNlVHlwZTogJ2NvbGxlY3Rpb24nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIEFXU093bmVkS2V5OiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vXG4gICAgLy8gMikgTmV0d29yayBwb2xpY3kg4oCTIGFsbG93IHB1YmxpYyBIVFRQUyBhY2Nlc3MgYnV0IElBTS1wcm90ZWN0ZWRcbiAgICAvL1xuICAgIGNvbnN0IG5ldHdvcmtQb2xpY3kgPSBuZXcgb3NzLkNmblNlY3VyaXR5UG9saWN5KFxuICAgICAgdGhpcyxcbiAgICAgICdEb2N1bWVudHNOZXR3b3JrUG9saWN5JyxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogYCR7dGhpcy5jb2xsZWN0aW9uTmFtZX0tbmV0LXBvbGljeWAsXG4gICAgICAgIHR5cGU6ICduZXR3b3JrJyxcbiAgICAgICAgZGVzY3JpcHRpb246IGBOZXR3b3JrIHBvbGljeSBmb3IgJHt0aGlzLmNvbGxlY3Rpb25OYW1lfWAsXG4gICAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIERlc2NyaXB0aW9uOlxuICAgICAgICAgICAgICAnUHVibGljIEhUVFBTIGFjY2VzcyB0byBjb2xsZWN0aW9ucywgcmVzdHJpY3RlZCBieSBJQU0nLFxuICAgICAgICAgICAgUnVsZXM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIFJlc291cmNlOiBbJ2NvbGxlY3Rpb24vKiddLFxuICAgICAgICAgICAgICAgIFJlc291cmNlVHlwZTogJ2NvbGxlY3Rpb24nLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIEFsbG93RnJvbVB1YmxpYzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICBdKSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vXG4gICAgLy8gMykgQ29sbGVjdGlvbiDigJMgZGVwZW5kcyBvbiBib3RoIHBvbGljaWVzIChmaXhlcyB5b3VyIGVycm9yKVxuICAgIC8vXG4gICAgdGhpcy5jb2xsZWN0aW9uID0gbmV3IG9zcy5DZm5Db2xsZWN0aW9uKHRoaXMsICdEb2N1bWVudHNDb2xsZWN0aW9uJywge1xuICAgICAgbmFtZTogdGhpcy5jb2xsZWN0aW9uTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgU2VydmVybGVzcyBjb2xsZWN0aW9uIGZvciBBdXRvUkZQIGRvY3VtZW50IGVtYmVkZGluZ3MgKCR7c3RhZ2V9KWAsXG4gICAgICB0eXBlOiAnU0VBUkNIJyxcbiAgICB9KTtcbiAgICB0aGlzLmNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShlbmNyeXB0aW9uUG9saWN5KTtcbiAgICB0aGlzLmNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShuZXR3b3JrUG9saWN5KTtcblxuICAgIC8vXG4gICAgLy8gNCkgRXhwb3NlIGVuZHBvaW50IGZvciBvdGhlciBzdGFja3NcbiAgICAvL1xuICAgIHRoaXMuY29sbGVjdGlvbkVuZHBvaW50ID0gdGhpcy5jb2xsZWN0aW9uLmF0dHJDb2xsZWN0aW9uRW5kcG9pbnQ7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29sbGVjdGlvbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jb2xsZWN0aW9uTmFtZSxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1Db2xsZWN0aW9uTmFtZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29sbGVjdGlvbkVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMuY29sbGVjdGlvbkVuZHBvaW50LFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUNvbGxlY3Rpb25FbmRwb2ludGAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==