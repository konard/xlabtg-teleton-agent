import type { Config } from "../config/schema.js";
import {
  MAX_TOOL_RESULT_SIZE,
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  COMPACTION_MAX_TOKENS_RATIO,
  COMPACTION_SOFT_THRESHOLD_RATIO,
  CONTEXT_MAX_RECENT_MESSAGES,
  CONTEXT_MAX_RELEVANT_CHUNKS,
  CONTEXT_OVERFLOW_SUMMARY_MESSAGES,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_MAX_BACKOFF_MS,
  SERVER_ERROR_MAX_RETRIES,
  NETWORK_ERROR_MAX_RETRIES,
  TOOL_CONCURRENCY_LIMIT,
  EMBEDDING_QUERY_MAX_CHARS,
  MEMORY_STATS_CACHE_TTL_MS,
  TOOL_PARAM_HINT_MAX_CHARS,
  RAG_QUERY_RECENT_MESSAGES,
  RESPONSE_REINFORCEMENT_TOOL_CALL_THRESHOLD,
  LOOP_STALL_CONSECUTIVE_THRESHOLD,
} from "../constants/limits.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import {
  chatWithContext,
  loadContextFromTranscript,
  getProviderModel,
  getEffectiveApiKey,
  type ChatResponse,
} from "./client.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { buildSystemPrompt } from "../soul/loader.js";
import {
  getDatabase,
  MemoryGraphQuery,
  MemoryGraphStore,
  EntityExtractor,
} from "../memory/index.js";
import { sanitizeForContext } from "../utils/sanitize.js";
import { formatMessageEnvelope } from "../memory/envelope.js";
import {
  getOrCreateSession,
  updateSession,
  getSession,
  resetSession,
  shouldResetSession,
  resetSessionWithPolicy,
} from "../session/store.js";
import { transcriptExists, archiveTranscript, appendToTranscript } from "../session/transcript.js";
import type {
  Context,
  Tool as PiAiTool,
  UserMessage,
  ToolResultMessage,
  ToolCall,
} from "@mariozechner/pi-ai";
import { CompactionManager, DEFAULT_COMPACTION_CONFIG } from "../memory/compaction.js";
import { maskOldToolResults } from "../memory/observation-masking.js";
import { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { SemanticVectorStore } from "../memory/vector-store.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { appendToDailyLog } from "../memory/daily-logs.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import { createLogger } from "../utils/logger.js";
import type { createHookRunner } from "../sdk/hooks/runner.js";
import type { UserHookEvaluator } from "./hooks/user-hook-evaluator.js";
import type {
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforePromptBuildEvent,
  MessageReceiveEvent,
  ResponseBeforeEvent,
  ResponseAfterEvent,
  ResponseErrorEvent,
  ToolErrorEvent,
  PromptAfterEvent,
} from "../sdk/hooks/types.js";
import {
  isContextOverflowError,
  isTrivialMessage,
  extractContextSummary,
  parseRetryAfterMs,
  isNetworkError,
  isNetworkErrorMessage,
  trimRagContext,
  LoopStallDetector,
} from "./runtime-utils.js";
import { truncateToolResult } from "./tool-result-truncator.js";
import { accumulateTokenUsage } from "./token-usage.js";
import { getMetrics } from "../services/metrics.js";
import { getAnalytics } from "../services/analytics.js";

export { isContextOverflowError, isTrivialMessage } from "./runtime-utils.js";
export { getTokenUsage } from "./token-usage.js";

const log = createLogger("Agent");

export interface ProcessMessageOptions {
  chatId: string;
  userMessage: string;
  userName?: string;
  timestamp?: number;
  isGroup?: boolean;
  pendingContext?: string | null;
  toolContext?: Omit<ToolContext, "chatId" | "isGroup">;
  senderUsername?: string;
  senderRank?: string;
  hasMedia?: boolean;
  mediaType?: string;
  messageId?: number;
  replyContext?: { senderName?: string; text: string; isAgent?: boolean };
  isHeartbeat?: boolean;
}

export interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
}

/**
 * Generate a human-readable summary from tool execution results.
 * Used as a fallback when the LLM returns no text after tool calls.
 */
function generateToolSummary(
  results: Array<{ toolName: string; result: { success: boolean; data?: unknown; error?: string } }>
): string {
  const successes = results.filter((r) => r.result.success);
  const failures = results.filter((r) => !r.result.success);

  if (failures.length === 0) {
    const names = successes.map((r) => r.toolName).join(", ");
    return `✅ Completed ${successes.length} operation${successes.length !== 1 ? "s" : ""} (${names}).`;
  } else if (successes.length === 0) {
    const errors = failures
      .map((r) => `${r.toolName}: ${r.result.error || "unknown error"}`)
      .join("; ");
    return `⚠️ ${failures.length} operation${failures.length !== 1 ? "s" : ""} failed: ${errors}`;
  } else {
    const errorDetails = failures
      .map((r) => `${r.toolName}: ${r.result.error || "unknown error"}`)
      .join("; ");
    return (
      `✅ ${successes.length} succeeded, ⚠️ ${failures.length} failed. ` + `Errors: ${errorDetails}`
    );
  }
}

/** Compact summary of tool params for the iteration log line. */
function summarizeToolParams(toolName: string, params: Record<string, unknown>): string {
  const MAX = TOOL_PARAM_HINT_MAX_CHARS;
  let hint = "";

  if (toolName === "exec_run" && typeof params.command === "string") {
    hint = params.command;
  } else if (
    (toolName === "web_fetch" || toolName === "web_download_binary") &&
    typeof params.url === "string"
  ) {
    hint = params.url;
  } else if (toolName.startsWith("telegram_") && typeof params.message === "string") {
    hint = params.message;
  } else if (typeof params.query === "string") {
    hint = params.query;
  } else if (typeof params.section === "string") {
    hint = params.section;
  }

  if (!hint) return "";
  if (hint.length > MAX) hint = hint.slice(0, MAX) + "…";
  return `(${hint})`;
}

export class AgentRuntime {
  private config: Config;
  private soul: string;
  private compactionManager: CompactionManager;
  private contextBuilder: ContextBuilder | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private embedder: EmbeddingProvider | null = null;
  private entityExtractor = new EntityExtractor();
  private hookRunner?: ReturnType<typeof createHookRunner>;
  private userHookEvaluator?: UserHookEvaluator;

  constructor(config: Config, soul?: string, toolRegistry?: ToolRegistry) {
    this.config = config;
    this.soul = soul ?? "";
    this.toolRegistry = toolRegistry ?? null;

    const provider = (config.agent.provider || "anthropic") as SupportedProvider;
    const compactionOverride = config.agent.compaction;
    try {
      const model = getProviderModel(provider, config.agent.model);
      const ctx = model.contextWindow;
      this.compactionManager = new CompactionManager({
        enabled: compactionOverride.enabled,
        maxMessages: compactionOverride.max_messages ?? COMPACTION_MAX_MESSAGES,
        maxTokens: Math.floor(ctx * COMPACTION_MAX_TOKENS_RATIO),
        keepRecentMessages: compactionOverride.keep_recent ?? COMPACTION_KEEP_RECENT,
        memoryFlushEnabled: true,
        softThresholdTokens: Math.floor(ctx * COMPACTION_SOFT_THRESHOLD_RATIO),
        logCompaction: compactionOverride.log_compaction,
        autoPreserve: compactionOverride.auto_preserve,
      });
    } catch {
      this.compactionManager = new CompactionManager({
        ...DEFAULT_COMPACTION_CONFIG,
        enabled: compactionOverride.enabled,
        ...(compactionOverride.max_messages !== undefined && {
          maxMessages: compactionOverride.max_messages,
        }),
        ...(compactionOverride.keep_recent !== undefined && {
          keepRecentMessages: compactionOverride.keep_recent,
        }),
        logCompaction: compactionOverride.log_compaction,
        autoPreserve: compactionOverride.auto_preserve,
      });
    }
  }

  setHookRunner(runner: ReturnType<typeof createHookRunner>): void {
    this.hookRunner = runner;
  }

  setUserHookEvaluator(evaluator: UserHookEvaluator): void {
    this.userHookEvaluator = evaluator;
  }

  initializeContextBuilder(
    embedder: EmbeddingProvider,
    vectorEnabled: boolean,
    semanticVectorStore?: SemanticVectorStore
  ): void {
    this.embedder = embedder;
    const db = getDatabase().getDb();
    this.contextBuilder = new ContextBuilder(db, embedder, vectorEnabled, semanticVectorStore);
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  async processMessage(opts: ProcessMessageOptions): Promise<AgentResponse> {
    const {
      chatId,
      userMessage,
      userName,
      timestamp,
      isGroup,
      pendingContext,
      toolContext,
      senderUsername,
      senderRank,
      hasMedia,
      mediaType,
      messageId,
      replyContext,
      isHeartbeat,
    } = opts;

    const effectiveIsGroup = isGroup ?? false;
    const processStartTime = Date.now();

    try {
      // User hooks: keyword blocklist + context injection (hot-reloadable, no restart)
      let userHookContext = "";
      if (this.userHookEvaluator) {
        const hookResult = this.userHookEvaluator.evaluate(userMessage);
        if (hookResult.blocked) {
          log.info("Message blocked by keyword filter");
          return { content: hookResult.blockMessage ?? "", toolCalls: [] };
        }
        if (hookResult.additionalContext) {
          userHookContext = sanitizeForContext(hookResult.additionalContext);
        }
      }

      // Hook: message:receive — plugins can block, mutate text, inject context
      let effectiveMessage = userMessage;
      let hookMessageContext = "";
      if (this.hookRunner) {
        const msgEvent: MessageReceiveEvent = {
          chatId,
          senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
          senderName: userName ?? "",
          isGroup: effectiveIsGroup,
          isReply: !!replyContext,
          replyToMessageId: replyContext ? messageId : undefined,
          messageId: messageId ?? 0,
          timestamp: timestamp ?? Date.now(),
          text: userMessage,
          block: false,
          blockReason: "",
          additionalContext: "",
        };
        await this.hookRunner.runModifyingHook("message:receive", msgEvent);
        if (msgEvent.block) {
          log.info(`🚫 Message blocked by hook: ${msgEvent.blockReason || "no reason"}`);
          return { content: "", toolCalls: [] };
        }
        effectiveMessage = sanitizeForContext(msgEvent.text);
        if (msgEvent.additionalContext) {
          hookMessageContext = sanitizeForContext(msgEvent.additionalContext);
        }
      }

      let session = getOrCreateSession(chatId);
      const now = timestamp ?? Date.now();

      const resetPolicy = this.config.agent.session_reset_policy;
      if (shouldResetSession(session, resetPolicy)) {
        log.info(`🔄 Auto-resetting session based on policy`);

        // Hook: session:end (before reset)
        if (this.hookRunner) {
          await this.hookRunner.runObservingHook("session:end", {
            sessionId: session.sessionId,
            chatId,
            messageCount: session.messageCount,
          });
        }

        if (transcriptExists(session.sessionId)) {
          try {
            log.info(`💾 Saving memory before daily reset...`);
            const oldContext = loadContextFromTranscript(session.sessionId);

            await saveSessionMemory({
              oldSessionId: session.sessionId,
              newSessionId: "pending",
              context: oldContext,
              chatId,
              apiKey: getEffectiveApiKey(this.config.agent.provider, this.config.agent.api_key),
              provider: this.config.agent.provider as SupportedProvider,
              utilityModel: this.config.agent.utility_model,
            });

            log.info(`✅ Memory saved before reset`);
          } catch (error) {
            log.warn({ err: error }, `⚠️ Failed to save memory before reset`);
          }
        }

        session = resetSessionWithPolicy(chatId, resetPolicy);
      }

      let context: Context = loadContextFromTranscript(session.sessionId);
      const isNewSession = context.messages.length === 0;
      if (!isNewSession) {
        log.info(`📖 Loading existing session: ${session.sessionId}`);
      } else {
        log.info(`🆕 Starting new session: ${session.sessionId}`);
      }

      // Hook: session:start — fire concurrently, don't block message processing
      const sessionStartPromise = this.hookRunner
        ? this.hookRunner
            .runObservingHook("session:start", {
              sessionId: session.sessionId,
              chatId,
              isResume: !isNewSession,
            })
            .catch((err) => log.warn({ err }, "session:start hook failed"))
        : Promise.resolve();

      const previousTimestamp = session.updatedAt;

      let formattedMessage = formatMessageEnvelope({
        channel: "Telegram",
        senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
        senderName: userName,
        senderUsername: senderUsername,
        senderRank,
        timestamp: now,
        previousTimestamp,
        body: effectiveMessage,
        isGroup: effectiveIsGroup,
        hasMedia,
        mediaType,
        messageId,
        replyContext,
      });

      if (pendingContext) {
        formattedMessage = `${pendingContext}\n\n${formattedMessage}`;
        log.debug(`📋 Including ${pendingContext.split("\n").length - 1} pending messages`);
      }

      log.debug(`📨 Formatted message: ${formattedMessage.substring(0, 100)}...`);

      const preview = formattedMessage.slice(0, 50).replace(/\n/g, " ");
      const who = senderUsername ? `@${senderUsername}` : userName;
      const msgType = isGroup ? `Group ${chatId} ${who}` : `DM ${who}`;
      log.info(`📨 ${msgType}: "${preview}${formattedMessage.length > 50 ? "..." : ""}"`);

      // Determine if the sender is the owner to protect private data.
      // owner_id takes precedence; admin_ids is used as fallback when owner_id is absent.
      // Computed early so it can be used to gate RAG context access.
      const ownerId = this.config.telegram.owner_id;
      const senderIdNum = toolContext?.senderId;
      const isOwner =
        ownerId !== undefined
          ? senderIdNum === ownerId
          : senderIdNum !== undefined && this.config.telegram.admin_ids.includes(senderIdNum);

      // Start embedding computation concurrently with session:start hook
      let queryEmbedding: number[] | undefined;
      const embeddingPromise = this.computeQueryEmbedding(effectiveMessage, context.messages)
        .then((embedding) => {
          queryEmbedding = embedding;
        })
        .catch((error) => {
          log.warn({ err: error }, "Embedding computation failed");
        });

      // Await session:start and embedding concurrently before building context
      await Promise.all([sessionStartPromise, embeddingPromise]);

      const maxRagChars = this.config.agent.max_rag_chars;
      const relevantContext = await this.buildRagContext({
        effectiveMessage,
        chatId,
        isGroup: effectiveIsGroup,
        isOwner,
        queryEmbedding,
        maxRagChars,
      });
      const graphContext = await this.buildGraphContext({
        effectiveMessage,
        isOwner,
        maxGraphChars: maxRagChars ? Math.min(2000, maxRagChars) : 2000,
      });
      const retrievalContext = [relevantContext, graphContext].filter(Boolean).join("\n\n");

      const memoryStats = this.getMemoryStats();
      const statsContext = `[Memory Status: ${memoryStats.totalMessages} messages across ${memoryStats.totalChats} chats, ${memoryStats.knowledgeChunks} knowledge chunks]`;

      const additionalContext = retrievalContext
        ? `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}\n\n${retrievalContext}`
        : `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}`;

      // Hook: prompt:before — run concurrently with context assembly
      const promptEvent: BeforePromptBuildEvent = {
        chatId,
        sessionId: session.sessionId,
        isGroup: effectiveIsGroup,
        additionalContext: "",
      };
      const promptBeforePromise = this.hookRunner
        ? this.hookRunner.runModifyingHook("prompt:before", promptEvent)
        : Promise.resolve();

      await promptBeforePromise;

      // Sanitize hook context to prevent prompt injection (H1 remediation)
      const hookAdditionalContext = sanitizeForContext(promptEvent.additionalContext);

      const compactionConfig = this.compactionManager.getConfig();
      const needsMemoryFlush =
        compactionConfig.enabled &&
        compactionConfig.memoryFlushEnabled &&
        context.messages.length > Math.floor((compactionConfig.maxMessages ?? 200) * 0.75);

      const allHookContext = [userHookContext, hookAdditionalContext, hookMessageContext]
        .filter(Boolean)
        .join("\n\n");
      const finalContext = additionalContext + (allHookContext ? `\n\n${allHookContext}` : "");

      const chatType: "private" | "group" | "channel" = effectiveIsGroup ? "group" : "private";

      const systemPrompt = buildSystemPrompt({
        soul: this.soul,
        userName,
        senderUsername,
        senderId: toolContext?.senderId,
        ownerName: this.config.telegram.owner_name,
        ownerUsername: this.config.telegram.owner_username,
        context: finalContext,
        includeMemory: !effectiveIsGroup,
        includeStrategy: !effectiveIsGroup,
        includeOwnerPersonalFiles: isOwner,
        chatType,
        isOwner,
        memoryFlushWarning: needsMemoryFlush,
        isHeartbeat,
        agentModel: this.config.agent.model,
      });

      // Hook: prompt:after — observing, analytics on prompt size
      if (this.hookRunner) {
        const promptAfterEvent: PromptAfterEvent = {
          chatId,
          sessionId: session.sessionId,
          isGroup: effectiveIsGroup,
          promptLength: systemPrompt.length,
          sectionCount: (systemPrompt.match(/^#{1,3} /gm) || []).length,
          ragContextLength: retrievalContext.length,
          hookContextLength: allHookContext.length,
        };
        await this.hookRunner.runObservingHook("prompt:after", promptAfterEvent);
      }

      const userMsg: UserMessage = {
        role: "user",
        content: formattedMessage,
        timestamp: now,
      };

      context.messages.push(userMsg);

      const preemptiveCompaction = await this.compactionManager.checkAndCompact(
        session.sessionId,
        context,
        getEffectiveApiKey(this.config.agent.provider, this.config.agent.api_key),
        chatId,
        this.config.agent.provider as SupportedProvider,
        this.config.agent.utility_model
      );
      if (preemptiveCompaction) {
        log.info(`🗜️  Preemptive compaction triggered, reloading session...`);
        updateSession(chatId, { sessionId: preemptiveCompaction });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- session guaranteed to exist after compaction
        session = getSession(chatId)!;
        context = loadContextFromTranscript(session.sessionId);
        context.messages.push(userMsg);
      }

      appendToTranscript(session.sessionId, userMsg);

      const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
      const providerMeta = getProviderMetadata(provider);
      const isAdmin =
        toolContext?.config?.telegram.admin_ids.includes(toolContext.senderId) ?? false;

      const tools = await this.selectTools({
        effectiveMessage,
        effectiveIsGroup,
        chatId,
        isAdmin,
        queryEmbedding,
        providerMeta,
      });

      const maxIterations = this.config.agent.max_agentic_iterations || 5;
      let iteration = 0;
      let overflowResets = 0;
      let rateLimitRetries = 0;
      let serverErrorRetries = 0;
      let networkErrorRetries = 0;
      let emptyResponseRetries = 0;
      const EMPTY_RESPONSE_MAX_RETRIES = 3;
      let finalResponse: ChatResponse | null = null;
      const totalToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
      const allToolExecResults: Array<{
        toolName: string;
        result: { success: boolean; data?: unknown; error?: string };
      }> = [];
      const accumulatedTexts: string[] = [];
      const accumulatedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 };
      const loopStallDetector = new LoopStallDetector(LOOP_STALL_CONSECUTIVE_THRESHOLD);

      interface ToolPlan {
        block: ToolCall;
        blocked: boolean;
        blockReason: string;
        params: Record<string, unknown>;
      }
      interface ToolExecResult {
        result: { success: boolean; data?: unknown; error?: string };
        durationMs: number;
        execError?: { message: string; stack?: string };
      }

      while (iteration < maxIterations) {
        iteration++;
        log.debug(`🔄 Agentic iteration ${iteration}/${maxIterations}`);

        // Track where current iteration starts so masking won't truncate its results
        const iterationStartIndex = context.messages.length;

        const maskedMessages = maskOldToolResults(context.messages, {
          toolRegistry: this.toolRegistry ?? undefined,
          currentIterationStartIndex: iterationStartIndex,
        });
        const maskedContext: Context = { ...context, messages: maskedMessages };

        // For complex tool chains, reinforce the "always respond with text" instruction
        // in the system prompt, since LLMs tend to skip text generation when the context
        // is large and tools succeeded.
        let effectiveSystemPrompt = systemPrompt;
        if (totalToolCalls.length >= RESPONSE_REINFORCEMENT_TOOL_CALL_THRESHOLD) {
          effectiveSystemPrompt +=
            "\n\n⚠️ IMPORTANT: You MUST generate a human-readable summary now. " +
            "After all tool executions, always respond with: " +
            "1) Brief confirmation of what was completed, " +
            "2) Key results in plain language, " +
            "3) Any next steps or questions for the user. Never return empty content.";
          log.debug(
            `🔧 Injecting response reinforcement (${totalToolCalls.length} tool calls so far)`
          );
        }

        let response: ChatResponse;
        try {
          response = await chatWithContext(this.config.agent, {
            systemPrompt: effectiveSystemPrompt,
            context: maskedContext,
            sessionId: session.sessionId,
            persistTranscript: true,
            tools,
          });
        } catch (err) {
          if (isNetworkError(err)) {
            networkErrorRetries++;
            if (networkErrorRetries <= NETWORK_ERROR_MAX_RETRIES) {
              const delay = 2000 * Math.pow(2, networkErrorRetries - 1);
              log.warn(
                `🌐 Network error, retrying in ${delay}ms (attempt ${networkErrorRetries}/${NETWORK_ERROR_MAX_RETRIES})...`
              );
              await new Promise((r) => setTimeout(r, delay));
              iteration--;
              continue;
            }
            log.error(
              `🌐 Network error after ${NETWORK_ERROR_MAX_RETRIES} retries: ${(err as Error).message}`
            );
            throw new Error(
              `Network error after ${NETWORK_ERROR_MAX_RETRIES} retries. Please check your connection and try again.`
            );
          }
          throw err;
        }

        const assistantMsg = response.message;
        if (assistantMsg.stopReason === "error") {
          const errorMsg = assistantMsg.errorMessage || "";

          // Hook: response:error — fire on all LLM errors
          if (this.hookRunner) {
            const errorCode =
              errorMsg.includes("429") || errorMsg.toLowerCase().includes("rate")
                ? "RATE_LIMIT"
                : isContextOverflowError(errorMsg)
                  ? "CONTEXT_OVERFLOW"
                  : errorMsg.includes("500") || errorMsg.includes("502") || errorMsg.includes("503")
                    ? "PROVIDER_ERROR"
                    : "UNKNOWN";
            const responseErrorEvent: ResponseErrorEvent = {
              chatId,
              sessionId: session.sessionId,
              isGroup: effectiveIsGroup,
              error: errorMsg,
              errorCode,
              provider: provider,
              model: this.config.agent.model,
              retryCount: rateLimitRetries + serverErrorRetries + networkErrorRetries,
              durationMs: Date.now() - processStartTime,
            };
            await this.hookRunner.runObservingHook("response:error", responseErrorEvent);
          }

          if (isContextOverflowError(errorMsg)) {
            overflowResets++;
            if (overflowResets > 1) {
              throw new Error(
                "Context overflow persists after session reset. Message may be too large for the model's context window."
              );
            }
            log.error(`🚨 Context overflow detected: ${errorMsg}`);

            log.info(`💾 Saving session memory before reset...`);
            const summary = extractContextSummary(context, CONTEXT_OVERFLOW_SUMMARY_MESSAGES);
            appendToDailyLog(summary);
            log.info(`✅ Memory saved to daily log`);

            const archived = archiveTranscript(session.sessionId);
            if (!archived) {
              log.error(
                `⚠️  Failed to archive transcript ${session.sessionId}, proceeding with reset anyway`
              );
            }

            log.info(`🔄 Resetting session due to context overflow...`);
            session = resetSession(chatId);

            context = { messages: [userMsg] };

            appendToTranscript(session.sessionId, userMsg);

            log.info(`🔄 Retrying with fresh context...`);
            continue;
          } else if (errorMsg.toLowerCase().includes("rate") || errorMsg.includes("429")) {
            rateLimitRetries++;
            if (rateLimitRetries <= RATE_LIMIT_MAX_RETRIES) {
              // Respect Retry-After hint from the API if present (e.g. "retry-after: 30")
              const retryAfterMs = parseRetryAfterMs(errorMsg);
              const backoffDelay = Math.min(
                1000 * Math.pow(2, rateLimitRetries - 1),
                RATE_LIMIT_MAX_BACKOFF_MS
              );
              const delay = retryAfterMs ?? backoffDelay;
              log.warn(
                `🚫 Rate limited, retrying in ${delay}ms (attempt ${rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES})...`
              );
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            log.error(`🚫 Rate limited after ${RATE_LIMIT_MAX_RETRIES} retries: ${errorMsg}`);
            throw new Error(
              `API rate limited after ${RATE_LIMIT_MAX_RETRIES} retries. Please try again later.`
            );
          } else if (
            errorMsg.includes("500") ||
            errorMsg.includes("502") ||
            errorMsg.includes("503") ||
            errorMsg.includes("529") ||
            errorMsg.toLowerCase().includes("overloaded") ||
            errorMsg.includes("Internal server error") ||
            errorMsg.includes("api_error")
          ) {
            serverErrorRetries++;
            if (serverErrorRetries <= SERVER_ERROR_MAX_RETRIES) {
              const delay = 2000 * Math.pow(2, serverErrorRetries - 1);
              log.warn(
                `🔄 Server error, retrying in ${delay}ms (attempt ${serverErrorRetries}/${SERVER_ERROR_MAX_RETRIES})...`
              );
              await new Promise((r) => setTimeout(r, delay));
              iteration--;
              continue;
            }
            log.error(`🚨 Server error after ${SERVER_ERROR_MAX_RETRIES} retries: ${errorMsg}`);
            throw new Error(
              `API server error after ${SERVER_ERROR_MAX_RETRIES} retries. The provider may be experiencing issues.`
            );
          } else if (isNetworkErrorMessage(errorMsg)) {
            networkErrorRetries++;
            if (networkErrorRetries <= NETWORK_ERROR_MAX_RETRIES) {
              const delay = 2000 * Math.pow(2, networkErrorRetries - 1);
              log.warn(
                `🌐 Network error, retrying in ${delay}ms (attempt ${networkErrorRetries}/${NETWORK_ERROR_MAX_RETRIES})...`
              );
              await new Promise((r) => setTimeout(r, delay));
              iteration--;
              continue;
            }
            log.error(`🌐 Network error after ${NETWORK_ERROR_MAX_RETRIES} retries: ${errorMsg}`);
            throw new Error(
              `Network error after ${NETWORK_ERROR_MAX_RETRIES} retries. Please check your connection and try again.`
            );
          } else {
            log.error(`🚨 API error: ${errorMsg}`);
            throw new Error(`API error: ${errorMsg || "Unknown error"}`);
          }
        }

        // Accumulate usage across all iterations
        const iterUsage = response.message.usage;
        if (iterUsage) {
          accumulatedUsage.input += iterUsage.input;
          accumulatedUsage.output += iterUsage.output;
          accumulatedUsage.cacheRead += iterUsage.cacheRead ?? 0;
          accumulatedUsage.cacheWrite += iterUsage.cacheWrite ?? 0;
          accumulatedUsage.totalCost += iterUsage.cost?.total ?? 0;
        }

        if (response.text) {
          accumulatedTexts.push(response.text);
        }

        const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

        if (toolCalls.length === 0) {
          // Detect empty response with zero tokens — retry the whole loop rather than giving up
          const hasTokens = !!(response.message.usage?.input || response.message.usage?.output);
          const hasText = !!response.text;
          if (!hasText && !hasTokens && emptyResponseRetries < EMPTY_RESPONSE_MAX_RETRIES) {
            emptyResponseRetries++;
            const delay = 2000 * emptyResponseRetries;
            log.warn(
              `⚠️ Empty response with zero tokens - retrying in ${delay}ms (attempt ${emptyResponseRetries}/${EMPTY_RESPONSE_MAX_RETRIES})...`
            );
            await new Promise((r) => setTimeout(r, delay));
            iteration--;
            continue;
          }
          log.info(`🔄 ${iteration}/${maxIterations} → done`);
          finalResponse = response;
          break;
        }

        if (!this.toolRegistry || !toolContext) {
          log.error("⚠️ Cannot execute tools: registry or context missing");
          break;
        }

        log.debug(`🔧 Executing ${toolCalls.length} tool call(s)`);

        context.messages.push(response.message);

        const iterationToolNames: string[] = [];

        const fullContext: ToolContext = {
          ...toolContext,
          chatId,
          isGroup: effectiveIsGroup,
        };

        // Phase 1: Run tool:before hooks sequentially (hooks may cross-reference)
        const toolPlans: ToolPlan[] = [];

        for (const block of toolCalls) {
          if (block.type !== "toolCall") continue;

          let toolParams = (block.arguments ?? {}) as Record<string, unknown>;
          let blocked = false;
          let blockReason = "";

          if (this.hookRunner) {
            const beforeEvent: BeforeToolCallEvent = {
              toolName: block.name,
              params: structuredClone(toolParams),
              chatId,
              isGroup: effectiveIsGroup,
              block: false,
              blockReason: "",
            };
            await this.hookRunner.runModifyingHook("tool:before", beforeEvent);
            if (beforeEvent.block) {
              blocked = true;
              blockReason = beforeEvent.blockReason || "Blocked by plugin hook";
            } else {
              toolParams = structuredClone(beforeEvent.params) as Record<string, unknown>;
            }
          }

          toolPlans.push({ block, blocked, blockReason, params: toolParams });
        }

        // Phase 2: Execute tools with concurrency limit (blocked tools resolve instantly)
        const execResults: ToolExecResult[] = new Array(toolPlans.length);
        {
          let cursor = 0;
          const runWorker = async (): Promise<void> => {
            while (cursor < toolPlans.length) {
              const idx = cursor++;
              const plan = toolPlans[idx];

              if (plan.blocked) {
                execResults[idx] = {
                  result: { success: false, error: plan.blockReason },
                  durationMs: 0,
                };
                continue;
              }

              const startTime = Date.now();
              try {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- registry checked at line 687
                const result = await this.toolRegistry!.execute(
                  { ...plan.block, arguments: plan.params },
                  fullContext
                );
                execResults[idx] = { result, durationMs: Date.now() - startTime };
              } catch (execErr) {
                const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
                const errStack = execErr instanceof Error ? execErr.stack : undefined;
                execResults[idx] = {
                  result: { success: false, error: errMsg },
                  durationMs: Date.now() - startTime,
                  execError: { message: errMsg, stack: errStack },
                };
              }
            }
          };
          const workers = Math.min(TOOL_CONCURRENCY_LIMIT, toolPlans.length);
          await Promise.all(Array.from({ length: workers }, () => runWorker()));
        }

        // Phase 3: Process results in original order (hooks, context, transcript)
        // Collect observing hook promises to fire concurrently via Promise.allSettled
        const observingHookPromises: Promise<void>[] = [];

        for (let i = 0; i < toolPlans.length; i++) {
          const plan = toolPlans[i];
          const { block } = plan;
          const exec = execResults[i];

          // Hook: tool:error (if execution threw) — fire concurrently
          if (exec.execError && this.hookRunner) {
            const errorEvent: ToolErrorEvent = {
              toolName: block.name,
              params: structuredClone(plan.params),
              error: exec.execError.message,
              stack: exec.execError.stack,
              chatId,
              isGroup: effectiveIsGroup,
              durationMs: exec.durationMs,
            };
            observingHookPromises.push(
              this.hookRunner.runObservingHook("tool:error", errorEvent).catch((err) => {
                log.warn({ err }, "tool:error hook failed");
              })
            );
          }

          // Hook: tool:after (fires for all cases including blocks) — fire concurrently
          if (this.hookRunner) {
            const afterEvent: AfterToolCallEvent = {
              toolName: block.name,
              params: structuredClone(plan.params),
              result: {
                success: exec.result.success,
                data: exec.result.data,
                error: exec.result.error,
              },
              durationMs: exec.durationMs,
              chatId,
              isGroup: effectiveIsGroup,
              ...(plan.blocked ? { blocked: true, blockReason: plan.blockReason } : {}),
            };
            observingHookPromises.push(
              this.hookRunner.runObservingHook("tool:after", afterEvent).catch((err) => {
                log.warn({ err }, "tool:after hook failed");
              })
            );
          }

          // Record tool invocation metric (skipped for blocked tools)
          if (!plan.blocked) {
            getMetrics()?.recordToolCall(block.name);
          }

          const toolHint = summarizeToolParams(block.name, plan.params);
          log.debug(`${block.name}: ${exec.result.success ? "✓" : "✗"} ${exec.result.error || ""}`);
          iterationToolNames.push(`${block.name}${toolHint} ${exec.result.success ? "✓" : "✗"}`);

          totalToolCalls.push({
            name: block.name,
            input: block.arguments,
          });
          allToolExecResults.push({ toolName: block.name, result: exec.result });

          const resultText = truncateToolResult(exec.result, MAX_TOOL_RESULT_SIZE);
          if (resultText.includes('"_truncated":true')) {
            log.warn(`⚠️ Tool result too large, truncated to ${resultText.length} chars`);
          }

          if (provider === "cocoon") {
            const { wrapToolResult } = await import("../cocoon/tool-adapter.js");
            const cocoonResultMsg: UserMessage = {
              role: "user",
              content: [
                {
                  type: "text",
                  text: wrapToolResult(resultText),
                },
              ],
              timestamp: Date.now(),
            };
            context.messages.push(cocoonResultMsg);
            appendToTranscript(session.sessionId, cocoonResultMsg);
          } else {
            const toolResultMsg: ToolResultMessage = {
              role: "toolResult",
              toolCallId: block.id,
              toolName: block.name,
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
              isError: !exec.result.success,
              timestamp: Date.now(),
            };
            context.messages.push(toolResultMsg);
            appendToTranscript(session.sessionId, toolResultMsg);
          }
        }

        // Await all observing hooks concurrently
        await Promise.allSettled(observingHookPromises);

        log.info(`🔄 ${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

        // Stall detection: break early only when the exact same set of tool calls
        // repeats LOOP_STALL_CONSECUTIVE_THRESHOLD times in a row. A single repeat
        // is normal (transient error retry, legitimate re-read after a write); only
        // persistent consecutive repetition indicates a genuine infinite loop.
        const iterSignatures = toolPlans.map(
          (p) => `${p.block.name}:${JSON.stringify(p.params, Object.keys(p.params).sort())}`
        );

        if (loopStallDetector.record(iterSignatures)) {
          log.warn(
            `🔁 Loop stall detected: identical tool call(s) [${iterSignatures.join(", ")}] repeated ${LOOP_STALL_CONSECUTIVE_THRESHOLD} times consecutively — breaking early`
          );
          finalResponse = response;
          break;
        }

        if (iteration === maxIterations) {
          log.info(`⚠️ Max iterations reached (${maxIterations})`);
          finalResponse = response;
        }
      }

      if (!finalResponse) {
        log.error("⚠️ Agentic loop exited early without final response");
        return {
          content: "Internal error: Agent loop failed to produce a response.",
          toolCalls: [],
        };
      }

      const response = finalResponse;

      const lastMsg = context.messages[context.messages.length - 1];
      if (lastMsg?.role !== "assistant") {
        context.messages.push(response.message);
      }

      // Post-loop compaction deferred: the pre-loop check at the start of the next
      // processMessage() will handle it, avoiding AI summarization latency on response delivery.

      const sessionUpdate: Parameters<typeof updateSession>[1] = {
        updatedAt: Date.now(),
        messageCount: session.messageCount + 1,
        model: this.config.agent.model,
        provider: this.config.agent.provider,
        inputTokens:
          (session.inputTokens ?? 0) +
          accumulatedUsage.input +
          accumulatedUsage.cacheRead +
          accumulatedUsage.cacheWrite,
        outputTokens: (session.outputTokens ?? 0) + accumulatedUsage.output,
      };
      updateSession(chatId, sessionUpdate);

      if (accumulatedUsage.input > 0 || accumulatedUsage.output > 0) {
        const u = accumulatedUsage;
        const totalInput = u.input + u.cacheRead + u.cacheWrite;
        const inK = (totalInput / 1000).toFixed(1);
        const cacheParts: string[] = [];
        if (u.cacheRead) cacheParts.push(`${(u.cacheRead / 1000).toFixed(1)}K cached`);
        if (u.cacheWrite) cacheParts.push(`${(u.cacheWrite / 1000).toFixed(1)}K new`);
        const cacheInfo = cacheParts.length > 0 ? ` (${cacheParts.join(", ")})` : "";
        log.info(`💰 ${inK}K in${cacheInfo}, ${u.output} out | $${u.totalCost.toFixed(3)}`);

        accumulateTokenUsage(u);
      }

      let content = accumulatedTexts.join("\n").trim() || response.text;

      const usedTelegramSendTool = totalToolCalls.some((tc) => TELEGRAM_SEND_TOOLS.has(tc.name));

      if (!content && accumulatedUsage.input === 0 && accumulatedUsage.output === 0) {
        log.warn("⚠️ Empty response with zero tokens - possible API issue");
        content = "I couldn't process your request. Please try again.";
      } else if (!content && usedTelegramSendTool) {
        log.info("✅ Response sent via Telegram tool - no additional text needed");
        content = "";
      } else if (!content && totalToolCalls.length > 0) {
        log.warn("⚠️ Empty response after tool calls - generating fallback");
        content = generateToolSummary(allToolExecResults);
        log.info(`✅ Generated fallback summary from ${allToolExecResults.length} tool result(s)`);
      }

      // Hook: response:before — plugins can mutate or block the response text
      let responseMetadata: Record<string, unknown> = {};
      if (this.hookRunner) {
        const responseBeforeEvent: ResponseBeforeEvent = {
          chatId,
          sessionId: session.sessionId,
          isGroup: effectiveIsGroup,
          originalText: content,
          text: content,
          block: false,
          blockReason: "",
          metadata: {},
        };
        await this.hookRunner.runModifyingHook("response:before", responseBeforeEvent);
        if (responseBeforeEvent.block) {
          log.info(
            `🚫 Response blocked by hook: ${responseBeforeEvent.blockReason || "no reason"}`
          );
          content = "";
        } else {
          content = responseBeforeEvent.text;
        }
        responseMetadata = responseBeforeEvent.metadata;
      }

      // Hook: response:after — analytics, billing, feedback
      if (this.hookRunner) {
        const responseAfterEvent: ResponseAfterEvent = {
          chatId,
          sessionId: session.sessionId,
          isGroup: effectiveIsGroup,
          text: content,
          durationMs: Date.now() - processStartTime,
          toolsUsed: totalToolCalls.map((tc) => tc.name),
          tokenUsage:
            accumulatedUsage.input > 0 || accumulatedUsage.output > 0
              ? { input: accumulatedUsage.input, output: accumulatedUsage.output }
              : undefined,
          metadata: responseMetadata,
        };
        await this.hookRunner.runObservingHook("response:after", responseAfterEvent);
      }

      // Record overall request metric for the Analytics performance dashboard
      getAnalytics()?.recordRequestMetric({
        durationMs: Date.now() - processStartTime,
        tokensUsed:
          accumulatedUsage.input +
          accumulatedUsage.output +
          accumulatedUsage.cacheRead +
          accumulatedUsage.cacheWrite,
        success: true,
      });

      await this.indexMemoryGraphTurn({
        chatId,
        sessionId: session.sessionId,
        userName,
        userMessage: effectiveMessage,
        assistantMessage: content,
        toolCalls: totalToolCalls,
        timestamp: now,
      });

      return {
        content,
        toolCalls: totalToolCalls,
      };
    } catch (error) {
      // Record failed request metric
      getAnalytics()?.recordRequestMetric({
        durationMs: Date.now() - processStartTime,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      log.error({ err: error }, "Agent error");
      throw error;
    }
  }

  /**
   * Build enriched query embedding from the current message and recent conversation history.
   * Returns undefined if no embedder is configured or the message is trivial.
   */
  private async computeQueryEmbedding(
    effectiveMessage: string,
    contextMessages: Context["messages"]
  ): Promise<number[] | undefined> {
    if (!this.embedder || isTrivialMessage(effectiveMessage)) return undefined;

    let searchQuery = effectiveMessage;
    const recentUserMsgs = contextMessages
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .slice(-RAG_QUERY_RECENT_MESSAGES)
      .map((m) => {
        const text = m.content as string;
        const bodyMatch = text.match(/\] (.+)/s);
        return (bodyMatch ? bodyMatch[1] : text).trim();
      })
      .filter((t) => t.length > 0);
    if (recentUserMsgs.length > 0) {
      searchQuery = recentUserMsgs.join(" ") + " " + effectiveMessage;
    }

    return this.embedder.embedQuery(searchQuery.slice(0, EMBEDDING_QUERY_MAX_CHARS));
  }

  /**
   * Fetch and assemble RAG context (relevant knowledge + feed history) for the given message.
   * Returns an empty string when RAG is unavailable or the message is trivial.
   */
  private async buildRagContext(opts: {
    effectiveMessage: string;
    chatId: string;
    isGroup: boolean;
    isOwner: boolean;
    queryEmbedding: number[] | undefined;
    maxRagChars: number | undefined;
  }): Promise<string> {
    const { effectiveMessage, chatId, isGroup, isOwner, queryEmbedding, maxRagChars } = opts;

    if (!this.contextBuilder || isTrivialMessage(effectiveMessage)) return "";

    let relevantContext = "";
    try {
      const dbContext = await this.contextBuilder.buildContext({
        query: effectiveMessage,
        chatId,
        includeAgentMemory: isOwner,
        includeFeedHistory: isOwner,
        searchAllChats: !isGroup,
        maxRecentMessages: CONTEXT_MAX_RECENT_MESSAGES,
        maxRelevantChunks: CONTEXT_MAX_RELEVANT_CHUNKS,
        queryEmbedding,
      });

      const contextParts: string[] = [];

      if (dbContext.relevantKnowledge.length > 0) {
        const sanitizedKnowledge = dbContext.relevantKnowledge.map((chunk) =>
          sanitizeForContext(chunk)
        );
        contextParts.push(
          `[Relevant knowledge from memory]\n${sanitizedKnowledge.join("\n---\n")}`
        );
      }

      if (dbContext.relevantFeed.length > 0) {
        const sanitizedFeed = dbContext.relevantFeed.map((msg) => sanitizeForContext(msg));
        contextParts.push(`[Relevant messages from Telegram feed]\n${sanitizedFeed.join("\n")}`);
      }

      if (contextParts.length > 0) {
        relevantContext = contextParts.join("\n\n");
        log.info(
          `🔍 RAG context: ${dbContext.relevantKnowledge.length} knowledge chunks, ${dbContext.relevantFeed.length} feed messages (${relevantContext.length} chars, ~${Math.ceil(relevantContext.length / 4)} tokens)`
        );
      }
    } catch (error) {
      log.warn({ err: error }, "Context building failed");
    }

    // Trim to configured budget to reduce token cost and response latency
    if (maxRagChars !== undefined && relevantContext.length > maxRagChars) {
      log.info(
        `✂️  RAG context trimmed: ${relevantContext.length} → ${maxRagChars} chars (max_rag_chars limit)`
      );
    }
    return trimRagContext(relevantContext, maxRagChars);
  }

  /**
   * Fetch structured graph context related to the current message.
   * Owner-only to avoid leaking memory from other chats into group or non-owner replies.
   */
  private async buildGraphContext(opts: {
    effectiveMessage: string;
    isOwner: boolean;
    maxGraphChars: number;
  }): Promise<string> {
    const { effectiveMessage, isOwner, maxGraphChars } = opts;
    if (!isOwner || isTrivialMessage(effectiveMessage)) return "";

    try {
      const terms = EntityExtractor.extractSearchTerms(effectiveMessage, 8);
      if (terms.length === 0) return "";

      const store = new MemoryGraphStore(getDatabase().getDb());
      const graphQuery = new MemoryGraphQuery(store);
      const seeds = store.findNodesByTerms(terms, { limit: 5 });
      if (seeds.length === 0) return "";

      const lines: string[] = [];
      const seenEdges = new Set<string>();

      for (const seed of seeds) {
        const related = graphQuery.getRelated(seed.id, { depth: 1, limit: 20 });
        const nodeById = new Map(related.nodes.map((node) => [node.id, node]));
        for (const edge of related.edges) {
          if (seenEdges.has(edge.id)) continue;
          const source = nodeById.get(edge.sourceId);
          const target = nodeById.get(edge.targetId);
          if (!source || !target) continue;
          seenEdges.add(edge.id);
          lines.push(
            `- [${source.type}] ${sanitizeForContext(source.label)} --${edge.relation}-> [${target.type}] ${sanitizeForContext(target.label)}`
          );
          if (lines.length >= 16) break;
        }
        if (lines.length >= 16) break;
      }

      if (lines.length === 0) return "";
      const context = `[Related knowledge graph]\n${lines.join("\n")}`;
      log.info(`Graph context: ${lines.length} relationship(s)`);
      return trimRagContext(context, maxGraphChars);
    } catch (error) {
      log.warn({ err: error }, "Graph context building failed");
      return "";
    }
  }

  private async indexMemoryGraphTurn(turn: {
    chatId: string;
    sessionId: string;
    userName?: string;
    userMessage: string;
    assistantMessage: string;
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    timestamp: number;
  }): Promise<void> {
    try {
      const store = new MemoryGraphStore(getDatabase().getDb());
      const graph = await this.entityExtractor.extractAndPersistTurn(store, turn);
      log.debug(`Indexed graph turn: ${graph.nodes.length} node(s), ${graph.edges.length} edge(s)`);
    } catch (error) {
      log.warn({ err: error }, "Memory graph extraction failed");
    }
  }

  /**
   * Select tools for the current request using RAG or full registry based on config.
   */
  private async selectTools(opts: {
    effectiveMessage: string;
    effectiveIsGroup: boolean;
    chatId: string;
    isAdmin: boolean;
    queryEmbedding: number[] | undefined;
    providerMeta: ReturnType<typeof getProviderMetadata>;
  }): Promise<PiAiTool[] | undefined> {
    const { effectiveMessage, effectiveIsGroup, chatId, isAdmin, queryEmbedding, providerMeta } =
      opts;

    if (!this.toolRegistry) return undefined;

    const toolIndex = this.toolRegistry.getToolIndex();
    const useRAG =
      toolIndex?.isIndexed &&
      this.config.tool_rag?.enabled !== false &&
      !isTrivialMessage(effectiveMessage) &&
      !(
        providerMeta.toolLimit === null && this.config.tool_rag?.skip_unlimited_providers !== false
      );

    if (useRAG && queryEmbedding) {
      const tools = await this.toolRegistry.getForContextWithRAG(
        effectiveMessage,
        queryEmbedding,
        effectiveIsGroup,
        providerMeta.toolLimit,
        chatId,
        isAdmin
      );
      log.info(`🔍 Tool RAG: ${tools.length}/${this.toolRegistry.count} tools selected`);
      return tools;
    }

    return this.toolRegistry.getForContext(
      effectiveIsGroup,
      providerMeta.toolLimit,
      chatId,
      isAdmin
    );
  }

  clearHistory(chatId: string): void {
    const db = getDatabase().getDb();

    db.prepare(
      `DELETE FROM tg_messages_vec WHERE id IN (
        SELECT id FROM tg_messages WHERE chat_id = ?
      )`
    ).run(chatId);

    db.prepare(`DELETE FROM tg_messages WHERE chat_id = ?`).run(chatId);

    resetSession(chatId);

    log.info(`🗑️  Cleared history for chat ${chatId}`);
  }

  getConfig(): Config {
    return this.config;
  }

  getActiveChatIds(): string[] {
    const db = getDatabase().getDb();

    const rows = db
      .prepare(
        `
      SELECT DISTINCT chat_id
      FROM tg_messages
      ORDER BY timestamp DESC
    `
      )
      .all() as Array<{ chat_id: string }>;

    return rows.map((r) => r.chat_id);
  }

  setSoul(soul: string): void {
    this.soul = soul;
  }

  configureCompaction(config: {
    enabled?: boolean;
    maxMessages?: number;
    maxTokens?: number;
  }): void {
    this.compactionManager.updateConfig(config);
    log.info({ config: this.compactionManager.getConfig() }, `🗜️  Compaction config updated`);
  }

  getCompactionConfig() {
    return this.compactionManager.getConfig();
  }

  private _memoryStatsCache: {
    data: { totalMessages: number; totalChats: number; knowledgeChunks: number };
    expiry: number;
  } | null = null;

  /** Threshold above which memory pressure is logged. Adjust via config if needed. */
  private static readonly MEMORY_PRESSURE_HEAP_MB = 512;

  getMemoryStats(): { totalMessages: number; totalChats: number; knowledgeChunks: number } {
    const now = Date.now();

    // Invalidate cache under memory pressure so callers get fresh data
    if (this._memoryStatsCache) {
      const heapMB = process.memoryUsage().heapUsed / (1024 * 1024);
      if (heapMB > AgentRuntime.MEMORY_PRESSURE_HEAP_MB) {
        log.warn(
          { heapMB: Math.round(heapMB) },
          "Memory pressure detected — invalidating stats cache"
        );
        this._memoryStatsCache = null;
      }
    }

    if (this._memoryStatsCache && now < this._memoryStatsCache.expiry) {
      return this._memoryStatsCache.data;
    }

    const db = getDatabase().getDb();

    const msgCount = db.prepare(`SELECT COUNT(*) as count FROM tg_messages`).get() as {
      count: number;
    };
    const chatCount = db
      .prepare(`SELECT COUNT(DISTINCT chat_id) as count FROM tg_messages`)
      .get() as {
      count: number;
    };
    const knowledgeCount = db.prepare(`SELECT COUNT(*) as count FROM knowledge`).get() as {
      count: number;
    };

    const data = {
      totalMessages: msgCount.count,
      totalChats: chatCount.count,
      knowledgeChunks: knowledgeCount.count,
    };

    this._memoryStatsCache = { data, expiry: now + MEMORY_STATS_CACHE_TTL_MS };
    return data;
  }
}
