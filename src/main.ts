/**
 * codex-agent - Main entry point
 *
 * a
 */

import { greet } from "./lib";

function main(): void {
  const message = greet("World");
  console.log(message);
}

main();
