import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AgentOverview } from "../lib/api";

export function AgentSwitcher() {
  const [agents, setAgents] = useState<AgentOverview[]>([]);
  const [selected, setSelected] = useState("primary");
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    api
      .listAgents()
      .then((response) => {
        if (mounted) setAgents(response.data.agents);
      })
      .catch(() => {
        if (mounted) setAgents([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (agents.length === 0) return null;

  return (
    <div style={{ padding: "8px 12px" }}>
      <select
        value={selected}
        aria-label="Agent switcher"
        onChange={(event) => {
          const next = event.target.value;
          setSelected(next);
          navigate(`/agents?agent=${encodeURIComponent(next)}`);
        }}
        style={{ width: "100%", fontSize: "12px" }}
      >
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name} ({agent.type})
          </option>
        ))}
      </select>
    </div>
  );
}
