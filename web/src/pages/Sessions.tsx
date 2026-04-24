import { useEffect, useState, useCallback } from "react";
import {
  api,
  type CorrectionLogEntry,
  type FeedbackRecord,
  type SessionListItem,
  type SessionMessage,
} from "../lib/api";
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

function ThumbIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: direction === "down" ? "rotate(180deg)" : undefined }}
    >
      <path d="M7 10v11" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function InlineFeedback({
  sessionId,
  messageId,
  existing,
}: {
  sessionId: string;
  messageId: string;
  existing?: FeedbackRecord;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<"positive" | "negative" | null>(
    existing?.type === "positive" || existing?.type === "negative" ? existing.type : null
  );
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [text, setText] = useState(existing?.text ?? "");
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(existing ? "Saved" : null);

  const submit = async (type: "positive" | "negative", extraTags = tags, note = text) => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await api.submitFeedback({
        sessionId,
        messageId,
        type,
        rating: type === "positive" ? Math.max(rating, 4) : Math.min(rating, 2),
        text: note || null,
        tags: extraTags,
      });
      setSelected(res.data?.type === "negative" ? "negative" : "positive");
      setStatus("Saved");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px",
        marginTop: "5px",
        maxWidth: "75%",
      }}
    >
      <button
        className={selected === "positive" ? "btn-sm" : "btn-ghost btn-sm"}
        onClick={() => submit("positive", tags.includes("helpful") ? tags : [...tags, "helpful"])}
        disabled={saving}
        title="Mark helpful"
        aria-label="Mark helpful"
        style={{ padding: "3px 7px", minWidth: "28px" }}
      >
        <ThumbIcon direction="up" />
      </button>
      <button
        className={selected === "negative" ? "btn-sm" : "btn-ghost btn-sm"}
        onClick={() => submit("negative")}
        disabled={saving}
        title="Mark not helpful"
        aria-label="Mark not helpful"
        style={{ padding: "3px 7px", minWidth: "28px" }}
      >
        <ThumbIcon direction="down" />
      </button>
      <select
        value={rating}
        onChange={(event) => setRating(Number(event.target.value))}
        title="Rating"
        aria-label="Rating"
        style={{ width: "56px", padding: "3px 18px 3px 7px", fontSize: "12px" }}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button
        className="btn-ghost btn-sm"
        onClick={() => setExpanded((value) => !value)}
        style={{ padding: "3px 8px", fontSize: "12px" }}
      >
        Note
      </button>
      {status && <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{status}</span>}
      {expanded && (
        <div style={{ flexBasis: "100%", display: "grid", gap: "6px", marginTop: "2px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {["too_long", "too_short", "wrong", "unclear"].map((tag) => (
              <button
                key={tag}
                className={tags.includes(tag) ? "btn-sm" : "btn-ghost btn-sm"}
                onClick={() => toggleTag(tag)}
                style={{ padding: "2px 7px", fontSize: "11px" }}
              >
                {tag.replace("_", " ")}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="What could be better?"
            rows={2}
            style={{ fontSize: "12px", minHeight: "54px" }}
          />
          <button
            className="btn-sm"
            onClick={() => submit(selected ?? (rating >= 4 ? "positive" : "negative"))}
            disabled={saving}
            style={{ justifySelf: "start", padding: "3px 10px", fontSize: "12px" }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  msg,
  sessionId,
  feedback,
}: {
  msg: SessionMessage;
  sessionId: string;
  feedback?: FeedbackRecord;
}) {
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
      {isAgent && <InlineFeedback sessionId={sessionId} messageId={msg.id} existing={feedback} />}
    </div>
  );
}

function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

function CorrectionTimeline({ corrections }: { corrections: CorrectionLogEntry[] }) {
  if (corrections.length === 0) return null;

  return (
    <details
      style={{
        margin: "10px 14px 0",
        border: "1px solid var(--separator)",
        borderRadius: "6px",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "8px 10px",
          fontSize: "13px",
          fontWeight: 600,
          backgroundColor: "var(--surface)",
        }}
      >
        Corrections ({corrections.length})
      </summary>
      <div style={{ padding: "10px", display: "grid", gap: "10px" }}>
        {corrections.map((entry) => (
          <div
            key={entry.id}
            style={{
              borderBottom: "1px solid var(--separator)",
              paddingBottom: "10px",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <strong>Attempt {entry.iteration}</strong>
              <span style={{ color: "var(--text-secondary)" }}>
                {formatScore(entry.score)} → {formatScore(entry.correctedScore)}
              </span>
              {entry.escalated && <span style={{ color: "#d9534f" }}>Human review</span>}
            </div>
            <div style={{ color: "var(--text-secondary)", marginBottom: "6px" }}>
              {entry.feedback}
            </div>
            {entry.reflection?.instructions.length ? (
              <ul style={{ margin: 0, paddingLeft: "18px", color: "var(--text-secondary)" }}>
                {entry.reflection.instructions.slice(0, 3).map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            ) : null}
            {entry.correctedOutput ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "8px",
                  marginTop: "8px",
                }}
              >
                {[
                  ["Original", entry.originalOutput],
                  ["Corrected", entry.correctedOutput],
                ].map(([label, text]) => (
                  <div key={label}>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        marginBottom: "3px",
                      }}
                    >
                      {label}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: "6px",
                        maxHeight: "120px",
                        overflow: "auto",
                        borderRadius: "4px",
                        backgroundColor: "rgba(0,0,0,0.18)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {text}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
            {entry.toolRecoveries.length > 0 ? (
              <div style={{ marginTop: "8px", color: "var(--text-secondary)" }}>
                {entry.toolRecoveries.map((recovery, idx) => (
                  <div key={`${recovery.toolName}-${idx}`}>
                    {recovery.toolName}: {recovery.kind}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
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
  const [feedbackByMessage, setFeedbackByMessage] = useState<Record<string, FeedbackRecord>>({});
  const [corrections, setCorrections] = useState<CorrectionLogEntry[]>([]);
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
        const [res, correctionRes, feedbackRes] = await Promise.all([
          api.getSessionMessages(session.sessionId, p, limit),
          api.getSessionCorrections(session.sessionId),
          api.getFeedback({ session: session.sessionId, limit: 500 }),
        ]);
        setMessages(res.data.messages);
        setTotal(res.data.total);
        setCorrections(correctionRes.data.corrections);
        const nextFeedbackByMessage: Record<string, FeedbackRecord> = {};
        for (const record of feedbackRes.data?.feedback ?? []) {
          if (record.messageId && !nextFeedbackByMessage[record.messageId]) {
            nextFeedbackByMessage[record.messageId] = record;
          }
        }
        setFeedbackByMessage(nextFeedbackByMessage);
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
    if (
      !(await confirm({
        title: "Delete session?",
        description: "This cannot be undone.",
        variant: "danger",
        confirmText: "Delete",
      }))
    )
      return;
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

      <CorrectionTimeline corrections={corrections} />

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
          messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              msg={msg}
              sessionId={session.sessionId}
              feedback={feedbackByMessage[msg.id]}
            />
          ))
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
