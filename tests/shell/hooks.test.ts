// ============================================================
// Tests — Shell: Hook Registry
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { onTransition, removeHook, clearHooks, fireHooks } from "../../extensions/dao/shell/hooks.ts";
import type { GuardContext } from "../../extensions/dao/core/states.ts";

describe("Hook Registry", () => {
  beforeEach(() => {
    clearHooks();
  });

  it("fires hook on matching transition", () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", (from, to) => {
      calls.push(`${from}→${to}`);
    });

    const ctx: GuardContext = { status: "open" };
    fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["open→deliberating"]);
  });

  it("does not fire hook on non-matching transition", () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", () => {
      calls.push("fired");
    });

    const ctx: GuardContext = { status: "approved" };
    fireHooks("approved", "controlled", "pass_gates", 1, ctx);

    expect(calls).toEqual([]);
  });

  it("fires wildcard hooks (from→*)", () => {
    const calls: string[] = [];
    onTransition("*", "deliberating", (from, to) => {
      calls.push(`${from}→${to}`);
    });

    const ctx: GuardContext = { status: "open" };
    fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["open→deliberating"]);
  });

  it("fires wildcard hooks (*→to)", () => {
    const calls: string[] = [];
    onTransition("controlled", "*", (from, to) => {
      calls.push(`${from}→${to}`);
    });

    const ctx: GuardContext = { status: "controlled" };
    fireHooks("controlled", "executed", "execute", 1, ctx);

    expect(calls).toEqual(["controlled→executed"]);
  });

  it("fires *→* catch-all hook", () => {
    const calls: string[] = [];
    onTransition("*", "*", () => {
      calls.push("any");
    });

    const ctx: GuardContext = { status: "open" };
    fireHooks("open", "deliberating", "deliberate", 1, ctx);
    fireHooks("approved", "controlled", "pass_gates", 2, ctx);

    expect(calls).toEqual(["any", "any"]);
  });

  it("supports multiple hooks on same transition", () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", () => calls.push("hook1"));
    onTransition("open", "deliberating", () => calls.push("hook2"));

    const ctx: GuardContext = { status: "open" };
    fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["hook1", "hook2"]);
  });

  it("removes hook by ID", () => {
    const calls: string[] = [];
    const id = onTransition("open", "deliberating", () => calls.push("fired"));

    removeHook(id);

    const ctx: GuardContext = { status: "open" };
    fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual([]);
  });

  it("swallows hook errors without breaking other hooks", () => {
    const calls: string[] = [];
    onTransition("open", "deliberating", () => { throw new Error("boom"); });
    onTransition("open", "deliberating", () => calls.push("after-error"));

    const ctx: GuardContext = { status: "open" };
    fireHooks("open", "deliberating", "deliberate", 1, ctx);

    expect(calls).toEqual(["after-error"]);
  });
});
