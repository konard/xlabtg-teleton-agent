import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  MemoryGraphData,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphNodeType,
} from "../lib/api";

const NODE_TYPES: Array<{ id: "" | MemoryGraphNodeType; label: string }> = [
  { id: "", label: "All types" },
  { id: "conversation", label: "Conversations" },
  { id: "task", label: "Tasks" },
  { id: "tool", label: "Tools" },
  { id: "topic", label: "Topics" },
  { id: "entity", label: "Entities" },
  { id: "outcome", label: "Outcomes" },
];

const TYPE_COLORS: Record<MemoryGraphNodeType, string> = {
  conversation: "var(--accent)",
  task: "var(--green)",
  tool: "var(--cyan)",
  topic: "var(--purple)",
  entity: "var(--orange)",
  outcome: "var(--red)",
};

const WIDTH = 900;
const HEIGHT = 440;

function trimLabel(label: string, max = 28): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}...`;
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function edgeKey(edge: MemoryGraphEdge): string {
  return `${edge.sourceId}:${edge.targetId}:${edge.relation}`;
}

export function KnowledgeGraph() {
  const [graph, setGraph] = useState<MemoryGraphData>({ nodes: [], edges: [] });
  const [search, setSearch] = useState("");
  const [nodeType, setNodeType] = useState<"" | MemoryGraphNodeType>("");
  const [relation, setRelation] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathGraph, setPathGraph] = useState<MemoryGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMemoryGraph({
        type: nodeType || undefined,
        q: search.trim() || undefined,
        limit: 140,
      });
      const data = res.data ?? { nodes: [], edges: [] };
      setGraph(data);
      setPathGraph(null);
      if (data.nodes.length > 0) {
        setSelectedNodeId((current) =>
          current && data.nodes.some((node) => node.id === current) ? current : data.nodes[0].id
        );
        setPathFrom((current) =>
          current && data.nodes.some((node) => node.id === current) ? current : data.nodes[0].id
        );
        setPathTo((current) =>
          current && data.nodes.some((node) => node.id === current)
            ? current
            : data.nodes[Math.min(1, data.nodes.length - 1)].id
        );
      } else {
        setSelectedNodeId(null);
        setPathFrom("");
        setPathTo("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [nodeType, search]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const relationOptions = useMemo(() => {
    return Array.from(new Set(graph.edges.map((edge) => edge.relation))).sort();
  }, [graph.edges]);

  const visibleEdges = useMemo(() => {
    return relation ? graph.edges.filter((edge) => edge.relation === relation) : graph.edges;
  }, [graph.edges, relation]);

  const visibleNodes = useMemo(() => {
    if (!relation) return graph.nodes;
    const ids = new Set<string>();
    for (const edge of visibleEdges) {
      ids.add(edge.sourceId);
      ids.add(edge.targetId);
    }
    return graph.nodes.filter((node) => ids.has(node.id));
  }, [graph.nodes, relation, visibleEdges]);

  const nodesById = useMemo(() => {
    return new Map(graph.nodes.map((node) => [node.id, node]));
  }, [graph.nodes]);

  const layout = useMemo(() => {
    const points = new Map<string, { x: number; y: number }>();
    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;
    const radius = Math.max(80, Math.min(WIDTH, HEIGHT) / 2 - 58);

    visibleNodes.forEach((node, index) => {
      if (visibleNodes.length === 1) {
        points.set(node.id, { x: centerX, y: centerY });
        return;
      }
      const angle = (index / visibleNodes.length) * Math.PI * 2 - Math.PI / 2;
      const typeOffset = NODE_TYPES.findIndex((type) => type.id === node.type) * 9;
      points.set(node.id, {
        x: centerX + Math.cos(angle) * (radius - typeOffset),
        y: centerY + Math.sin(angle) * (radius - typeOffset),
      });
    });

    return points;
  }, [visibleNodes]);

  const selectedNode = selectedNodeId ? (nodesById.get(selectedNodeId) ?? null) : null;
  const selectedEdges = selectedNode
    ? graph.edges.filter(
        (edge) => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id
      )
    : [];

  const pathNodeIds = useMemo(
    () => new Set(pathGraph?.nodes.map((node) => node.id) ?? []),
    [pathGraph]
  );
  const pathEdgeKeys = useMemo(() => new Set(pathGraph?.edges.map(edgeKey) ?? []), [pathGraph]);

  const findPath = async () => {
    if (!pathFrom || !pathTo || pathFrom === pathTo) return;
    setError(null);
    try {
      const res = await api.getMemoryGraphPath(pathFrom, pathTo);
      setPathGraph(res.data ?? null);
    } catch (err) {
      setPathGraph(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadGraph();
          }}
          placeholder="Search graph..."
          style={{ flex: "1 1 200px", minWidth: 0, padding: "6px 10px", fontSize: "13px" }}
        />
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as "" | MemoryGraphNodeType)}
          style={{ flex: "0 1 160px", padding: "6px 28px 6px 10px", fontSize: "12px" }}
        >
          {NODE_TYPES.map((type) => (
            <option key={type.id || "all"} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        <select
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          style={{ flex: "0 1 170px", padding: "6px 28px 6px 10px", fontSize: "12px" }}
        >
          <option value="">All relations</option>
          {relationOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          onClick={loadGraph}
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

      <div className="knowledge-graph-grid">
        <div
          style={{
            border: "1px solid var(--separator)",
            borderRadius: "8px",
            overflow: "hidden",
            minHeight: "440px",
            background: "var(--surface)",
          }}
        >
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)" }}>
              Loading...
            </div>
          ) : visibleNodes.length === 0 ? (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              No graph nodes
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label="Knowledge graph"
              style={{ width: "100%", height: "440px", display: "block" }}
            >
              <g>
                {visibleEdges.map((edge) => {
                  const source = layout.get(edge.sourceId);
                  const target = layout.get(edge.targetId);
                  if (!source || !target) return null;
                  const highlighted = pathEdgeKeys.has(edgeKey(edge));
                  return (
                    <g key={edge.id}>
                      <line
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={highlighted ? "var(--accent)" : "var(--separator)"}
                        strokeWidth={highlighted ? 3 : 1.4}
                      />
                      <text
                        x={(source.x + target.x) / 2}
                        y={(source.y + target.y) / 2}
                        textAnchor="middle"
                        fontSize="9"
                        fill="var(--text-tertiary)"
                        style={{ pointerEvents: "none" }}
                      >
                        {edge.relation}
                      </text>
                    </g>
                  );
                })}
              </g>
              <g>
                {visibleNodes.map((node) => {
                  const point = layout.get(node.id);
                  if (!point) return null;
                  const selected = selectedNodeId === node.id;
                  const highlighted = pathNodeIds.has(node.id);
                  return (
                    <g
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedNodeId(node.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedNodeId(node.id);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={selected ? 18 : 15}
                        fill={TYPE_COLORS[node.type]}
                        opacity={highlighted || !pathGraph ? 0.95 : 0.35}
                        stroke={selected || highlighted ? "var(--text)" : "transparent"}
                        strokeWidth={selected || highlighted ? 2 : 0}
                      />
                      <text
                        x={point.x}
                        y={point.y + 30}
                        textAnchor="middle"
                        fontSize="11"
                        fill="var(--text)"
                        style={{ pointerEvents: "none" }}
                      >
                        {trimLabel(node.label)}
                      </text>
                      <text
                        x={point.x}
                        y={point.y + 43}
                        textAnchor="middle"
                        fontSize="9"
                        fill="var(--text-secondary)"
                        style={{ pointerEvents: "none" }}
                      >
                        {node.type}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
          <div
            style={{
              border: "1px solid var(--separator)",
              borderRadius: "8px",
              padding: "10px",
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
              <select
                value={pathFrom}
                onChange={(e) => setPathFrom(e.target.value)}
                style={{ minWidth: 0, padding: "6px 28px 6px 10px", fontSize: "12px" }}
              >
                {graph.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {trimLabel(node.label, 44)}
                  </option>
                ))}
              </select>
              <select
                value={pathTo}
                onChange={(e) => setPathTo(e.target.value)}
                style={{ minWidth: 0, padding: "6px 28px 6px 10px", fontSize: "12px" }}
              >
                {graph.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {trimLabel(node.label, 44)}
                  </option>
                ))}
              </select>
              <button
                onClick={findPath}
                disabled={!pathFrom || !pathTo || pathFrom === pathTo}
                style={{ padding: "6px 12px", fontSize: "12px" }}
              >
                Highlight path
              </button>
            </div>
          </div>

          <div
            style={{
              border: "1px solid var(--separator)",
              borderRadius: "8px",
              padding: "12px",
              background: "var(--surface)",
              minHeight: "260px",
              overflow: "auto",
            }}
          >
            {selectedNode ? (
              <>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}
                >
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: TYPE_COLORS[selectedNode.type],
                      flexShrink: 0,
                    }}
                  />
                  <strong style={{ fontSize: "13px", overflowWrap: "anywhere" }}>
                    {selectedNode.label}
                  </strong>
                </div>
                <div
                  style={{ color: "var(--text-secondary)", fontSize: "12px", marginBottom: "12px" }}
                >
                  {selectedNode.type}
                </div>
                {selectedEdges.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      marginBottom: "12px",
                    }}
                  >
                    {selectedEdges.slice(0, 8).map((edge) => {
                      const otherId =
                        edge.sourceId === selectedNode.id ? edge.targetId : edge.sourceId;
                      const other = nodesById.get(otherId);
                      return (
                        <div
                          key={edge.id}
                          style={{
                            fontSize: "12px",
                            color: "var(--text-secondary)",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {edge.relation}:{" "}
                          <span style={{ color: "var(--text)" }}>{other?.label ?? otherId}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {Object.keys(selectedNode.metadata).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {Object.entries(selectedNode.metadata)
                      .slice(0, 8)
                      .map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            fontSize: "11px",
                            color: "var(--text-secondary)",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {key}:{" "}
                          <span style={{ color: "var(--text)" }}>{formatMetadataValue(value)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No node selected
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
