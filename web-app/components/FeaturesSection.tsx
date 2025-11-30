import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function FeaturesSection() {
  return (
    <section className="py-24" id="platform">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            The AI platform for every team in your organization
          </h2>
          <p className="max-w-[800px] text-muted-foreground md:text-xl">
            Discover how AutoRFP can help different teams in your organization respond to RFPs faster and more effectively.
          </p>
        </div>

        <Tabs defaultValue="proposal" className="mt-12">
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
            <TabsTrigger value="proposal" className="py-2 md:py-3">Proposal Managers</TabsTrigger>
            <TabsTrigger value="sales" className="py-2 md:py-3">Sales</TabsTrigger>
            <TabsTrigger value="marketing" className="py-2 md:py-3">Marketing</TabsTrigger>
            <TabsTrigger value="it" className="py-2 md:py-3">IT/Security</TabsTrigger>
            <TabsTrigger value="exec" className="py-2 md:py-3">Executive Leadership</TabsTrigger>
            <TabsTrigger value="legal" className="py-2 md:py-3">Legal</TabsTrigger>
          </TabsList>
          
          <TabsContent value="proposal" className="mt-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Proposal & Bid Managers</h3>
                <p className="text-muted-foreground">
                  AutoRFP AI drafts your answers and manages collaborative workflows so you can deliver winning responses to RFPs, questionnaires, and assessments 80% faster.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Auto-generate responses based on your documents
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Manage content library with AI assistance
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Streamline team collaboration
                  </li>
                </ul>
                <Button className="mt-4">Explore solutions</Button>
              </div>
              <div className="relative h-[350px] w-full rounded-lg bg-muted p-4 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="180"
                  height="180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" x2="8" y1="13" y2="13" />
                  <line x1="16" x2="8" y1="17" y2="17" />
                  <line x1="10" x2="8" y1="9" y2="9" />
                </svg>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="sales" className="mt-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Sales Teams</h3>
                <p className="text-muted-foreground">
                  Accelerate your sales cycle by quickly responding to prospect questions and RFPs with accurate, consistent information powered by AI.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Instant answers to prospect questions
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Reduce response time to RFPs by 80%
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Increase win rates with better responses
                  </li>
                </ul>
                <Button className="mt-4">Explore solutions</Button>
              </div>
              <div className="relative h-[350px] w-full rounded-lg bg-muted p-4 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="180"
                  height="180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <path d="M21 15V6" />
                  <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                  <path d="M12 12H3" />
                  <path d="M16 6H3" />
                  <path d="M12 18H3" />
                </svg>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="marketing" className="mt-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Marketing Teams</h3>
                <p className="text-muted-foreground">
                  Ensure consistent messaging and brand voice across all RFP responses while saving time on content creation.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Maintain consistent brand messaging
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Update content once for all channels
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Analytics on most-used content pieces
                  </li>
                </ul>
                <Button className="mt-4">Explore solutions</Button>
              </div>
              <div className="relative h-[350px] w-full rounded-lg bg-muted p-4 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="180"
                  height="180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <path d="M3 3v18h18" />
                  <path d="m19 9-5 5-4-4-3 3" />
                </svg>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="it" className="mt-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">IT & Security Teams</h3>
                <p className="text-muted-foreground">
                  Streamline security questionnaires and compliance documentation with AI-powered responses that are accurate and up-to-date.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Automate security questionnaire responses
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Keep compliance documentation current
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Secure content access controls
                  </li>
                </ul>
                <Button className="mt-4">Explore solutions</Button>
              </div>
              <div className="relative h-[350px] w-full rounded-lg bg-muted p-4 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="180"
                  height="180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="exec" className="mt-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Executive Leadership</h3>
                <p className="text-muted-foreground">
                  Gain visibility into your RFP process, optimize win rates, and allocate resources efficiently with data-driven insights.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Win rate analytics and reporting
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Resource utilization metrics
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    ROI calculations on RFP responses
                  </li>
                </ul>
                <Button className="mt-4">Explore solutions</Button>
              </div>
              <div className="relative h-[350px] w-full rounded-lg bg-muted p-4 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="180"
                  height="180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                  <path d="M12 18V6" />
                </svg>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="legal" className="mt-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Legal Teams</h3>
                <p className="text-muted-foreground">
                  Ensure consistent, accurate legal responses while reducing the burden on your legal team for standard RFP questions.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Pre-approved legal language library
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Compliance tracking for responses
                  </li>
                  <li className="flex items-center">
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
                      className="text-primary mr-2 h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Approval workflows for legal content
                  </li>
                </ul>
                <Button className="mt-4">Explore solutions</Button>
              </div>
              <div className="relative h-[350px] w-full rounded-lg bg-muted p-4 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="180"
                  height="180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
                </svg>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
} 