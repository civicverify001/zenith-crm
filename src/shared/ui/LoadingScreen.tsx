export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="text-white font-black text-xl">Z</span>
        </div>
        <div className="text-muted text-sm">Loading...</div>
      </div>
    </div>
  )
}
