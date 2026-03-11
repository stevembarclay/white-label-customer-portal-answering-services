// STUB — replaced with full implementation in Task 11.
export type AuthResult = { valid: true; keyId: string; businessId: string | null; operatorOrgId: string | null; scopes: string[] }
export type AuthFailure = { valid: false; status: 401 | 403; message: string }
export type BearerAuthResult = AuthResult | AuthFailure

export function hashApiKey(_rawKey: string): string { return '' }
export function generateRawApiKey(): string { return '' }
export function checkScope(_scopes: string[], _required: string): boolean { return false }
export function checkIpAllowlist(_ips: string[] | null, _ip: string): boolean { return true }

export async function validateBearerToken(
  _authHeader: string | null,
  _requiredScope: string,
  _clientIp: string
): Promise<BearerAuthResult> {
  return { valid: false, status: 401, message: 'Bearer auth not yet implemented.' }
}
