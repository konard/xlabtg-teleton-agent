// Mock API server for Autonomous UI testing.
// Runs on port 7777 to match the dev Vite proxy target.
// Returns canned responses for /auth/check, /api/autonomous, etc.
import http from "node:http";
import { URL } from "node:url";

const PORT = 7777;

const mockTasks = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    goal: "Monitor new DeDust pools every 5 minutes and report to @tonbankcard",
    successCriteria: ["≥1 pool recorded", "report sent to @tonbankcard"],
    failureConditions: ["3 consecutive errors"],
    constraints: { maxIterations: 50, maxDurationHours: 8, budgetTON: 1 },
    strategy: "balanced",
    retryPolicy: { maxRetries: 3, backoff: "exponential" },
    context: {},
    priority: "high",
    status: "running",
    currentStep: 12,
    lastCheckpointId: "cp-1",
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - 10_000).toISOString(),
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    completedAt: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    goal: "Analyze top 10 TON projects and produce a summary report",
    successCriteria: ["summary generated"],
    failureConditions: [],
    constraints: { maxIterations: 30, maxDurationHours: 4 },
    strategy: "conservative",
    retryPolicy: { maxRetries: 3, backoff: "exponential" },
    context: {},
    priority: "medium",
    status: "completed",
    currentStep: 18,
    lastCheckpointId: "cp-2",
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
    updatedAt: new Date(Date.now() - 600_000).toISOString(),
    startedAt: new Date(Date.now() - 7000_000).toISOString(),
    completedAt: new Date(Date.now() - 600_000).toISOString(),
    result: "Summary report saved to workspace/summary.md",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    goal: "Watch a wallet and alert on incoming transactions >10 TON",
    successCriteria: [],
    failureConditions: [],
    constraints: { maxIterations: 100 },
    strategy: "aggressive",
    retryPolicy: { maxRetries: 5, backoff: "linear" },
    context: {},
    priority: "critical",
    status: "paused",
    currentStep: 7,
    createdAt: new Date(Date.now() - 900_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    startedAt: new Date(Date.now() - 900_000).toISOString(),
    completedAt: null,
  },
];

const mockLogs = [
  { id: 1, taskId: mockTasks[0].id, step: 1, eventType: "plan", message: "Planning initial scan of DeDust pools", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  { id: 2, taskId: mockTasks[0].id, step: 1, eventType: "tool_call", message: "Calling tool dedust:list_pools", createdAt: new Date(Date.now() - 3590_000).toISOString() },
  { id: 3, taskId: mockTasks[0].id, step: 1, eventType: "tool_result", message: "Received 124 pools", createdAt: new Date(Date.now() - 3585_000).toISOString() },
  { id: 4, taskId: mockTasks[0].id, step: 2, eventType: "reflect", message: "No new pools this iteration, waiting 5m", createdAt: new Date(Date.now() - 3280_000).toISOString() },
  { id: 5, taskId: mockTasks[0].id, step: 2, eventType: "checkpoint", message: "Checkpoint saved", createdAt: new Date(Date.now() - 3275_000).toISOString() },
  { id: 6, taskId: mockTasks[0].id, step: 12, eventType: "info", message: "Found 2 new pools, sending report", createdAt: new Date(Date.now() - 15_000).toISOString() },
  { id: 7, taskId: mockTasks[0].id, step: 12, eventType: "tool_call", message: "Calling tool telegram:send_message", createdAt: new Date(Date.now() - 10_000).toISOString() },
];

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Set-Cookie": "teleton_csrf=mock-csrf; Path=/; SameSite=Lax",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  // Read body for POST/PUT
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }

  console.log(`${req.method} ${pathname}`, body ? JSON.stringify(body).slice(0, 80) : "");

  if (pathname === "/auth/check") {
    return json(res, 200, { success: true, data: { authenticated: true } });
  }
  if (pathname === "/auth/login" && req.method === "POST") {
    return json(res, 200, { success: true });
  }

  if (pathname === "/api/autonomous" && req.method === "GET") {
    return json(res, 200, { success: true, data: mockTasks });
  }

  if (pathname === "/api/autonomous" && req.method === "POST") {
    const now = new Date().toISOString();
    const newTask = {
      id: crypto.randomUUID(),
      goal: body?.goal || "new task",
      successCriteria: body?.successCriteria || [],
      failureConditions: body?.failureConditions || [],
      constraints: body?.constraints || {},
      strategy: body?.strategy || "balanced",
      retryPolicy: body?.retryPolicy || { maxRetries: 3, backoff: "exponential" },
      context: body?.context || {},
      priority: body?.priority || "medium",
      status: "pending",
      currentStep: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    mockTasks.unshift(newTask);
    return json(res, 201, { success: true, data: newTask });
  }

  const detailMatch = pathname.match(/^\/api\/autonomous\/([^/]+)$/);
  if (detailMatch && req.method === "GET") {
    const id = detailMatch[1];
    const task = mockTasks.find((t) => t.id === id);
    if (!task) return json(res, 404, { success: false, error: "Not found" });
    return json(res, 200, {
      success: true,
      data: {
        ...task,
        lastCheckpoint: task.lastCheckpointId
          ? { id: task.lastCheckpointId, step: task.currentStep, createdAt: task.updatedAt }
          : null,
        executionLogs: mockLogs.filter((l) => l.taskId === id),
      },
    });
  }

  const actionMatch = pathname.match(/^\/api\/autonomous\/([^/]+)\/(pause|resume|stop)$/);
  if (actionMatch && req.method === "POST") {
    const [, id, action] = actionMatch;
    const task = mockTasks.find((t) => t.id === id);
    if (!task) return json(res, 404, { success: false, error: "Not found" });
    task.status = action === "pause" ? "paused" : action === "resume" ? "pending" : "cancelled";
    task.updatedAt = new Date().toISOString();
    return json(res, 200, { success: true, data: task });
  }

  if (detailMatch && req.method === "DELETE") {
    const idx = mockTasks.findIndex((t) => t.id === detailMatch[1]);
    if (idx === -1) return json(res, 404, { success: false, error: "Not found" });
    mockTasks.splice(idx, 1);
    return json(res, 200, { success: true, data: { message: "deleted" } });
  }

  return json(res, 404, { success: false, error: `unknown path ${pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock autonomous API: http://127.0.0.1:${PORT}`);
});
