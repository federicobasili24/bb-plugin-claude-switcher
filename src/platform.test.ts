import { describe, expect, it } from "vitest";
import {
  expandHome,
  isAbsolutePath,
  joinPath,
  plainPath,
  trimTrailingSeparators,
} from "./platform.js";

describe("isAbsolutePath", () => {
  it("takes only a leading slash on macOS and Linux", () => {
    expect(isAbsolutePath("/Users/x", "darwin")).toBe(true);
    expect(isAbsolutePath("C:\\x", "linux")).toBe(false);
  });

  it("takes a drive letter or a UNC share on Windows, with either separator", () => {
    expect(isAbsolutePath("C:\\Users\\x", "win32")).toBe(true);
    expect(isAbsolutePath("C:/Users/x", "win32")).toBe(true);
    expect(isAbsolutePath("\\\\srv\\share\\x", "win32")).toBe(true);
    expect(isAbsolutePath("~/x", "win32")).toBe(false);
    expect(isAbsolutePath("Users\\x", "win32")).toBe(false);
  });
});

describe("expandHome", () => {
  it("expands ~\\ on Windows only", () => {
    expect(expandHome("~\\.claude-accounts", "C:\\Users\\x", "win32")).toBe(
      "C:\\Users\\x\\.claude-accounts",
    );
    expect(expandHome("~/a", "C:\\Users\\x", "win32")).toBe("C:\\Users\\x/a");
    expect(expandHome("~\\a", "/home/x", "linux")).toBe("~\\a");
    expect(expandHome("~/a", "/home/x", "linux")).toBe("/home/x/a");
    expect(expandHome("~", "/home/x", "linux")).toBe("/home/x");
  });
});

describe("trimTrailingSeparators", () => {
  it("drops trailing separators but keeps a root", () => {
    expect(trimTrailingSeparators("C:\\a\\\\", "win32")).toBe("C:\\a");
    expect(trimTrailingSeparators("C:/a/", "win32")).toBe("C:/a");
    expect(trimTrailingSeparators("C:\\", "win32")).toBe("C:\\");
    expect(trimTrailingSeparators("/a//", "linux")).toBe("/a");
    expect(trimTrailingSeparators("/", "linux")).toBe("/");
    expect(trimTrailingSeparators("/a\\", "linux")).toBe("/a\\");
  });
});

describe("joinPath", () => {
  it("joins with the platform's separator", () => {
    expect(joinPath("C:\\a", "b", "win32")).toBe("C:\\a\\b");
    expect(joinPath("/a", "b", "linux")).toBe("/a/b");
  });
});

describe("plainPath", () => {
  it("gives one spelling for paths that lead to the same place", () => {
    expect(plainPath("C:\\Users\\X\\.claude\\..\\.claude", "win32")).toBe(
      "c:/users/x/.claude",
    );
    expect(plainPath("C:/Users/X/.claude", "win32")).toBe("c:/users/x/.claude");
    expect(plainPath("C:\\..\\a", "win32")).toBe("c:/a");
    expect(plainPath("/Users/X/./a//b", "darwin")).toBe("/users/x/a/b");
    expect(plainPath("/a/../../b", "linux")).toBe("/b");
  });
});
