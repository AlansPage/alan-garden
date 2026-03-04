"use client";

import { useState } from "react";
import type { GraphData, NoteStatus } from "@/lib/vault";
import GraphCanvas from "./GraphCanvas";
import Link from "next/link";

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
  const selected = selectedSlug
    ? notes.find((note) => note.slug === selectedSlug) ?? null
    : null;

  return (
    <>
      <GraphCanvas
        graph={graph}
        selectedSlug={selectedSlug}
        onSelectNode={setSelectedSlug}
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
    </>
  );
}

