"use client";

import { useRef } from "react";
import CreatureCanvas, { CreatureRef } from "./CreatureCanvas";
import NotePageClient from "./NotePageClient";

type NoteStatus = "seedling" | "budding" | "evergreen";

interface Backlink {
  slug: string;
  title: string;
  excerpt: string;
}

interface NoteShellProps {
  slug: string;
  title: string;
  status: NoteStatus;
  date: string;
  lastTended: string;
  tags: string[];
  content: string;
  wordCount: number;
  minutes: number;
  backlinks: Backlink[];
  children: React.ReactNode;
  disableFeeding?: boolean;
  isEssay?: boolean;
}

export default function NoteShell(props: NoteShellProps) {
  const creatureRef = useRef<CreatureRef>(null);
  return (
    <>
      <CreatureCanvas ref={creatureRef} />
      <NotePageClient {...props} creatureRef={creatureRef} />
    </>
  );
}
