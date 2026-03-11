import jwt from "jsonwebtoken";
import { env } from "./env.js";

const OTP_CODE = "7777";
const validEmails = new Set<string>();

export function requestOtp(email: string): void {
  validEmails.add(email.toLowerCase());
}

export function verifyOtp(email: string, code: string): string | null {
  const normalizedEmail = email.toLowerCase();
  if (!validEmails.has(normalizedEmail)) return null;
  if (code !== OTP_CODE) return null;

  validEmails.delete(normalizedEmail);

  const token = jwt.sign({ email: normalizedEmail }, env.JWT_SECRET, {
    expiresIn: "1d",
  });
  console.log("[auth] Token issued for:", normalizedEmail);
  console.log("[auth] Token (first 20 chars):", token.substring(0, 20) + "...");
  console.log("[auth] JWT_SECRET used (first 5 chars):", env.JWT_SECRET.substring(0, 5) + "...");
  return token;
}

export function getEmailFromToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { email: string };
    console.log("[auth] Token verified for email:", payload.email);
    return payload.email;
  } catch (error) {
    console.error("[auth] Token verification failed:", (error as Error).message);
    console.error("[auth] Token (first 20 chars):", token.substring(0, 20) + "...");
    console.error("[auth] JWT_SECRET (first 5 chars):", env.JWT_SECRET.substring(0, 5) + "...");
    return null;
  }
}
