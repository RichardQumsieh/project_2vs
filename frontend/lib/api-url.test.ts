import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DEV_API_URL,
  DEFAULT_PRODUCTION_API_URL,
  resolveApiUrl,
} from "./api-url";

describe("resolveApiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers an explicit override", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://from-env.example");
    expect(resolveApiUrl("https://explicit.example")).toBe(
      "https://explicit.example",
    );
  });

  it("uses NEXT_PUBLIC_API_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://from-env.example");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveApiUrl()).toBe("https://from-env.example");
  });

  it("defaults to the live API in production builds", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveApiUrl()).toBe(DEFAULT_PRODUCTION_API_URL);
  });

  it("defaults to localhost outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveApiUrl()).toBe(DEFAULT_DEV_API_URL);
  });
});
