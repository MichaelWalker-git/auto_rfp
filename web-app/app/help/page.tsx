import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle,
  Upload, 
  Bot, 
  FileText,
  Download
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
                Complete guide to extracting RFP questions, generating answers, and creating proposals
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
            The Auto RFP platform streamlines the proposal process by generating an executive brief from the RFP, automatically extracting questions, allowing you to generate or write answers, and then creating professional proposals based on your responses. This guide walks you through each step.
          </p>
        </section>

        {/* Workflow */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Complete Workflow</h2>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 1</Badge>
                <CardTitle className="text-base">Project Selection</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Create or select workspace</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 2</Badge>
                <CardTitle className="text-base">Knowledge Base</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Upload company documents</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 3</Badge>
                <CardTitle className="text-base">Import RFP</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Upload RFP document</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 4</Badge>
                <CardTitle className="text-base">Generate Brief</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">AI analyzes RFP</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 5</Badge>
                <CardTitle className="text-base">Answer Questions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">AI or manual answers</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 6</Badge>
                <CardTitle className="text-base">Create Proposal</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Generate document</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <Badge className="w-fit mb-2">Step 7</Badge>
                <CardTitle className="text-base">Export & Submit</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Download and submit</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Detailed Steps */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Detailed Workflow</h2>

          <div className="space-y-8">
            {/* Steps 1-3: Setup */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">1-3</span>
                  Setup: Project, Knowledge Base & Import RFP
                </CardTitle>
                <CardDescription>Get your workspace ready and upload the RFP</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <h4 className="font-medium mb-2">Step 1: Create Project</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Log in to dashboard</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Create or select project</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Enter project workspace</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Step 2: Build Knowledge Base</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Go to Content Library</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Upload documents (DOCX, PDF, XLS, TXT)</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Tag and organize</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Step 3: Import RFP</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Go to Opportunities</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Upload or search RFP</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Enter opportunity details</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 4: Generate Brief */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">4</span>
                  Generating Executive Brief
                </CardTitle>
                <CardDescription>AI analyzes RFP and extracts questions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium mb-2">What is a Brief?</h4>
                    <p className="text-sm text-muted-foreground">
                      An Executive Brief is an AI-generated internal analysis of the RFP that includes executive summary, requirements analysis, risks, scoring, past performance, and more. The brief also automatically extracts all questions from the RFP that need answers.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Generation Process:</h4>
                    <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Click "Generate Brief" or "Analyze RFP" button</li>
                      <li>System analyzes RFP text and searches Knowledge Base (1-5 minutes)</li>
                      <li>Questions are automatically extracted from the RFP</li>
                      <li>Brief organized into proposal sections</li>
                      <li>You'll be notified when brief is ready</li>
                    </ol>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <h4 className="font-medium text-green-900 mb-2 text-sm">Brief Includes:</h4>
                    <p className="text-xs text-green-800">Executive Summary • Requirements Analysis • Proposed Solutions • Risks Assessment • Scoring Grid • Past Performance • Team & Contacts • Extracted Questions • Appendices</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 5: Answer Questions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">5</span>
                  Answering Questions
                </CardTitle>
                <CardDescription>Address RFP questions with AI-generated or manual answers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium mb-2">View Extracted Questions:</h4>
                    <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Navigate to your RFP in Opportunities</li>
                      <li>Click "View Questions" or "Questions & Answers" tab</li>
                      <li>See all questions extracted from the RFP</li>
                      <li>Status shows: Unanswered, AI Generated, or Manually Written</li>
                    </ol>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 mt-4">
                  <div>
                    <h4 className="font-medium mb-2">Option A: AI-Generated Answers</h4>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Click "Generate Answer" button</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> System searches Knowledge Base</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> AI generates professional answer</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Review, accept, edit, or regenerate</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Option B: Manual Answers</h4>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Select a question from the list</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Type or paste your answer in the answer field</li>
                      <li className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-1" /> Click the "Save" button to save your answer</li>
                    </ul>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
                  <h4 className="font-medium text-blue-900 mb-2 text-sm">Tips for Quality Answers:</h4>
                  <ul className="text-xs text-blue-800 space-y-1">
                    <li>• Be specific and detailed with relevant examples</li>
                    <li>• Reference company capabilities and past performance</li>
                    <li>• Ensure consistency across all answers</li>
                    <li>• Have SMEs review technical answers</li>
                    <li>• Complete all questions before final proposal</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Step 6: Create Proposal */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">6</span>
                  Creating the Proposal
                </CardTitle>
                <CardDescription>Generate final formatted document</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium mb-2">Generate Proposal:</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Ensure all questions are answered</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Click "Create Proposal" button</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Choose format (Word or PDF)</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> System generates formatted proposal</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Preview and download</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Review Proposal:</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Check professional formatting and layout</li>
                      <li>• Verify accurate content from answers</li>
                      <li>• Confirm proper branding and company information</li>
                      <li>• Ensure all required sections are included</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 7: Export & Submit */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">7</span>
                  Exporting & Submitting
                </CardTitle>
                <CardDescription>Download and submit your proposal</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="font-medium mb-2">Download:</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Click "Download" or "Export"</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Choose file format (DOCX or PDF)</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> File downloads to your computer</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Submit:</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Follow RFP submission instructions</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Submit via SAM.gov, email, or portal</li>
                      <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Update opportunity status to Submitted</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-6">Best Practices</h2>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Knowledge Base & Answers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Keep KB Current</p>
                    <p className="text-xs text-muted-foreground">Regular updates improve AI answers</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Be Specific in Answers</p>
                    <p className="text-xs text-muted-foreground">Detailed answers = stronger proposals</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Validate AI Output</p>
                    <p className="text-xs text-muted-foreground">Always review before using</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Proposal Quality</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Complete All Answers</p>
                    <p className="text-xs text-muted-foreground">Every question answered = better proposal</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Involve SMEs</p>
                    <p className="text-xs text-muted-foreground">Review technical sections</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Submit Early</p>
                    <p className="text-xs text-muted-foreground">Avoid last-minute rush</p>
                  </div>
                </div>
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
                <CardTitle className="text-lg">Questions Not Extracted</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>RFPs lacking structured questions:</strong> Manually identify key requirements.</p>
                <p><strong>Questions seem incomplete?</strong> Check original RFP for context.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Answer Generation Slow</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>Large KB:</strong> More documents = longer processing.</p>
                <p><strong>Complex questions:</strong> Try off-peak hours or write manually.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Weak Proposal Output</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p><strong>Incomplete answers:</strong> Ensure thorough responses.</p>
                <p><strong>Expand KB:</strong> More relevant docs improve quality.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Support */}
        <section>
          <h2 className="text-2xl font-semibold mb-6">Need Help?</h2>
          
          <Card>
            <CardHeader>
              <CardTitle>Contact Support</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Contact your platform administrator, check the in-app help section, or reach out to your project manager.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}