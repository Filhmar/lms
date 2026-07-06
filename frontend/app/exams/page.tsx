import type { Metadata } from "next";
import { ExamJourney } from "./journey";

export const metadata: Metadata = {
  title: "Exams — Resilient-Learn",
  description:
    "Offline-first exam journey: download once, take it with zero signal, answers save on this phone as you go.",
};

export default function ExamsPage() {
  return <ExamJourney />;
}
