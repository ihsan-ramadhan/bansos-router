import type { NotificationType } from "../types";

export function getNotificationClasses(type: NotificationType): string {
  if (type === "success") {
    return "bg-emerald-950/40 border-emerald-800/40 text-emerald-300";
  }
  if (type === "error") {
    return "bg-rose-950/40 border-rose-800/40 text-rose-300";
  }
  return "bg-blue-950/40 border-blue-800/40 text-blue-300";
}
