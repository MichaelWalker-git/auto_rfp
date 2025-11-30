import type React from "react"

export function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto bg-background">{children}</main>
      </div>
    </div>
  )
}
