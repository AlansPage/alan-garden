import { getAllNotes, getGraphData } from "@/lib/vault";
import GraphPageClient from "@/components/GraphPageClient";

export default function GraphPage() {
  const graph = getGraphData();
  const notes = getAllNotes().filter((note) => note.type === "note");

  const noteMeta = notes.map((note) => ({
    slug: note.slug,
    title: note.frontmatter.title,
    status: note.frontmatter.status,
    excerpt: note.frontmatter.excerpt,
    backlinks: note.backlinks,
  }));

  return <GraphPageClient graph={graph} notes={noteMeta} />;
}

