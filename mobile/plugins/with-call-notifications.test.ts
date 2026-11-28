import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveGoogleServicesPath } = require("./with-call-notifications.js") as {
  resolveGoogleServicesPath: (projectRoot: string, env?: { GOOGLE_SERVICES_JSON?: string }) => string;
};

describe("resolveGoogleServicesPath", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "google-services-"));
    roots.push(root);
    return root;
  }

  it("prefers GOOGLE_SERVICES_JSON when that file exists", () => {
    const root = tempRoot();
    const secretDir = join(root, "eas-secret");
    mkdirSync(secretDir);
    const secret = join(secretDir, "google-services.json");
    writeFileSync(secret, "{}\n");
    writeFileSync(join(root, "google-services.json"), "{}\n");

    expect(resolveGoogleServicesPath(root, { GOOGLE_SERVICES_JSON: secret })).toBe(secret);
  });

  it("falls back to mobile/google-services.json when the env path is missing", () => {
    const root = tempRoot();
    const missing = join(root, "missing", "google-services.json");

    expect(resolveGoogleServicesPath(root, { GOOGLE_SERVICES_JSON: missing })).toBe(
      join(root, "google-services.json"),
    );
  });

  it("falls back when GOOGLE_SERVICES_JSON is unset or blank", () => {
    const root = tempRoot();
    const local = join(root, "google-services.json");

    expect(resolveGoogleServicesPath(root, {})).toBe(local);
    expect(resolveGoogleServicesPath(root, { GOOGLE_SERVICES_JSON: "   " })).toBe(local);
  });
});
