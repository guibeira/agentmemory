import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { legacyDockerStateMessage, legacyDockerStopCommand } from "../src/cli/legacy-docker-state.js";

const state = {
  kind: "docker" as const,
  composeFile: "/tmp/old project's/docker-compose.yml",
  projectName: "agentmemory-3111",
  restPort: 3111,
};

const command = `docker compose -p 'agentmemory-3111' -f '/tmp/old project'"'"'s/docker-compose.yml' stop`;

describe("legacy Docker state migration notice", () => {
  it("builds a scoped Compose stop command from the saved project and file", () => {
    expect(legacyDockerStopCommand(state)).toBe(command);
  });

  it("warns without changing state and explains the exact next action", () => {
    const message = legacyDockerStateMessage(state);
    expect(message).toContain("older Docker-based agentmemory CLI (REST port 3111)");
    expect(message).toContain(command);
    expect(message).toContain("no container or data was changed");
  });

  it("falls back to the saved container ID only when Compose metadata is absent", () => {
    expect(legacyDockerStopCommand({ kind: "docker", containerId: "old-engine-1" })).toBe("docker stop 'old-engine-1'");
  });
});


const sandboxes: string[] = [];

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("legacy Docker lifecycle CLI compatibility", () => {
  it.each(["start", "stop", "status", "remove"] as const)(
    "reports recovery instructions on %s without calling Docker or clearing state/data",
    (command) => {
      const root = mkdtempSync(join(tmpdir(), "agentmemory-legacy-cli-"));
      sandboxes.push(root);
      const home = join(root, "home");
      const runtime = join(home, ".agentmemory");
      const dataDir = join(root, "data");
      const binDir = join(root, "bin");
      const dockerLog = join(root, "docker.log");
      mkdirSync(runtime, { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, "legacy-data.txt"), "preserve me");
      mkdirSync(binDir, { recursive: true });
      const docker = join(binDir, "docker");
      writeFileSync(docker, `#!/bin/sh\nprintf called >> "$DOCKER_LOG"\nexit 90\n`, { mode: 0o755 });
      const statePath = join(runtime, "engine-state.json");
      const legacyState = { ...state };
      writeFileSync(statePath, JSON.stringify(legacyState));
      const args = command === "start"
        ? ["--port", "3111", "--data-dir", dataDir, "--reset"]
        : [command, ...(command === "remove" ? ["--force"] : []), "--port", "3111", "--data-dir", dataDir];
      const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          AGENTMEMORY_RUNTIME_DIR: runtime,
          CI: "1",
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          DOCKER_LOG: dockerLog,
          AGENTMEMORY_URL: "http://127.0.0.1:3111",
          III_REST_PORT: "3111",
        },
      });
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(output).toContain("older Docker-based agentmemory CLI");
      if (command !== "remove") expect(output).toContain(command);
      expect(output).toContain(`docker compose -p 'agentmemory-3111' -f '/tmp/old project'\"'\"'s/docker-compose.yml' stop`);
      expect(readFileSync(statePath, "utf8")).toBe(JSON.stringify(legacyState));
      expect(readFileSync(join(dataDir, "legacy-data.txt"), "utf8")).toBe("preserve me");
      expect(existsSync(dockerLog)).toBe(false);
    },
  );
});
