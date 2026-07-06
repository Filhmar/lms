/**
 * Demo dataset — exactly the content used across the Claude Design export.
 * Student Ana Reyes, Science 8 Quarter 2 exam (12 items, 30 min),
 * San Isidro NHS, Dasmariñas District, Division of Cavite, Region IV-A.
 */

export const student = {
  name: "Ana Reyes",
  shortName: "Ana",
  initials: "AR",
  grade: "Grade 8",
  school: "San Isidro NHS",
} as const;

export const scopeChain = [
  "Central",
  "Region IV-A",
  "Division of Cavite",
  "Dasmariñas District",
  "San Isidro NHS",
] as const;

export const teacher = { name: "Mr. Santos" } as const;

export type QuestionType = "mcq" | "tf" | "ident";

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options?: string[];
}

export const examQuestions: Question[] = [
  { id: "q1", type: "mcq", text: "Which of the following is a renewable source of energy?", options: ["Coal", "Solar energy", "Natural gas", "Diesel"] },
  { id: "q2", type: "mcq", text: "What gas do plants release during photosynthesis?", options: ["Carbon dioxide", "Nitrogen", "Oxygen", "Methane"] },
  { id: "q3", type: "tf", text: "True or false: the Philippines lies within the Pacific Ring of Fire.", options: ["True", "False"] },
  { id: "q4", type: "mcq", text: "Which cloud type usually brings thunderstorms?", options: ["Cirrus", "Cumulonimbus", "Stratus", "Altocumulus"] },
  { id: "q5", type: "ident", text: "What instrument is used to measure air pressure?" },
  { id: "q6", type: "mcq", text: "Which enzyme in saliva begins the digestion of starch?", options: ["Pepsin", "Lipase", "Amylase", "Trypsin"] },
  { id: "q7", type: "tf", text: "True or false: sound travels faster in water than in air.", options: ["True", "False"] },
  { id: "q8", type: "mcq", text: "Which is an example of Newton's third law of motion?", options: ["A book resting on a table", "A rocket pushing exhaust down and rising up", "A ball rolling down a hill", "A magnet attracting iron"] },
  { id: "q9", type: "mcq", text: "What is the chemical symbol of iron?", options: ["Ir", "In", "Fe", "I"] },
  { id: "q10", type: "ident", text: "Name the outermost layer of the Earth." },
  { id: "q11", type: "mcq", text: "In a flashlight, electrical energy is mainly transformed into…", options: ["Sound and heat", "Light and heat", "Motion and sound", "Chemical energy"] },
  { id: "q12", type: "tf", text: "True or false: the Sun is a planet.", options: ["True", "False"] },
];

export const exam = {
  id: "sci8-q2",
  title: "Science 8 · Quarter 2 Periodical",
  shortTitle: "Science 8 · Quarter 2",
  subject: "Science 8",
  quarter: "Quarter 2",
  items: 12,
  minutes: 30,
  durationSeconds: 1800,
  attempts: "one attempt",
  window: "Today, until 5 PM",
  downloadSize: "1.2 MB",
  gradedScore: "10/12",
  teacher: teacher.name,
} as const;

/** Seed answers used by Review/Submitted/Status states in the design:
 *  10 answered, Q8 & Q11 blank, Q4 flagged. */
export const seedAnswers: (number | string | null)[] = [1, 2, 0, 1, "Barometer", 2, 0, null, 2, "Crust", null, 1];
export const seedFlags: boolean[] = examQuestions.map((_, i) => i === 3);

export const otherExams = [
  { id: "fil8-unit", title: "Filipino 8 · Unit Test", status: "upcoming", note: "Opens Mon, July 13" },
  { id: "math8-q1", title: "Math 8 · Quarter 1", status: "graded", note: "Graded · 38/40" },
] as const;

export const outboxExtras = [
  { id: "reading-ch3", label: "Reading progress · Chapter 3", size: "2 KB" },
  { id: "badge-science-star", label: "Badge claim · Science Star", size: "1 KB" },
] as const;

export const syncPayloadKb = 40;

export const courses = [
  {
    id: "science-8",
    title: "Science 8",
    chapters: 10,
    progressPercent: 62,
    continueChapter: "Chapter 3: Weather disturbances",
    onDevice: true,
  },
  {
    id: "math-8",
    title: "Math 8",
    chapters: 8,
    progressPercent: 88,
    onDevice: true,
  },
  {
    id: "filipino-8",
    title: "Filipino 8",
    chapters: 9,
    progressPercent: 0,
    onDevice: false,
    downloadSize: "31 MB",
  },
] as const;

export const credential = {
  controlNo: "2026-04-118203",
  verifyCode: "8KX2-94QF",
  verifyCodeRevoked: "8KX2-94QG",
  maskedName: "A** M**** D. R****",
  verifyHost: "verify.deped.gov.ph",
} as const;
