const millisecondsPerDay = 24 * 60 * 60 * 1000;

export function inclusiveCalendarDays(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const days = (end.getTime() - start.getTime()) / millisecondsPerDay + 1;

  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError("endDate must be on or after startDate");
  }

  return days;
}

export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Date must use YYYY-MM-DD format");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Date is invalid");
  }

  return date;
}

