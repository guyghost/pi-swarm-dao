// ============================================================
// Tests — Shell: Hook Registry
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { onTransition, removeHook, clearHooks, fireHooks } from "../../extensions/dao/shell/hooks.ts";
import type { GuardContext } from "../../extensions/dao/core/states.ts";

describe("Hook Registry", () => {
  beforeEach(() => {
    clearHooks();
  });

  it("fires hook on matching transition", async () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", (from, to) => {
      calls.push(`${from}→${to}`);
    });

    const ctx: GuardContext = { status: "open" };
    await fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["open→deliberating"]);
  });

  it("does not fire hook on non-matching transition", async () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", () => {
      calls.push("fired");
    });

    const ctx: GuardContext = { status: "approved" };
    await fireHooks("approved", "controlled", "pass_gates", 1, ctx);

    expect(calls).toEqual([]);
  });

  it("fires wildcard hooks (from→*)", async () => {
    const calls: string[] = [];
    onTransition("*", "deliberating", (from, to) => {
      calls.push(`${from}→${to}`);
    });

    const ctx: GuardContext = { status: "open" };
    await fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["open→deliberating"]);
  });

  it("fires wildcard hooks (*→to)", async () => {
    const calls: string[] = [];
    onTransition("controlled", "*", (from, to) => {
      calls.push(`${from}→${to}`);
    });

    const ctx: GuardContext = { status: "controlled" };
    await fireHooks("controlled", "executed", "execute", 1, ctx);

    expect(calls).toEqual(["controlled→executed"]);
  });

  it("fires *→* catch-all hook", async () => {
    const calls: string[] = [];
    onTransition("*", "*", () => {
      calls.push("any");
    });

    const ctx: GuardContext = { status: "open" };
    await fireHooks("open", "deliberating", "deliberate", 1, ctx);
    await fireHooks("approved", "controlled", "pass_gates", 2, ctx);

    expect(calls).toEqual(["any", "any"]);
  });

  it("supports multiple hooks on same transition", async () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", () => { calls.push("hook1"); });
    onTransition("open", "deliberating", () => { calls.push("hook2"); });

    const ctx: GuardContext = { status: "open" };
    await fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["hook1", "hook2"]);
  });

  it("removes hook by ID", async () => {
    const calls: string[] = [];
    const id = onTransition("open", "deliberating", () => { calls.push("fired"); });

    removeHook(id);

    const ctx: GuardContext = { status: "open" };
    await fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual([]);
  });

  it("swallows best-effort hook errors without breaking other hooks", async () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", () => { throw new Error("boom"); });
    onTransition("open", "deliberating", () => { calls.push("after-error"); });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx: GuardContext = { status: "open" };
    const result = await fireHooks("open", "deliberating", "deliberate", 1, ctx);
    warnSpy.mockRestore();

    expect(calls).toEqual(["after-error"]);
    expect(result.errors).toHaveLength(1);
  });
});
