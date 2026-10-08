import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Next.js loads `.env.local` for the app, but nothing does it for a plain `bun run`
 * script, so `process.env` is empty inside these scripts unless the caller exports
 * everything by hand. That is a trap worth removing rather than documenting.
 *
 * Real environment variables win, so an explicit value in the shell still overrides the
 * file. `.env.local` is read first, so it takes precedence over `.env`.
 */
export function loadEnv(files = [".env.local", ".env"]) {
  for (const file of files) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;

      const key = match[1];
      let value = match[2];

      // No `s` flag: this file is compiled to ES2017, where it is not available.
      const quoted = value.match(/^"([\s\S]*)"$/) ?? value.match(/^'([\s\S]*)'$/);
      if (quoted) value = quoted[1];
      else value = value.replace(/\s+#.*$/, "").trim();

      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}