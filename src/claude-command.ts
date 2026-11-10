// The Claude Code executable a login runs.
//
// The plugin spawns it without a shell. On Windows that finds only a real
// `.exe`: npm installs Claude Code as `claude.cmd` (a shim that a shell would
// run), so the default `claude` would not start. There it is looked up the
// way the shim itself finds it. A path set by hand is always kept.
import { joinPath, trimTrailingSeparators } from "./platform.js";

const NPM_EXE = ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"];

/** The value of an environment variable, its name in any case (Windows). */
function envValue(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(env))
    if (key.toLowerCase() === lower && value !== undefined && value !== "")
      return value;
  return undefined;
}

function under(dir: string, parts: string[]): string {
  return parts.reduce(
    (path, part) => joinPath(path, part, "win32"),
    trimTrailingSeparators(dir, "win32"),
  );
}

/**
 * `configured` (trimmed; empty means `claude`) as it is, except `claude` on
 * Windows: the first that exists of a `claude.exe` on the PATH, the
 * `claude.exe` of npm's package next to a `claude.cmd` on the PATH, the one in
 * npm's global folder under APPDATA, and bb's BB_CLAUDE_CODE_EXECUTABLE;
 * with none, `claude` (and the spawn fails as before).
 */
export function resolveClaudeCommand(
  configured: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): string {
  const command = configured.trim() || "claude";
  if (platform !== "win32" || command !== "claude") return command;
  const dirs = (envValue(env, "PATH") ?? "")
    .split(";")
    .map((dir) => dir.trim())
    .filter((dir) => dir !== "");
  const candidates = [
    ...dirs.map((dir) => under(dir, ["claude.exe"])),
    ...dirs
      .filter((dir) => exists(under(dir, ["claude.cmd"])))
      .map((dir) => under(dir, NPM_EXE)),
  ];
  const appData = envValue(env, "APPDATA");
  if (appData !== undefined) candidates.push(under(appData, ["npm", ...NPM_EXE]));
  const bb = envValue(env, "BB_CLAUDE_CODE_EXECUTABLE");
  if (bb !== undefined) candidates.push(bb);
  return candidates.find(exists) ?? command;
}
