import {
  listTemplates,
  createTemplate,
  deleteTemplate,
  applyTemplateToClient,
  type BillingTemplateInput,
} from '../billingTemplateService'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => mockSupabase),
}))

const mockInsert = jest.fn()
const mockSelect = jest.fn()
const mockDelete = jest.fn()

const mockSupabase = {
  from: jest.fn((table: string) => {
    if (table === 'billing_rule_templates') {
      return {
        select: mockSelect,
        insert: mockInsert,
        delete: mockDelete,
      }
    }
    return { insert: jest.fn(() => ({ error: null })) }
  }),
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('listTemplates', () => {
  it('returns templates for the operator org', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({
          data: [{ id: 't-1', name: 'Standard', rules: [], operator_org_id: 'org-1', created_at: '2026-01-01' }],
          error: null,
        }),
      }),
    })
    const templates = await listTemplates('org-1')
    expect(templates).toHaveLength(1)
    expect(templates[0].name).toBe('Standard')
  })

  it('throws on DB error', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    })
    await expect(listTemplates('org-1')).rejects.toThrow()
  })
})

describe('createTemplate', () => {
  it('inserts a new template and returns it', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 't-2', name: 'New Template', rules: [], operator_org_id: 'org-1', created_at: '2026-01-01' },
          error: null,
        }),
      }),
    })
    const input: BillingTemplateInput = { name: 'New Template', rules: [] }
    const template = await createTemplate('org-1', input)
    expect(template.id).toBe('t-2')
  })

  it('throws on DB error', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
      }),
    })
    const input: BillingTemplateInput = { name: 'Bad Template', rules: [] }
    await expect(createTemplate('org-1', input)).rejects.toThrow()
  })
})

describe('deleteTemplate', () => {
  it('deletes a template scoped to the operator org', async () => {
    const mockEq2 = jest.fn().mockResolvedValue({ error: null })
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 })
    mockDelete.mockReturnValue({ eq: mockEq1 })

    await expect(deleteTemplate('org-1', 't-3')).resolves.toBeUndefined()
    expect(mockEq1).toHaveBeenCalledWith('id', 't-3')
    expect(mockEq2).toHaveBeenCalledWith('operator_org_id', 'org-1')
  })

  it('throws on DB error', async () => {
    const mockEq2 = jest.fn().mockResolvedValue({ error: { message: 'Delete failed' } })
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 })
    mockDelete.mockReturnValue({ eq: mockEq1 })

    await expect(deleteTemplate('org-1', 't-3')).rejects.toThrow()
  })
})

describe('applyTemplateToClient', () => {
  it('returns 0 when template has no rules', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { rules: [] },
            error: null,
          }),
        }),
      }),
    })

    const result = await applyTemplateToClient('org-1', 't-1', 'biz-1')
    expect(result).toBe(0)
  })

  it('inserts rules into billing_rules and returns count', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              rules: [
                { type: 'per_call', name: 'Per Call Fee', amount: 350, active: true },
                { type: 'flat_monthly', name: 'Monthly Fee', amount: 5000, active: true },
              ],
            },
            error: null,
          }),
        }),
      }),
    })

    const billingRulesInsert = jest.fn().mockResolvedValue({ error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'billing_rule_templates') {
        return { select: mockSelect, insert: mockInsert, delete: mockDelete }
      }
      if (table === 'billing_rules') {
        return { insert: billingRulesInsert }
      }
      return { insert: jest.fn(() => ({ error: null })) }
    })

    const result = await applyTemplateToClient('org-1', 't-1', 'biz-1')
    expect(result).toBe(2)
    expect(billingRulesInsert).toHaveBeenCalledTimes(1)
  })

  it('throws when template is not found', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    await expect(applyTemplateToClient('org-1', 'missing-id', 'biz-1')).rejects.toThrow('Template not found.')
  })

  it('throws when billing_rules insert fails', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { rules: [{ type: 'per_call', name: 'Fee', amount: 100, active: true }] },
            error: null,
          }),
        }),
      }),
    })

    const billingRulesInsert = jest.fn().mockResolvedValue({ error: { message: 'Insert failed' } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'billing_rule_templates') {
        return { select: mockSelect, insert: mockInsert, delete: mockDelete }
      }
      if (table === 'billing_rules') {
        return { insert: billingRulesInsert }
      }
      return { insert: jest.fn(() => ({ error: null })) }
    })

    await expect(applyTemplateToClient('org-1', 't-1', 'biz-1')).rejects.toThrow('Failed to apply template rules to client.')
  })
})
