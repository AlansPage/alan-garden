import { getAllNotes, getVaultStats } from "@/lib/vault";
import CreatureCanvas from "@/components/CreatureCanvas";
import NoteList from "@/components/NoteList";

export default function NotesPage() {
  const stats = getVaultStats();
  const notes = getAllNotes()
    .filter((n) => n.type === "note")
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
        <div className="listing-section-label">NOTES</div>
        <div className="listing-section-rule" />

        <NoteList notes={notes} />
      </main>

      <div className="home-status listing-page-status">
        VAULT_STATUS: {stats.noteCount} NOTES · {stats.essayCount} ESSAYS ·
        LAST_UPDATE: {stats.lastUpdate}
      </div>
    </div>
  );
}
