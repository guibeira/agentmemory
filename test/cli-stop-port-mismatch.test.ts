import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const sandboxes: string[] = [];
const cli = join(process.cwd(), "dist", "cli.mjs");

beforeAll(() => {
  const build = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), encoding: "utf8" });
  if (build.status !== 0) throw new Error(`CLI build failed: ${build.stderr}`);
}, 30_000);

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true });
});

afterAll(() => {
  // Keep this test independent of whether a build ran before it.
});

function sandbox(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  sandboxes.push(path);
  return path;
}

describe("stop port ownership", () => {
  it("refuses saved Compose state on a different requested port without signaling the daemon", async () => {
    const root = sandbox("agentmemory-stop-port-");
    const home = join(root, "home");
    const runtime = join(home, ".agentmemory");
    const statePath = join(runtime, "engine-state.json");
    const enginePidfile = join(runtime, "iii.pid");
    const workerPidfile = join(runtime, "worker.pid");
    const namespace = "agentmemory-35111";
    const composeFile = join(root, "compose.yml");
    mkdirSync(runtime, { recursive: true });
    const daemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "compose", "--namespace", namespace, "--file", composeFile], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    if (!daemon.pid) throw new Error("synthetic Compose daemon failed to start");
    const state = {
      kind: "compose",
      restPort: 35111,
      viewerPort: 35113,
      enginePort: 81134,
      engineUrl: "http://127.0.0.1:81134",
      namespace,
      file: composeFile,
      stateDir: join(root, "state"),
      logFile: join(root, "compose.log"),
      binPath: process.execPath,
      composePid: daemon.pid,
    };
    writeFileSync(statePath, JSON.stringify(state));
    writeFileSync(enginePidfile, "424242\n");
    writeFileSync(workerPidfile, "424243\n");

    try {
      const result = spawnSync(process.execPath, [cli, "stop", "--port", "35121"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          AGENTMEMORY_RUNTIME_DIR: runtime,
          AGENTMEMORY_URL: "",
          CI: "1",
        },
      });
      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Saved Compose lifecycle state belongs to REST port 35111");
      expect(daemon.exitCode).toBe(null);
      expect(readFileSync(statePath, "utf8")).toBe(JSON.stringify(state));
      expect(readFileSync(enginePidfile, "utf8")).toBe("424242\n");
      expect(readFileSync(workerPidfile, "utf8")).toBe("424243\n");
    } finally {
      if (daemon.exitCode === null) daemon.kill("SIGTERM");
      await new Promise<void>((resolve) => daemon.once("exit", () => resolve()));
    }
  }, 20_000);
});

