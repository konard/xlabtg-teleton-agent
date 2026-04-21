import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { HybridSearch } from "../../../../memory/search/hybrid.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface MemorySearchParams {
  query: string;
  limit?: number;
}

export const memorySearchTool: Tool = {
  name: "memory_search",
  description:
    "Search your memory (knowledge chunks, ingested files) using semantic vector and keyword search. " +
    "Returns the most relevant results with source paths. " +
    "Use this to recall facts, prior conversations, or ingested documents.",
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.String({
      description: "The search query — keywords or a natural-language question.",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of results to return (default: 5, max: 20).",
        minimum: 1,
        maximum: 20,
      })
    ),
  }),
};

export const memorySearchExecutor: ToolExecutor<MemorySearchParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { query } = params;
    const limit = Math.min(params.limit ?? 5, 20);

    let queryEmbedding: number[] = [];
    const semanticMemory = context.semanticMemory;
    const shouldEmbed =
      semanticMemory && (semanticMemory.vectorEnabled || semanticMemory.vectorStore?.isConfigured);
    if (shouldEmbed) {
      try {
        queryEmbedding = await semanticMemory.embedder.embedQuery(query);
      } catch (error) {
        log.warn({ err: error }, "Memory search embedding failed; using keyword fallback");
      }
    }

    const search = new HybridSearch(
      context.db,
      semanticMemory?.vectorEnabled ?? false,
      semanticMemory?.vectorStore
    );
    const results = await search.searchKnowledge(query, queryEmbedding, { limit });

    if (results.length === 0) {
      return {
        success: true,
        data: { results: [], message: "No matching knowledge found." },
      };
    }

    return {
      success: true,
      data: {
        query,
        count: results.length,
        results: results.map((r) => ({
          text: r.text,
          source: r.source,
          score: Math.round(r.score * 1000) / 1000,
        })),
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error searching memory");
    return { success: false, error: getErrorMessage(error) };
  }
};
