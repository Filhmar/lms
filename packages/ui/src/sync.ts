import type { IconName } from "./icons";

/**
 * The four work states of the state language. Shape + color always travel
 * together — never color alone.
 *
 * - synced     cloud    "Sent to school" — work has reached the school server
 * - on-device  phone    "Saved on this phone" — safe locally, calm resting state
 * - sending    up-arrow "Sending X of Y…" — background transfer, never blocks
 * - attention  triangle "Needs you" — only when the user's action helps
 */
export type WorkState = "synced" | "on-device" | "sending" | "attention";

export const WORK_STATE_ICON: Record<WorkState, IconName> = {
  synced: "cloud-check",
  "on-device": "phone-check",
  sending: "send",
  attention: "attention",
};

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  synced: "Up to date",
  "on-device": "Saved on this phone",
  sending: "Sending…",
  attention: "Needs Wi-Fi",
};
