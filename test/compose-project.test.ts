import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { COMPOSE_WORKER_VERSIONS, composeNamespace, renderWorkerCompose, writeWorkerCompose } from "../src/cli/compose-project.js";

const root = mkdtempSync(join(tmpdir(), "agentmemory-compose-"));
const rootUrl = `path://${root.replaceAll("\\", "/")}`;
afterEach(() => rmSync(root, { recursive: true, force: true }));
const options = (overrides: Record<string, unknown> = {}) => ({
  ports: { restPort: 3511, viewerPort: 3513, enginePort: 49534 },
  dataDir: join(root, "data"),
  projectRoot: join(root, "pkg"),
  nodeBin: "/opt/node/bin/node",
  homeDir: join(root, "home"),
  startupTimeoutMs: 300_000,
  linux: true,
  ...overrides,
});

describe("Worker Compose project", () => {
  it("pins registry workers and configures the isolated engine, state and HTTP", () => {
    const text = renderWorkerCompose(options());
    expect(text).toContain("namespace: agentmemory-3511");
    expect(text).toContain("url: ws://127.0.0.1:49534");
    expect(text).toContain("iii-worker-manager:");
    expect(text).toContain("directory: '");
    expect(text).toContain(`worker: 'package://api.workers.iii.dev/state'\n    version: '${COMPOSE_WORKER_VERSIONS.state}'`);
    expect(text).toContain(`worker: 'package://api.workers.iii.dev/http'\n    version: '${COMPOSE_WORKER_VERSIONS.http}'`);
    expect(text).not.toContain("dependencies:");
    expect(text).not.toContain("      configuration: latest");
    expect(text).toContain("save_interval_ms: 2000");
    expect(text.match(/condition: on-failure/g)).toHaveLength(3);
    expect(text).toContain("default_timeout: 180000");
    expect(text).toContain("allowed_methods: [GET, POST, PUT, DELETE, OPTIONS]");
    expect(text).toContain("start_after: [state, http]");
    expect(text).toContain("required_default: true");
    expect(text.match(/condition: on-failure/g)).toHaveLength(3);
    expect(text.match(/max_attempts: 5/g)).toHaveLength(3);
    expect(text.match(/delay: 500ms/g)).toHaveLength(3);
    expect(text.match(/max_delay: 30s/g)).toHaveLength(3);
    expect(text.match(/window: 60s/g)).toHaveLength(3);
    for (const retired of ["iii-stream", "iii-pubsub", "iii-http", "iii-state", "queue"]) expect(text).not.toContain(retired);
  });

  it("uses local worker binaries when requested and emits explicit path worker commands", () => {
    const text = renderWorkerCompose(options({ workerBinDir: "/opt/am/workers-local" }));
    expect(text).toContain(`worker: '${rootUrl}/data/compose/local-workers/state'`);
    expect(text).toContain("local-workers/state");
    expect(text).toContain("run: '/opt/am/workers-local/state'");
    expect(text).toContain("run: '/opt/am/workers-local/http'");
    expect(text).not.toContain("version: '");
    expect(text).not.toContain("file_path: '/opt/am/workers-local");
  });

  it("uses and validates the configured state flush interval", () => {
    expect(renderWorkerCompose(options({ workerEnvironment: { AGENTMEMORY_STATE_SAVE_INTERVAL_MS: "9000" } }))).toContain("save_interval_ms: 9000");
    for (const invalid of ["nope", "99", "3600001", "1.5"]) {
      expect(() => renderWorkerCompose(options({ workerEnvironment: { AGENTMEMORY_STATE_SAVE_INTERVAL_MS: invalid } }))).toThrow(/AGENTMEMORY_STATE_SAVE_INTERVAL_MS/);
    }
  });

  it("honors disableRestartPolicy for every worker", () => {
    const disabled = parse(renderWorkerCompose(options({ disableRestartPolicy: true }))) as {
      containers: Record<string, { restart: string }>;
    };
    expect(Object.values(disabled.containers).map((container) => container.restart)).toEqual(["no", "no", "no"]);
  });

  it("passes configured embedding credentials/settings only to the application container", () => {
    const text = renderWorkerCompose(options({ workerEnvironment: { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "fake-gate-key", OPENAI_BASE_URL: "http://127.0.0.1:4555", ANTHROPIC_API_KEY: "ignored" } }));
    const app = text.slice(text.indexOf("  agentmemory:"));
    expect(app).toContain("EMBEDDING_PROVIDER: 'openai'");
    expect(app).toContain("OPENAI_API_KEY: 'fake-gate-key'");
    expect(app).toContain("OPENAI_BASE_URL: 'http://127.0.0.1:4555'");
    expect(text.slice(0, text.indexOf("containers:")).concat(text.slice(text.indexOf("  state:"), text.indexOf("  agentmemory:")))).not.toContain("fake-gate-key");
  });

  it("supports Redis state without leaking Redis configuration into the daemon", () => {
    const text = renderWorkerCompose(options({ stateBackend: { kind: "redis", redisUrl: "redis://user:p'ass@localhost:6379" } }));
    expect(text).toContain("name: redis");
    expect(text).toContain("redis_url: 'redis://user:p''ass@localhost:6379'");
    expect(text).not.toContain("state_store.db");
  });

  it("includes env_file only when present and quotes paths safely", () => {
    const envPath = join(root, "home", ".env");
    mkdirSync(join(root, "home"), { recursive: true });
    writeFileSync(envPath, "ANTHROPIC_API_KEY=fixture-secret\nIII_URL=ws://wrong\nIII_NAMESPACE=wrong\n");
    const written = writeWorkerCompose(options({ envFile: envPath }));
    expect(written.text).toContain(`env_file: ['${join(root, "data", "compose", ".agentmemory-filtered.env")}']`);
    expect(written.text).toContain(".agentmemory-filtered.env");
    expect(written.text).toContain(`AGENTMEMORY_ENV_FILE: '${join(root, "data", "compose", ".agentmemory-filtered.env")}'`);
    expect(written.text).not.toContain("III_URL:");
    expect(readFileSync(join(root, "data", "compose", ".agentmemory-filtered.env"), "utf8")).toContain("ANTHROPIC_API_KEY=fixture-secret");
    expect(readFileSync(join(root, "data", "compose", ".agentmemory-filtered.env"), "utf8")).not.toContain("III_URL");
    expect(readFileSync(join(root, "data", "compose", ".agentmemory-filtered.env"), "utf8")).not.toContain("III_ENGINE_URL");
    expect(written.text).toContain("HOME: '");
  });

  it("writes generated local worker manifests with the pinned worker commands", () => {
    const binDir = join(root, "workers-local");
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(binDir, { recursive: true });
    for (const name of ["state", "http"]) {
      writeFileSync(join(binDir, name), "#!/bin/sh\nexit 0\n");
      chmodSync(join(binDir, name), 0o755);
    }
    const written = writeWorkerCompose(options({ workerBinDir: binDir, workerBinDirIsAbsolute: true }));
    for (const name of ["state", "http"]) {
      const manifestPath = join(root, "data", "compose", "local-workers", name, "iii.worker.yaml");
      const manifest = readFileSync(manifestPath, "utf8");
      expect(manifest).toContain(`name: ${name}`);
      expect(manifest).toContain("start: '");
      expect(manifest).toContain(`/workers-local/${name}'`);
    }
    expect(written.text).toContain(`worker: '${rootUrl}/data/compose/local-workers/state'`);
  });

  it("seeds persistent engine trace storage in the data directory", () => {
    writeWorkerCompose(options());
    const configFile = join(root, "data", "compose", "config", "iii-observability.yaml");
    const entry = parse(readFileSync(configFile, "utf8")) as {
      id: string;
      value: { trace_storage: { directory: string } };
    };
    expect(entry.id).toBe("iii-observability");
    expect(entry.value.trace_storage.directory).toBe(join(root, "data", "observability", "traces"));
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
  });

  it("stores engine traces under the instance data dir and preserves user observability settings", () => {
    const configDir = join(root, "data", "compose", "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "iii-observability.yaml"), [
      "id: iii-observability",
      "name: Observability",
      "description: custom settings",
      "schema: {}",
      "value:",
      "  service_name: agentmemory-test",
      "  trace_storage:",
      "    directory: ./data/observability/traces",
      "    max_disk_bytes: 67108864",
      "",
    ].join("\n"));

    writeWorkerCompose(options());
    const entry = parse(readFileSync(join(configDir, "iii-observability.yaml"), "utf8")) as {
      value: { service_name: string; trace_storage: { directory: string; max_disk_bytes: number } };
    };
    expect(entry.value.service_name).toBe("agentmemory-test");
    expect(entry.value.trace_storage).toEqual({
      directory: join(root, "data", "observability", "traces"),
      max_disk_bytes: 67108864,
    });
  });

  it("leaves a deliberately customized engine trace directory alone", () => {
    const configDir = join(root, "data", "compose", "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "iii-observability.yaml"), [
      "id: iii-observability",
      "value:",
      "  trace_storage:",
      "    directory: /mnt/traces",
      "",
    ].join("\n"));

    writeWorkerCompose(options());
    const entry = parse(readFileSync(join(configDir, "iii-observability.yaml"), "utf8")) as {
      value: { trace_storage: { directory: string } };
    };
    expect(entry.value.trace_storage.directory).toBe("/mnt/traces");
  });

  it("writes the project and runtime state only inside the data dir with owner-only file permissions", () => {
    const written = writeWorkerCompose(options());
    expect(written.file).toBe(join(root, "data", "compose", "worker-compose.yaml"));
    expect(written.stateDir).toBe(join(root, "data", "compose-state"));
    expect(readFileSync(written.file, "utf8")).toBe(written.text);
    expect(statSync(written.file).mode & 0o777).toBe(0o600);
  });
});
