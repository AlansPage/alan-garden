"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Fuse from "fuse.js";
import type { VaultStats } from "@/lib/vault";

type ContentType = "note" | "essay" | "project";

interface SearchItem {
  slug: string;
  title: string;
  type: ContentType;
  tags: string[];
  excerpt: string;
}

interface HomeShellProps {
  stats: VaultStats;
  items: SearchItem[];
}

export default function HomeShell({ stats, items }: HomeShellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: ["title", "tags", "excerpt"],
        threshold: 0.35,
        includeMatches: true,
      }),
    [items]
  );

  const results = useMemo(() => {
    if (!query.trim()) return items;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse, items]);

  const dispatchDim = (dim: boolean) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("creature-dim", {
        detail: dim,
      })
    );
  };

  const openOverlay = () => {
    setOpen(true);
    setActiveIndex(0);
    dispatchDim(true);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const closeOverlay = () => {
    setOpen(false);
    dispatchDim(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          closeOverlay();
        } else {
          openOverlay();
        }
      }

      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) =>
          results.length === 0 ? 0 : (prev + 1) % results.length
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) =>
          results.length === 0
            ? 0
            : (prev - 1 + results.length) % results.length
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        const target = results[activeIndex];
        if (target) {
          const base =
            target.type === "essay"
              ? "/essays"
              : target.type === "project"
              ? "/projects"
              : "/notes";
          closeOverlay();
          router.push(`${base}/${target.slug}`);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, results, activeIndex, router]);

  const onSearchBarMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    openOverlay();
  };

  const onSearchBarFocus = (event: React.FocusEvent) => {
    event.preventDefault();
    openOverlay();
  };

  const renderTypeTag = (type: ContentType) => {
    if (type === "essay") return "#essay";
    if (type === "project") return "#project";
    return "#note";
  };

  return (
    <>
      <header className="site-id">
        <div className="site-id-label">ALAN_GARDEN</div>
        <div className="site-id-line" />
      </header>

      <main className="home-center">
        <button
          type="button"
          className="home-search"
          onMouseDown={onSearchBarMouseDown}
          onFocus={onSearchBarFocus}
        >
          <div className="home-search-icon">⌕</div>
          <div className="home-search-input home-search-input-static">
            Query vault...
          </div>
          <div className="home-search-kbd">
            <span>⌘</span>
            <span>K</span>
          </div>
        </button>

        <nav className="home-nav">
          <span className="home-nav-item">ESSAYS</span>
          <span className="home-nav-sep">·</span>
          <span className="home-nav-item">NOTES</span>
          <span className="home-nav-sep">·</span>
          <span className="home-nav-item">GRAPH</span>
          <span className="home-nav-sep">·</span>
          <span className="home-nav-item">NOW</span>
        </nav>

        <div className="home-status">
          VAULT_STATUS: {stats.noteCount} NOTES · {stats.essayCount} ESSAYS ·
          LAST_UPDATE: {stats.lastUpdate}
        </div>
      </main>

      {open && (
        <div
          className="search-overlay"
          onClick={() => {
            closeOverlay();
          }}
        >
          <div
            className="search-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              className="search-input"
              placeholder="Query vault..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
            />
            <div className="search-results">
              {results.map((item, index) => (
                <div
                  key={`${item.type}-${item.slug}`}
                  className={
                    index === activeIndex
                      ? "search-result search-result-active"
                      : "search-result"
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    const base =
                      item.type === "essay"
                        ? "/essays"
                        : item.type === "project"
                        ? "/projects"
                        : "/notes";
                    closeOverlay();
                    router.push(`${base}/${item.slug}`);
                  }}
                >
                  <div className="search-result-header">
                    <div className="search-result-title">{item.title}</div>
                    <div className="search-result-type">
                      {renderTypeTag(item.type)}
                    </div>
                  </div>
                  <div className="search-result-excerpt">
                    {item.excerpt}
                  </div>
                  <div className="search-result-separator" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

