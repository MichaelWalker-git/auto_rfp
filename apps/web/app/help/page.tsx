import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle,
  Database,
  Shield,
  Users,
  Settings,
  FolderOpen,
  Target,
  Search,
  Mail,
  Building2,
} from 'lucide-react';
import Link from 'next/link';

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">AutoRFP Help Center</h1>
              <p className="text-muted-foreground mt-2">
                Complete guide to managing organizations, knowledge bases, proposals, and team access
              </p>
            </div>
            <Link href="/">
              <Button variant="outline">Back to App</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Overview</h2>
          <p className="text-muted-foreground mb-6">
            AutoRFP streamlines the government proposal process. Upload RFP documents, generate executive briefs with AI analysis, extract and answer questions, manage knowledge bases with access control, and create professional proposals — all within a multi-organization platform.
          </p>
        </section>

        {/* Key Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Key Features</h2>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Building2 className="h-5 w-5 text-primary mb-2" />
                <CardTitle className="text-base">Multi-Organization</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Belong to multiple organizations and switch between them seamlessly</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Database className="h-5 w-5 text-primary mb-2" />
                <CardTitle className="text-base">Knowledge Bases</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Upload documents and Q&A content for AI-powered answer generation</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Shield className="h-5 w-5 text-primary mb-2" />
                <CardTitle className="text-base">Access Control</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Control which team members can access each knowledge base</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Target className="h-5 w-5 text-primary mb-2" />
                <CardTitle className="text-base">Executive Briefs</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">AI-generated bid/no-bid analysis with scoring and risk assessment</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Search className="h-5 w-5 text-primary mb-2" />
                <CardTitle className="text-base">SAM.gov Integration</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Search and import opportunities directly from SAM.gov</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <FolderOpen className="h-5 w-5 text-primary mb-2" />
                <CardTitle className="text-base">Google Drive Sync</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Automatically sync approved opportunities to Google Drive folders</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Workflow */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Proposal Workflow</h2>

          <div className="space-y-6">
            {/* Step 1: Setup */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                  Organization & Project Setup
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Select or create an organization (you can belong to multiple)</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Create a project for each RFP opportunity</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Assign specific knowledge bases to the project (optional — defaults to all org KBs)</li>
                </ul>
              </CardContent>
            </Card>

            {/* Step 2: Knowledge Base */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                  Build Knowledge Base
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Create knowledge bases (Documents type or Content Library Q&A type)</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Upload company documents (PDF, DOCX, TXT, CSV, XLS)</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Documents are automatically indexed for AI search</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Configure access control — choose which team members can see each KB</li>
                </ul>
              </CardContent>
            </Card>

            {/* Step 3: Import & Analyze */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  Import RFP & Generate Executive Brief
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Search SAM.gov or upload RFP documents manually</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> AI generates an Executive Brief with: summary, requirements, risks, scoring, contacts, deadlines</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Review the bid/no-bid recommendation and scoring (1-5 scale)</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Questions are automatically extracted from the RFP</li>
                </ul>
              </CardContent>
            </Card>

            {/* Step 4: Answer Questions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">4</span>
                  Answer Questions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="font-medium mb-2 text-sm">AI-Generated Answers</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Click "Generate" — AI searches your knowledge base</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Review confidence score and sources</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Edit, accept, or regenerate</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2 text-sm">Manual Answers</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Type or paste your answer directly</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Save to the project</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Answers are used in proposal generation</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 5: Generate Proposal */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">5</span>
                  Generate & Export Proposal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Click "Generate Proposal" — AI creates a structured document from your answers</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Apply templates for consistent formatting</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Export as DOCX or PDF</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5" /> Approved opportunities auto-sync to Google Drive (if configured)</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Admin Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Admin Features</h2>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Team Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>Invite users:</strong> Invite team members by email to collaborate on proposals.</p>
                <p><strong>Multiple organizations:</strong> Users can belong to multiple organizations with different roles.</p>
                <p><strong>KB access control:</strong> Grant or revoke access to specific knowledge bases per user.</p>
                <p><strong>Roles:</strong> Admin, Editor, Viewer, Billing — each with different permissions.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Organization Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>API Keys:</strong> Configure SAM.gov, Google Drive, and Linear integrations.</p>
                <p><strong>Prompts:</strong> Customize AI prompts for each analysis type (summary, requirements, risks, scoring, etc.).</p>
                <p><strong>Templates:</strong> Upload DOCX templates for consistent proposal formatting.</p>
                <p><strong>Saved Searches:</strong> Save SAM.gov search criteria for quick access.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Troubleshooting */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Troubleshooting</h2>

          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Can't See a Knowledge Base</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>An admin may have restricted access. Ask your admin to grant you access via the KB's Access Control page.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Can't See an Organization</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>You need to be added to the organization by an admin. Ask them to invite you via Team settings.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">AI Answers Are Weak</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Upload more relevant documents to your knowledge base. The AI quality depends on the content available.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Support */}
        <section>
          <h2 className="text-2xl font-semibold mb-6">Need Help?</h2>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Contact Support
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                If you have questions, run into issues, or need assistance with your account, reach out to our support team:
              </p>
              <a
                href="mailto:brennen@horustech.dev"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                <Mail className="h-4 w-4" />
                brennen@horustech.dev
              </a>
              <p className="text-xs text-muted-foreground">
                You can also contact your organization administrator for access-related questions.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
