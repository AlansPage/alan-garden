import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getAllNotes, getNoteBySlug, getVaultStats } from "@/lib/vault";
import NoteShell from "@/components/NoteShell";

function transformWikilinks(content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const [rawSlug, labelOverride] = inner.split("|");
    const slug = rawSlug.trim().toLowerCase().replace(/\s+/g, "-");
    const label = (labelOverride ?? rawSlug).trim();
    return `[${label}](/notes/${slug})`;
  });
}

export async function generateStaticParams() {
  const all = getAllNotes().filter((n) => n.type === "note");
  return all.map((n) => ({ slug: n.slug }));
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const stats = getVaultStats();
  const note = getNoteBySlug(slug);
  if (!note || note.type !== "note") return notFound();
  const transformed = transformWikilinks(note.content);
  const wordCount = note.content
    .split(/\s+/)
    .filter((t) => t.trim().length > 0).length;
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return (
    <NoteShell
      slug={note.slug}
      title={note.frontmatter.title}
      status={note.frontmatter.status}
      date={note.frontmatter.date}
      lastTended={note.frontmatter.lastTended}
      tags={note.frontmatter.tags}
      content={note.content}
      wordCount={wordCount}
      minutes={minutes}
      backlinks={note.backlinks}
      noteCount={stats.totalNotes}
      totalWords={stats.totalWords}
    >
      <MDXRemote source={transformed} />
    </NoteShell>
  );
}
