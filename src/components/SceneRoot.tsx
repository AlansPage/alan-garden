"use client";

import { usePathname } from "next/navigation";
import CreatureCanvas from "./CreatureCanvas";

export default function SceneRoot() {
  const pathname = usePathname();

  if (pathname === "/graph") {
    return null;
  }

  return <CreatureCanvas />;
}

