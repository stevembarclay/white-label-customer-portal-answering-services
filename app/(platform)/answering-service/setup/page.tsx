import { getBusinessContext, getUser } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { SetupWizardClient } from '@/components/answering-service/SetupWizardClient'
import { createClient } from '@/lib/supabase/server'
import { WizardService } from '@/lib/services/answering-service/wizardService'

export const dynamic = 'force-dynamic'

export default async function AnsweringServiceSetupPage() {
  const context = await getBusinessContext()
  const user = await getUser()
  
  if (!context) {
    redirect('/auth/login')
  }

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch existing session server-side
  let sessionData = null
  try {
    const supabase = await createClient()
    const wizardService = new WizardService(supabase)
    const session = await wizardService.getOrCreateSession(context.businessId, user.id)
    sessionData = {
      id: session.id,
      currentStep: session.current_step,
      pathSelected: session.path_selected,
      wizardData: session.wizard_data,
    }
  } catch (error) {
    console.error('[AnsweringServiceSetupPage] Error fetching session:', error)
    // Continue without session data - client will create one
  }

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <SetupWizardClient 
        businessId={context.businessId}
        userId={user.id}
        userRole={context.role}
        userEmail={user.email}
        initialSession={sessionData}
      />
    </div>
  )
}

