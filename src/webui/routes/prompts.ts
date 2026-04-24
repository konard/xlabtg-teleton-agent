import { Hono } from "hono";
import type { Context } from "hono";
import type { APIResponse, WebUIServerDeps } from "../types.js";
import { FeedbackAnalyzer } from "../../services/feedback/analyzer.js";
import {
  PromptABTesting,
  PromptOptimizer,
  PromptVariantManager,
  assertPromptSection,
  type PromptMetricInput,
  type PromptSectionId,
} from "../../services/prompts/index.js";
import { getErrorMessage } from "../../utils/errors.js";

type ErrorStatus = 400 | 404 | 500;

function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}

function parseSection(c: Context): PromptSectionId {
  const section = c.req.param("section");
  if (!section) throw new Error("section is required");
  assertPromptSection(section);
  return section;
}

function statusForError(error: unknown): ErrorStatus {
  const message = getErrorMessage(error);
  if (message.includes("not found")) return 404;
  if (
    message.includes("Invalid") ||
    message.includes("required") ||
    message.includes("must") ||
    message.includes("exceeds")
  ) {
    return 400;
  }
  return 500;
}

function metricInputFromBody(body: Record<string, unknown>): PromptMetricInput {
  return {
    rating: typeof body.rating === "number" ? body.rating : null,
    taskSuccess: typeof body.taskSuccess === "boolean" ? body.taskSuccess : null,
    responseQualityScore:
      typeof body.responseQualityScore === "number" ? body.responseQualityScore : null,
    inputTokens: typeof body.inputTokens === "number" ? body.inputTokens : null,
    outputTokens: typeof body.outputTokens === "number" ? body.outputTokens : null,
    error: typeof body.error === "boolean" ? body.error : null,
  };
}

export function createPromptRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const variants = new PromptVariantManager(deps.memory.db);
  const experiments = new PromptABTesting(deps.memory.db, variants);
  const optimizer = new PromptOptimizer(variants);

  app.get("/sections", (c) => {
    try {
      return c.json<APIResponse>({ success: true, data: variants.listSections() });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/sections/:section/variants", (c) => {
    try {
      const section = parseSection(c);
      return c.json<APIResponse>({ success: true, data: variants.listVariants(section) });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.post("/sections/:section/variants", async (c) => {
    try {
      const section = parseSection(c);
      const body = await c.req.json<{
        content?: unknown;
        activate?: unknown;
        source?: unknown;
      }>();
      if (typeof body.content !== "string") {
        return c.json<APIResponse>({ success: false, error: "content is required" }, 400);
      }
      const variant = variants.createVariant({
        section,
        content: body.content,
        activate: body.activate === true,
        source: body.source === "optimizer" ? "optimizer" : "manual",
      });
      return c.json<APIResponse>({ success: true, data: variant }, 201);
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.put("/sections/:section/variants/:id/activate", (c) => {
    try {
      const section = parseSection(c);
      const variant = variants.activateVariant(section, parseId(c.req.param("id")));
      return c.json<APIResponse>({ success: true, data: variant });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.post("/sections/:section/variants/:id/metrics", async (c) => {
    try {
      parseSection(c);
      const body = await c.req.json<Record<string, unknown>>();
      const variant = variants.recordMetrics(parseId(c.req.param("id")), metricInputFromBody(body));
      return c.json<APIResponse>({ success: true, data: variant });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.get("/experiments", (c) => {
    try {
      const section = c.req.query("section");
      if (section) assertPromptSection(section);
      const data = experiments.listExperiments(section as PromptSectionId | undefined);
      return c.json<APIResponse>({ success: true, data });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.post("/experiments", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (typeof body.section !== "string") throw new Error("section is required");
      assertPromptSection(body.section);
      if (typeof body.controlVariantId !== "number") {
        throw new Error("controlVariantId is required");
      }
      if (typeof body.candidateVariantId !== "number") {
        throw new Error("candidateVariantId is required");
      }

      const experiment = experiments.createExperiment({
        section: body.section,
        name: typeof body.name === "string" ? body.name : undefined,
        controlVariantId: body.controlVariantId,
        candidateVariantId: body.candidateVariantId,
        trafficPercentage:
          typeof body.trafficPercentage === "number" ? body.trafficPercentage : undefined,
        minSamples: typeof body.minSamples === "number" ? body.minSamples : undefined,
        autoPromote: typeof body.autoPromote === "boolean" ? body.autoPromote : undefined,
      });
      const data = body.start === true ? experiments.startExperiment(experiment.id) : experiment;
      return c.json<APIResponse>({ success: true, data }, 201);
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.get("/experiments/:id", (c) => {
    try {
      const experiment = experiments.getExperiment(parseId(c.req.param("id")));
      if (!experiment) throw new Error("Experiment not found");
      return c.json<APIResponse>({ success: true, data: experiment });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.post("/experiments/:id/start", (c) => {
    try {
      const experiment = experiments.startExperiment(parseId(c.req.param("id")));
      return c.json<APIResponse>({ success: true, data: experiment });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.post("/experiments/:id/outcomes", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (typeof body.variantId !== "number") throw new Error("variantId is required");
      const experiment = experiments.recordOutcome({
        experimentId: parseId(c.req.param("id")),
        variantId: body.variantId,
        ...metricInputFromBody(body),
      });
      return c.json<APIResponse>({ success: true, data: experiment });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.post("/optimize", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (typeof body.section !== "string") throw new Error("section is required");
      assertPromptSection(body.section);
      const feedbackThemes = new FeedbackAnalyzer(deps.memory.db).getThemes({
        periodDays: 90,
        limit: 10,
      });
      const suggestion = optimizer.suggestImprovement({
        section: body.section,
        baseVariantId: typeof body.variantId === "number" ? body.variantId : undefined,
        feedbackThemes,
        evaluationIssues: Array.isArray(body.evaluationIssues)
          ? body.evaluationIssues.filter((item): item is string => typeof item === "string")
          : undefined,
        createVariant: body.createVariant === true,
      });
      return c.json<APIResponse>({ success: true, data: suggestion });
    } catch (error) {
      return c.json<APIResponse>(
        { success: false, error: getErrorMessage(error) },
        statusForError(error)
      );
    }
  });

  app.get("/performance", (c) => {
    try {
      return c.json<APIResponse>({
        success: true,
        data: {
          ...variants.getPerformance(),
          experiments: experiments.listExperiments().slice(0, 10),
        },
      });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
