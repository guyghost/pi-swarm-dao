import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInitialState, type Proposal } from "../../extensions/dao/types.ts";
import {
  getDaoRoot,
  getStorageSettings,
  hasLocalState,
  persistLocalState,
  restoreLocalState,
  updateStorageSettings,
} from "../../extensions/dao/local-persistence.ts";

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dao-local-"));
  tempDirs.push(dir);
  return dir;
};

const makeProposal = (id: number, status: Proposal["status"] = "approved"): Proposal => ({
  id,
  title: `Proposal ${id}`,
  type: "technical-change",
  description: `Description ${id}`,
  stage: status === "open" ? "intake" : "execution-gate",
  proposedBy: "test",
  status,
  votes: [],
  agentOutputs: [],
  createdAt: "2026-04-18T10:00:00.000Z",
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("local offline-first persistence", () => {
  it("uses offline-first defaults and can disable GitHub sync", () => {
    const rootDir = makeTempDir();

    expect(getStorageSettings(rootDir)).toEqual({
      version: 1,
      mode: "offline-first",
      githubSyncEnabled: true,
    });

    const updated = updateStorageSettings({ githubSyncEnabled: false }, rootDir);

    expect(updated.githubSyncEnabled).toBe(false);
    expect(getStorageSettings(rootDir).githubSyncEnabled).toBe(false);
  });

  it("persists DAO state into .dao with per-proposal and decision files", () => {
    const rootDir = makeTempDir();
    const state = createInitialState();
    state.proposals = [makeProposal(1, "approved"), makeProposal(2, "open")];
    state.nextProposalId = 3;

    persistLocalState(state, rootDir);

    const daoRoot = getDaoRoot(rootDir);
    expect(hasLocalState(rootDir)).toBe(true);
    expect(existsSync(join(daoRoot, "state.json"))).toBe(true);
    expect(existsSync(join(daoRoot, "proposals", "001.json"))).toBe(true);
    expect(existsSync(join(daoRoot, "proposals", "002.json"))).toBe(true);
    expect(existsSync(join(daoRoot, "decisions", "001.json"))).toBe(true);
    expect(existsSync(join(daoRoot, "decisions", "002.json"))).toBe(false);

    const decisionIndex = JSON.parse(
      readFileSync(join(daoRoot, "decisions", "index.json"), "utf-8"),
    ) as Array<{ id: number }>;
    expect(decisionIndex.map((entry) => entry.id)).toEqual([1]);
  });

  it("restores previously persisted local state", () => {
    const rootDir = makeTempDir();
    const state = createInitialState();
    state.proposals = [makeProposal(7, "executed")];
    state.nextProposalId = 8;

    persistLocalState(state, rootDir);
    const restored = restoreLocalState(rootDir);

    expect(restored?.nextProposalId).toBe(8);
    expect(restored?.proposals[0]?.id).toBe(7);
    expect(restored?.proposals[0]?.status).toBe("executed");
  });
});
