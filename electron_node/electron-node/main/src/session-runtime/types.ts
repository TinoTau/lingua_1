import type { SessionIntentDiagnostics } from './session-intent-diagnostics';

export const SESSION_TTL_ACTIVE_MS = 30 * 60 * 1000;
export const SESSION_TTL_IDLE_MS = 10 * 60 * 1000;
export const SESSION_TTL_MAX_MS = 2 * 60 * 60 * 1000;
export const MAX_ROLLING_TURNS = 20;
export const MAX_PROFILE_HISTORY = 20;

export const INTENT_INTERVAL_MS = 3 * 60 * 1000;
export const INTENT_BOOTSTRAP_TURNS = 3;
export const INTENT_STABLE_INTERVAL_TURNS = 20;
export const INTENT_NO_TOPK_STREAK_TURNS = 3;
export const INTENT_NO_TOPK_RATIO = 0.5;

export type SessionStatus = 'active' | 'idle' | 'expired';

export type RollingTurnRecoverStats = {
  noTopkCandidate: number;
  pickedSource?: string;
  domainBoostApplied: number;
};

export type RollingTurn = {
  turnId: string;
  timestamp: number;
  rawAsrText: string;
  finalText: string;
  sourceLang: string;
  targetLang: string;
  activeProfileAtTurn: string;
  recoverStats: RollingTurnRecoverStats;
};

export type ActiveLexiconProfileSnapshot = {
  primaryDomain: string;
  secondaryDomains: string[];
  boosts: Record<string, number>;
  profileVersion: string;
  confidence: number;
  effectiveFromTurn: number;
};

export type LexiconIntentSummary = {
  summary: string;
  updatedAt: number;
};

export type ProfileSwitchTrigger =
  | 'bootstrap'
  | 'interval_refresh'
  | 'time_refresh'
  | 'no_topk_surge'
  | 'manual';

export type ProfileSwitchEvent = {
  from: string;
  to: string;
  confidence: number;
  reason: string[];
  trigger: ProfileSwitchTrigger;
  effectiveFromTurn: number;
  timestamp: number;
};

export type SessionObject = {
  sessionId: string;
  assignedNodeId: string;
  sourceLang: string;
  targetLangs: string[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  rollingContext: RollingTurn[];
  activeLexiconProfile: ActiveLexiconProfileSnapshot;
  lexiconIntentSummary?: LexiconIntentSummary;
  profileHistory: ProfileSwitchEvent[];
  status: SessionStatus;
  finalizedTurnCount: number;
  lastIntentAtMs: number;
  /** 已决策、待 effectiveFromTurn 生效的 profile */
  pendingProfile?: ActiveLexiconProfileSnapshot;
  /** 当前 processing turn（turn 内 profile 固定） */
  currentTurnId?: string;
  turnProfileSnapshot?: ActiveLexiconProfileSnapshot;
  /** per-session Intent 调度开关（批测可禁用） */
  intentSchedulingEnabled?: boolean;
  /** Lexicon V2 Intent 可观测性 */
  intentDiagnostics: SessionIntentDiagnostics;
};

export type LexiconProfileDecision = {
  summary: string;
  primaryDomain: string;
  secondaryDomains: string[];
  confidence: number;
  shouldSwitch: boolean;
  reason: string[];
  effectiveFromTurn: number;
};

export type SessionSnapshot = {
  sessionId: string;
  assignedNodeId: string;
  rollingContext: RollingTurn[];
  activeLexiconProfile: ActiveLexiconProfileSnapshot;
  lexiconIntentSummary?: LexiconIntentSummary;
  profileHistory: ProfileSwitchEvent[];
};

/** Node ↔ Scheduler 迁移契约（调度对接前节点本地亦可用） */
export const SESSION_MIGRATION_SCHEMA_VERSION = 'session-migration-v1';

export type SessionMigrationPayload = {
  schemaVersion: typeof SESSION_MIGRATION_SCHEMA_VERSION;
  exportedAtMs: number;
  sourceNodeId: string;
  sessionId: string;
  assignedNodeId: string;
  sourceLang: string;
  targetLangs: string[];
  rollingContext: RollingTurn[];
  activeLexiconProfile: ActiveLexiconProfileSnapshot;
  pendingProfile?: ActiveLexiconProfileSnapshot;
  lexiconIntentSummary?: LexiconIntentSummary;
  profileHistory: ProfileSwitchEvent[];
  finalizedTurnCount: number;
  lastIntentAtMs: number;
  intentDiagnostics?: SessionIntentDiagnostics;
  checksum: string;
};

export type SessionMigrationExportResult = {
  found: boolean;
  payload?: SessionMigrationPayload;
};

export type SessionMigrationImportResult = {
  sessionId: string;
  replaced: boolean;
};
