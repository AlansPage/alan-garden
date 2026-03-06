"use client";

import { RefObject, useEffect, useRef } from "react";
import Link from "next/link";
import { CreatureRef } from "./CreatureCanvas";

type NoteStatus = "seedling" | "budding" | "evergreen";

interface Backlink {
  slug: string;
  title: string;
  excerpt: string;
}

interface NotePageClientProps {
  slug: string;
  title: string;
  status: NoteStatus;
  date: string;
  lastTended: string;
  tags: string[];
  content: string;
  wordCount: number;
  minutes: number;
  backlinks: Backlink[];
  children: React.ReactNode;
  creatureRef?: RefObject<CreatureRef | null>;
  disableFeeding?: boolean;
  isEssay?: boolean;
}

export default function NotePageClient({
  slug: _slug,
  title,
  status,
  date,
  lastTended,
  tags,
  content,
  wordCount,
  minutes,
  backlinks,
  children,
  creatureRef,
  disableFeeding = false,
  isEssay = false,
}: NotePageClientProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Notify the creature that a note has been opened — fire-and-forget
    if (!disableFeeding) {
      creatureRef?.current?.triggerFeed(
        window.innerWidth / 2,
        window.innerHeight / 2,
        { wordCount, tags }
      );
    }

    // ── Character wrapping ────────────────────────────────────────────────────
    // Restrict to the note body element only (not header / backlinks)
    const noteBody = root.querySelector<HTMLElement>(".note-body");
    if (!noteBody) return;

    let index = 0;

    const walker = document.createTreeWalker(
      noteBody,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: Node) {
          if (!node.nodeValue || node.nodeValue.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip blockquote, code, pre descendants
          let current: Node | null = node;
          while (current && current !== noteBody) {
            if (current instanceof HTMLElement) {
              const tag = current.tagName.toLowerCase();
              if (tag === "blockquote" || tag === "code" || tag === "pre") {
                return NodeFilter.FILTER_REJECT;
              }
            }
            current = current.parentNode;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      } as unknown as NodeFilter
    );

    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current.nodeType === Node.TEXT_NODE) {
        textNodes.push(current as Text);
      }
    }

    for (const textNode of textNodes) {
      const text = textNode.nodeValue ?? "";
      const frag = document.createDocumentFragment();
      for (let i = 0; i < text.length; i++) {
        const span = document.createElement("span");
        span.className = "char";
        span.dataset.charIndex = String(index++);
        span.style.display = "inline-block";
        span.textContent = text[i];
        frag.appendChild(span);
      }
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }

    // ── Consumption setup ─────────────────────────────────────────────────────
    const paragraphs = Array.from(
      noteBody.querySelectorAll<HTMLElement>("p")
    );

    type EdgeState = {
      spans: HTMLSpanElement[];
      left: number;
      right: number;
      limit: number;
      consumed: number;
    };

    const edgeStates: EdgeState[] = paragraphs.map((p) => {
      const spans = Array.from(p.querySelectorAll<HTMLSpanElement>(".char"));
      // Never consume more than 35% of any paragraph
      const limit = Math.floor(spans.length * 0.35);
      return {
        spans,
        left: 0,
        right: spans.length - 1,
        limit,
        consumed: 0,
      };
    });

    const hasCapacity = () =>
      edgeStates.some((s) => s.consumed < s.limit && s.spans.length > 0);

    const pickNextSpan = (): HTMLSpanElement | null => {
      const candidates = edgeStates.filter(
        (s) => s.consumed < s.limit && s.spans.length > 0 && s.left <= s.right
      );
      if (candidates.length === 0) return null;
      const s = candidates[Math.floor(Math.random() * candidates.length)];

      // Alternate edges; bias toward whichever has more to offer
      const fromLeft = Math.random() < 0.5;
      const idx = fromLeft ? s.left : s.right;
      const span = s.spans[idx];

      if (fromLeft) s.left += 1;
      else s.right -= 1;
      s.consumed += 1;
      return span;
    };

    if (!hasCapacity() || disableFeeding) return;

    const consumptionRate = Math.min(
      8,
      3 + Math.floor(wordCount / 200)
    );
    // Interval in ms so we hit consumptionRate chars/sec
    const intervalMs = Math.round(1000 / consumptionRate);

    const interval = window.setInterval(() => {
      if (!hasCapacity()) {
        window.clearInterval(interval);
        window.dispatchEvent(new CustomEvent("creature-stop-feeding"));
        return;
      }

      const span = pickNextSpan();
      if (!span) return;

      const rect = span.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Signal the creature so it can spawn particles at this char's position
      window.dispatchEvent(
        new CustomEvent("creature-char-consumed", {
          detail: { x: cx, y: cy },
        })
      );

      // CSS transition: highlight then dissolve
      span.classList.add("char-targeted");
      window.setTimeout(() => {
        span.classList.add("char-consumed");
      }, 200);
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
      window.dispatchEvent(new CustomEvent("creature-stop-feeding"));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  return (
    <div className="note-page-root" ref={rootRef}>
      <header className="note-header">
        <div className="note-title-row">
          <span className={`note-status-dot status-${status}`} />
          <h1 className="note-title">{title}</h1>
        </div>
        <div className="note-meta-row">
          <div className="note-meta-left">
            <span>PLANTED: {date}</span>
            <span className="note-meta-sep">·</span>
            <span>TENDED: {lastTended}</span>
          </div>
          <div className="note-meta-right">
            <span>
              {wordCount} WORDS · {minutes} MIN READ
            </span>
          </div>
        </div>
        {tags.length > 0 && (
          <div className="note-tags">
            {tags.map((tag) => (
              <span key={tag} className="note-tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <article data-note-body className={isEssay ? "note-body essay-body" : "note-body"}>
        {children}
      </article>

      {backlinks.length > 0 && (
        <section className="note-backlinks">
          <div className="note-backlinks-separator" />
          <div className="note-backlinks-label">REFERENCED BY</div>
          <div className="note-backlinks-list">
            {backlinks.map((backlink) => (
              <Link
                key={backlink.slug}
                href={`/notes/${backlink.slug}`}
                className="note-backlink"
              >
                <div className="note-backlink-title">{backlink.title}</div>
                <div className="note-backlink-excerpt">
                  {backlink.excerpt}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
