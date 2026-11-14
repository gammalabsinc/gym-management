import { buildGreeting } from "../domain/greeting";
import type { Clock } from "./ports";

export interface GreetDeps {
  readonly clock: Clock;
}

export interface GreetInput {
  readonly name: string;
}

export interface GreetOutput {
  readonly message: string;
}

/** Sample use case: dependencies come in through the factory, never as singletons. */
export function makeGreet(deps: GreetDeps): (input: GreetInput) => GreetOutput {
  return (input) => ({ message: buildGreeting(input.name, deps.clock.now().getUTCHours()) });
}
