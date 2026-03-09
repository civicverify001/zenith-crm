import { useAuth } from '../../hooks/useAuth'

export function DashboardPage() {
  const { profile, role } = useAuth()

  const greeting = profile
    ? `Welcome back, ${profile.full_name.split(' ')[0]}.`
    : 'Welcome.'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">{greeting}</h1>
        <p className="text-muted text-sm mt-1">
          Zenith Pure Solutions CRM — Indianapolis, IN
        </p>
      </div>

      {/* Placeholder KPI cards — Phase 5 wires real data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Leads',    value: '—', color: 'border-accent',  icon: '⬡' },
          { label: 'Jobs This Week',  value: '—', color: 'border-orange',  icon: '🔧' },
          { label: 'Active Customers',value: '—', color: 'border-green',   icon: '👥' },
          { label: 'Open Invoices',   value: '—', color: 'border-amber',   icon: '💰' },
        ].map(card => (
          <div key={card.label} className={`bg-card border ${card.color} border-t-2 rounded-xl p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <span>{card.icon}</span>
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                {card.label}
              </span>
            </div>
            <div className="text-3xl font-bold text-white">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Build status */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-sm font-semibold text-accent">Phase 1 Complete — Foundation Live</span>
        </div>
        <div className="space-y-1.5 text-sm text-muted">
          <div className="flex items-center gap-2">
            <span className="text-green">✓</span>
            <span>React + TypeScript + Tailwind</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green">✓</span>
            <span>Supabase connected — project: ckmhvsrfodyaqizuqcyy</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green">✓</span>
            <span>Auth working — role: {role ?? 'loading...'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green">✓</span>
            <span>Vercel deploy pipeline ready</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-amber">→</span>
            <span className="text-slate-300">Next: Phase 2 — Database schema migrations</span>
          </div>
        </div>
      </div>
    </div>
  )
}
