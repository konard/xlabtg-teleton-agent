import { useState } from "react";
import { api, type AutonomousParsedGoal } from "../lib/api";

const LOW_CONFIDENCE_THRESHOLD = 0.7;

function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return "#5cb85c";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "#f0ad4e";
  return "#d9534f";
}

function confidenceEmoji(confidence: number): string {
  if (confidence >= 0.85) return "🟢";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "🟡";
  return "🔴";
}

interface Props {
  onParsed: (parsed: AutonomousParsedGoal) => void;
  disabled?: boolean;
}

export function NaturalLanguageParser({ onParsed, disabled }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);

  const handleParse = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setError(null);
    setLoading(true);
    try {
      const res = await api.autonomousParseGoal(trimmed);
      if (!res.success || !res.data) {
        throw new Error("Parser returned no data");
      }
      setLastConfidence(res.data.confidence);
      onParsed(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLastConfidence(null);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setInput("");
    setError(null);
    setLastConfidence(null);
  };

  const isLowConfidence = lastConfidence !== null && lastConfidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <div
      className="card"
      style={{
        padding: "12px",
        marginBottom: "14px",
        borderLeft: "3px solid #7b68ee",
        backgroundColor: "var(--bg-secondary, rgba(123, 104, 238, 0.04))",
      }}
    >
      <label
        htmlFor="nl-parser-input"
        style={{
          display: "block",
          marginBottom: "6px",
          fontWeight: 600,
          fontSize: "13px",
        }}
      >
        🪄 Describe your task in natural language (optional)
      </label>

      <textarea
        id="nl-parser-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='e.g. "Monitor new DeDust pools every 5 minutes and report to @channel"'
        rows={3}
        disabled={disabled || loading}
        style={{ width: "100%", resize: "vertical", marginBottom: "8px" }}
      />

      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
          AI will try to fill the form below. You can always edit fields afterwards.
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {input && (
            <button type="button" className="btn-ghost btn-sm" onClick={clear} disabled={loading}>
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleParse}
            disabled={disabled || loading || !input.trim()}
            className="btn-sm"
          >
            {loading ? "Parsing…" : "✨ Parse with AI"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert error" style={{ marginTop: "10px", fontSize: "12px" }}>
          {error}
        </div>
      )}

      {lastConfidence !== null && !error && (
        <div
          role="status"
          className="alert"
          style={{
            marginTop: "10px",
            fontSize: "12px",
            borderLeft: `3px solid ${confidenceColor(lastConfidence)}`,
            backgroundColor: isLowConfidence
              ? "rgba(217, 83, 79, 0.08)"
              : "rgba(92, 184, 92, 0.06)",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {isLowConfidence ? "⚠️ AI parsed with low confidence" : "✅ AI filled the form"}{" "}
            {confidenceEmoji(lastConfidence)}{" "}
            <span style={{ color: confidenceColor(lastConfidence) }}>
              {Math.round(lastConfidence * 100)}%
            </span>
          </div>
          <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
            {isLowConfidence
              ? "Some fields may be inaccurate. Please review every field carefully before saving."
              : "All fields below were filled from your description. Edit them if needed, then save."}
          </div>
        </div>
      )}
    </div>
  );
}
