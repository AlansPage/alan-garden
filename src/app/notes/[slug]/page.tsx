import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getAllNotes, getNoteBySlug } from "@/lib/vault";
import NoteShell from "@/components/NoteShell";

interface NotePageProps {
  params: {
    slug: string;
  };
}

function transformWikilinksToMarkdownLinks(content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const [rawSlug, labelOverride] = inner.split("|");
    const slug = rawSlug.trim().toLowerCase().replace(/\s+/g, "-");
    const label = (labelOverride ?? rawSlug).trim();
    return `[${label}](/notes/${slug})`;
  });
}

export async function generateStaticParams() {
  const all = getAllNotes().filter((note) => note.type === "note");
  return all.map((note) => ({ slug: note.slug }));
}

export default function NotePage({ params }: NotePageProps) {
  const note = getNoteBySlug(params.slug);

  if (!note || note.type !== "note") {
    return notFound();
  }

  const transformed = transformWikilinksToMarkdownLinks(note.content);

  const wordCount = note.content
    .split(/\s+/)
    .filter((token) => token.trim().length > 0).length;
  const minutes = Math.max(1, Math.round(wordCount / 200));

  const mdx = <MDXRemote source={transformed} />;

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
    >
      {mdx}
    </NoteShell>
  );
}

