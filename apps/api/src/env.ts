import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  MONGODB_URL: z.string().min(1),
  MONGODB_DB_NAME: z.string().default("gtmbench"),
  FIBER_API_KEY: z.string().min(1),
  FIBER_API_BASE_URL: z.string().url().default("https://api.fiber.ai"),
  OPENAI_API_KEY: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1),
  ALLOWED_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().default("dev-jwt-secret-change-in-production"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PARALLEL_API_KEY: z.string().default("V{XPnAejf2e,aL|neZJhh)UCf1M.u9G->ai9rX"),
  PARALLEL_API_BASE_URL: z.string().url().default("https://api-dev.useparallel.com"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4000/auth/google/callback"),
});

export const env = envSchema.parse(process.env);
