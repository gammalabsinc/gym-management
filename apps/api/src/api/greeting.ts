import { z } from "zod";
import type { GreetOutput } from "../app/greet";

const greetingArgs = z.object({ name: z.string().trim().min(1).max(100) });

/** Thin resolver: parse input, call the use case, return its output. */
export function makeGreetingResolver(
  greet: (input: { name: string }) => GreetOutput,
): (args: unknown) => GreetOutput {
  return (args) => greet(greetingArgs.parse(args));
}
