import { redirect } from 'next/navigation'
import { getBusinessContext } from '@/lib/auth/server'
import { requireModuleAccess } from '@/lib/middleware/requireModule'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AnsweringServicePage() {
  const context = await getBusinessContext()

  if (!context) {
    redirect('/auth/login')
  }

  // Check module access
  try {
    await requireModuleAccess('answering_service')
  } catch (error) {
    redirect('/dashboard?error=module-access-denied')
  }

  const { businessId } = context

  // Query for completed wizard session
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('answering_service_wizard_sessions')
      .select('id')
      .eq('business_id', businessId)
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[AnsweringServicePage] Error querying wizard sessions:', error)
      // On error, redirect to setup to be safe
      redirect('/answering-service/setup')
    }

    // If completed session exists, redirect to dashboard
    if (data) {
      redirect('/answering-service/dashboard')
    }

    // No completed session, redirect to setup
    redirect('/answering-service/setup')
  } catch (error) {
    console.error('[AnsweringServicePage] Unexpected error:', error)
    // On error, redirect to setup to be safe
    redirect('/answering-service/setup')
  }
}


