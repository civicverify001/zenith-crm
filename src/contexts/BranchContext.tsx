import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export interface Branch {
  id: string
  name: string
  code: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  stripe_account_id: string | null
  fedex_account_number: string | null
  is_active: boolean
  created_at: string
}

interface BranchContextValue {
  userBranch: Branch | null           // the branch this user belongs to
  allBranches: Branch[]               // admin only — all active branches
  selectedBranchId: string | null     // admin switcher — null = show all branches
  setSelectedBranchId: (id: string | null) => void
  loading: boolean
}

const BranchContext = createContext<BranchContextValue>({
  userBranch: null,
  allBranches: [],
  selectedBranchId: null,
  setSelectedBranchId: () => {},
  loading: true,
})

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [userBranch, setUserBranch] = useState<Branch | null>(null)
  const [allBranches, setAllBranches] = useState<Branch[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    loadBranches()
  }, [profile?.id])

  async function loadBranches() {
    setLoading(true)
    try {
      if (isAdmin) {
        // Admin fetches all branches
        const { data } = await supabase
          .from('branches')
          .select('*')
          .eq('is_active', true)
          .order('name')
        if (data && data.length > 0) {
          setAllBranches(data)
          // Set user's own branch from profile.branch_id
          const mine = profile?.branch_id
            ? data.find(b => b.id === profile.branch_id) ?? data[0]
            : data[0]
          setUserBranch(mine ?? null)
        }
      } else {
        // Non-admin: fetch only their assigned branch
        if (profile?.branch_id) {
          const { data } = await supabase
            .from('branches')
            .select('*')
            .eq('id', profile.branch_id)
            .single()
          if (data) setUserBranch(data)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <BranchContext.Provider
      value={{ userBranch, allBranches, selectedBranchId, setSelectedBranchId, loading }}
    >
      {children}
    </BranchContext.Provider>
  )
}

export function useBranchContext() {
  return useContext(BranchContext)
}
