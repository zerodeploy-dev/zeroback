import { describe, it, expect } from "vitest";
import { toSafeName } from "./bundle";

describe("toSafeName", () => {
  it("replaces slashes with $", () => {
    expect(toSafeName("users/auth")).toBe("users$auth");
  });

  it("replaces hyphens with _", () => {
    expect(toSafeName("email-ops")).toBe("email_ops");
  });

  it("passes through simple names", () => {
    expect(toSafeName("simple")).toBe("simple");
  });

  it("handles nested paths with slashes", () => {
    expect(toSafeName("a/b/c")).toBe("a$b$c");
  });

  it("produces different names for / vs -", () => {
    const a = toSafeName("users/auth");
    const b = toSafeName("users-auth");
    expect(a).not.toBe(b);
    expect(a).toBe("users$auth");
    expect(b).toBe("users_auth");
  });

  it("replaces dots and other special chars with _", () => {
    expect(toSafeName("file.name")).toBe("file_name");
    expect(toSafeName("a@b")).toBe("a_b");
  });

  it("handles dot-namespaced module names (new format)", () => {
    // Module names now use dots for namespacing (e.g., "inbox.threads")
    expect(toSafeName("inbox.threads")).toBe("inbox_threads");
    expect(toSafeName("deep.nested.module")).toBe("deep_nested_module");
  });
});
