export function addSubscriptionPeriod(start: Date, interval: string): Date {
  const normalizedInterval = interval.toUpperCase();
  const months = normalizedInterval === "MONTHLY"
    ? 1
    : normalizedInterval === "YEARLY" || normalizedInterval === "ANNUAL"
      ? 12
      : 0;
  if (months === 0) throw new Error(`Unsupported subscription interval: ${interval}`);

  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}
