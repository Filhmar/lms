/**
 * Microcopy library — English, with Filipino samples.
 * Verbatim from the design's State Language spec. FIL strings are drafts
 * for translator review; they set the register (warm, plain, second person).
 *
 * Hard rules:
 * 1. Never color alone — shape + label always travel with it.
 * 2. Red only when the user's action helps — action in the same sentence.
 * 3. Amber is calm. "On this phone" is safety, not danger.
 * 4. Counts over adjectives: "12 of 60 sent" beats "sending…".
 * 5. No blocking spinner anywhere.
 * 6. Every reassurance names the place: "on this phone", "at your school".
 */

export type WorkState = "synced" | "on-device" | "sending" | "attention";

export const stateLabels = {
  synced: ["Sent to school", "At your school", "Up to date"],
  "on-device": ["Saved on this phone", "Saved on this device"],
  sending: ["Sending {sent} of {total}…", "continues in background"],
  attention: ["Connect to finish sending"],
} as const;

export const exam = {
  ready: "Exam is on this phone — works with no signal.",
  safetyStrip: {
    en: "Your answers save on this phone as you go. No internet needed.",
    fil: "Awtomatikong nase-save sa cellphone mo ang mga sagot mo. Hindi kailangan ng internet.",
  },
  answerSaved: {
    en: "Saved on this phone · just now",
    fil: "Naka-save sa cellphone mo · ngayon lang",
  },
  timerFiveMin: "5 min left",
  timerFinalMinute: "Almost up — your answers are already saved.",
  leaveAttempt:
    "Leave the exam? Your answers stay saved on this phone, but the timer keeps running.",
  crashRecovery: (name: string, count: number) => ({
    en: `Welcome back, ${name} — your ${count} answers are safe on this phone.`,
    fil: `Welcome back, ${name} — ligtas sa cellphone mo ang ${count} sagot mo.`,
  }),
  submitConfirm: (count: number) =>
    `Submit ${count} answers? Once submitted, answers can't be changed. Everything is already saved on this phone.`,
  submitted: (time: string) =>
    `Exam submitted ✓ — saved on this phone at ${time}. It cannot be lost.`,
  uploadingAndroid: (sent: number, total: number) => ({
    en: `Sending to school: ${sent} of ${total}. You can close this app — sending continues in the background.`,
    fil: `Ipinapadala sa paaralan: ${sent} sa ${total}. Puwede mong isara ang app.`,
  }),
  uploadingOffline: {
    en: "No signal right now — your answers will send automatically the moment you're connected. You can close the app.",
    fil: "Walang signal ngayon — awtomatikong maipapadala kapag nakakonekta ka na.",
  },
  iosKeepOpen:
    "Keep the app open until sending finishes. iPhones pause sending when the app closes. Your answers stay safe either way.",
  iosRemind: "Remind me to reopen",
  escalation: {
    en: "Connect to Wi-Fi or data to finish sending your exam. Your answers are safe meanwhile.",
    fil: "Kumonekta sa Wi-Fi o data para matapos maipadala ang exam mo. Ligtas pa rin ang mga sagot mo.",
  },
} as const;

export const syncCenter = {
  pillAllClear: "Up to date",
  pillAllSent: "All sent to school",
  pillResting: (count: number) => `On this phone · ${count}`,
  sendNowOffline:
    "No connection — everything sends automatically when signal returns.",
  dataCost: (kb: number) => `Sending uses about ${kb} KB of data.`,
  downloadAsk: (size: string) =>
    `Download this exam? ${size} — uses your mobile data once. After that it works with no signal.`,
  downloadStalled:
    "No signal — download will continue automatically. Nothing is lost.",
  contentUpdated: (scope: string, pages: number, chapter: string, size: string) =>
    `Your ${scope} updated ${pages} pages in ${chapter} — Download ${pages} changed pages · ${size}`,
  badgePending: (badge: string) =>
    `You earned ${badge} — it's safe on this phone. It becomes official once your school confirms it. No action needed.`,
} as const;

export const environment = {
  offline: "You're offline — everything on this phone still works.",
  dataSaver: "Pages load when you tap. Nothing downloads by itself.",
  storageFull: "Storage almost full — downloads may pause soon. Free up space.",
  firstRun: "Setting up your offline library… you can start reading now.",
  updateReady: "A new version is ready.",
  sessionExpired: "Sign in again to send your work — nothing was lost.",
  crossDeviceMerge:
    "Progress from your other device was added — nothing was lost.",
} as const;
