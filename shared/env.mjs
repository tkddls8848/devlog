import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT_ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

export function parseEnv(source) {
  const values = {};
  for (const line of String(source).replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const raw = match[2];
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const end = raw.lastIndexOf(raw[0]);
      values[match[1]] = end > 0 ? raw.slice(1, end) : raw;
    } else values[match[1]] = raw.replace(/\s+#.*$/, "").trim();
  }
  return values;
}

// Shell/CI values take precedence. Resolve from this module, never from cwd.
export function loadEnv({ file = ROOT_ENV_FILE, env = process.env } = {}) {
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (!(key in env)) env[key] = value;
  }
}
