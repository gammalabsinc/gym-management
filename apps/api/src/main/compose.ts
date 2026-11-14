import { makeGreetingResolver } from "../api/greeting";
import { makeGreet } from "../app/greet";
import { systemClock } from "../infra/clock";

/** Composition root: the only place that calls factories with real adapters. */
export function composeApp() {
  const greet = makeGreet({ clock: systemClock });
  return { greeting: makeGreetingResolver(greet) };
}
