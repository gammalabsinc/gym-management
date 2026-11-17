import type { Clock } from "../app/ports";
import { localDateIn } from "../domain/calendar";

export const systemClock: Clock = { now: () => new Date() };

const HOURS_TO_SEARCH = 27;
const HOUR_MS = 3_600_000;

/**
 * A clock that always reads as the given day of a gym's calendar. Some hour of the 27 around
 * midnight UTC of that day falls on it in any zone, so the first one that does is used.
 */
export function clockOnLocalDate(localDate: string, timeZone: string): Clock {
  const start = Date.parse(`${localDate}T00:00:00.000Z`) - 14 * HOUR_MS;
  for (let hour = 0; hour < HOURS_TO_SEARCH; hour += 1) {
    const instant = new Date(start + hour * HOUR_MS);
    if (localDateIn(instant, timeZone) === localDate) return { now: () => instant };
  }
  throw new RangeError(`No moment of ${localDate} exists in ${timeZone}`);
}
