import type { CycleStatus, ReviewStage } from "@hrms/shared";

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  selfRating: number | null;
  selfComment: string | null;
  managerRating?: number | null;
  managerComment?: string | null;
}
export interface Part {
  summary?: string;
  strengths?: string;
  improvements?: string;
  competencies?: Record<string, number | null>;
}
export interface ReviewDetail {
  id: string;
  cycle: { id: string; name: string; periodStart: string; periodEnd: string; selfDue: string; managerDue: string; status: CycleStatus; competencies: string[] };
  employee: { id: string; name?: string; code?: string; department?: string | null; designation?: string | null };
  manager: { id: string; name: string } | null;
  stage: ReviewStage;
  goals: Goal[];
  self: Part;
  selfScore: number | null;
  selfSubmittedAt: string | null;
  managerPart: Part;
  managerScore: number | null;
  managerSubmittedAt: string | null;
  finalRating: number | null;
  finalLabel: string;
  calibrationNote: string | null;
  employeeComment: string | null;
  sharedAt: string | null;
  acknowledgedAt: string | null;
  canCalibrate?: boolean;
}
