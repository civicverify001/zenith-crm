import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success, useAuth listener in AppRouter picks up the session automatically
  }

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-black text-2xl">Z</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Zenith Pure Solutions</h1>
          <p className="text-muted text-sm mt-1">CRM Operating System</p>
        </div>

        {/* Form */}
        <div className="bg-surface border border-border rounded-2xl p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@zenithpuresolutions.com"
                required
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red/10 border border-red/30 rounded-lg px-3 py-2 text-sm text-red">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Indianapolis, IN · (317) 690-4172
        </p>
      </div>
    </div>
  )
}
