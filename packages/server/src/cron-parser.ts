// Minimal cron expression parser for standard 5-field format:
//   minute hour dayOfMonth month dayOfWeek
// Supports: numbers, ranges (1-5), steps (star/5), lists (1,3,5), wildcards (star)

type CronField = { type: "any" } | { type: "values"; values: Set<number> };

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function parseField(field: string, min: number, max: number): CronField {
  if (field === "*") return { type: "any" };

  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      // Step: */5 or 1-30/5
      const [rangePart, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (rangePart !== "*") {
        if (rangePart.includes("-")) {
          [start, end] = rangePart.split("-").map((s) => parseInt(s, 10));
        } else {
          start = parseInt(rangePart, 10);
        }
      }
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part.includes("-")) {
      // Range: 1-5
      const [start, end] = part.split("-").map((s) => parseInt(s, 10));
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      // Single value
      values.add(parseInt(part, 10));
    }
  }

  return { type: "values", values };
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression "${expression}": expected 5 fields (minute hour dayOfMonth month dayOfWeek)`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0 = Sunday
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  if (field.type === "any") return true;
  return field.values.has(value);
}

/**
 * Given a parsed cron and a reference time, compute the next UTC time the cron fires.
 * Searches up to 366 days ahead.
 */
export function nextCronTime(parsed: ParsedCron, after: Date): Date {
  const d = new Date(after.getTime());
  // Start from the next minute
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  const maxIterations = 366 * 24 * 60; // one year of minutes
  for (let i = 0; i < maxIterations; i++) {
    const month = d.getUTCMonth() + 1; // 1-12
    const dayOfMonth = d.getUTCDate();
    const dayOfWeek = d.getUTCDay(); // 0 = Sunday
    const hour = d.getUTCHours();
    const minute = d.getUTCMinutes();

    if (
      fieldMatches(parsed.month, month) &&
      fieldMatches(parsed.dayOfMonth, dayOfMonth) &&
      fieldMatches(parsed.dayOfWeek, dayOfWeek) &&
      fieldMatches(parsed.hour, hour) &&
      fieldMatches(parsed.minute, minute)
    ) {
      return d;
    }

    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }

  throw new Error("Could not find next cron time within 366 days");
}
