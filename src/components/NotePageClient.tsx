"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

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
}: NotePageClientProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let index = 0;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: Node) {
          if (!node.nodeValue || node.nodeValue.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }

          let current: Node | null = node;
          while (current && current !== root) {
            if (current instanceof HTMLElement) {
              const tag = current.tagName.toLowerCase();
              if (tag === "code" || tag === "pre" || tag === "blockquote") {
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
        span.dataset.index = String(index++);
        span.textContent = text[i];
        frag.appendChild(span);
      }
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }

    const paragraphs = Array.from(
      root.querySelectorAll<HTMLElement>(".note-body p")
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
      const limit = Math.floor(spans.length * 0.4);
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

      const fromLeft =
        Math.random() < 0.5 || s.left === 0 || s.right === s.spans.length - 1;
      const index = fromLeft ? s.left : s.right;
      const span = s.spans[index];

      if (fromLeft) s.left += 1;
      else s.right -= 1;
      s.consumed += 1;
      return span;
    };

    if (!hasCapacity()) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("creature-start-feeding", {
        detail: {
          targetRect: root
            .querySelector(".note-body")
            ?.getBoundingClientRect(),
        },
      })
    );

    const interval = window.setInterval(() => {
      if (!hasCapacity()) {
        window.clearInterval(interval);
        window.dispatchEvent(new CustomEvent("creature-stop-feeding"));
        return;
      }

      const count = 3 + Math.floor(Math.random() * 3); // 3–5 characters
      for (let i = 0; i < count; i++) {
        const span = pickNextSpan();
        if (!span) break;

        span.classList.add("char-targeted");

        const rect = span.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        window.dispatchEvent(
          new CustomEvent("creature-char-consumed", {
            detail: { x: centerX, y: centerY },
          })
        );

        window.setTimeout(() => {
          span.classList.add("char-consumed");
        }, 300);
      }
    }, 800);

    return () => {
      window.dispatchEvent(new CustomEvent("creature-stop-feeding"));
      window.clearInterval(interval);
    };
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

      <article className="note-body">{children}</article>

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

