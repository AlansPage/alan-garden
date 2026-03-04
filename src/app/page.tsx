import { getAllNotes, getVaultStats } from "@/lib/vault";
import HomeShell from "@/components/HomeShell";

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

  return <HomeShell stats={stats} items={items} />;
}
