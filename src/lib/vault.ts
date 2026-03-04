import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "content");

export type ContentType = "note" | "essay" | "project";

export type NoteStatus = "seedling" | "budding" | "evergreen";

export interface NoteFrontmatter {
  title: string;
  date: string;
  lastTended: string;
  status: NoteStatus;
  tags: string[];
  excerpt: string;
}

export interface Note {
  slug: string;
  type: ContentType;
  frontmatter: NoteFrontmatter;
  content: string;
  backlinks: { slug: string; title: string; excerpt: string }[];
}

export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  type: ContentType;
  status: NoteStatus;
  backlinkCount: number;
  excerpt: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VaultStats {
  noteCount: number;
  essayCount: number;
  lastUpdate: string;
}

function getAllContentFiles(): { filePath: string; type: ContentType }[] {
  const files: { filePath: string; type: ContentType }[] = [];

  const types: ContentType[] = ["notes", "essays", "projects"];
  const typeMap: Record<string, ContentType> = {
    notes: "note",
    essays: "essay",
    projects: "project",
  };

  for (const typeDir of types) {
    const dirPath = path.join(CONTENT_DIR, typeDir);
    if (!fs.existsSync(dirPath)) continue;

    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      if (fs.statSync(fullPath).isFile() && item.endsWith(".md")) {
        files.push({ filePath: fullPath, type: typeMap[typeDir] });
      }
    }
  }

  return files;
}

function slugFromPath(filePath: string): string {
  const basename = path.basename(filePath, ".md");
  return basename.toLowerCase().replace(/\s+/g, "-");
}

function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const slugs = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    const link = match[1].split("|")[0].trim().toLowerCase().replace(/\s+/g, "-");
    slugs.add(link);
  }
  return Array.from(slugs);
}

function parseNote(
  filePath: string,
  type: ContentType
): { slug: string; frontmatter: NoteFrontmatter; content: string } {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const slug = slugFromPath(filePath);

  return {
    slug,
    frontmatter: {
      title: data.title ?? "Untitled",
      date: data.date ?? "",
      lastTended: data.lastTended ?? data.date ?? "",
      status: data.status ?? "seedling",
      tags: Array.isArray(data.tags) ? data.tags : [],
      excerpt: data.excerpt ?? content.slice(0, 200).replace(/\n/g, " "),
    },
    content,
  };
}

export function getAllNotes(): Note[] {
  const files = getAllContentFiles();
  const allNotes: Note[] = [];
  const slugToNote = new Map<string, Note>();

  for (const { filePath, type } of files) {
    const { slug, frontmatter, content } = parseNote(filePath, type);
    const note: Note = {
      slug,
      type,
      frontmatter,
      content,
      backlinks: [],
    };
    allNotes.push(note);
    slugToNote.set(slug, note);
  }

  for (const note of allNotes) {
    const wikilinks = extractWikilinks(note.content);
    for (const targetSlug of wikilinks) {
      const target = slugToNote.get(targetSlug);
      if (target) {
        target.backlinks = target.backlinks ?? [];
        target.backlinks.push({
          slug: note.slug,
          title: note.frontmatter.title,
          excerpt: note.frontmatter.excerpt.slice(0, 200),
        });
      }
    }
  }

  return allNotes.sort(
    (a, b) =>
      new Date(b.frontmatter.lastTended).getTime() -
      new Date(a.frontmatter.lastTended).getTime()
  );
}

export function getNoteBySlug(slug: string): Note | null {
  const all = getAllNotes();
  return all.find((n) => n.slug === slug) ?? null;
}

export function getGraphData(): GraphData {
  const all = getAllNotes();
  const backlinkCount = new Map<string, number>();

  for (const note of all) {
    backlinkCount.set(note.slug, note.backlinks?.length ?? 0);
  }

  const nodes: GraphNode[] = all.map((note) => ({
    id: note.slug,
    slug: note.slug,
    title: note.frontmatter.title,
    type: note.type,
    status: note.frontmatter.status,
    backlinkCount: backlinkCount.get(note.slug) ?? 0,
    excerpt: note.frontmatter.excerpt,
  }));

  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const note of all) {
    const wikilinks = extractWikilinks(note.content);
    for (const targetSlug of wikilinks) {
      const target = all.find((n) => n.slug === targetSlug);
      if (target) {
        const key = `${note.slug}->${targetSlug}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: note.slug, target: targetSlug });
        }
      }
    }
  }

  return { nodes, edges };
}

export function getVaultStats(): VaultStats {
  const all = getAllNotes();
  const noteCount = all.filter((n) => n.type === "note").length;
  const essayCount = all.filter((n) => n.type === "essay").length;

  let lastUpdate = "";
  for (const n of all) {
    const d = n.frontmatter.lastTended;
    if (d && (!lastUpdate || d > lastUpdate)) lastUpdate = d;
  }

  return {
    noteCount,
    essayCount,
    lastUpdate: lastUpdate || new Date().toISOString().slice(0, 10),
  };
}
