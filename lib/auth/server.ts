import { createClient } from '@/lib/supabase/server'

export interface BusinessContext {
  businessId: string
  userId: string
  role: string
}

export interface AuthUser {
  id: string
  email: string | undefined
}

/**
 * Gets the authenticated user's business context from the current Supabase session.
 * Returns null if the user is not authenticated or has no business membership.
 */
export async function getBusinessContext(): Promise<BusinessContext | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) return null

    // Get the first business this user belongs to
    const { data: membership, error: memberError } = await supabase
      .from('users_businesses')
      .select('business_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (memberError || !membership) return null

    return {
      userId: user.id,
      businessId: membership.business_id as string,
      role: (membership.role as string) ?? 'member',
    }
  } catch {
    return null
  }
}

/**
 * Gets the authenticated user's basic info.
 * Returns null if the user is not authenticated.
 */
export async function getUser(): Promise<AuthUser | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) return null

    return {
      id: user.id,
      email: user.email,
    }
  } catch {
    return null
  }
}
