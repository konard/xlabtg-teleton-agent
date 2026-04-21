import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  MemorySourceFile,
  MemoryChunk,
  MemoryPriorityData,
  MemoryCleanupResult,
} from "../lib/api";
import { KnowledgeGraph } from "../components/KnowledgeGraph";

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "score_below_threshold":
      return "Low score";
    case "max_age_exceeded":
      return "Max age";
    case "max_entries_exceeded":
      return "Entry cap";
    case "near_min_score":
      return "Near threshold";
    case "near_max_age":
      return "Aging";
    default:
      return reason;
  }
}

export function Memory() {
  const [activeTab, setActiveTab] = useState<"sources" | "graph" | "priority">("sources");
  const [filter, setFilter] = useState("");
  const [sources, setSources] = useState<MemorySourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncSynced, setSyncSynced] = useState(false);

  // Expanded source state
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [chunks, setChunks] = useState<MemoryChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [priority, setPriority] = useState<MemoryPriorityData | null>(null);
  const [priorityLoading, setPriorityLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<MemoryCleanupResult | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMemorySources();
      setSources(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const toggleSource = async (sourceKey: string) => {
    if (expandedSource === sourceKey) {
      setExpandedSource(null);
      setChunks([]);
      return;
    }

    setExpandedSource(sourceKey);
    setChunksLoading(true);
    try {
      const res = await api.getSourceChunks(sourceKey);
      setChunks(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChunksLoading(false);
    }
  };

  const loadPriority = useCallback(async () => {
    setPriorityLoading(true);
    setError(null);
    try {
      const res = await api.getMemoryPriority();
      setPriority(res.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPriorityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "priority") {
      loadPriority();
    }
  }, [activeTab, loadPriority]);

  const togglePin = async (memoryId: string, pinned: boolean) => {
    setError(null);
    try {
      await api.pinMemory(memoryId, pinned);
      await loadPriority();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runCleanup = async (dryRun: boolean) => {
    setCleanupLoading(true);
    setError(null);
    try {
      const res = await api.cleanupMemory(dryRun);
      setCleanupResult(res.data ?? null);
      await loadPriority();
      if (!dryRun) {
        await loadSources();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanupLoading(false);
    }
  };

  const syncVectorMemory = async () => {
    setSyncLoading(true);
    setError(null);
    setSyncMessage(null);
    try {
      const res = await api.syncVectorMemory();
      const data = res.data;
      setSyncSynced(data?.synced ?? false);
      setSyncMessage(data?.message ?? "Vector memory synchronization finished.");
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncLoading(false);
    }
  };

  const lowerFilter = filter.toLowerCase();
  const filtered = lowerFilter
    ? sources.filter((s) => s.source.toLowerCase().includes(lowerFilter))
    : sources;

  return (
    <div>
      <div className="header">
        <h1>Memory</h1>
        <p>Browse indexed knowledge sources and graph relationships</p>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "sources" ? "active" : ""}`}
          onClick={() => setActiveTab("sources")}
        >
          Sources
        </button>
        <button
          className={`tab ${activeTab === "graph" ? "active" : ""}`}
          onClick={() => setActiveTab("graph")}
        >
          Knowledge Graph
        </button>
        <button
          className={`tab ${activeTab === "priority" ? "active" : ""}`}
          onClick={() => setActiveTab("priority")}
        >
          Priority
        </button>
      </div>

      {activeTab === "sources" ? (
        <div className="card" style={{ padding: 0 }}>
          {/* Search + refresh bar */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom: "1px solid var(--separator)",
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sources..."
              style={{ flex: "1 1 220px", minWidth: 0, padding: "6px 10px", fontSize: "13px" }}
            />
            <button
              onClick={syncVectorMemory}
              disabled={syncLoading}
              title="Synchronize memory files with vector memory"
              style={{ padding: "4px 12px", fontSize: "12px", opacity: syncLoading ? 0.5 : 0.7 }}
            >
              {syncLoading ? "Syncing..." : "Sync Vector"}
            </button>
            <button
              onClick={loadSources}
              disabled={loading}
              style={{ padding: "4px 12px", fontSize: "12px", opacity: 0.7 }}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {error && (
            <div className="alert error" style={{ margin: "12px 14px" }}>
              {error}
              <button
                onClick={() => setError(null)}
                style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {syncMessage && (
            <div className="alert success" style={{ margin: "12px 14px" }}>
              {syncMessage}
              {!syncSynced && (
                <span style={{ color: "var(--text-secondary)" }}>
                  {" "}
                  Local memory is still available.
                </span>
              )}
              <button
                onClick={() => setSyncMessage(null)}
                style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Sources table */}
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              {filter ? "No matching sources" : "No memory files indexed"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--separator)",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                    textTransform: "uppercase",
                  }}
                >
                  <th style={{ textAlign: "left", padding: "8px 14px" }}>Source</th>
                  <th style={{ textAlign: "right", padding: "8px 14px", width: "80px" }}>Chunks</th>
                  <th style={{ textAlign: "right", padding: "8px 14px", width: "140px" }}>
                    Last Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((src) => {
                  const isExpanded = expandedSource === src.source;
                  return (
                    <React.Fragment key={src.source}>
                      <tr
                        onClick={() => toggleSource(src.source)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSource(src.source);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        style={{
                          cursor: "pointer",
                          borderBottom: isExpanded ? "none" : "1px solid var(--separator)",
                          backgroundColor: isExpanded ? "rgba(255,255,255,0.03)" : undefined,
                        }}
                        className="file-row"
                      >
                        <td style={{ padding: "6px 14px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: "14px",
                              fontSize: "10px",
                              color: "var(--text-secondary)",
                              marginRight: "8px",
                            }}
                          >
                            {isExpanded ? "\u25BC" : "\u25B6"}
                          </span>
                          {src.source}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            padding: "6px 14px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {src.entryCount}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            padding: "6px 14px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {formatDate(src.lastUpdated)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr
                          style={{
                            backgroundColor: "rgba(255,255,255,0.03)",
                            borderBottom: "1px solid var(--separator)",
                          }}
                        >
                          <td colSpan={3} style={{ padding: "0 14px 14px 14px" }}>
                            {chunksLoading ? (
                              <div
                                style={{
                                  padding: "12px 0",
                                  textAlign: "center",
                                  color: "var(--text-secondary)",
                                  fontSize: "12px",
                                }}
                              >
                                Loading chunks...
                              </div>
                            ) : chunks.length === 0 ? (
                              <div
                                style={{
                                  padding: "12px 0",
                                  textAlign: "center",
                                  color: "var(--text-secondary)",
                                  fontSize: "12px",
                                }}
                              >
                                No chunks
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "8px",
                                  paddingTop: "8px",
                                }}
                              >
                                {chunks.map((chunk) => (
                                  <div
                                    key={chunk.id}
                                    style={{
                                      padding: "10px 12px",
                                      border: "1px solid var(--separator)",
                                      borderRadius: "4px",
                                      backgroundColor: "var(--surface)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "var(--text-secondary)",
                                        marginBottom: "6px",
                                      }}
                                    >
                                      {chunk.startLine != null && chunk.endLine != null && (
                                        <span>
                                          Lines {chunk.startLine}–{chunk.endLine} &middot;{" "}
                                        </span>
                                      )}
                                      {formatDate(chunk.updatedAt)}
                                    </div>
                                    <pre
                                      style={{
                                        margin: 0,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        fontSize: "12px",
                                        fontFamily: "monospace",
                                        lineHeight: "1.5",
                                        maxHeight: "300px",
                                        minHeight: "60px",
                                        overflow: "auto",
                                        resize: "vertical",
                                        color: "var(--text)",
                                      }}
                                    >
                                      {chunk.text}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : activeTab === "graph" ? (
        <div className="card" style={{ padding: 0 }}>
          <KnowledgeGraph />
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom: "1px solid var(--separator)",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={loadPriority}
              disabled={priorityLoading}
              style={{
                padding: "4px 12px",
                fontSize: "12px",
                opacity: priorityLoading ? 0.5 : 0.7,
              }}
            >
              {priorityLoading ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={() => runCleanup(true)}
              disabled={cleanupLoading}
              title="Run cleanup without archiving"
              style={{ padding: "4px 12px", fontSize: "12px", opacity: cleanupLoading ? 0.5 : 0.7 }}
            >
              Dry Run
            </button>
            <button
              onClick={() => runCleanup(false)}
              disabled={cleanupLoading}
              title="Archive cleanup candidates"
              style={{ padding: "4px 12px", fontSize: "12px", opacity: cleanupLoading ? 0.5 : 0.7 }}
            >
              Archive
            </button>
          </div>

          {error && (
            <div className="alert error" style={{ margin: "12px 14px" }}>
              {error}
              <button
                onClick={() => setError(null)}
                style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {cleanupResult && (
            <div className="alert success" style={{ margin: "12px 14px" }}>
              {cleanupResult.dryRun ? "Dry run complete" : "Cleanup complete"}:{" "}
              {cleanupResult.candidates.length} candidate(s), {cleanupResult.archived} archived,{" "}
              {cleanupResult.deleted} deleted.
              <button
                onClick={() => setCleanupResult(null)}
                style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {priorityLoading && !priority ? (
            <div style={{ padding: "20px", textAlign: "center" }}>Loading...</div>
          ) : !priority ? (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              No priority data
            </div>
          ) : (
            <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "8px",
                }}
              >
                {[
                  ["Scored", priority.scores.total],
                  ["Average", formatScore(priority.scores.averageScore)],
                  ["Pinned", priority.scores.pinned],
                  ["Archived", priority.archive.archived],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      border: "1px solid var(--separator)",
                      borderRadius: "4px",
                      padding: "10px 12px",
                      background: "var(--surface)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        textTransform: "uppercase",
                        marginBottom: "4px",
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: "20px", fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>

              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    marginBottom: "8px",
                  }}
                >
                  Score Distribution
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${priority.scores.distribution.length}, minmax(18px, 1fr))`,
                    gap: "6px",
                    alignItems: "end",
                    minHeight: "120px",
                  }}
                >
                  {priority.scores.distribution.map((bucket) => {
                    const maxCount = Math.max(
                      1,
                      ...priority.scores.distribution.map((item) => item.count)
                    );
                    const height = Math.max(4, (bucket.count / maxCount) * 100);
                    return (
                      <div
                        key={`${bucket.min}-${bucket.max}`}
                        title={`${formatScore(bucket.min)}-${formatScore(bucket.max)}: ${bucket.count}`}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: `${height}px`,
                            minHeight: "4px",
                            background: "var(--accent)",
                            opacity: bucket.count > 0 ? 0.8 : 0.2,
                            borderRadius: "3px 3px 0 0",
                          }}
                        />
                        <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                          {bucket.count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {priority.pinned.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      textTransform: "uppercase",
                      marginBottom: "8px",
                    }}
                  >
                    Pinned
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--separator)",
                          color: "var(--text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                        }}
                      >
                        <th style={{ textAlign: "left", padding: "8px 0" }}>Memory ID</th>
                        <th style={{ textAlign: "right", padding: "8px 0", width: "72px" }}>
                          Score
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 0", width: "90px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {priority.pinned.map((entry) => (
                        <tr
                          key={entry.memoryId}
                          style={{ borderBottom: "1px solid var(--separator)" }}
                        >
                          <td
                            style={{
                              padding: "8px 8px 8px 0",
                              fontFamily: "monospace",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {entry.memoryId}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              padding: "8px 0",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {formatScore(entry.score)}
                          </td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>
                            <button
                              onClick={() => togglePin(entry.memoryId, false)}
                              style={{ padding: "3px 10px", fontSize: "12px" }}
                            >
                              Unpin
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    marginBottom: "8px",
                  }}
                >
                  At Risk
                </div>
                {priority.atRisk.length === 0 ? (
                  <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                    No active cleanup candidates
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--separator)",
                          color: "var(--text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                        }}
                      >
                        <th style={{ textAlign: "left", padding: "8px 0" }}>Memory</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "84px" }}>
                          Score
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 12px", width: "190px" }}>
                          Reason
                        </th>
                        <th style={{ textAlign: "right", padding: "8px 0", width: "80px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {priority.atRisk.map((entry) => (
                        <tr key={entry.id} style={{ borderBottom: "1px solid var(--separator)" }}>
                          <td style={{ padding: "8px 8px 8px 0" }}>
                            <div style={{ fontWeight: 500, marginBottom: "3px" }}>
                              {entry.path || entry.source}
                            </div>
                            <div
                              style={{
                                color: "var(--text-secondary)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: "520px",
                              }}
                            >
                              {entry.text.replace(/\s+/g, " ").slice(0, 140)}
                            </div>
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              padding: "8px 12px",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {formatScore(entry.score)}
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--text-secondary)" }}>
                            {entry.reasons.map(reasonLabel).join(", ")}
                          </td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>
                            <button
                              onClick={() => togglePin(entry.id, true)}
                              style={{ padding: "3px 10px", fontSize: "12px" }}
                            >
                              Pin
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    marginBottom: "8px",
                  }}
                >
                  Cleanup History
                </div>
                {priority.cleanupHistory.length === 0 ? (
                  <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                    No cleanup runs
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--separator)",
                          color: "var(--text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                        }}
                      >
                        <th style={{ textAlign: "left", padding: "8px 0" }}>Run</th>
                        <th style={{ textAlign: "right", padding: "8px 0" }}>Candidates</th>
                        <th style={{ textAlign: "right", padding: "8px 0" }}>Archived</th>
                        <th style={{ textAlign: "right", padding: "8px 0" }}>Deleted</th>
                        <th style={{ textAlign: "right", padding: "8px 0" }}>Protected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priority.cleanupHistory.map((run) => (
                        <tr key={run.id} style={{ borderBottom: "1px solid var(--separator)" }}>
                          <td style={{ padding: "8px 8px 8px 0" }}>
                            <div style={{ fontWeight: 500 }}>{run.mode.replace("_", " ")}</div>
                            <div style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                              {formatDate(run.createdAt)}
                            </div>
                          </td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>{run.candidates}</td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>{run.archived}</td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>{run.deleted}</td>
                          <td style={{ textAlign: "right", padding: "8px 0" }}>{run.protected}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
