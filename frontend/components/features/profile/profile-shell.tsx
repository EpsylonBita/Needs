interface ProfileShellProps {
  children: React.ReactNode
}

export function ProfileShell({ children }: ProfileShellProps) {
  return (
    <div className="relative min-h-screen bg-gradient-to-b from-blue-50/80 via-blue-50/20 to-white pt-24">
      <div className="container relative mx-auto max-w-7xl px-6 pb-8">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-10 rounded-xl border border-border/50 bg-gradient-to-b from-white to-blue-50/50 p-6 shadow-sm backdrop-blur-sm">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
} 