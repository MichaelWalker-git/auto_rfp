import { Button } from "./ui/button";

export function AISection() {
  return (
    <section className="py-24 bg-primary/5" id="ai">
      <div className="container px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
          <div className="space-y-6">
            <div className="inline-block rounded-lg bg-primary/10 px-3 py-1 text-sm text-primary">
              POWERED BY LLAMAINDEX
            </div>
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
              Advanced AI that understands your documents
            </h2>
            <p className="text-muted-foreground md:text-xl">
              Our LlamaIndex-powered document agents read and understand your corporate documentation, knowledge bases, and previous RFP responses to generate accurate, consistent answers.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary mr-2 h-5 w-5 mt-0.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <div>
                  <span className="font-medium">Document Understanding:</span> Our AI can process Word, PDF, Excel, and PowerPoint files to understand your content
                </div>
              </li>
              <li className="flex items-start">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary mr-2 h-5 w-5 mt-0.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <div>
                  <span className="font-medium">Context-Aware Responses:</span> Generates answers that are contextually relevant to the specific RFP question
                </div>
              </li>
              <li className="flex items-start">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary mr-2 h-5 w-5 mt-0.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <div>
                  <span className="font-medium">Continuous Learning:</span> Improves over time as it processes more of your content and RFP responses
                </div>
              </li>
              <li className="flex items-start">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary mr-2 h-5 w-5 mt-0.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <div>
                  <span className="font-medium">Secure Processing:</span> All your data remains private and secure within your own environment
                </div>
              </li>
            </ul>
            <Button size="lg">Learn about AutoRFP AI</Button>
          </div>
          <div className="relative h-[450px] w-full rounded-lg bg-gradient-to-br from-primary/20 via-primary/10 to-background p-4">
            <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center">
              <div className="relative w-full max-w-[80%] bg-background rounded-lg shadow-lg p-6 border border-border">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <div className="rounded-full bg-red-500 h-3 w-3" />
                    <div className="rounded-full bg-yellow-500 h-3 w-3" />
                    <div className="rounded-full bg-green-500 h-3 w-3" />
                    <div className="ml-auto text-xs text-muted-foreground">AI Response Generator</div>
                  </div>
                  <div className="space-y-2">
                    <div className="bg-muted p-2 rounded text-sm font-medium">
                      Q: What security measures do you have in place to protect customer data?
                    </div>
                    <div className="p-2 text-sm border-l-2 border-primary pl-4">
                      <p className="mb-2">Our platform implements multiple layers of security to protect customer data:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>256-bit AES encryption for data at rest and in transit</li>
                        <li>Role-based access controls with multi-factor authentication</li>
                        <li>Regular penetration testing and vulnerability assessments</li>
                        <li>SOC 2 Type II and ISO 27001 compliance</li>
                        <li>Data backup and disaster recovery procedures</li>
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">Sources: Security_Whitepaper.pdf, ISO27001_Certification.pdf</p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">Response generated in 3.2 seconds from 5 documents</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
} 