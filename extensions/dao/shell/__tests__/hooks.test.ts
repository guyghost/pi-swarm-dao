// ============================================================
// Hooks System Tests — Critical vs Best-Effort
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  onTransition,
  removeHook,
  clearHooks,
  fireHooks,
  getHooksForTransition,
  CriticalHookError,
} from "../hooks.js";
import type { GuardContext } from "../../core/states.js";

// ── Helpers ───────────────────────────────────────────────────

const defaultCtx: GuardContext = {
  status: "open",
  quorumMet: true,
  gatesPassed: true,
  approvalScore: 80,
};

beforeEach(() => {
  clearHooks();
});

// ── Critical Hook Failure ────────────────────────────────────

describe("critical hook failure", () => {
  it("throws CriticalHookError when a critical hook throws", async () => {
    onTransition(
      "open",
      "deliberating",
      () => {
        throw new Error("GitHub API down");
      },
      "critical",
      "github-persist",
    );

    await expect(
      fireHooks("open", "deliberating", "deliberate", 1, defaultCtx),
    ).rejects.toThrow(CriticalHookError);

    try {
      await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);
    } catch (err) {
      expect(err).toBeInstanceOf(CriticalHookError);
      const crit = err as CriticalHookError;
      expect(crit.hookName).toBe("github-persist");
      expect(String(crit.cause)).toContain("GitHub API down");
    }
  });
});

// ── Best-Effort Hook Failure ─────────────────────────────────

describe("best-effort hook failure", () => {
  it("logs a warning but does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    onTransition(
      "open",
      "deliberating",
      () => {
        throw new Error("Notification service unavailable");
      },
      "best-effort",
      "slack-notify",
    );

    // Should NOT throw
    const result = await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.hook).toBe("slack-notify");
    expect(String(result.errors[0]!.error)).toContain("Notification service unavailable");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("continues executing subsequent best-effort hooks after a failure", async () => {
    const hook2Call = vi.fn();

    onTransition(
      "open",
      "deliberating",
      () => {
        throw new Error("fail");
      },
      "best-effort",
      "hook-1",
    );
    onTransition(
      "open",
      "deliberating",
      hook2Call,
      "best-effort",
      "hook-2",
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);
    warnSpy.mockRestore();

    // hook-1 failed but hook-2 still ran
    expect(hook2Call).toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.hook).toBe("hook-1");
  });
});

// ── Default Type ─────────────────────────────────────────────

describe("default hook type", () => {
  it("hooks default to best-effort", async () => {
    // Register without specifying type
    onTransition("open", "deliberating", () => {
      throw new Error("boom");
    });

    // Should NOT throw — best-effort by default
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);
    warnSpy.mockRestore();

    expect(result.errors).toHaveLength(1);
  });
});

// ── Critical Before Best-Effort ──────────────────────────────

describe("hook execution order", () => {
  it("critical hooks run before best-effort hooks", async () => {
    const order: string[] = [];

    // Register best-effort first
    onTransition(
      "open",
      "deliberating",
      () => { order.push("best-effort-1"); },
      "best-effort",
      "be-1",
    );

    // Register critical second
    onTransition(
      "open",
      "deliberating",
      () => { order.push("critical-1"); },
      "critical",
      "cr-1",
    );

    // Register another best-effort
    onTransition(
      "open",
      "deliberating",
      () => { order.push("best-effort-2"); },
      "best-effort",
      "be-2",
    );

    await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);

    expect(order).toEqual(["critical-1", "best-effort-1", "best-effort-2"]);
  });
});

// ── Multiple Critical Hooks ──────────────────────────────────

describe("multiple critical hooks", () => {
  it("first critical failure stops execution", async () => {
    const secondCritical = vi.fn();

    onTransition(
      "open",
      "deliberating",
      () => {
        throw new Error("First critical fails");
      },
      "critical",
      "cr-1",
    );
    onTransition(
      "open",
      "deliberating",
      secondCritical,
      "critical",
      "cr-2",
    );

    await expect(
      fireHooks("open", "deliberating", "deliberate", 1, defaultCtx),
    ).rejects.toThrow(CriticalHookError);

    // Second critical hook should NOT have been called
    expect(secondCritical).not.toHaveBeenCalled();
  });
});

// ── getHooksForTransition ────────────────────────────────────

describe("getHooksForTransition", () => {
  it("sorts critical before best-effort", () => {
    onTransition("open", "deliberating", () => {}, "best-effort", "be-1");
    onTransition("open", "deliberating", () => {}, "critical", "cr-1");
    onTransition("open", "deliberating", () => {}, "best-effort", "be-2");

    const hooks = getHooksForTransition("open", "deliberating");
    const types = hooks.map(h => h.type);

    expect(types).toEqual(["critical", "best-effort", "best-effort"]);
  });

  it("includes wildcard hooks", () => {
    onTransition("*", "deliberating", () => {}, "best-effort", "wild-1");
    onTransition("open", "*", () => {}, "critical", "wild-2");

    const hooks = getHooksForTransition("open", "deliberating");
    const names = hooks.map(h => h.name);

    expect(names).toContain("wild-1");
    expect(names).toContain("wild-2");
  });
});

// ── Wildcard Hooks ───────────────────────────────────────────

describe("wildcard hooks", () => {
  it("critical wildcard hook failure throws", async () => {
    onTransition(
      "*",
      "*",
      () => {
        throw new Error("Global critical fail");
      },
      "critical",
      "global-critical",
    );

    await expect(
      fireHooks("open", "deliberating", "deliberate", 1, defaultCtx),
    ).rejects.toThrow(CriticalHookError);
  });

  it("best-effort wildcard hook failure is swallowed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    onTransition(
      "*",
      "*",
      () => {
        throw new Error("Global best-effort fail");
      },
      "best-effort",
      "global-be",
    );

    const result = await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);
    warnSpy.mockRestore();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.hook).toBe("global-be");
  });
});

// ── removeHook ───────────────────────────────────────────────

describe("removeHook", () => {
  it("removes a hook so it no longer fires", async () => {
    const hookFn = vi.fn();
    const id = onTransition("open", "deliberating", hookFn, "best-effort", "removable");

    removeHook(id);

    await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);
    expect(hookFn).not.toHaveBeenCalled();
  });
});

// ── Async Hooks ──────────────────────────────────────────────

describe("async hooks", () => {
  it("waits for async hooks", async () => {
    let resolved = false;

    onTransition(
      "open",
      "deliberating",
      async () => {
        await new Promise(r => setTimeout(r, 10));
        resolved = true;
      },
      "critical",
      "async-critical",
    );

    await fireHooks("open", "deliberating", "deliberate", 1, defaultCtx);
    expect(resolved).toBe(true);
  });

  it("async critical failure throws CriticalHookError", async () => {
    onTransition(
      "open",
      "deliberating",
      async () => {
        throw new Error("Async critical fail");
      },
      "critical",
      "async-cr",
    );

    await expect(
      fireHooks("open", "deliberating", "deliberate", 1, defaultCtx),
    ).rejects.toThrow(CriticalHookError);
  });
});
