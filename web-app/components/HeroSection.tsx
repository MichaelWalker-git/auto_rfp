import { Button } from "./ui/button";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="py-24 md:py-32 bg-gradient-to-b from-background to-muted">
      <div className="container px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col justify-center space-y-6">
            <div className="space-y-2">
              <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm">
                RESPONSIVE AI FOR EVERY RFP
              </div>
              <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl">
                AI agents that automate your RFP responses
              </h1>
              <p className="max-w-[600px] text-muted-foreground md:text-xl">
                Power your team with insights, accuracy, and speed across bids, questionnaires, and RFP documents with our LlamaIndex-powered AI.
              </p>
            </div>
            <div className="flex flex-col gap-2 min-[400px]:flex-row">
              <Button size="lg" className="px-8">
                Contact sales
              </Button>
              <Link href="/upload">
                <Button size="lg" variant="outline" className="px-8">
                  Try Document Upload
                </Button>
              </Link>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="relative h-[400px] w-[400px] rounded-lg bg-gradient-to-b from-primary/20 to-primary/5 p-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="240"
                  height="240"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary/30"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M7 3v18" />
                  <path d="M3 7h18" />
                  <path d="M3 11h18" />
                  <path d="M3 15h18" />
                  <path d="M3 19h18" />
                  <path d="M11 3v18" />
                  <path d="M15 3v18" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
} 