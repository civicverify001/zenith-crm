import { useEffect, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { UserRole, UserProfile } from '../types/domain.types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  role: UserRole | null
  loading: boolean
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        if (session?.user) fetchProfile(session.user.id)
        else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      setProfile(data as UserProfile)
    } catch (err) {
      console.error('Failed to fetch user profile:', err)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  return {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    loading,
  }
}
