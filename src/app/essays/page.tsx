import { getAllNotes, getVaultStats } from "@/lib/vault";
import CreatureCanvas from "@/components/CreatureCanvas";
import EssayList from "@/components/EssayList";

export default function EssaysPage() {
  const stats = getVaultStats();
  const essays = getAllNotes()
    .filter((n) => n.type === "essay")
    .map((n) => ({
      slug: n.slug,
      title: n.frontmatter.title,
      status: n.frontmatter.status,
      date: n.frontmatter.date,
      tags: n.frontmatter.tags,
      excerpt: n.frontmatter.excerpt,
    }));

  return (
    <div>
      <CreatureCanvas noteCount={stats.totalNotes} totalWords={stats.totalWords} />

      <header className="site-id">
        <div className="site-id-label">ALAN_GARDEN</div>
        <div className="site-id-line" />
      </header>

      <main className="listing-page-center">
        <div className="listing-section-label">ESSAYS</div>
        <div className="listing-section-rule" />

        <EssayList essays={essays} />
      </main>

      <div className="home-status listing-page-status">
        VAULT_STATUS: {stats.noteCount} NOTES · {stats.essayCount} ESSAYS ·
        LAST_UPDATE: {stats.lastUpdate}
      </div>
    </div>
  );
}
