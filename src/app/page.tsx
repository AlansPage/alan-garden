import { getAllNotes, getVaultStats } from "@/lib/vault";
import HomeShell from "@/components/HomeShell";
import CreatureCanvas from "@/components/CreatureCanvas";

export default function Home() {
  const stats = getVaultStats();
  const all = getAllNotes();

  const items = all.map((note) => ({
    slug: note.slug,
    title: note.frontmatter.title,
    type: note.type,
    tags: note.frontmatter.tags,
    excerpt: note.frontmatter.excerpt,
  }));

  return (
    <div>
      <CreatureCanvas />
      <HomeShell stats={stats} items={items} />
    </div>
  );
}
