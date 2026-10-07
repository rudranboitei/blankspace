import type { Metadata } from "next";

import { LibraryScreen } from "@/components/library-screen";

export const metadata: Metadata = {
  title: "Library",
  description: "Your saved English phrase patterns.",
};

export default function LibraryPage() {
  return <LibraryScreen />;
}