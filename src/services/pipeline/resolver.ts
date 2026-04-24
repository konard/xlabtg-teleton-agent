import type { PipelineStep } from "./definition.js";

export interface PipelineResolution {
  order: PipelineStep[];
  levels: PipelineStep[][];
  dependents: Map<string, string[]>;
}

export function resolvePipelineSteps(steps: PipelineStep[]): PipelineResolution {
  const byId = new Map<string, PipelineStep>();
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    if (byId.has(step.id)) {
      throw new Error(`Duplicate pipeline step id "${step.id}"`);
    }
    byId.set(step.id, step);
    indegree.set(step.id, 0);
    dependents.set(step.id, []);
  }

  for (const step of steps) {
    for (const dependencyId of step.dependsOn) {
      if (dependencyId === step.id) {
        throw new Error(`Pipeline step "${step.id}" cannot depend on itself`);
      }
      if (!byId.has(dependencyId)) {
        throw new Error(`Pipeline step "${step.id}" depends on unknown step "${dependencyId}"`);
      }
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
      dependents.get(dependencyId)?.push(step.id);
    }
  }

  const queue = steps.filter((step) => (indegree.get(step.id) ?? 0) === 0);
  const order: PipelineStep[] = [];
  const levels: PipelineStep[][] = [];

  while (queue.length > 0) {
    const level = queue.splice(0, queue.length);
    levels.push(level);

    for (const step of level) {
      order.push(step);
      for (const dependentId of dependents.get(step.id) ?? []) {
        const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, nextIndegree);
        if (nextIndegree === 0) {
          const dependent = byId.get(dependentId);
          if (dependent) queue.push(dependent);
        }
      }
    }
  }

  if (order.length !== steps.length) {
    const unresolved = steps
      .filter((step) => !order.some((ordered) => ordered.id === step.id))
      .map((step) => step.id)
      .join(", ");
    throw new Error(`Pipeline steps must form a DAG; cycle detected near: ${unresolved}`);
  }

  return { order, levels, dependents };
}
