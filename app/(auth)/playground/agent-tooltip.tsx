'use client';

// app/(auth)/playground/agent-tooltip.tsx — Hover tooltip showing agent details.
//
// Rendered as a normal DOM <div> positioned absolutely over the canvas.
// Not painted on the canvas itself — keeps event propagation and Tailwind styling simple.
// Visibility is controlled by the `agent` prop: null → renders nothing.

export interface HoveredAgentInfo {
  id: string;
  class: string;
  position: number;
  /** Pre-formatted inventory lines, e.g. ["L1.yellow-like.yellow = 1.0", ...] */
  inventoryLines: string[];
}

interface AgentTooltipProps {
  agent: HoveredAgentInfo | null;
  pointerX: number;
  pointerY: number;
}

export function AgentTooltip({ agent, pointerX, pointerY }: AgentTooltipProps) {
  if (!agent) return null;

  return (
    <div
      data-testid="agent-tooltip"
      className="pointer-events-none absolute z-10 rounded border border-gray-300 bg-white p-3 text-xs font-mono shadow-lg"
      style={{ left: pointerX + 12, top: pointerY + 12 }}
    >
      <div className="font-semibold text-gray-900">Agent {agent.id}</div>
      <div className="mt-1 text-gray-700">Class: {agent.class}</div>
      <div className="text-gray-700">Position: {agent.position}</div>
      {agent.inventoryLines.length > 0 && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre text-gray-600">
          {agent.inventoryLines.join('\n')}
        </pre>
      )}
    </div>
  );
}
