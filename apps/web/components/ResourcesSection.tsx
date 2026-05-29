import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function ResourcesSection() {
  return (
    <section className="py-24" id="resources">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Strategic resources for RFP teams
          </h2>
          <p className="max-w-[800px] text-muted-foreground md:text-xl">
            Expert insights and tools to help you succeed with your RFP responses
          </p>
        </div>

        <Tabs defaultValue="featured" className="mt-12">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-3">
            <TabsTrigger value="featured">Featured</TabsTrigger>
            <TabsTrigger value="webinars">Webinars</TabsTrigger>
            <TabsTrigger value="blog">Blog</TabsTrigger>
          </TabsList>
          
          <TabsContent value="featured" className="mt-8">
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              <Card className="bg-muted/40 border-primary/20">
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">The AI RFP Handbook</CardTitle>
                  <CardDescription>Your ultimate guide to harnessing AI for RFP responses</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-primary"
                      >
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Get the guide</Button>
                </CardFooter>
              </Card>
              
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">5 Ways AI Is Transforming RFP Responses</CardTitle>
                  <CardDescription>On-demand webinar</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Watch now</Button>
                </CardFooter>
              </Card>
              
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">Measuring RFP Success: KPIs That Matter</CardTitle>
                  <CardDescription>Featured blog post</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M16 13H8" />
                        <path d="M16 17H8" />
                        <path d="M10 9H8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Read article</Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="webinars" className="mt-8">
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">5 Ways AI Is Transforming RFP Responses</CardTitle>
                  <CardDescription>On-demand webinar</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Watch now</Button>
                </CardFooter>
              </Card>
              
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">Building an Efficient RFP Content Library</CardTitle>
                  <CardDescription>Live webinar - June 15, 2023</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Register now</Button>
                </CardFooter>
              </Card>
              
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">RFP Response Metrics: What to Track</CardTitle>
                  <CardDescription>On-demand webinar</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Watch now</Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="blog" className="mt-8">
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">Measuring RFP Success: KPIs That Matter</CardTitle>
                  <CardDescription>Featured blog post</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M16 13H8" />
                        <path d="M16 17H8" />
                        <path d="M10 9H8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Read article</Button>
                </CardFooter>
              </Card>
              
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">10 Common RFP Mistakes to Avoid</CardTitle>
                  <CardDescription>Blog post</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M16 13H8" />
                        <path d="M16 17H8" />
                        <path d="M10 9H8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Read article</Button>
                </CardFooter>
              </Card>
              
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">How LlamaIndex Powers Better RFP Responses</CardTitle>
                  <CardDescription>Blog post</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-video overflow-hidden rounded-md">
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M16 13H8" />
                        <path d="M16 17H8" />
                        <path d="M10 9H8" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">Read article</Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-center mt-12">
          <Button variant="outline" size="lg">
            Explore all resources
          </Button>
        </div>
      </div>
    </section>
  );
} 