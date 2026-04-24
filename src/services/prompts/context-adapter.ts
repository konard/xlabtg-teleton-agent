import type { PromptSectionId, PromptVariantSelection } from "./types.js";

export interface PromptContextVariables {
  userPreferenceStyle?: string;
  currentContext?: string;
  activeTools?: string[];
  timeOfDay?: string;
  feedbackPreferences?: string;
}

const VARIABLE_MAP: Record<string, keyof PromptContextVariables> = {
  user_preference_style: "userPreferenceStyle",
  current_context: "currentContext",
  active_tools: "activeTools",
  time_of_day: "timeOfDay",
  feedback_preferences: "feedbackPreferences",
};

function normalizeValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

export class PromptContextAdapter {
  private variables: PromptContextVariables;

  constructor(variables: PromptContextVariables = {}) {
    this.variables = variables;
  }

  render(content: string): string {
    return content.replace(/\{([a-z_]+)\}/g, (match, name: string) => {
      const key = VARIABLE_MAP[name];
      if (!key) return match;
      return normalizeValue(this.variables[key]);
    });
  }
}

export function renderPromptSelections(
  selections: PromptVariantSelection[],
  variables: PromptContextVariables
): Partial<Record<PromptSectionId, string>> {
  const adapter = new PromptContextAdapter(variables);
  const sections: Partial<Record<PromptSectionId, string>> = {};
  for (const selection of selections) {
    sections[selection.section] = adapter.render(selection.variant.content);
  }
  return sections;
}
