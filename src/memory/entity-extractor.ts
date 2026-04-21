import type {
  MemoryGraph,
  MemoryGraphMetadata,
  MemoryGraphNodeType,
  MemoryGraphStore,
} from "./graph-store.js";
import { normalizeGraphLabel } from "./graph-store.js";

export interface AgentTurnForExtraction {
  chatId: string;
  sessionId: string;
  userName?: string;
  userMessage: string;
  assistantMessage: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  timestamp: number;
}

export interface ExtractedGraphNode {
  ref: string;
  type: MemoryGraphNodeType;
  label: string;
  metadata?: MemoryGraphMetadata;
}

export interface ExtractedGraphEdge {
  sourceRef: string;
  targetRef: string;
  relation: string;
  weight?: number;
}

export interface ExtractedMemoryGraph {
  nodes: ExtractedGraphNode[];
  edges: ExtractedGraphEdge[];
}

export type LlmEntityExtractor = (prompt: string) => Promise<unknown>;

export interface EntityExtractorOptions {
  enableLlm?: boolean;
  llmExtractor?: LlmEntityExtractor;
  maxTopics?: number;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "can",
  "could",
  "did",
  "does",
  "done",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "just",
  "let",
  "make",
  "need",
  "now",
  "our",
  "please",
  "that",
  "the",
  "then",
  "there",
  "this",
  "use",
  "used",
  "using",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
]);

function truncateLabel(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 1).trimEnd() + "...";
}

function stripEntities(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>)"']+/gi, " ")
    .replace(/@[A-Za-z0-9_]{3,}/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
}

function cleanEntity(value: string): string {
  return value.replace(/[),.;:!?]+$/g, "");
}

function uniquePush(values: string[], value: string): void {
  const normalized = normalizeGraphLabel(value);
  if (!normalized || values.some((existing) => normalizeGraphLabel(existing) === normalized))
    return;
  values.push(value);
}

function extractCommonEntities(text: string): Array<{ label: string; entityType: string }> {
  const entities: Array<{ label: string; entityType: string }> = [];

  for (const match of text.matchAll(/https?:\/\/[^\s<>)"']+/gi)) {
    entities.push({ label: cleanEntity(match[0]), entityType: "url" });
  }
  for (const match of text.matchAll(/@[A-Za-z0-9_]{3,}/g)) {
    entities.push({ label: match[0], entityType: "mention" });
  }
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    entities.push({ label: match[0], entityType: "date" });
  }
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g)) {
    const label = match[0].trim();
    if (label.length > 2 && !["I", "Please", "The", "This"].includes(label)) {
      entities.push({ label, entityType: "name" });
    }
  }

  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.entityType}:${normalizeGraphLabel(entity.label)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractTopics(text: string, maxTopics: number): string[] {
  const topics: string[] = [];

  for (const match of text.matchAll(/#([A-Za-z][A-Za-z0-9_-]{2,})/g)) {
    uniquePush(topics, match[1].replace(/[-_]+/g, " "));
  }

  const tokens = stripEntities(text)
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g);
  if (!tokens) return topics.slice(0, maxTopics);

  const filtered = tokens.filter((token) => !STOP_WORDS.has(token));
  const scores = new Map<string, number>();
  for (const token of filtered) {
    scores.set(token, (scores.get(token) ?? 0) + 1);
  }
  for (let i = 0; i < filtered.length - 1; i++) {
    const left = filtered[i];
    const right = filtered[i + 1];
    if (left !== right) {
      const phrase = `${left} ${right}`;
      scores.set(phrase, (scores.get(phrase) ?? 0) + 2);
    }
  }

  const ranked = [...scores.entries()]
    .filter(([topic]) => topic.length >= 3)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([topic]) => topic);

  for (const topic of ranked) {
    uniquePush(topics, topic);
    if (topics.length >= maxTopics) break;
  }

  return topics;
}

function parseLlmGraph(raw: unknown): ExtractedMemoryGraph | null {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object") return null;
  const graph = value as {
    nodes?: Array<Partial<ExtractedGraphNode>>;
    edges?: Array<Partial<ExtractedGraphEdge>>;
  };
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;

  const nodes: ExtractedGraphNode[] = [];
  for (const node of graph.nodes) {
    if (
      typeof node.ref === "string" &&
      typeof node.type === "string" &&
      typeof node.label === "string"
    ) {
      nodes.push({
        ref: node.ref,
        type: node.type as MemoryGraphNodeType,
        label: node.label,
        metadata:
          node.metadata && typeof node.metadata === "object"
            ? (node.metadata as MemoryGraphMetadata)
            : undefined,
      });
    }
  }

  const edges: ExtractedGraphEdge[] = [];
  for (const edge of graph.edges) {
    if (
      typeof edge.sourceRef === "string" &&
      typeof edge.targetRef === "string" &&
      typeof edge.relation === "string"
    ) {
      edges.push({
        sourceRef: edge.sourceRef,
        targetRef: edge.targetRef,
        relation: edge.relation,
        weight: typeof edge.weight === "number" ? edge.weight : undefined,
      });
    }
  }

  return nodes.length > 0 ? { nodes, edges } : null;
}

export class EntityExtractor {
  constructor(private options: EntityExtractorOptions = {}) {}

  static buildExtractionPrompt(turn: AgentTurnForExtraction): string {
    return [
      "Extract an associative memory graph from this agent turn.",
      "Return only JSON with nodes and relationships.",
      "Allowed node types: conversation, task, tool, topic, entity, outcome.",
      "Extract entities, topics, tool invocations, tasks, outcomes, and relationships.",
      "Allowed relationships: USED_TOOL, PRODUCED, ABOUT, RELATED_TO, MENTIONED_IN.",
      "Use stable short refs inside this JSON. Include metadata only when it is useful.",
      "",
      "JSON shape:",
      '{"nodes":[{"ref":"conversation","type":"conversation","label":"...","metadata":{}}],"edges":[{"sourceRef":"conversation","targetRef":"topic:memory","relation":"ABOUT","weight":1}]}',
      "",
      `Chat ID: ${turn.chatId}`,
      `Session ID: ${turn.sessionId}`,
      `User: ${turn.userName ?? "unknown"}`,
      `Timestamp: ${turn.timestamp}`,
      `User message: ${turn.userMessage}`,
      `Assistant message: ${turn.assistantMessage}`,
      `Tool calls: ${JSON.stringify(turn.toolCalls)}`,
    ].join("\n");
  }

  static extractSearchTerms(text: string, maxTerms = 8): string[] {
    const entities = extractCommonEntities(text).map((entity) => entity.label);
    const topics = extractTopics(text, maxTerms);
    const terms: string[] = [];
    for (const value of [...entities, ...topics]) {
      uniquePush(terms, value);
      if (terms.length >= maxTerms) break;
    }
    return terms;
  }

  async extractTurn(turn: AgentTurnForExtraction): Promise<ExtractedMemoryGraph> {
    if (this.options.enableLlm && this.options.llmExtractor) {
      try {
        const prompt = EntityExtractor.buildExtractionPrompt(turn);
        const extracted = parseLlmGraph(await this.options.llmExtractor(prompt));
        if (extracted) return extracted;
      } catch {
        // Fall through to deterministic extraction.
      }
    }

    return this.extractWithFallback(turn);
  }

  async extractAndPersistTurn(
    store: MemoryGraphStore,
    turn: AgentTurnForExtraction
  ): Promise<MemoryGraph> {
    const extracted = await this.extractTurn(turn);
    const refToId = new Map<string, string>();
    const nodes = [];
    const edges = [];

    for (const node of extracted.nodes) {
      const stored = store.upsertNode({
        type: node.type,
        label: node.label,
        metadata: node.metadata,
      });
      refToId.set(node.ref, stored.id);
      nodes.push(stored);
    }

    for (const edge of extracted.edges) {
      const sourceId = refToId.get(edge.sourceRef);
      const targetId = refToId.get(edge.targetRef);
      if (!sourceId || !targetId || sourceId === targetId) continue;
      edges.push(
        store.upsertEdge({
          sourceId,
          targetId,
          relation: edge.relation,
          weight: edge.weight,
        })
      );
    }

    return { nodes, edges };
  }

  private extractWithFallback(turn: AgentTurnForExtraction): ExtractedMemoryGraph {
    const nodes = new Map<string, ExtractedGraphNode>();
    const edges: ExtractedGraphEdge[] = [];
    const maxTopics = this.options.maxTopics ?? 6;
    const combinedText = `${turn.userMessage}\n${turn.assistantMessage}`;

    const addNode = (
      ref: string,
      type: MemoryGraphNodeType,
      label: string,
      metadata?: MemoryGraphMetadata
    ) => {
      const key = `${type}:${normalizeGraphLabel(label)}`;
      if (!nodes.has(key)) {
        nodes.set(key, { ref, type, label, metadata });
      }
      return nodes.get(key)?.ref ?? ref;
    };

    const addEdge = (sourceRef: string, targetRef: string, relation: string, weight = 1) => {
      if (sourceRef === targetRef) return;
      const key = `${sourceRef}:${targetRef}:${relation}`;
      if (edges.some((edge) => `${edge.sourceRef}:${edge.targetRef}:${edge.relation}` === key)) {
        return;
      }
      edges.push({ sourceRef, targetRef, relation, weight });
    };

    const conversationRef = addNode(
      "conversation",
      "conversation",
      `Telegram chat ${turn.chatId}`,
      {
        chatId: turn.chatId,
        sessionId: turn.sessionId,
        source: "telegram",
        lastTurnAt: turn.timestamp,
      }
    );

    let taskRef: string | null = null;
    if (turn.userMessage.trim().length > 0) {
      taskRef = addNode("task", "task", truncateLabel(turn.userMessage), {
        chatId: turn.chatId,
        sessionId: turn.sessionId,
        createdFrom: "user_message",
      });
      addEdge(conversationRef, taskRef, "ABOUT", 1);
    }

    if (turn.assistantMessage.trim().length > 0 && taskRef) {
      const outcomeRef = addNode("outcome", "outcome", truncateLabel(turn.assistantMessage), {
        chatId: turn.chatId,
        sessionId: turn.sessionId,
      });
      addEdge(taskRef, outcomeRef, "PRODUCED", 1);
    }

    for (const toolCall of turn.toolCalls) {
      const toolRef = addNode(`tool:${toolCall.name}`, "tool", toolCall.name, {
        lastInput: toolCall.input,
        lastUsedAt: turn.timestamp,
      });
      addEdge(conversationRef, toolRef, "USED_TOOL", 1);
    }

    for (const topic of extractTopics(combinedText, maxTopics)) {
      const topicRef = addNode(`topic:${topic}`, "topic", topic, {
        extractedBy: "fallback",
      });
      addEdge(conversationRef, topicRef, "ABOUT", 0.6);
    }

    for (const entity of extractCommonEntities(combinedText)) {
      const entityRef = addNode(`entity:${entity.label}`, "entity", entity.label, {
        entityType: entity.entityType,
        extractedBy: "fallback",
      });
      addEdge(entityRef, conversationRef, "MENTIONED_IN", 0.8);
    }

    return {
      nodes: [...nodes.values()],
      edges,
    };
  }
}
