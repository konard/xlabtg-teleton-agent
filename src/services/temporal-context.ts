import { createHash } from "crypto";
import type { Database } from "better-sqlite3";
import { SECONDS_PER_DAY } from "../constants/limits.js";

export type TemporalEntityType =
  | "knowledge"
  | "message"
  | "session"
  | "task"
  | "behavior"
  | "request"
  | "tool";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type RelativePeriod = "weekday" | "weekend";
export type SessionPhase = "beginning" | "middle" | "end" | "unknown";
export type TemporalPatternType = "daily" | "weekly" | "recurring" | "seasonal" | "custom";
export type TemporalDecayCurve = "exponential" | "linear" | "step";

export interface TemporalMetadata {
  timestamp: number;
  isoString: string;
  timezone: string;
  localDate: string;
  localTime: string;
  dayOfWeek: number;
  dayName: string;
  hourOfDay: number;
  timeOfDay: TimeOfDay;
  relativePeriod: RelativePeriod;
  relativeMarkers: string[];
  sessionPhase: SessionPhase;
}

export interface TemporalWeightingConfig {
  enabled: boolean;
  decay_curve: TemporalDecayCurve;
  recency_half_life_days: number;
  temporal_relevance_weight: number;
}

export interface TemporalContextConfig {
  enabled?: boolean;
  timezone?: string;
  pattern_min_frequency?: number;
  pattern_confidence_threshold?: number;
  context_patterns_limit?: number;
  weighting?: Partial<TemporalWeightingConfig>;
}

export interface TemporalSearchWeightingOptions extends Partial<TemporalWeightingConfig> {
  timezone?: string;
  now?: number;
}

export interface TemporalPattern<
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  patternType: TemporalPatternType;
  description: string;
  scheduleCron: string | null;
  confidence: number;
  frequency: number;
  lastSeen: number;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  metadata: TMetadata;
  activeScore?: number;
}

export interface TemporalContextSnapshot {
  timezone: string;
  generatedAt: number;
  metadata: TemporalMetadata;
  activePatterns: TemporalPattern[];
  suggestedGreeting: string;
}

export interface TemporalTimelineEntry {
  id: string;
  entityType: TemporalEntityType;
  entityId: string;
  timestamp: number;
  timezone: string;
  dayOfWeek: number;
  hourOfDay: number;
  timeOfDay: TimeOfDay;
  relativePeriod: RelativePeriod;
  sessionPhase: SessionPhase;
  metadata: Record<string, unknown>;
}

export interface TemporalScoredSearchResult {
  score: number;
  createdAt?: number;
  temporalScore?: number;
}

interface TemporalMetadataDbRow {
  id: string;
  entity_type: TemporalEntityType;
  entity_id: string;
  timestamp: number;
  timezone: string;
  day_of_week: number;
  hour_of_day: number;
  time_of_day: TimeOfDay;
  relative_period: RelativePeriod;
  session_phase: SessionPhase;
  metadata: string;
}

interface TemporalPatternDbRow {
  id: string;
  pattern_type: TemporalPatternType;
  description: string;
  schedule_cron: string | null;
  confidence: number;
  frequency: number;
  last_seen: number;
  created_at: number;
  updated_at: number;
  enabled: number;
  metadata: string;
}

interface BehaviorEventRow {
  id: number;
  action_type: string;
  action: string;
  metadata: string;
  created_at: number;
}

interface PatternSeed {
  patternType: TemporalPatternType;
  actionType: string;
  action: string;
  dayOfWeek?: number;
  hourOfDay?: number;
  timeOfDay?: TimeOfDay;
  confidence: number;
  frequency: number;
  lastSeen: number;
  description: string;
  scheduleCron: string | null;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_CONTEXT_PATTERNS_LIMIT = 5;
const DEFAULT_PATTERN_MIN_FREQUENCY = 2;
const DEFAULT_PATTERN_CONFIDENCE_THRESHOLD = 0.5;
const DEFAULT_WEIGHTING: TemporalWeightingConfig = {
  enabled: true,
  decay_curve: "exponential",
  recency_half_life_days: 30,
  temporal_relevance_weight: 0.2,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toUnixTimestamp(timestamp?: number | Date | string): number {
  if (timestamp === undefined) return Math.floor(Date.now() / 1000);
  if (timestamp instanceof Date) return Math.floor(timestamp.getTime() / 1000);
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (Number.isNaN(parsed)) return Math.floor(Date.now() / 1000);
    return Math.floor(parsed / 1000);
  }
  return Math.floor(timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableId(prefix: string, value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${prefix}:${stableJson(value)}`)
    .digest("hex");
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function normalizeTimezone(timezone?: string): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function getSessionPhase(index?: number, total?: number): SessionPhase {
  if (index === undefined || index < 0) return "unknown";
  if (index <= 2) return "beginning";
  if (total !== undefined && total > 0 && index / total >= 0.75) return "end";
  return "middle";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getZonedParts(
  timestamp: number,
  timezone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp * 1000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const rawHour = Number(parts.hour ?? "0");
  return {
    year: Number(parts.year ?? "1970"),
    month: Number(parts.month ?? "1"),
    day: Number(parts.day ?? "1"),
    hour: rawHour === 24 ? 0 : Math.max(0, Math.min(23, rawHour)),
    minute: Number(parts.minute ?? "0"),
    second: Number(parts.second ?? "0"),
  };
}

export function deriveTemporalMetadata(
  input: {
    timestamp?: number | Date | string;
    timezone?: string;
    sessionIndex?: number;
    sessionMessageCount?: number;
    sessionPhase?: SessionPhase;
  } = {}
): TemporalMetadata {
  const timestamp = toUnixTimestamp(input.timestamp);
  const timezone = normalizeTimezone(input.timezone);
  const parts = getZonedParts(timestamp, timezone);
  const dayOfWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const hourOfDay = parts.hour;
  const timeOfDay = getTimeOfDay(hourOfDay);
  const relativePeriod: RelativePeriod = dayOfWeek === 0 || dayOfWeek === 6 ? "weekend" : "weekday";
  const dayName = DAY_NAMES[dayOfWeek] ?? "Sunday";
  const sessionPhase =
    input.sessionPhase ?? getSessionPhase(input.sessionIndex, input.sessionMessageCount);

  return {
    timestamp,
    isoString: new Date(timestamp * 1000).toISOString(),
    timezone,
    localDate: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    localTime: `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`,
    dayOfWeek,
    dayName,
    hourOfDay,
    timeOfDay,
    relativePeriod,
    relativeMarkers: [timeOfDay, relativePeriod, dayName.toLowerCase()],
    sessionPhase,
  };
}

export function ensureTemporalSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS temporal_metadata (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('knowledge', 'message', 'session', 'task', 'behavior', 'request', 'tool')),
      entity_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
      hour_of_day INTEGER NOT NULL CHECK(hour_of_day >= 0 AND hour_of_day <= 23),
      time_of_day TEXT NOT NULL CHECK(time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
      relative_period TEXT NOT NULL CHECK(relative_period IN ('weekday', 'weekend')),
      session_phase TEXT NOT NULL DEFAULT 'unknown'
        CHECK(session_phase IN ('beginning', 'middle', 'end', 'unknown')),
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_temporal_metadata_entity
      ON temporal_metadata(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_temporal_metadata_time
      ON temporal_metadata(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_temporal_metadata_day_hour
      ON temporal_metadata(day_of_week, hour_of_day);
    CREATE INDEX IF NOT EXISTS idx_temporal_metadata_markers
      ON temporal_metadata(time_of_day, relative_period);

    CREATE TABLE IF NOT EXISTS time_patterns (
      id TEXT PRIMARY KEY,
      pattern_type TEXT NOT NULL CHECK(pattern_type IN ('daily', 'weekly', 'recurring', 'seasonal', 'custom')),
      description TEXT NOT NULL,
      schedule_cron TEXT,
      confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
      frequency INTEGER NOT NULL DEFAULT 1,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_time_patterns_type
      ON time_patterns(pattern_type, confidence DESC, frequency DESC);
    CREATE INDEX IF NOT EXISTS idx_time_patterns_last_seen
      ON time_patterns(last_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_time_patterns_enabled
      ON time_patterns(enabled, confidence DESC) WHERE enabled = 1;
  `);
}

export function upsertTemporalMetadata(
  db: Database,
  entityType: TemporalEntityType,
  entityId: string,
  timestamp: number | Date | string,
  options: {
    timezone?: string;
    sessionPhase?: SessionPhase;
    metadata?: Record<string, unknown>;
  } = {}
): TemporalMetadata {
  ensureTemporalSchema(db);
  const temporal = deriveTemporalMetadata({
    timestamp,
    timezone: options.timezone,
    sessionPhase: options.sessionPhase,
  });
  const id = stableId("temporal_metadata", { entityType, entityId });
  const metadata = JSON.stringify({
    isoString: temporal.isoString,
    localDate: temporal.localDate,
    localTime: temporal.localTime,
    relativeMarkers: temporal.relativeMarkers,
    ...(options.metadata ?? {}),
  });

  db.prepare(
    `
    INSERT INTO temporal_metadata (
      id, entity_type, entity_id, timestamp, timezone, day_of_week, hour_of_day,
      time_of_day, relative_period, session_phase, metadata, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      timestamp = excluded.timestamp,
      timezone = excluded.timezone,
      day_of_week = excluded.day_of_week,
      hour_of_day = excluded.hour_of_day,
      time_of_day = excluded.time_of_day,
      relative_period = excluded.relative_period,
      session_phase = excluded.session_phase,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `
  ).run(
    id,
    entityType,
    entityId,
    temporal.timestamp,
    temporal.timezone,
    temporal.dayOfWeek,
    temporal.hourOfDay,
    temporal.timeOfDay,
    temporal.relativePeriod,
    temporal.sessionPhase,
    metadata
  );

  return temporal;
}

export function calculateFreshnessScore(
  timestamp: number,
  now = Math.floor(Date.now() / 1000),
  options: Partial<TemporalWeightingConfig> = {}
): number {
  const halfLifeDays = positiveNumber(
    options.recency_half_life_days,
    DEFAULT_WEIGHTING.recency_half_life_days
  );
  const ageDays = Math.max(0, (now - timestamp) / SECONDS_PER_DAY);
  const curve = options.decay_curve ?? DEFAULT_WEIGHTING.decay_curve;

  if (curve === "linear") {
    return clamp01(1 - ageDays / (halfLifeDays * 2));
  }
  if (curve === "step") {
    if (ageDays <= halfLifeDays) return 1;
    if (ageDays <= halfLifeDays * 2) return 0.5;
    return 0.1;
  }
  return clamp01(Math.exp((-Math.LN2 * ageDays) / halfLifeDays));
}

export function scoreTemporalRelevance(
  timestamp: number,
  options: TemporalSearchWeightingOptions = {}
): number {
  const timezone = normalizeTimezone(options.timezone);
  const now = toUnixTimestamp(options.now);
  const current = deriveTemporalMetadata({ timestamp: now, timezone });
  const candidate = deriveTemporalMetadata({ timestamp, timezone });
  const freshness = calculateFreshnessScore(timestamp, now, options);

  const hourDistance = Math.min(
    Math.abs(current.hourOfDay - candidate.hourOfDay),
    24 - Math.abs(current.hourOfDay - candidate.hourOfDay)
  );
  const hourProximity = 1 - hourDistance / 12;
  const markerScore =
    (current.dayOfWeek === candidate.dayOfWeek ? 0.35 : 0) +
    (current.timeOfDay === candidate.timeOfDay ? 0.3 : 0) +
    (current.relativePeriod === candidate.relativePeriod ? 0.2 : 0) +
    0.15 * clamp01(hourProximity);

  return clamp01(0.55 * freshness + 0.45 * markerScore);
}

export function applyTemporalSearchWeights<T extends TemporalScoredSearchResult>(
  results: T[],
  options: TemporalSearchWeightingOptions = {}
): T[] {
  const enabled = options.enabled ?? DEFAULT_WEIGHTING.enabled;
  if (!enabled) return results;

  const temporalWeight = clamp01(
    options.temporal_relevance_weight ?? DEFAULT_WEIGHTING.temporal_relevance_weight
  );
  if (temporalWeight <= 0) return results;

  for (const result of results) {
    if (!result.createdAt) continue;
    const temporalScore = scoreTemporalRelevance(result.createdAt, options);
    result.temporalScore = temporalScore;
    result.score = clamp01((1 - temporalWeight) * result.score + temporalWeight * temporalScore);
  }

  return results;
}

function rowToPattern(row: TemporalPatternDbRow): TemporalPattern {
  return {
    id: row.id,
    patternType: row.pattern_type,
    description: row.description,
    scheduleCron: row.schedule_cron,
    confidence: row.confidence,
    frequency: row.frequency,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    enabled: row.enabled === 1,
    metadata: parseJsonObject(row.metadata),
  };
}

function rowToTimelineEntry(row: TemporalMetadataDbRow): TemporalTimelineEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    timestamp: row.timestamp,
    timezone: row.timezone,
    dayOfWeek: row.day_of_week,
    hourOfDay: row.hour_of_day,
    timeOfDay: row.time_of_day,
    relativePeriod: row.relative_period,
    sessionPhase: row.session_phase,
    metadata: parseJsonObject(row.metadata),
  };
}

function actionKey(actionType: string, action: string): string {
  return `${actionType}:${action}`;
}

function describeAction(action: string): string {
  return action.length > 80 ? `${action.slice(0, 77)}...` : action;
}

function scheduleFor(seed: PatternSeed): string | null {
  if (seed.patternType === "daily" && seed.hourOfDay !== undefined) {
    return `0 ${seed.hourOfDay} * * *`;
  }
  if (
    seed.patternType === "weekly" &&
    seed.dayOfWeek !== undefined &&
    seed.hourOfDay !== undefined
  ) {
    return `0 ${seed.hourOfDay} * * ${seed.dayOfWeek}`;
  }
  if (
    seed.patternType === "recurring" &&
    seed.dayOfWeek !== undefined &&
    seed.hourOfDay !== undefined
  ) {
    return `0 ${seed.hourOfDay} * * ${seed.dayOfWeek}`;
  }
  return seed.scheduleCron;
}

function seedMetadata(seed: PatternSeed, timezone: string): Record<string, unknown> {
  return {
    actionKey: actionKey(seed.actionType, seed.action),
    actionType: seed.actionType,
    action: seed.action,
    timezone,
    ...(seed.dayOfWeek !== undefined ? { dayOfWeek: seed.dayOfWeek } : {}),
    ...(seed.hourOfDay !== undefined ? { hourOfDay: seed.hourOfDay } : {}),
    ...(seed.timeOfDay ? { timeOfDay: seed.timeOfDay } : {}),
  };
}

function suggestedGreeting(metadata: TemporalMetadata): string {
  if (metadata.timeOfDay === "morning") return "Good morning";
  if (metadata.timeOfDay === "afternoon") return "Good afternoon";
  if (metadata.timeOfDay === "evening") return "Good evening";
  return "Hello";
}

function matchesPattern(pattern: TemporalPattern, metadata: TemporalMetadata): number {
  if (!pattern.enabled) return 0;
  const p = pattern.metadata;
  const day = typeof p.dayOfWeek === "number" ? p.dayOfWeek : undefined;
  const hour = typeof p.hourOfDay === "number" ? p.hourOfDay : undefined;
  const timeOfDay = typeof p.timeOfDay === "string" ? p.timeOfDay : undefined;

  if (pattern.patternType === "recurring") {
    return day === metadata.dayOfWeek && hour === metadata.hourOfDay ? 1 : 0;
  }
  if (pattern.patternType === "weekly") {
    return day === metadata.dayOfWeek ? 0.85 : 0;
  }
  if (pattern.patternType === "daily") {
    if (hour === metadata.hourOfDay) return 0.75;
    if (timeOfDay === metadata.timeOfDay) return 0.55;
    return 0;
  }
  if (pattern.patternType === "seasonal") {
    return day === metadata.dayOfWeek || timeOfDay === metadata.timeOfDay ? 0.45 : 0;
  }
  return 0.35;
}

export class TemporalContextService {
  private readonly timezone: string;
  private readonly minFrequency: number;
  private readonly confidenceThreshold: number;
  private readonly contextPatternsLimit: number;

  constructor(
    private db: Database,
    config: TemporalContextConfig = {}
  ) {
    this.timezone = normalizeTimezone(config.timezone);
    this.minFrequency = positiveInt(config.pattern_min_frequency, DEFAULT_PATTERN_MIN_FREQUENCY);
    this.confidenceThreshold = clamp01(
      config.pattern_confidence_threshold ?? DEFAULT_PATTERN_CONFIDENCE_THRESHOLD
    );
    this.contextPatternsLimit = positiveInt(
      config.context_patterns_limit,
      DEFAULT_CONTEXT_PATTERNS_LIMIT
    );
    ensureTemporalSchema(db);
  }

  syncTemporalMetadata(limit = 5000): { synced: number } {
    let synced = 0;
    const syncRows = (
      entityType: TemporalEntityType,
      rows: Array<{ id: string; timestamp: number; metadata?: Record<string, unknown> }>
    ): void => {
      for (const row of rows) {
        upsertTemporalMetadata(this.db, entityType, row.id, row.timestamp, {
          timezone: this.timezone,
          metadata: row.metadata,
        });
        synced++;
      }
    };

    if (this.tableExists("knowledge")) {
      const rows = this.db
        .prepare(
          `
          SELECT id, COALESCE(updated_at, created_at) AS timestamp, source, path
          FROM knowledge
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT ?
        `
        )
        .all(limit) as Array<{
        id: string;
        timestamp: number;
        source: string;
        path: string | null;
      }>;
      syncRows(
        "knowledge",
        rows.map((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          metadata: { source: row.source, path: row.path },
        }))
      );
    }

    if (this.tableExists("tg_messages")) {
      const rows = this.db
        .prepare(
          `
          SELECT id, timestamp, chat_id, sender_id, is_from_agent
          FROM tg_messages
          ORDER BY timestamp DESC
          LIMIT ?
        `
        )
        .all(limit) as Array<{
        id: string;
        timestamp: number;
        chat_id: string;
        sender_id: string | null;
        is_from_agent: number;
      }>;
      syncRows(
        "message",
        rows.map((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          metadata: {
            chatId: row.chat_id,
            senderId: row.sender_id,
            isFromAgent: row.is_from_agent === 1,
          },
        }))
      );
    }

    if (this.tableExists("sessions")) {
      const rows = this.db
        .prepare(
          `
          SELECT id, started_at, chat_id, message_count
          FROM sessions
          ORDER BY started_at DESC
          LIMIT ?
        `
        )
        .all(limit) as Array<{
        id: string;
        started_at: number;
        chat_id: string;
        message_count: number | null;
      }>;
      syncRows(
        "session",
        rows.map((row) => ({
          id: row.id,
          timestamp: toUnixTimestamp(row.started_at),
          metadata: { chatId: row.chat_id, messageCount: row.message_count ?? 0 },
        }))
      );
    }

    if (this.tableExists("tasks")) {
      const rows = this.db
        .prepare(
          `
          SELECT id, created_at, status, priority
          FROM tasks
          ORDER BY created_at DESC
          LIMIT ?
        `
        )
        .all(limit) as Array<{
        id: string;
        created_at: number;
        status: string;
        priority: number | null;
      }>;
      syncRows(
        "task",
        rows.map((row) => ({
          id: row.id,
          timestamp: row.created_at,
          metadata: { status: row.status, priority: row.priority ?? 0 },
        }))
      );
    }

    return { synced };
  }

  analyzeAndStorePatterns(): { upserted: number } {
    const events = this.getBehaviorEvents();
    if (events.length === 0) return { upserted: 0 };

    const totals = new Map<string, number>();
    const daily = new Map<string, PatternSeed>();
    const weekly = new Map<string, PatternSeed>();
    const recurring = new Map<string, PatternSeed>();

    for (const event of events) {
      const key = actionKey(event.action_type, event.action);
      totals.set(key, (totals.get(key) ?? 0) + 1);
      const temporal = deriveTemporalMetadata({
        timestamp: event.created_at,
        timezone: this.timezone,
      });
      const base = {
        actionType: event.action_type,
        action: event.action,
        lastSeen: event.created_at,
      };

      const dailyKey = `${key}:hour:${temporal.hourOfDay}`;
      this.incrementSeed(daily, dailyKey, {
        ...base,
        patternType: "daily",
        hourOfDay: temporal.hourOfDay,
        timeOfDay: temporal.timeOfDay,
        confidence: 0,
        frequency: 0,
        description: `${describeAction(event.action)} usually appears around ${pad2(temporal.hourOfDay)}:00`,
        scheduleCron: null,
      });

      const weeklyKey = `${key}:day:${temporal.dayOfWeek}`;
      this.incrementSeed(weekly, weeklyKey, {
        ...base,
        patternType: "weekly",
        dayOfWeek: temporal.dayOfWeek,
        hourOfDay: temporal.hourOfDay,
        timeOfDay: temporal.timeOfDay,
        confidence: 0,
        frequency: 0,
        description: `${describeAction(event.action)} is common on ${temporal.dayName}s`,
        scheduleCron: null,
      });

      const recurringKey = `${key}:day:${temporal.dayOfWeek}:hour:${temporal.hourOfDay}`;
      this.incrementSeed(recurring, recurringKey, {
        ...base,
        patternType: "recurring",
        dayOfWeek: temporal.dayOfWeek,
        hourOfDay: temporal.hourOfDay,
        timeOfDay: temporal.timeOfDay,
        confidence: 0,
        frequency: 0,
        description: `${describeAction(event.action)} recurs on ${temporal.dayName}s around ${pad2(temporal.hourOfDay)}:00`,
        scheduleCron: null,
      });
    }

    const candidates = [...daily.values(), ...weekly.values(), ...recurring.values()]
      .map((seed) => {
        const total = totals.get(actionKey(seed.actionType, seed.action)) ?? 1;
        return { ...seed, confidence: clamp01(seed.frequency / total) };
      })
      .filter(
        (seed) => seed.frequency >= this.minFrequency && seed.confidence >= this.confidenceThreshold
      );

    let upserted = 0;
    for (const seed of candidates) {
      this.upsertPattern(seed);
      upserted++;
    }

    return { upserted };
  }

  getCurrentTemporalContext(
    input: {
      time?: number | Date | string;
      sessionIndex?: number;
      sessionMessageCount?: number;
      limit?: number;
    } = {}
  ): TemporalContextSnapshot {
    this.analyzeAndStorePatterns();
    const metadata = deriveTemporalMetadata({
      timestamp: input.time,
      timezone: this.timezone,
      sessionIndex: input.sessionIndex,
      sessionMessageCount: input.sessionMessageCount,
    });
    const activePatterns = this.getActivePatterns(
      metadata,
      input.limit ?? this.contextPatternsLimit
    );
    return {
      timezone: this.timezone,
      generatedAt: Math.floor(Date.now() / 1000),
      metadata,
      activePatterns,
      suggestedGreeting: suggestedGreeting(metadata),
    };
  }

  listPatterns(options: { includeDisabled?: boolean; limit?: number } = {}): TemporalPattern[] {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    const where = options.includeDisabled ? "" : "WHERE enabled = 1";
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM time_patterns
        ${where}
        ORDER BY confidence DESC, frequency DESC, last_seen DESC
        LIMIT ?
      `
      )
      .all(limit) as TemporalPatternDbRow[];
    return rows.map(rowToPattern);
  }

  updatePattern(
    id: string,
    patch: {
      enabled?: boolean;
      confidence?: number;
      description?: string;
      scheduleCron?: string | null;
    }
  ): TemporalPattern | null {
    const existing = this.db.prepare(`SELECT * FROM time_patterns WHERE id = ?`).get(id) as
      | TemporalPatternDbRow
      | undefined;
    if (!existing) return null;

    this.db
      .prepare(
        `
        UPDATE time_patterns
        SET enabled = ?,
            confidence = ?,
            description = ?,
            schedule_cron = ?,
            updated_at = unixepoch()
        WHERE id = ?
      `
      )
      .run(
        patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
        patch.confidence === undefined ? existing.confidence : clamp01(patch.confidence),
        patch.description ?? existing.description,
        patch.scheduleCron === undefined ? existing.schedule_cron : patch.scheduleCron,
        id
      );

    const row = this.db.prepare(`SELECT * FROM time_patterns WHERE id = ?`).get(id) as
      | TemporalPatternDbRow
      | undefined;
    return row ? rowToPattern(row) : null;
  }

  getTimeline(
    options: {
      from?: number | Date | string;
      to?: number | Date | string;
      entityType?: TemporalEntityType;
      limit?: number;
    } = {}
  ): TemporalTimelineEntry[] {
    const from = options.from === undefined ? 0 : toUnixTimestamp(options.from);
    const to =
      options.to === undefined ? Math.floor(Date.now() / 1000) : toUnixTimestamp(options.to);
    const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)));
    const clauses = ["timestamp >= ?", "timestamp <= ?"];
    const params: Array<string | number> = [from, to];
    if (options.entityType) {
      clauses.push("entity_type = ?");
      params.push(options.entityType);
    }
    params.push(limit);

    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM temporal_metadata
        WHERE ${clauses.join(" AND ")}
        ORDER BY timestamp DESC
        LIMIT ?
      `
      )
      .all(...params) as TemporalMetadataDbRow[];
    return rows.map(rowToTimelineEntry);
  }

  private getActivePatterns(metadata: TemporalMetadata, limit: number): TemporalPattern[] {
    return this.listPatterns({ includeDisabled: false, limit: 500 })
      .map((pattern) => ({
        ...pattern,
        activeScore: matchesPattern(pattern, metadata) * pattern.confidence,
      }))
      .filter((pattern) => (pattern.activeScore ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.activeScore ?? 0) - (a.activeScore ?? 0) ||
          b.confidence - a.confidence ||
          b.frequency - a.frequency
      )
      .slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
  }

  private tableExists(table: string): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(table) as { name: string } | undefined;
    return Boolean(row);
  }

  private getBehaviorEvents(): BehaviorEventRow[] {
    if (!this.tableExists("behavior_events")) return [];
    return this.db
      .prepare(
        `
        SELECT id, action_type, action, metadata, created_at
        FROM behavior_events
        ORDER BY created_at DESC, id DESC
        LIMIT 10000
      `
      )
      .all() as BehaviorEventRow[];
  }

  private incrementSeed(store: Map<string, PatternSeed>, key: string, seed: PatternSeed): void {
    const existing = store.get(key);
    if (!existing) {
      store.set(key, { ...seed, frequency: 1 });
      return;
    }
    existing.frequency += 1;
    existing.lastSeen = Math.max(existing.lastSeen, seed.lastSeen);
  }

  private upsertPattern(seed: PatternSeed): void {
    const metadata = seedMetadata(seed, this.timezone);
    const id = stableId("time_pattern", {
      patternType: seed.patternType,
      ...metadata,
    });
    const scheduleCron = scheduleFor(seed);
    this.db
      .prepare(
        `
        INSERT INTO time_patterns (
          id, pattern_type, description, schedule_cron, confidence,
          frequency, last_seen, created_at, updated_at, enabled, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          description = excluded.description,
          schedule_cron = excluded.schedule_cron,
          confidence = excluded.confidence,
          frequency = excluded.frequency,
          last_seen = excluded.last_seen,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata
      `
      )
      .run(
        id,
        seed.patternType,
        seed.description,
        scheduleCron,
        clamp01(seed.confidence),
        seed.frequency,
        seed.lastSeen,
        JSON.stringify(metadata)
      );
  }
}

export function formatTemporalContextForPrompt(snapshot: TemporalContextSnapshot): string {
  const meta = snapshot.metadata;
  const lines = [
    "[Temporal context]",
    `Local time: ${meta.localDate} ${meta.localTime} (${snapshot.timezone})`,
    `Day context: ${meta.dayName}, ${meta.timeOfDay}, ${meta.relativePeriod}`,
    `Suggested greeting tone: ${snapshot.suggestedGreeting}`,
  ];

  if (snapshot.activePatterns.length > 0) {
    lines.push("Active temporal patterns:");
    for (const pattern of snapshot.activePatterns) {
      lines.push(
        `- ${pattern.description} (${Math.round(pattern.confidence * 100)}% confidence, ${pattern.frequency} observations)`
      );
    }
  }

  lines.push(
    "Use time-sensitive context only when it is relevant. Avoid unsolicited reminders unless a strong active pattern directly supports them."
  );
  return lines.join("\n");
}
