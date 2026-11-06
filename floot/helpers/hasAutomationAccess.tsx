/** Shared server policy. Social login never changes billing or grants. */
export function hasAutomationAccess(input: { userId: number; ownerId: number; disabled?: boolean; accessUntil?: Date | null; billing?: { status: string; periodEnd: Date | null; paidThrough: Date | null } | null; now?: Date }) {
  const now = (input.now || new Date()).getTime();
  if (input.disabled) return false;
  if (input.userId === input.ownerId) return true;
  if (input.accessUntil && new Date(input.accessUntil).getTime() > now) return true;
  const b = input.billing;
  return !!b && b.status === "active" && !!b.periodEnd && !!b.paidThrough && new Date(b.periodEnd).getTime() > now && new Date(b.paidThrough).getTime() > now;
}
