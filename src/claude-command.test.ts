import { describe, expect, it } from "vitest";
import { resolveClaudeCommand } from "./claude-command.js";

const NPM_EXE = "node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";

function existing(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (path) => set.has(path.toLowerCase());
}

describe("resolveClaudeCommand", () => {
  it("on Windows, takes a claude.exe on the PATH", () => {
    expect(
      resolveClaudeCommand(
        "claude",
        { Path: "C:\\Windows;C:\\bin" },
        "win32",
        existing("C:\\bin\\claude.exe"),
      ),
    ).toBe("C:\\bin\\claude.exe");
  });

  it("on Windows, goes from npm's claude.cmd to the claude.exe it starts", () => {
    expect(
      resolveClaudeCommand(
        "claude",
        { Path: "C:\\Windows;C:\\npm\\" },
        "win32",
        existing("C:\\npm\\claude.cmd", `C:\\npm\\${NPM_EXE}`),
      ),
    ).toBe(`C:\\npm\\${NPM_EXE}`);
  });

  it("on Windows, looks in npm's global folder under APPDATA", () => {
    expect(
      resolveClaudeCommand(
        "",
        { PATH: "C:\\Windows", APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
        "win32",
        existing(`C:\\Users\\x\\AppData\\Roaming\\npm\\${NPM_EXE}`),
      ),
    ).toBe(`C:\\Users\\x\\AppData\\Roaming\\npm\\${NPM_EXE}`);
  });

  it("on Windows, takes bb's BB_CLAUDE_CODE_EXECUTABLE last", () => {
    expect(
      resolveClaudeCommand(
        " claude ",
        { PATH: "C:\\Windows", BB_CLAUDE_CODE_EXECUTABLE: "D:\\tools\\claude.exe" },
        "win32",
        existing("D:\\tools\\claude.exe"),
      ),
    ).toBe("D:\\tools\\claude.exe");
  });

  it("on Windows, leaves `claude` when nothing is found", () => {
    expect(resolveClaudeCommand("claude", {}, "win32", existing())).toBe(
      "claude",
    );
  });

  it("keeps a path set by hand, and on macOS and Linux keeps what is set, as before", () => {
    expect(
      resolveClaudeCommand(
        "D:\\x\\claude.exe",
        { PATH: "C:\\bin" },
        "win32",
        existing("C:\\bin\\claude.exe"),
      ),
    ).toBe("D:\\x\\claude.exe");
    expect(
      resolveClaudeCommand("", { PATH: "/usr/bin" }, "darwin", existing()),
    ).toBe("claude");
    expect(
      resolveClaudeCommand(" /opt/claude ", {}, "linux", existing()),
    ).toBe("/opt/claude");
  });
});
