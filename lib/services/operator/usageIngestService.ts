import { createClient } from '@/lib/supabase/server'

export interface ParsedRow {
  date: string
  businessId: string
  totalCalls: number
  totalMinutes: number
  callTypeBreakdown: Record<string, { calls: number; minutes: number }>
}

export interface ValidationResult {
  valid: boolean
  issue?: string
}

export interface IngestResult {
  businessId: string
  date: string
  status: 'processed' | 'error'
  issue?: string
}

/**
 * Parse a CSV string into structured rows.
 * Expected format:
 *   date,business_id,total_calls,total_minutes[,{calltype}_calls,{calltype}_minutes,...]
 *
 * Call type columns must be in _calls / _minutes pairs.
 * Within the same CSV, the last row for a (business_id, date) pair wins.
 */
export function parseCsvRows(csv: string): ParsedRow[] {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim())
  const dateIdx = headers.indexOf('date')
  const bizIdx = headers.indexOf('business_id')
  const callsIdx = headers.indexOf('total_calls')
  const minutesIdx = headers.indexOf('total_minutes')

  if ([dateIdx, bizIdx, callsIdx, minutesIdx].includes(-1)) return []

  const callTypeColPairs: Array<{ type: string; callsIdx: number; minutesIdx: number }> = []
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].endsWith('_calls') && headers[i] !== 'total_calls') {
      const typeName = headers[i].slice(0, -6)
      const minutesColIdx = headers.indexOf(`${typeName}_minutes`)
      if (minutesColIdx !== -1) {
        callTypeColPairs.push({ type: typeName, callsIdx: i, minutesIdx: minutesColIdx })
      }
    }
  }

  const seen = new Map<string, ParsedRow>()

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim())
    if (cols.length < 4) continue

    const date = cols[dateIdx]
    const businessId = cols[bizIdx]
    const totalCalls = parseInt(cols[callsIdx], 10)
    const totalMinutes = parseFloat(cols[minutesIdx])

    if (!date || !businessId || isNaN(totalCalls) || isNaN(totalMinutes)) continue

    const callTypeBreakdown: Record<string, { calls: number; minutes: number }> = {}
    for (const { type, callsIdx: cIdx, minutesIdx: mIdx } of callTypeColPairs) {
      const calls = parseInt(cols[cIdx] ?? '0', 10)
      const minutes = parseFloat(cols[mIdx] ?? '0')
      if (!isNaN(calls) && !isNaN(minutes)) {
        callTypeBreakdown[type] = { calls, minutes }
      }
    }

    const key = `${businessId}|${date}`
    seen.set(key, { date, businessId, totalCalls, totalMinutes, callTypeBreakdown })
  }

  return Array.from(seen.values())
}

export function validateRow(
  row: ParsedRow,
  allowedBusinessIds: string[]
): ValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    return { valid: false, issue: `Invalid date format: "${row.date}". Expected YYYY-MM-DD.` }
  }

  if (!allowedBusinessIds.includes(row.businessId)) {
    return { valid: false, issue: `business_id "${row.businessId}" does not belong to this operator org.` }
  }

  if (row.totalCalls < 0) {
    return { valid: false, issue: `total_calls must be >= 0, got ${row.totalCalls}.` }
  }
  if (row.totalMinutes < 0) {
    return { valid: false, issue: `total_minutes must be >= 0, got ${row.totalMinutes}.` }
  }

  return { valid: true }
}

/**
 * Upserts a set of ParsedRows into usage_periods for the given operator.
 * Rows that fail validation get status='error'; valid rows get status='processed'.
 * Returns per-row results for the API response.
 */
export async function ingestRows(
  rows: ParsedRow[],
  operatorOrgId: string,
  allowedBusinessIds: string[],
  source: 'csv_upload' | 'api' = 'csv_upload'
): Promise<IngestResult[]> {
  const supabase = await createClient()

  const results: IngestResult[] = []

  for (const row of rows) {
    const validation = validateRow(row, allowedBusinessIds)

    if (!validation.valid) {
      await supabase.from('usage_periods').upsert({
        business_id: row.businessId,
        operator_org_id: operatorOrgId,
        period_date: row.date,
        total_calls: 0,
        total_minutes: 0,
        call_type_breakdown: {},
        source,
        status: 'error',
        error_detail: { issue: validation.issue },
        processed_at: null,
      }, { onConflict: 'business_id,period_date' })

      results.push({ businessId: row.businessId, date: row.date, status: 'error', issue: validation.issue })
      continue
    }

    const { error } = await supabase.from('usage_periods').upsert({
      business_id: row.businessId,
      operator_org_id: operatorOrgId,
      period_date: row.date,
      total_calls: row.totalCalls,
      total_minutes: row.totalMinutes,
      call_type_breakdown: row.callTypeBreakdown,
      source,
      status: 'processed',
      error_detail: null,
      processed_at: new Date().toISOString(),
    }, { onConflict: 'business_id,period_date' })

    if (error) {
      results.push({ businessId: row.businessId, date: row.date, status: 'error', issue: 'Database write failed.' })
    } else {
      results.push({ businessId: row.businessId, date: row.date, status: 'processed' })
    }
  }

  return results
}
