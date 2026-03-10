"use client";

import { useState } from "react";
import Link from "next/link";
import type { GraphData, NoteStatus } from "@/lib/vault";
import GraphCanvas from "./GraphCanvas";

interface NoteMeta {
  slug: string;
  title: string;
  status: NoteStatus;
  excerpt: string;
  backlinks: { slug: string; title: string; excerpt: string }[];
}

interface GraphPageClientProps {
  graph: GraphData;
  notes: NoteMeta[];
}

export default function GraphPageClient({ graph, notes }: GraphPageClientProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [isLinkHovered, setIsLinkHovered] = useState(false);

  const selected = selectedSlug
    ? (notes.find((note) => note.slug === selectedSlug) ?? null)
    : null;

  return (
    <>
      <GraphCanvas
        graph={graph}
        selectedSlug={selectedSlug}
        onSelectNode={setSelectedSlug}
        isLinkHovered={isLinkHovered}
      />

      {selected && (
        <aside className="graph-panel">
          <div className="graph-panel-inner">
            <div className="graph-panel-header">
              <span className={`note-status-dot status-${selected.status}`} />
              <h2 className="graph-panel-title">{selected.title}</h2>
            </div>
            <div className="graph-panel-excerpt">{selected.excerpt}</div>
            {selected.backlinks.length > 0 && (
              <div className="graph-panel-backlinks">
                <div className="graph-panel-backlinks-label">BACKLINKS</div>
                <ul>
                  {selected.backlinks.map((b) => (
                    <li key={b.slug}>{b.title}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="graph-panel-footer">
              <Link href={`/notes/${selected.slug}`} className="graph-panel-link">
                OPEN NOTE
              </Link>
            </div>
          </div>
        </aside>
      )}

      {/* Fixed bottom-left return link — brightens organ 2 on hover */}
      <Link
        href="/"
        className="return-to-void"
        onMouseEnter={() => setIsLinkHovered(true)}
        onMouseLeave={() => setIsLinkHovered(false)}
      >
        ↖ RETURN TO VOID
      </Link>
    </>
  );
}
