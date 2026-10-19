import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temp = mkdtempSync(join(tmpdir(), "compose-state-error-"));
afterEach(() => rmSync(temp, { recursive: true, force: true }));
import { composeEnvironment, composeRegistryFailureMessage, composeStateRegistryFailure, ownedComposeProject, startComposeDaemon, type ComposeStatus } from "../src/cli/compose-control.js";

describe("Compose control plane", () => {
  it("does not leak arbitrary machine credentials to the Compose daemon", () => {
    const env = composeEnvironment({
      HOME: "/tmp/home",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "must-not-leak",
      OPENAI_API_KEY: "must-not-leak",
      III_URL: "ws://foreign-engine",
      AGENTMEMORY_REDIS_URL: "redis://secret",
      MALLOC_ARENA_MAX: "10",
    }, "/tmp/state");
    expect(env).toMatchObject({ HOME: "/tmp/home", PATH: "/bin", III_COMPOSE_STATE_DIR: "/tmp/state", III_TELEMETRY_ENABLED: "false", MALLOC_ARENA_MAX: "2" });
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("III_URL");
    expect(env).not.toHaveProperty("AGENTMEMORY_REDIS_URL");
  });

  it("turns a registry resolution failure into a quick actionable CLI diagnostic", () => {
    const failure = composeRegistryFailureMessage("error[REGISTRY_UNREACHABLE]: container 'state': cannot reach the registry");
    expect(failure).toContain("Worker registry unavailable while resolving state/http");
    expect(failure).toContain("retry later");
    expect(failure).toContain("AGENTMEMORY_WORKER_BIN_DIR");
    expect(failure).not.toMatch(/set AGENTMEMORY_WORKER_BIN_DIR.*set AGENTMEMORY_WORKER_BIN_DIR/i);
    expect(composeRegistryFailureMessage("STARTUP_TIMEOUT: a worker did not register")).toBeNull();
    expect(composeRegistryFailureMessage("REGISTRY_ERROR", "/tmp/workers")).toContain("/tmp/workers");
    const realistic = composeRegistryFailureMessage("error[E100]: Registry error: registry returned HTTP 504 while resolving package api.workers.iii.dev/state@0.22.19");
    expect(realistic).toContain("Worker registry unavailable while resolving state/http");
    const compose502 = composeRegistryFailureMessage("error[PACKAGE_DOWNLOAD_FAILED]: container 'http': could not download https://api.workers.iii.dev/download/http/0.22.6/x86_64-unknown-linux-gnu: HTTP status server error (504 Gateway Timeout) for url (https://api.workers.iii.dev/download/http/0.22.6/x86_64-unknown-linux-gnu)");
    expect(compose502).toContain("Worker registry unavailable while resolving state/http");
    expect(composeRegistryFailureMessage("package resolution failed: registry HTTP 504")).not.toBeNull();
    expect(composeRegistryFailureMessage("Compose exited with code 1")).not.toBeNull();
    expect(composeRegistryFailureMessage("state: failed; last_error=exited unexpectedly: status: exit code: 1")).not.toBeNull();
  });

  it("recognizes the real Compose state error after daemon logs have closed", () => {
    const projectFile = join(temp, "worker-compose.yaml");
    const stateDir = join(temp, "compose-state", "project", "instance");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "state.json"), JSON.stringify({
      compose_path: projectFile,
      namespace: "agentmemory-3511",
      containers: {
        state: { pid: 101, status: "failed", last_error: "exited unexpectedly (status: 1)" },
        http: { pid: 102, status: "failed", last_error: "container 'http': cannot reach the registry at https://api.workers.iii.dev: registry returned HTTP 504" },
      },
    }));
    const failure = composeStateRegistryFailure(temp, projectFile);
    expect(failure).toContain("container 'http': cannot reach the registry");
    expect(composeStateRegistryFailure(temp, join(temp, "other-compose.yaml"))).toBeNull();
  });

  it("keeps the Compose daemon log under the durable per-user metadata root", () => {
    const source = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(source).toContain('logFile: join(homedir(), ".agentmemory", `compose-${getRestPort()}.log`)');
  });

  it("accepts the current Compose status payload with a project at its top level", () => {
    const status: ComposeStatus = { file: "/tmp/worker-compose.yaml", state_dir: "/tmp/state", containers: [{ container: "state", state: "ready" }] };
    expect(ownedComposeProject(status, "/tmp/worker-compose.yaml")).toBe(status);
  });

  it("finds the owned project in a daemon status projects list", () => {
    const project = { file: "/tmp/worker-compose.yaml" };
    expect(ownedComposeProject({ projects: [project] }, "/tmp/worker-compose.yaml")).toBe(project);
  });
});
