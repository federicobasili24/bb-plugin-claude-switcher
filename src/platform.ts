// What a path means on the machine the plugin runs on.
//
// Everything here is pure and takes the platform as an argument, so the tests
// of both kinds of path run on any machine. On macOS and Linux each function
// gives exactly what the plugin computed before it ran on Windows.

type Platform = NodeJS.Platform;

const SEPARATORS = { posix: /\/+$/, win32: /[\\/]+$/ };

function isWindows(platform: Platform): boolean {
  return platform === "win32";
}

/** `/…` on macOS and Linux; `C:\…`, `C:/…` or `\\server\share\…` on Windows. */
export function isAbsolutePath(path: string, platform: Platform): boolean {
  if (!isWindows(platform)) return path.startsWith("/");
  return (
    /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(path)
  );
}

/** `~` and `~/…` (and on Windows `~\…`) under `home`; anything else as it is. */
export function expandHome(
  path: string,
  home: string,
  platform: Platform,
): string {
  if (path === "~" || path.startsWith("~/")) return home + path.slice(1);
  if (isWindows(platform) && path.startsWith("~\\")) return home + path.slice(1);
  return path;
}

/** Without trailing separators, but a root (`/`, `C:\`) stays a root. */
export function trimTrailingSeparators(path: string, platform: Platform): string {
  if (!isWindows(platform)) {
    let dir = path;
    while (dir.length > 1 && dir.endsWith("/")) dir = dir.slice(0, -1);
    return dir;
  }
  const trimmed = path.replace(SEPARATORS.win32, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return path.slice(0, 3);
  return trimmed === "" ? path : trimmed;
}

/** `dir` and `name` with the platform's separator. */
export function joinPath(dir: string, name: string, platform: Platform): string {
  return `${dir}${isWindows(platform) ? "\\" : "/"}${name}`;
}

/**
 * An absolute path without `.`, `..` or repeated separators, in lower case:
 * for comparing where two paths lead, on a disk that may ignore case. On
 * Windows both separators count and the drive (`c:`) is never popped.
 */
export function plainPath(path: string, platform: Platform): string {
  const lower = path.toLowerCase();
  if (!isWindows(platform)) return `/${resolveParts(lower.split("/")).join("/")}`;
  const drive = /^[a-z]:/.exec(lower)?.[0] ?? "";
  const parts = resolveParts(lower.slice(drive.length).split(/[\\/]/));
  return drive === "" ? `/${parts.join("/")}` : `${drive}/${parts.join("/")}`;
}

function resolveParts(segments: string[]): string[] {
  const parts: string[] = [];
  for (const part of segments) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts;
}
