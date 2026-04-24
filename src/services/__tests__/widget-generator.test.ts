import { describe, expect, it } from "vitest";
import { createDataSourceCatalog } from "../data-source-catalog.js";
import { WidgetGeneratorService } from "../widget-generator.js";

describe("WidgetGeneratorService", () => {
  it("generates a bar chart definition for tool usage comparisons", () => {
    const generator = new WidgetGeneratorService(createDataSourceCatalog());

    const result = generator.generate({
      prompt: "Compare tool usage across categories for the last 7 days",
    });

    expect(result.definition.title).toBe("Tool Usage");
    expect(result.definition.renderer).toBe("chart");
    expect(result.definition.dataSource.id).toBe("metrics.tools");
    expect(result.definition.dataSource.endpoint).toBe("/api/metrics/tools");
    expect(result.definition.dataSource.params).toEqual({ period: "7d" });
    expect(result.definition.config).toMatchObject({
      chartType: "bar",
      categoryKey: "tool",
      valueKey: "count",
    });
    expect(result.validation.valid).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("refines an existing generated widget without changing the data source", () => {
    const generator = new WidgetGeneratorService(createDataSourceCatalog());
    const generated = generator.generate({
      prompt: "Show tool usage as a bar chart",
    });

    const refined = generator.refine({
      prompt: "Make it a pie chart and use the last 30 days",
      widget: generated.definition,
    });

    expect(refined.definition.id).toBe(generated.definition.id);
    expect(refined.definition.dataSource.id).toBe("metrics.tools");
    expect(refined.definition.dataSource.params).toEqual({ period: "30d" });
    expect(refined.definition.config).toMatchObject({
      chartType: "pie",
      categoryKey: "tool",
      valueKey: "count",
    });
    expect(refined.definition.refinementHistory).toHaveLength(1);
    expect(refined.validation.valid).toBe(true);
  });

  it("exposes endpoint metadata for generated widget data source selection", () => {
    const catalog = createDataSourceCatalog();

    const source = catalog.get("metrics.tools");

    expect(source).toMatchObject({
      id: "metrics.tools",
      endpoint: "/api/metrics/tools",
      rendererHints: ["bar", "pie", "table"],
    });
    expect(catalog.list().every((entry) => entry.endpoint.startsWith("/api/"))).toBe(true);
  });
});
