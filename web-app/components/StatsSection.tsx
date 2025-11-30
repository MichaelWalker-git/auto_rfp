export function StatsSection() {
  return (
    <section className="py-16 bg-muted/50">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Company Performance Metrics
          </h2>
          <div className="flex flex-wrap justify-center gap-8 mt-8">
            <div className="flex flex-col items-center p-6 bg-background rounded-lg shadow-sm">
              <div className="text-5xl font-bold">4.8</div>
              <div className="text-sm text-muted-foreground mt-2">
                500+ reviews
              </div>
            </div>
            <div className="flex flex-col items-center p-6 bg-background rounded-lg shadow-sm">
              <div className="text-5xl font-bold">$200M+</div>
              <div className="text-sm text-muted-foreground mt-2">
                in total opportunities managed
              </div>
            </div>
            <div className="flex flex-col items-center p-6 bg-background rounded-lg shadow-sm">
              <div className="text-5xl font-bold">10+</div>
              <div className="text-sm text-muted-foreground mt-2">
                of the Fortune 500 use AutoRFP
              </div>
            </div>
            <div className="flex flex-col items-center p-6 bg-background rounded-lg shadow-sm">
              <div className="text-5xl font-bold">1.5M+</div>
              <div className="text-sm text-muted-foreground mt-2">
                Q&A pairs maintained on the platform
              </div>
            </div>
          </div>
          <h3 className="text-2xl font-bold mt-12">
            The leader in response intelligence, trusted worldwide
          </h3>
        </div>
      </div>
    </section>
  );
} 