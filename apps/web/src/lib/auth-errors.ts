import { ApiError } from "./api";

/** Plain-English messages for Better Auth error codes. */
const MESSAGES: Record<string, string> = {
  INVALID_PASSWORD: "That password isn't right.",
  INVALID_CODE: "That code didn't work. Check the time on your phone and try the newest code.",
  INVALID_BACKUP_CODE: "That backup code didn't work, or it has already been used.",
  INVALID_TWO_FACTOR_COOKIE: "This sign-in step has expired. Enter your email and password again.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many wrong codes. Enter your email and password again.",
  ACCOUNT_LOCKED: "Too many wrong codes. Wait a few minutes and try again.",
  TOTP_ALREADY_ENABLED: "Two-factor sign-in is already on.",
  PASSWORD_TOO_SHORT: "Use at least 10 characters.",
};

export function authMessage(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    return (e.code && MESSAGES[e.code]) || e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
