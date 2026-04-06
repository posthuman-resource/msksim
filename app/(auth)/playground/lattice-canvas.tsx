'use client';

// app/(auth)/playground/lattice-canvas.tsx — HTML5 Canvas 2D lattice renderer.
//
// Draws a 2D grid of colored cells — one cell per agent in the given world.
// Uses requestAnimationFrame only when cells or projection change (not every frame).
// Hit-testing is O(1): pointer coords divided by cellSize.
// ResizeObserver handles container resizing + high-DPI backing store.
//
// Performance decisions:
// - fillRect exclusively (no beginPath/rect/fill per cell)
// - Cells batched by color before drawing (one fillStyle write per distinct color)
// - Matching-rate colors quantized to MATCHING_RATE_BINS buckets (cap distinct fillStyle calls)
// - rAF dirty-flag pattern: redraws only when the cell list or projection changes
//
// Reference: CLAUDE.md 'Worker lifecycle', MDN CanvasRenderingContext2D

import { useEffect, useRef, useMemo } from 'react';

import type { CellData, ProjectionKind, WorldId } from '@/lib/sim/worker-client';
import { classToColor, tokenToColor, matchingRateToColor } from './colors';

const MATCHING_RATE_BINS = 32;
const CELL_GAP = 1; // 1-pixel gutter between cells

interface LatticeCanvasProps {
  world: WorldId;
  projectionKind: ProjectionKind;
  cells: CellData[];
  latticeWidth: number;
  latticeHeight: number;
  onHoverCell: (position: number | null, clientX: number, clientY: number) => void;
}

export function LatticeCanvas({
  world,
  projectionKind,
  cells,
  latticeWidth,
  latticeHeight,
  onHoverCell,
}: LatticeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastHoveredPosition = useRef<number | null>(null);

  // O(1) lookup by position for hover hit-testing.
  const cellsByPosition = useMemo(
    () => new Map(cells.map((c) => [c.position, c])),
    [cells],
  );

  // All tokens present in the current cell list (for tokenToColor stable ordering).
  const allTokens = useMemo(() => {
    const seen = new Set<string>();
    for (const c of cells) {
      if (c.topToken) seen.add(c.topToken);
    }
    return Array.from(seen).sort();
  }, [cells]);

  /** Compute the color string for one cell given the active projection. */
  function colorForCell(cell: CellData): string {
    if (projectionKind === 'class') {
      return classToColor(cell.class);
    }
    if (projectionKind === 'dominant-token') {
      return cell.topToken ? tokenToColor(cell.topToken, allTokens) : '#9ca3af';
    }
    // matching-rate — quantize to MATCHING_RATE_BINS
    const rate = cell.matchingRate ?? 0;
    const bin = Math.round(rate * MATCHING_RATE_BINS) / MATCHING_RATE_BINS;
    return matchingRateToColor(bin);
  }

  /** Schedule a single rAF redraw. Cancels any pending frame first. */
  function scheduleDraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw(canvas);
    });
  }

  function draw(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return;

    // Reset transform and re-apply DPR scale so coordinates match CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear with a light gray background (empty cells fall through to this).
    ctx.fillStyle = '#f3f4f6'; // gray-100
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (latticeWidth === 0 || latticeHeight === 0) return;

    const cellW = cssWidth / latticeWidth;
    const cellH = cssHeight / latticeHeight;

    // Group cells by color to minimize fillStyle writes.
    const byColor = new Map<string, CellData[]>();
    for (const cell of cells) {
      const color = colorForCell(cell);
      let group = byColor.get(color);
      if (!group) {
        group = [];
        byColor.set(color, group);
      }
      group.push(cell);
    }

    // Draw each color group.
    for (const [color, group] of byColor) {
      ctx.fillStyle = color;
      for (const cell of group) {
        const cx = cell.position % latticeWidth;
        const cy = Math.floor(cell.position / latticeWidth);
        ctx.fillRect(
          cx * cellW,
          cy * cellH,
          cellW - CELL_GAP,
          cellH - CELL_GAP,
        );
      }
    }
  }

  // ─── Sizing effect (ResizeObserver) ──────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        scheduleDraw();
      }
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // scheduleDraw is stable (no deps); safe to exclude.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Draw effect (cells / projection / dimensions changed) ───────────────────

  useEffect(() => {
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, projectionKind, latticeWidth, latticeHeight, allTokens]);

  // ─── Hover effect (mousemove / mouseleave) ────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onMouseMove(e: MouseEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const cx = Math.floor((localX / rect.width) * latticeWidth);
      const cy = Math.floor((localY / rect.height) * latticeHeight);

      if (cx < 0 || cx >= latticeWidth || cy < 0 || cy >= latticeHeight) {
        if (lastHoveredPosition.current !== null) {
          lastHoveredPosition.current = null;
          onHoverCell(null, e.clientX, e.clientY);
        }
        return;
      }

      const position = cy * latticeWidth + cx;
      if (!cellsByPosition.has(position)) {
        if (lastHoveredPosition.current !== null) {
          lastHoveredPosition.current = null;
          onHoverCell(null, e.clientX, e.clientY);
        }
        return;
      }

      if (lastHoveredPosition.current !== position) {
        lastHoveredPosition.current = position;
        onHoverCell(position, e.clientX, e.clientY);
      }
    }

    function onMouseLeave() {
      if (lastHoveredPosition.current !== null) {
        lastHoveredPosition.current = null;
        onHoverCell(null, 0, 0);
      }
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [cellsByPosition, latticeWidth, latticeHeight, onHoverCell]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-square w-full max-w-[600px]"
    >
      <canvas
        ref={canvasRef}
        data-testid={`lattice-canvas-${world}`}
        className="block"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
