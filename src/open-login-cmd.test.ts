import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HELPER = fileURLToPath(new URL("../bin/open-login.cmd", import.meta.url));
// What Claude Code hands over: query parameters, an encoded redirect, and a
// character cmd.exe treats as an escape.
const URL_HARD =
  "https://claude.com/x?a=1&redirect_uri=http%3A%2F%2Flocalhost&b=^c&state=z";

let base = "";
afterEach(async () => {
  if (base !== "") await rm(base, { recursive: true, force: true });
  base = "";
});

/** Runs the helper the way Claude Code does: cmd.exe, the URL quoted. */
function run(
  url: string,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "cmd.exe",
      ["/d", "/s", "/c", `""${HELPER}" "${url}""`],
      {
        windowsVerbatimArguments: true,
        // Windows names ignore case: the real LOCALAPPDATA would win over
        // the LocalAppData set here, and find this machine's Chrome.
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                !/^(programfiles|programfiles\(x86\)|localappdata|claude_switcher_.*)$/i.test(
                  key,
                ),
            ),
          ),
          CLAUDE_SWITCHER_DRY_RUN: "1",
          ProgramFiles: join(tmpdir(), "no-such-dir-a"),
          "ProgramFiles(x86)": join(tmpdir(), "no-such-dir-b"),
          LocalAppData: join(tmpdir(), "no-such-dir-c"),
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : (error as { code?: number }).code;
        resolve({
          code: typeof code === "number" ? code : -1,
          stdout: stdout.trim(),
          stderr,
        });
      },
    );
  });
}

async function fakeChrome(dirName: string): Promise<string> {
  base = await mkdtemp(join(tmpdir(), "open-login-"));
  const programFiles = join(base, dirName);
  const app = join(programFiles, "Google", "Chrome", "Application");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "chrome.exe"), "");
  return programFiles;
}

describe.runIf(process.platform === "win32")("bin/open-login.cmd", () => {
  it("opens nothing but an https address", async () => {
    const result = await run("ftp://example.com/x", {});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("open-login: not an https URL");
    expect(result.stdout).toBe("");
  });

  // Windows sets ProgramFiles for every 64-bit process whatever the parent
  // passes: only LocalAppData (Chrome's per-user install, looked at first)
  // and CLAUDE_SWITCHER_CHROME can point the helper at a fake Chrome here.

  it("hands the whole address to the default browser when asked for no private window", async () => {
    const localAppData = await fakeChrome("lad");
    const result = await run(URL_HARD, {
      CLAUDE_SWITCHER_PRIVATE: "0",
      LocalAppData: localAppData,
    });
    expect(result).toMatchObject({ code: 0, stdout: `default ${URL_HARD}` });
  });

  it("opens a private window of the per-user Chrome, under a folder with spaces and parentheses", async () => {
    const localAppData = await fakeChrome("App Data (x86)");
    const result = await run(URL_HARD, { LocalAppData: localAppData });
    expect(result).toMatchObject({
      code: 0,
      stdout: `chrome-incognito ${join(localAppData, "Google", "Chrome", "Application", "chrome.exe")} ${URL_HARD}`,
    });
  });

  it("uses the Chrome CLAUDE_SWITCHER_CHROME names", async () => {
    const dir = await fakeChrome("custom");
    const chrome = join(dir, "Google", "Chrome", "Application", "chrome.exe");
    const result = await run(URL_HARD, { CLAUDE_SWITCHER_CHROME: chrome });
    expect(result).toMatchObject({
      code: 0,
      stdout: `chrome-incognito ${chrome} ${URL_HARD}`,
    });
  });

  it("falls back to the default browser when the named Chrome is not there", async () => {
    const result = await run(URL_HARD, {
      CLAUDE_SWITCHER_CHROME: join(tmpdir(), "no-such-chrome.exe"),
    });
    expect(result).toMatchObject({ code: 0, stdout: `default ${URL_HARD}` });
  });
});
