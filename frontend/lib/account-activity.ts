import { api } from "./api";

export type AccountActivityInput = {
  action: "SETTING_CHANGED" | "BUTTON_ACTION";
  summary: string;
  subjectKind?: "setting" | "consent" | "email" | "calendar" | "button";
  subjectId?: string;
};

/** Records a short metadata event. Failures never block the action already taken. */
export function logAccountActivity(input: AccountActivityInput) {
  void api.recordActivity(input).catch(() => undefined);
}
