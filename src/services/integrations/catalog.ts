import type { IntegrationCatalogEntry } from "./base.js";

export const BUILT_IN_INTEGRATIONS: IntegrationCatalogEntry[] = [
  {
    id: "telegram",
    name: "Telegram",
    type: "api",
    provider: "telegram",
    description: "Use the configured Teleton Telegram bridge for messaging actions.",
    authTypes: ["none"],
    defaultConfig: {
      actions: {
        send_message: { method: "POST" },
      },
    },
    actions: [
      {
        id: "send_message",
        name: "Send message",
        description: "Send a Telegram message through the active bridge.",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    type: "api",
    provider: "slack",
    description: "Slack Web API template for chat and channel automation.",
    authTypes: ["api_key", "oauth2"],
    defaultConfig: {
      baseUrl: "https://slack.com/api",
      healthCheckUrl: "https://slack.com/api/auth.test",
      actions: {
        post_message: { method: "POST", path: "/chat.postMessage" },
        list_channels: { method: "GET", path: "/conversations.list" },
      },
    },
    actions: [
      { id: "post_message", name: "Post message", description: "Call chat.postMessage." },
      { id: "list_channels", name: "List channels", description: "Call conversations.list." },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    type: "api",
    provider: "github",
    description: "GitHub REST API template for issues, pull requests, and repository actions.",
    authTypes: ["api_key", "oauth2"],
    defaultConfig: {
      baseUrl: "https://api.github.com",
      healthCheckUrl: "https://api.github.com/rate_limit",
      headers: { "X-GitHub-Api-Version": "2022-11-28" },
      actions: {
        request: { method: "GET", path: "/" },
        create_issue: { method: "POST", path: "/repos/{owner}/{repo}/issues" },
      },
    },
    actions: [
      { id: "request", name: "HTTP request", description: "Call a configured GitHub path." },
      { id: "create_issue", name: "Create issue", description: "Create a repository issue." },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    type: "api",
    provider: "jira",
    description: "Jira Cloud REST API template for issue workflows.",
    authTypes: ["api_key", "basic", "oauth2"],
    defaultConfig: {
      baseUrl: "https://your-domain.atlassian.net/rest/api/3",
      healthCheckUrl: "https://your-domain.atlassian.net/rest/api/3/myself",
      actions: {
        create_issue: { method: "POST", path: "/issue" },
        search_issues: { method: "GET", path: "/search" },
      },
    },
    actions: [
      { id: "create_issue", name: "Create issue", description: "Create a Jira issue." },
      { id: "search_issues", name: "Search issues", description: "Search Jira issues." },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    type: "api",
    provider: "notion",
    description: "Notion API template for databases and pages.",
    authTypes: ["api_key", "oauth2"],
    defaultConfig: {
      baseUrl: "https://api.notion.com/v1",
      healthCheckUrl: "https://api.notion.com/v1/users/me",
      headers: { "Notion-Version": "2022-06-28" },
      actions: {
        create_page: { method: "POST", path: "/pages" },
        query_database: { method: "POST", path: "/databases/{database_id}/query" },
      },
    },
    actions: [
      { id: "create_page", name: "Create page", description: "Create a Notion page." },
      { id: "query_database", name: "Query database", description: "Query a database." },
    ],
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    type: "oauth",
    provider: "google-workspace",
    description: "Google Workspace OAuth template for Drive, Calendar, Gmail, and Admin APIs.",
    authTypes: ["oauth2"],
    defaultConfig: {
      baseUrl: "https://www.googleapis.com",
      healthCheckUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
      actions: {
        request: { method: "GET", path: "/" },
      },
    },
    actions: [{ id: "request", name: "HTTP request", description: "Call a Google API endpoint." }],
  },
  {
    id: "smtp-email",
    name: "Email (SMTP)",
    type: "api",
    provider: "smtp-email",
    description: "Email integration template for SMTP gateway APIs.",
    authTypes: ["basic", "api_key", "custom_header"],
    defaultConfig: {
      actions: {
        send_email: { method: "POST" },
      },
    },
    actions: [
      {
        id: "send_email",
        name: "Send email",
        description: "Send mail through a configured SMTP gateway endpoint.",
      },
    ],
  },
  {
    id: "custom-http",
    name: "Custom HTTP",
    type: "api",
    provider: "custom-http",
    description: "Configurable HTTP endpoint with shared authentication and rate limiting.",
    authTypes: ["none", "api_key", "oauth2", "jwt", "basic", "custom_header"],
    defaultConfig: {
      baseUrl: "https://api.example.com",
      actions: {
        request: { method: "GET", path: "/" },
      },
    },
    actions: [{ id: "request", name: "HTTP request", description: "Call a configured endpoint." }],
  },
  {
    id: "mcp",
    name: "MCP Server",
    type: "mcp",
    provider: "mcp",
    description: "Represent configured MCP servers in the unified integration registry.",
    authTypes: ["none"],
    defaultConfig: {},
    actions: [
      {
        id: "health",
        name: "Health",
        description: "Check the connected MCP server status.",
      },
    ],
  },
];

export function getIntegrationCatalog(): IntegrationCatalogEntry[] {
  return BUILT_IN_INTEGRATIONS.map((entry) => ({
    ...entry,
    defaultConfig: { ...entry.defaultConfig },
    actions: entry.actions.map((action) => ({ ...action })),
  }));
}
