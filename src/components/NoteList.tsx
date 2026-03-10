"use client";

import { useZoomNavigate } from "@/components/TransitionLayer";

interface NoteItem {
  slug: string;
  title: string;
  status: string;
  date: string;
  tags: string[];
  excerpt: string;
}

interface NoteListProps {
  notes: NoteItem[];
}

export default function NoteList({ notes }: NoteListProps) {
  const zoomTo = useZoomNavigate();

  return (
    <div className="listing-items">
      <div className="listing-rail" />
      {notes.map((note) => (
        <div
          key={note.slug}
          className="listing-item"
          onClick={(e) => zoomTo(`/notes/${note.slug}`, e)}
        >
          <div className="listing-title-row">
            <span className={`listing-dot listing-dot-${note.status}`} />
            <span className="listing-title">{note.title}</span>
          </div>
          <div className="listing-meta">{note.date}</div>
          <div className="listing-excerpt">{note.excerpt}</div>
          {note.tags.length > 0 && (
            <div className="listing-tags">
              {note.tags.map((tag) => (
                <span key={tag} className="listing-tag">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
