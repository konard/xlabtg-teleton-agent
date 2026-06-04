import { validateResolvedOutboundUrl } from "./outbound-url-guard.js";

const WORKFLOW_CALL_API_PROTOCOLS = ["http:", "https:"] as const;

export async function validateWorkflowCallApiUrl(raw: string): Promise<void> {
  await validateResolvedOutboundUrl(raw, {
    allowedProtocols: WORKFLOW_CALL_API_PROTOCOLS,
    label: "Workflow call_api URL",
  });
}
