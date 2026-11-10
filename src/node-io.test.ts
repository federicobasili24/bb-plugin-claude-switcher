import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loginHelperPath,
  nodeAccountsIo,
  nodeLoginIo,
  nodeSessionsIo,
  renameWithRetry,
} from "./node-io.js";

let base = "";
afterEach(async () => {
  if (base !== "") await rm(base, { recursive: true, force: true });
  base = "";
});

describe("nodeAccountsIo.listDirs", () => {
  it("treats a missing accounts dir as empty, and reports any other failure", async () => {
    const io = nodeAccountsIo();
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    expect(await io.listDirs(join(base, "missing"))).toEqual([]);
    // A file where the dir should be (ENOTDIR): not "no accounts", a failure
    // the caller must see, or a transient error would forget every account.
    const file = join(base, "not-a-dir");
    await writeFile(file, "");
    await expect(io.listDirs(file)).rejects.toThrow(/ENOTDIR/);
  });
});

describe("nodeLoginIo", () => {
  /** An executable standing in for `claude`, written to the temp dir. */
  async function command(body: string): Promise<string> {
    const path = join(base, "fake-claude");
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it("creates the directory for its owner only, and says whether it was new", async () => {
    const io = nodeLoginIo();
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    const dir = join(base, "accounts", "team");
    expect(await io.mkdir(dir)).toBe(true);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(await io.mkdir(dir)).toBe(false);
  });

  it("links what exists, once", async () => {
    const io = nodeLoginIo();
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    const target = join(base, "projects");
    await mkdir(target);
    const path = join(base, "link");
    expect(await io.link(join(base, "missing"), join(base, "nowhere"))).toBe(false);
    expect(await io.link(target, path)).toBe(true);
    expect(await readlink(path)).toBe(target);
    // Already there: left as it is.
    expect(await io.link(target, path)).toBe(false);
  });

  it("lists the accounts directory, telling real directories from links and files", async () => {
    const io = nodeLoginIo();
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    expect(await io.entries(join(base, "missing"))).toEqual([]);
    await mkdir(join(base, "team"));
    await symlink(join(base, "team"), join(base, "linked"));
    await writeFile(join(base, "file"), "");
    const found = await io.entries(base);
    expect(found.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "file", directory: false },
      { name: "linked", directory: false },
      { name: "team", directory: true },
    ]);
  });

  it("runs the command with `auth login`, passes its output on and writes to it", async () => {
    const io = nodeLoginIo();
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    const path = await command('echo "args: $* dir: $CLAUDE_CONFIG_DIR"\nread line\necho "got $line" >&2');
    const process = io.spawn({ command: path, env: { CLAUDE_CONFIG_DIR: "/d/team", PATH: "/usr/bin:/bin" } });
    let output = "";
    process.onOutput((chunk) => {
      output += chunk;
    });
    process.write("the-code\n");
    expect(await process.exited).toEqual({ code: 0 });
    expect(output).toBe("args: auth login dir: /d/team\ngot the-code\n");
  });

  it("reports a command that cannot run, and survives writing to a login that is gone", async () => {
    const io = nodeLoginIo();
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    const missing = io.spawn({ command: join(base, "no-such-command"), env: {} });
    const result = await missing.exited;
    expect(result.code).toBeNull();
    expect(result.error).toMatch(/ENOENT/);
    missing.write("x\n");
    const path = await command("exit 3");
    const gone = io.spawn({ command: path, env: {} });
    expect(await gone.exited).toEqual({ code: 3 });
    gone.write("x\n");
    gone.kill();
    // Still running, but no longer reading: the write fails on the pipe
    // (EPIPE), which without a listener is an unhandled error.
    const deaf = io.spawn({ command: await command("exec 0<&-\nsleep 0.3"), env: { PATH: "/usr/bin:/bin" } });
    await new Promise((r) => setTimeout(r, 100));
    deaf.write("x\n");
    expect(await deaf.exited).toEqual({ code: 0 });
  });
});

describe("loginHelperPath", () => {
  it("finds bin/open-login.sh beside server.ts, and one level up from dist/", () => {
    expect(loginHelperPath("file:///plugins/switcher/server.ts")).toBe(
      "/plugins/switcher/bin/open-login.sh",
    );
    expect(loginHelperPath("file:///plugins/switcher/dist/server.js")).toBe(
      "/plugins/switcher/bin/open-login.sh",
    );
    expect(loginHelperPath("file:///plugins/my%20dist/dist/server.js")).toBe(
      "/plugins/my dist/bin/open-login.sh",
    );
  });
});

describe("renameWithRetry", () => {
  const busy = (code: string) =>
    Object.assign(new Error(`${code}: resource busy`), { code });

  it("on Windows, tries again while the file is busy", async () => {
    let calls = 0;
    await renameWithRetry("a.tmp", "a", {
      platform: "win32",
      attempts: 5,
      delayMs: 1,
      rename: async () => {
        calls += 1;
        if (calls < 3) throw busy("EBUSY");
      },
    });
    expect(calls).toBe(3);
  });

  it("on Windows, gives up after the last attempt and leaves no temp file", async () => {
    base = await mkdtemp(join(tmpdir(), "claude-credentials-"));
    const tmp = join(base, ".credentials.json.tmp-1");
    await writeFile(tmp, "{}");
    let calls = 0;
    await expect(
      renameWithRetry(tmp, join(base, ".credentials.json"), {
        platform: "win32",
        attempts: 5,
        delayMs: 1,
        rename: async () => {
          calls += 1;
          throw busy("EPERM");
        },
      }),
    ).rejects.toThrow(/EPERM/);
    expect(calls).toBe(5);
    await expect(stat(tmp)).rejects.toThrow(/ENOENT/);
  });

  it("on macOS and Linux, tries once, as before", async () => {
    let calls = 0;
    await expect(
      renameWithRetry("a.tmp", "a", {
        platform: "linux",
        attempts: 5,
        delayMs: 1,
        rename: async () => {
          calls += 1;
          throw busy("EBUSY");
        },
      }),
    ).rejects.toThrow(/EBUSY/);
    expect(calls).toBe(1);
  });
});

describe.runIf(process.platform === "win32")("links on Windows", () => {
  /** A directory on the repo's drive, which may not be the temp dir's. */
  let other = "";
  afterEach(async () => {
    if (other !== "") await rm(other, { recursive: true, force: true });
    other = "";
  });

  it("links a directory as a junction, also from another drive, once", async () => {
    const io = nodeLoginIo("win32");
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    other = await mkdtemp(join(process.cwd(), ".link-test-"));
    const target = join(other, "projects");
    await mkdir(target);
    await writeFile(join(target, "a.jsonl"), "x");
    const path = join(base, "projects");
    expect(await io.link(target, path)).toBe(true);
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect(await readdir(path)).toEqual(["a.jsonl"]);
    expect(await io.link(target, path)).toBe(false);
    expect(await readFile(join(target, "a.jsonl"), "utf8")).toBe("x");
  });

  it("links a file with a symlink when Windows allows it", async () => {
    const io = nodeLoginIo("win32");
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    const target = join(base, "settings.json");
    await writeFile(target, "{}");
    const path = join(base, "linked.json");
    const linked = await io.link(target, path);
    expect([true, "hardlink"]).toContain(linked);
    expect(await readFile(path, "utf8")).toBe("{}");
  });

  it("falls back to a hard link for a file when symlinks need a privilege", async () => {
    const refused = Object.assign(new Error("EPERM: operation not permitted"), {
      code: "EPERM",
    });
    const io = nodeLoginIo("win32", {
      symlink: async (target, path, type) => {
        if (type === "file") throw refused;
        await symlink(target, path, type);
      },
    });
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    const target = join(base, "settings.json");
    await writeFile(target, "{}");
    const path = join(base, "linked.json");
    expect(await io.link(target, path)).toBe("hardlink");
    expect((await stat(path)).ino).toBe((await stat(target)).ino);
    expect(await io.link(target, path)).toBe(false);
  });

  it("asks for a junction for a directory and a file symlink for a file: no privilege for the first", async () => {
    const asked: [string, string | null | undefined][] = [];
    const record = async (target: string, path: string, type?: string | null) => {
      asked.push([path, type]);
      await symlink(target, path, type as "junction" | "file");
    };
    base = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    await mkdir(join(base, "dir"));
    await writeFile(join(base, "file"), "x");
    const login = nodeLoginIo("win32", { symlink: record });
    await login.link(join(base, "dir"), join(base, "l-dir"));
    await login.link(join(base, "file"), join(base, "l-file"));
    const sessions = nodeSessionsIo("win32", { symlink: record });
    await sessions.symlink(join(base, "dir"), join(base, "s-dir"));
    await sessions.symlink(join(base, "file"), join(base, "s-file"));
    expect(asked).toEqual([
      [join(base, "l-dir"), "junction"],
      [join(base, "l-file"), "file"],
      [join(base, "s-dir"), "junction"],
      [join(base, "s-file"), "file"],
    ]);
  });

  it("links a session folder as a junction and never over what is there", async () => {
    const io = nodeSessionsIo("win32");
    base = await mkdtemp(join(tmpdir(), "claude-sessions-"));
    const from = join(base, "a", "s");
    await io.mkdir(join(from, "subagents"));
    await io.mkdir(join(base, "b"));
    await io.symlink(from, join(base, "b", "s"));
    expect(await readdir(join(base, "b", "s"))).toEqual(["subagents"]);
    await expect(io.symlink(from, join(base, "b", "s"))).rejects.toThrow(
      /EEXIST/,
    );
    expect(await io.entries(join(base, "b"))).toEqual([
      { name: "s", directory: true },
    ]);
  });
});

describe("nodeSessionsIo", () => {
  it("hard-links and symlinks without overwriting, and lists a link to a directory as one", async () => {
    const io = nodeSessionsIo();
    base = await mkdtemp(join(tmpdir(), "claude-sessions-"));
    const from = join(base, "a", "s.jsonl");
    await io.mkdir(join(base, "a", "s", "subagents"));
    await writeFile(from, "one\n");
    await io.mkdir(join(base, "b"));
    await io.link(from, join(base, "b", "s.jsonl"));
    // One file: what the old account appends, the new one reads.
    expect((await stat(join(base, "b", "s.jsonl"))).ino).toBe(
      (await stat(from)).ino,
    );
    await expect(io.link(from, join(base, "b", "s.jsonl"))).rejects.toThrow(
      /EEXIST/,
    );
    await io.symlink(from, join(base, "b", "t.jsonl"));
    await expect(io.symlink(from, join(base, "b", "t.jsonl"))).rejects.toThrow(
      /EEXIST/,
    );
    await io.symlink(join(base, "a", "s"), join(base, "b", "s"));
    expect(await readlink(join(base, "b", "s"))).toBe(join(base, "a", "s"));
    expect(await io.entries(join(base, "b"))).toEqual(
      expect.arrayContaining([
        { name: "s", directory: true },
        { name: "s.jsonl", directory: false },
        { name: "t.jsonl", directory: false },
      ]),
    );
    expect(await io.entries(join(base, "missing"))).toEqual([]);
    expect(await io.exists(join(base, "b", "s"))).toBe(true);
    expect(await io.exists(join(base, "nowhere"))).toBe(false);
    await symlink(join(base, "a"), join(base, "c"));
    expect(await io.realpath(join(base, "c", "s"))).toBe(
      await io.realpath(join(base, "a", "s")),
    );
  });
});
