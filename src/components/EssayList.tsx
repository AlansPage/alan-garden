"use client";

import { useRouter } from "next/navigation";

interface EssayItem {
  slug: string;
  title: string;
  status: string;
  date: string;
  tags: string[];
  excerpt: string;
}

interface EssayListProps {
  essays: EssayItem[];
}

export default function EssayList({ essays }: EssayListProps) {
  const router = useRouter();

  return (
    <div className="listing-items">
      <div className="listing-rail" />
      {essays.map((essay) => (
        <div
          key={essay.slug}
          className="listing-item"
          onClick={() => router.push(`/essays/${essay.slug}`)}
        >
          <div className="listing-title-row">
            <span className={`listing-dot listing-dot-${essay.status}`} />
            <span className="listing-title">{essay.title}</span>
          </div>
          <div className="listing-meta">{essay.date}</div>
          <div className="listing-excerpt">{essay.excerpt}</div>
          {essay.tags.length > 0 && (
            <div className="listing-tags">
              {essay.tags.map((tag) => (
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
