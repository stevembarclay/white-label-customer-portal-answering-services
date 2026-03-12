import {
  getIndustryGreetingTemplates,
  getVerticalPresets,
  applyVerticalPresets,
} from '@/lib/services/answering-service/verticalPresets'
import type { AnsweringServiceSetup } from '@/schemas/answeringServiceSchema'

describe('getIndustryGreetingTemplates', () => {
  const industries = [
    'legal', 'medical', 'home_services',
    'real_estate', 'professional_services', 'other',
  ] as const

  it.each(industries)('last entry is always custom for %s', (industry) => {
    const templates = getIndustryGreetingTemplates(industry)
    expect(templates.at(-1)).toEqual({ id: 'custom', text: 'Custom' })
  })

  it('includes industry-specific templates for legal', () => {
    const ids = getIndustryGreetingTemplates('legal').map(t => t.id)
    expect(ids).toContain('legal-1')
    expect(ids).toContain('legal-2')
  })

  it('includes industry-specific templates for medical', () => {
    const ids = getIndustryGreetingTemplates('medical').map(t => t.id)
    expect(ids).toContain('medical-1')
  })

  it('includes industry-specific templates for real_estate', () => {
    const ids = getIndustryGreetingTemplates('real_estate').map(t => t.id)
    expect(ids).toContain('real_estate-1')
  })

  it('returns base templates for home_services (no industry-specific)', () => {
    const ids = getIndustryGreetingTemplates('home_services').map(t => t.id)
    expect(ids).toContain('template-1')
    expect(ids).not.toContain('home_services-1')
  })
})
