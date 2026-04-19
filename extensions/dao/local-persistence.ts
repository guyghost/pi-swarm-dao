import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DAOState, Proposal } from "./types.js";

export interface DAOStorageSettings {
  version: 1;
  mode: "offline-first";
  githubSyncEnabled: boolean;
}

const DEFAULT_STORAGE_SETTINGS: DAOStorageSettings = {
  version: 1,
  mode: "offline-first",
  githubSyncEnabled: true,
};

const isTestEnvironment = (): boolean =>
  process.env.VITEST === "true" && process.env.DAO_FORCE_LOCAL_PERSIST !== "1";

const readJson = <T>(path: string): T | null => {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
};

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
};

const padId = (value: number): string => String(value).padStart(3, "0");

const toDecisionRecord = (proposal: Proposal) => ({
  id: proposal.id,
  title: proposal.title,
  type: proposal.type,
  status: proposal.status,
  stage: proposal.stage,
  riskZone: proposal.riskZone,
  createdAt: proposal.createdAt,
  resolvedAt: proposal.resolvedAt,
});

export const getDaoRoot = (rootDir: string = process.cwd()): string =>
  join(rootDir, ".dao");

const getConfigPath = (rootDir: string = process.cwd()): string =>
  join(getDaoRoot(rootDir), "config.json");

const getStatePath = (rootDir: string = process.cwd()): string =>
  join(getDaoRoot(rootDir), "state.json");

const getProposalsDir = (rootDir: string = process.cwd()): string =>
  join(getDaoRoot(rootDir), "proposals");

const getDecisionsDir = (rootDir: string = process.cwd()): string =>
  join(getDaoRoot(rootDir), "decisions");

const ensureDaoStructure = (rootDir: string = process.cwd()): void => {
  mkdirSync(getDaoRoot(rootDir), { recursive: true });
  mkdirSync(getProposalsDir(rootDir), { recursive: true });
  mkdirSync(getDecisionsDir(rootDir), { recursive: true });

  if (!existsSync(getConfigPath(rootDir))) {
    writeJson(getConfigPath(rootDir), DEFAULT_STORAGE_SETTINGS);
  }
};

export const getStorageSettings = (
  rootDir: string = process.cwd(),
): DAOStorageSettings => {
  const existing = readJson<DAOStorageSettings>(getConfigPath(rootDir));
  if (!existing) return { ...DEFAULT_STORAGE_SETTINGS };

  return {
    version: 1,
    mode: "offline-first",
    githubSyncEnabled: existing.githubSyncEnabled !== false,
  };
};

export const updateStorageSettings = (
  updates: Partial<DAOStorageSettings>,
  rootDir: string = process.cwd(),
): DAOStorageSettings => {
  ensureDaoStructure(rootDir);
  const next = {
    ...getStorageSettings(rootDir),
    ...updates,
    version: 1 as const,
    mode: "offline-first" as const,
  };
  writeJson(getConfigPath(rootDir), next);
  return next;
};

export const isGitHubSyncEnabled = (rootDir: string = process.cwd()): boolean =>
  getStorageSettings(rootDir).githubSyncEnabled;

export const hasLocalState = (rootDir: string = process.cwd()): boolean =>
  existsSync(getStatePath(rootDir));

export const restoreLocalState = (
  rootDir: string = process.cwd(),
): DAOState | null => readJson<DAOState>(getStatePath(rootDir));

export const persistLocalState = (
  state: DAOState,
  rootDir: string = process.cwd(),
): void => {
  if (rootDir === process.cwd() && isTestEnvironment()) return;

  ensureDaoStructure(rootDir);
  writeJson(getStatePath(rootDir), state);

  for (const proposal of state.proposals) {
    writeJson(join(getProposalsDir(rootDir), `${padId(proposal.id)}.json`), proposal);
  }

  const decisions = state.proposals
    .filter((proposal) => proposal.status !== "open" && proposal.status !== "deliberating")
    .map(toDecisionRecord)
    .sort((a, b) => a.id - b.id);

  writeJson(join(getDecisionsDir(rootDir), "index.json"), decisions);

  for (const decision of decisions) {
    writeJson(join(getDecisionsDir(rootDir), `${padId(decision.id)}.json`), decision);
  }
};
