// STUB — replaced with full delivery implementation in Task 13.

export async function fireWebhookEvent(
  _operatorOrgId: string,
  _topic: string,
  _payload: Record<string, unknown>
): Promise<void> {
  // No-op stub. Task 13 implements subscription lookup, HMAC signing, and delivery.
}

export async function processRetryQueue(): Promise<void> {
  // No-op stub. Task 13 implements retry logic.
}
