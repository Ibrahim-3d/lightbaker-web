import { signal } from "@preact/signals";
export type BakeStatus = "idle" | "baking" | "done" | "error";
export const bakeStatus = signal<BakeStatus>("idle");
export const isStale = signal(true);
export const renderMode = signal<string>("lit");
