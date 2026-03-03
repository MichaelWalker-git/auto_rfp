import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
  FileText,
  Pencil,
  Download,
  RefreshCw,
  UserCheck,
  BookOpen,
  Zap,
  ClipboardCheck,
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
                Complete guide to managing organizations, document folders, proposals, and team access
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
            AutoRFP streamlines the government proposal process. Search or upload RFP opportunities, generate AI-powered executive briefs, extract and answer questions, manage document folders, generate full proposal documents, and export them — all within a multi-organization platform.
          </p>
        </section>

        {/* Key Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Key Features</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Building2, title: 'Multi-Organization', desc: 'Belong to multiple organizations and switch between them seamlessly' },
              { icon: Database, title: 'Document Folders', desc: 'Upload documents for AI-powered search and answer generation' },
              { icon: Shield, title: 'Access Control', desc: 'Control which team members can access each document folder' },
              { icon: Target, title: 'Executive Briefs', desc: 'AI-generated bid/no-bid analysis with scoring, risks, and deadlines' },
              { icon: Search, title: 'SAM.gov Integration', desc: 'Search and import opportunities directly from SAM.gov' },
              { icon: FileText, title: 'Proposal Documents', desc: 'AI-generated proposals with full-page rich text editor and export' },
              { icon: Pencil, title: 'Rich Text Editor', desc: 'Edit generated documents with inline formatting, images, and tables' },
              { icon: Download, title: 'Export Formats', desc: 'Export proposals as DOCX, PDF, PowerPoint, HTML, Markdown, or plain text' },
              { icon: RefreshCw, title: 'Google Drive Sync', desc: 'Sync approved proposals to Google Drive folders automatically' },
              { icon: UserCheck, title: 'Primary Contact', desc: 'Set a proposal signatory used in all AI-generated signature blocks' },
              { icon: BookOpen, title: 'Content Library', desc: 'Pre-approved Q&A snippets and boilerplate for consistent proposals' },
              { icon: ClipboardCheck, title: 'Signature Tracking', desc: 'Track signature status across proposal documents' },
            ].map(({ icon: Icon, title, desc }) => (
              <Card key={title} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <Icon className="h-5 w-5 text-primary mb-2" />
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Workflow */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Proposal Workflow</h2>
          <div className="space-y-6">

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">1</span>
                  Organization & Project Setup
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Select or create an organization (you can belong to multiple)</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Create a project for each RFP opportunity</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Set a <strong>Primary Contact (Proposal Signatory)</strong> in Organization Settings — used in all AI-generated signature blocks</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Assign specific document folders to the project (optional — defaults to all organization document folders)</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">2</span>
                  Build Document Folders
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Create document folders and upload company documents</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Upload company documents (PDF, DOCX, TXT, CSV, XLS) — automatically indexed for AI search</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Add pre-approved Q&A pairs to the Content Library for consistent proposal language</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Configure access control — choose which team members can see each document folder</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">3</span>
                  Import RFP & Generate Executive Brief
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Search SAM.gov or upload RFP documents manually to a project</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Click <strong>Executive Brief</strong> on the opportunity page to generate AI analysis</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Brief includes: summary, requirements, risks, scoring (1–5), contacts, and deadlines</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Review the bid/no-bid recommendation — GO, NO-GO, or CONDITIONAL GO</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Questions are automatically extracted from the RFP for the Q&A workflow</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">4</span>
                  Answer Questions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="font-medium mb-2 text-sm">AI-Generated Answers</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1 shrink-0" /> Click "Generate" — AI searches your document folders and content library</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1 shrink-0" /> Review confidence score and source citations</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1 shrink-0" /> Edit, accept, or regenerate the answer</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2 text-sm">Manual Answers</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1 shrink-0" /> Type or paste your answer directly</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1 shrink-0" /> Save to the project for use in proposal generation</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1 shrink-0" /> All answered questions feed into the AI proposal generator</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">5</span>
                  Generate Proposal Documents
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> On the opportunity page, click <strong>Generate Document</strong> and choose a document type (Technical Proposal, Cost Proposal, Management Approach, etc.)</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> AI generates a full structured document using your Q&A answers, document folders, and primary contact info</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Click the <strong>Edit (pencil)</strong> button to open the full-page rich text editor</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Use <strong>Regenerate</strong> to re-run AI generation if needed</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Apply DOCX templates for consistent formatting (upload in Organization Settings)</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">6</span>
                  Edit & Export
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> The full-page editor supports rich text: headings, tables, lists, images, inline formatting</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Click <strong>Save</strong> to persist your edits to the document</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Click <strong>Export</strong> to download in your preferred format: DOCX, PDF, PowerPoint, HTML, Markdown, or plain text</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Use the <strong>Google Drive</strong> dropdown (⋯ menu) to sync documents to Drive for collaboration</li>
                  <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Track signature status via the Signature Status option in the document menu</li>
                </ul>
              </CardContent>
            </Card>

          </div>
        </section>

        <Separator className="my-8" />

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
                <p><strong>Document folder access control:</strong> Grant or revoke access to specific document folders per user.</p>
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
                <p><strong>Primary Contact:</strong> Set the proposal signatory (name, title, email, phone, address) used in all AI-generated documents.</p>
                <p><strong>API Keys:</strong> Configure SAM.gov, Google Drive, DIBBS, and Linear integrations.</p>
                <p><strong>Prompts:</strong> Customize AI prompts for each analysis type (summary, requirements, risks, scoring, etc.).</p>
                <p><strong>Templates:</strong> Upload DOCX templates for consistent proposal formatting.</p>
                <p><strong>Saved Searches:</strong> Save SAM.gov search criteria for quick access.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  AI Document Generation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>Document types:</strong> Technical Proposal, Cost Proposal, Management Approach, Past Performance, Compliance Matrix, Executive Brief, and more.</p>
                <p><strong>Section-by-section:</strong> Large documents are generated section-by-section for higher quality and completeness.</p>
                <p><strong>Tool use:</strong> AI actively queries your document folders, past performance, content library, and org context during generation.</p>
                <p><strong>Regenerate:</strong> Re-run AI generation at any time from the document editor toolbar.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  Google Drive Integration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>Sync to Drive:</strong> Push any AI-generated or uploaded document to Google Drive from the document menu.</p>
                <p><strong>Sync from Drive:</strong> Pull edits made in Google Docs back into AutoRFP.</p>
                <p><strong>Auto-sync on GO:</strong> When an Executive Brief scores GO, documents are automatically queued for Drive sync.</p>
                <p><strong>Setup:</strong> Configure a Google service account JSON key in Organization Settings → Google API Key.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator className="my-8" />

        {/* Troubleshooting */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Troubleshooting</h2>
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Can't See a Document Folder</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                An admin may have restricted access. Ask your admin to grant you access via the document folder's Access Control page.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Document Stuck on "Generating"</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Generation can take up to 2 minutes for large documents. If it stays stuck, use the Regenerate button in the editor toolbar to restart.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Answers Are Weak</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Upload more relevant documents to your document folder and add Q&A pairs to the Content Library. AI quality depends on available content.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Export Fails</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Save the document first before exporting. DOCX export is generated client-side from the current editor content. PDF and PPTX require a backend call.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Google Drive Sync Error</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Ensure a Google service account JSON key is configured in Organization Settings. The account needs Drive API access and a delegate email.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Primary Contact Not in Documents</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Set the Primary Contact in Organization Settings before generating documents. Regenerate the document after saving the contact.
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
