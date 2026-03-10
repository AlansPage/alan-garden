import matter from "gray-matter";
import { writeFile } from "fs/promises";
import { join } from "path";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "dev only" }, { status: 403 });
  }

  const { filename, content } = await req.json();

  const slug = filename
    .replace(/\.md$/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const parsed = matter(content);

  const today = new Date().toISOString().split("T")[0];

  const frontmatter = {
    title: parsed.data.title ?? slug.replace(/-/g, " "),
    date: parsed.data.date ?? today,
    lastTended: today,
    status: parsed.data.status ?? "seedling",
    tags: parsed.data.tags ?? [],
    excerpt:
      parsed.data.excerpt ??
      parsed.content.trim().slice(0, 120) + "...",
  };

  const output = matter.stringify(parsed.content, frontmatter);

  const filePath = join(process.cwd(), "content/notes", `${slug}.md`);
  await writeFile(filePath, output, "utf-8");

  const wordCount = parsed.content
    .split(/\s+/)
    .filter(Boolean).length;

  return Response.json({
    slug,
    title: frontmatter.title,
    tags: frontmatter.tags,
    wordCount,
  });
}
