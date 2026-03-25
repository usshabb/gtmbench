import jwt from "jsonwebtoken";
import { env } from "./env.js";

export function signToken(email: string): string {
  const token = jwt.sign({ email: email.toLowerCase() }, env.JWT_SECRET, { expiresIn: "30d" });
  console.log("[auth] Token issued for:", email);
  return token;
}

export function getEmailFromToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { email: string };
    console.log("[auth] Token verified for email:", payload.email);
    return payload.email;
  } catch (error) {
    console.error("[auth] Token verification failed:", (error as Error).message);
    return null;
  }
}
