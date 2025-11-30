import { Button } from "./ui/button";

export function CTASection() {
  return (
    <section className="py-24 bg-primary text-primary-foreground">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center text-center space-y-4">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Ready to see AutoRFP in action?
          </h2>
          <p className="max-w-[800px] text-primary-foreground/80 md:text-xl">
            Find out why leading response teams across the world turn to AutoRFP for their RFP software needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mt-6">
            <Button size="lg" variant="secondary" className="px-8">
              Request demo
            </Button>
            <Button size="lg" variant="outline" className="bg-transparent border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 px-8">
              Contact sales
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
} 