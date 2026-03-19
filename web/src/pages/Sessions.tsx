import React, { useEffect, useState, useCallback } from "react";
import { api, SessionListItem, SessionMessage } from "../lib/api";
import { useConfirm } from "../components/ConfirmDialog";

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function ChatTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const colors: Record<string, string> = { dm: "#5bc0de", group: "#5cb85c", channel: "#f0ad4e" };
  const bg = colors[type] ?? "#999";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: "10px",
        fontSize: "11px",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: bg,
      }}
    >
      {type}
    </span>
  );
}

function ChatBubble({ msg }: { msg: SessionMessage }) {
  const isAgent = msg.isFromAgent;
  const senderLabel = isAgent
    ? "Agent"
    : msg.senderUsername
      ? `@${msg.senderUsername}`
      : (msg.senderName ?? "User");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isAgent ? "flex-start" : "flex-end",
        marginBottom: "10px",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: "var(--text-secondary)",
          marginBottom: "3px",
          paddingLeft: isAgent ? "4px" : "0",
          paddingRight: isAgent ? "0" : "4px",
        }}
      >
        {senderLabel} · {formatTs(msg.timestamp)}
        {msg.isEdited && <span style={{ marginLeft: "4px", opacity: 0.6 }}>(edited)</span>}
      </div>
      <div
        style={{
          maxWidth: "75%",
          padding: "8px 12px",
          borderRadius: isAgent ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
          backgroundColor: isAgent ? "var(--surface)" : "var(--button-primary-bg, #2563eb)",
          color: isAgent ? "var(--text)" : "#fff",
          border: "1px solid var(--separator)",
          fontSize: "13px",
          lineHeight: "1.5",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {msg.text ?? <em style={{ opacity: 0.6 }}>[no text]</em>}
        {msg.hasMedia && (
          <div style={{ marginTop: "4px", fontSize: "11px", opacity: 0.7 }}>
            📎 {msg.mediaType ?? "media"}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionDetail({
  session,
  onClose,
  onDelete,
}: {
  session: SessionListItem;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const { confirm } = useConfirm();
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const loadMessages = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getSessionMessages(session.sessionId, p, limit);
        setMessages(res.data.messages);
        setTotal(res.data.total);
        setPage(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [session.sessionId]
  );

  useEffect(() => {
    loadMessages(1);
  }, [loadMessages]);

  const chatLabel = session.chatTitle ?? session.chatUsername ?? session.chatId;
  const totalPages = Math.ceil(total / limit);

  const handleDelete = async () => {
    if (!(await confirm({ title: "Delete session?", description: "This cannot be undone.", variant: "danger", confirmText: "Delete" }))) return;
    try {
      await api.deleteSession(session.sessionId);
      onDelete(session.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 14px",
          borderBottom: "1px solid var(--separator)",
          flexShrink: 0,
        }}
      >
        <button
          className="btn-ghost btn-sm"
          onClick={onClose}
          style={{ padding: "3px 8px", fontSize: "13px" }}
        >
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "14px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {chatLabel}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            {total} messages · Started {formatTs(session.startedAt)}
            {session.model && <> · {session.model}</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <a
            href={api.getSessionExportUrl(session.sessionId, "json")}
            download
            className="btn-ghost btn-sm"
            style={{
              padding: "3px 8px",
              fontSize: "12px",
              textDecoration: "none",
              color: "var(--text)",
              border: "1px solid var(--separator)",
              borderRadius: "4px",
            }}
          >
            JSON
          </a>
          <a
            href={api.getSessionExportUrl(session.sessionId, "md")}
            download
            className="btn-ghost btn-sm"
            style={{
              padding: "3px 8px",
              fontSize: "12px",
              textDecoration: "none",
              color: "var(--text)",
              border: "1px solid var(--separator)",
              borderRadius: "4px",
            }}
          >
            Markdown
          </a>
          <button
            className="btn-danger btn-sm"
            onClick={handleDelete}
            style={{ padding: "3px 8px", fontSize: "12px" }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert error" style={{ margin: "8px 14px", flexShrink: 0 }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: "8px", padding: "1px 6px", fontSize: "11px" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        {loading ? (
          <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            No Telegram messages found for this session.
          </div>
        ) : (
          messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "10px",
            padding: "8px 14px",
            borderTop: "1px solid var(--separator)",
            fontSize: "13px",
            flexShrink: 0,
          }}
        >
          <button
            className="btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => loadMessages(page - 1)}
            style={{ padding: "2px 10px" }}
          >
            ‹ Prev
          </button>
          <span style={{ color: "var(--text-secondary)" }}>
            {page} / {totalPages}
          </span>
          <button
            className="btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => loadMessages(page + 1)}
            style={{ padding: "2px 10px" }}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

export function Sessions() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [chatTypeFilter, setChatTypeFilter] = useState("");
  const [selected, setSelected] = useState<SessionListItem | null>(null);

  const loadSessions = useCallback(async (p: number, q?: string, ct?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSessions(p, limit, {
        q: q || undefined,
        chatType: ct || undefined,
      });
      setSessions(res.data.sessions);
      setTotal(res.data.total);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions(1, searchQuery, chatTypeFilter);
  }, [loadSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    loadSessions(1, searchQuery, chatTypeFilter);
  };

  const handleFilterChange = (ct: string) => {
    setChatTypeFilter(ct);
    loadSessions(1, searchQuery, ct);
  };

  const handleSessionDeleted = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    setTotal((prev) => Math.max(0, prev - 1));
    if (selected?.sessionId === sessionId) setSelected(null);
  };

  const totalPages = Math.ceil(total / limit);

  if (selected) {
    return (
      <div style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }}>
        <SessionDetail
          session={selected}
          onClose={() => setSelected(null)}
          onDelete={handleSessionDeleted}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1>Sessions</h1>
        <p>Chat history and conversation logs</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: "14px" }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: "10px", padding: "2px 8px", fontSize: "12px" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filters bar */}
      <div
        className="card"
        style={{
          padding: "10px 14px",
          marginBottom: "14px",
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {/* Chat type filter */}
        {["", "dm", "group", "channel"].map((ct) => (
          <span
            key={ct || "all"}
            onClick={() => handleFilterChange(ct)}
            style={{
              cursor: "pointer",
              fontWeight: chatTypeFilter === ct ? "bold" : "normal",
              color: chatTypeFilter === ct ? "var(--text)" : "var(--text-secondary)",
              fontSize: "13px",
            }}
          >
            {ct === "" ? `All (${total})` : ct}
          </span>
        ))}

        {/* Search */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
                if (e.key === "Escape") {
                  setSearchQuery("");
                  loadSessions(1, "", chatTypeFilter);
                }
              }}
              style={{
                padding: "4px 24px 4px 12px",
                fontSize: "13px",
                border: "1px solid var(--separator)",
                borderRadius: "14px",
                backgroundColor: "transparent",
                color: "var(--text)",
                width: "200px",
                outline: "none",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  loadSessions(1, "", chatTypeFilter);
                }}
                style={{
                  position: "absolute",
                  right: "4px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  padding: "0 2px",
                  fontSize: "14px",
                  lineHeight: 1,
                }}
              >
                &#x2715;
              </button>
            )}
          </div>
          <button
            className="btn-ghost btn-sm"
            onClick={handleSearch}
            style={{ padding: "4px 12px", fontSize: "13px" }}
          >
            Search
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => loadSessions(page, searchQuery, chatTypeFilter)}
            style={{ padding: "4px 12px", fontSize: "13px" }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Sessions table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: "20px", color: "var(--text-secondary)", fontSize: "13px" }}>
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: "20px", color: "var(--text-secondary)", fontSize: "13px" }}>
            No sessions found.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--separator)" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 14px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  Chat
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 14px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  Type
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 14px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  Messages
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 14px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  Model
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 14px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  Last Activity
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 14px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  Started
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const chatLabel =
                  session.chatTitle ||
                  (session.chatUsername ? `@${session.chatUsername}` : null) ||
                  truncate(session.chatId, 24);
                return (
                  <tr
                    key={session.sessionId}
                    onClick={() => setSelected(session)}
                    style={{
                      borderBottom: "1px solid var(--separator)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <td style={{ padding: "8px 14px", fontSize: "13px" }}>
                      <div style={{ fontWeight: 500 }}>{chatLabel}</div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          marginTop: "1px",
                          fontFamily: "monospace",
                        }}
                      >
                        {session.sessionId.slice(0, 8)}...
                      </div>
                    </td>
                    <td style={{ padding: "8px 14px" }}>
                      <ChatTypeBadge type={session.chatType} />
                    </td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: "13px" }}>
                      {session.messageCount}
                    </td>
                    <td
                      style={{
                        padding: "8px 14px",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {session.model ? truncate(session.model, 20) : "—"}
                    </td>
                    <td
                      style={{
                        padding: "8px 14px",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {formatTs(session.updatedAt)}
                    </td>
                    <td
                      style={{
                        padding: "8px 14px",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {formatTs(session.startedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "10px",
            marginTop: "14px",
            fontSize: "13px",
          }}
        >
          <button
            className="btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => loadSessions(page - 1, searchQuery, chatTypeFilter)}
            style={{ padding: "4px 12px" }}
          >
            ‹ Prev
          </button>
          <span style={{ color: "var(--text-secondary)" }}>
            Page {page} of {totalPages} ({total} sessions)
          </span>
          <button
            className="btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => loadSessions(page + 1, searchQuery, chatTypeFilter)}
            style={{ padding: "4px 12px" }}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
