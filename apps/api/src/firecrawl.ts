import Firecrawl from "@mendable/firecrawl-js";
import { z } from "zod";
import { env } from "./env.js";

const firecrawl = new Firecrawl({ apiKey: env.FIRECRAWL_API_KEY });

export interface ATSDetectionResult {
  atsName: string;
  careerPageURL: string;
  atsSlug: string;
}

export interface ATSDetectionResponse {
  success: boolean;
  data?: ATSDetectionResult;
  error?: string;
  rawData?: Record<string, unknown>;
}

const firecrawlATSSchema = z.object({
  ats: z.string().optional().describe("Name of the ATS vendor (e.g. Ashby, Greenhouse, Lever)"),
  ats_name: z.string().optional().describe("Name of the ATS vendor (e.g. Ashby, Greenhouse, Lever)"),
  career_portal_url: z.string().optional().describe("Direct public careers/jobs portal URL"),
});

const KNOWN_ATS: string[] = [
  "Ashby", "Greenhouse", "Lever", "Workday", "Notion", "Workable",
  "BambooHR", "iCIMS", "Taleo", "SmartRecruiters", "JazzHR", "Bullhorn",
  "Jobvite", "Recruitee", "Personio", "HiBob", "Rippling", "Gusto",
  "SAP", "Oracle", "Breezy", "Zoho", "Comeet", "Pinpoint",
];

function normalizeATSName(raw: string): string {
  const cleaned = raw.trim();
  // Check for a known vendor match (case-insensitive)
  const lower = cleaned.toLowerCase();
  const match = KNOWN_ATS.find((name) => lower.includes(name.toLowerCase()));
  if (match) return match;
  // Strip anything after ( or – or , and take at most the first 2 words
  const stripped = cleaned.replace(/[(–\-,].*/, "").trim();
  const words = stripped.split(/\s+/).slice(0, 2);
  return words.join(" ");
}

export async function detectCompanyATS(domain: string): Promise<ATSDetectionResponse> {
  try {
    console.log(`[firecrawl-ats] Detecting ATS for ${domain}...`);

    const result = await firecrawl.agent({
      prompt: `Identify the Applicant Tracking System (ATS) used by ${domain} and provide the direct URL to their career portal.`,
      schema: firecrawlATSSchema as unknown as Record<string, unknown>,
      model: "spark-1-mini",
    });

    console.log(`[firecrawl-ats] Result:`, JSON.stringify(result.data));

    const parseResult = firecrawlATSSchema.safeParse(result.data);
    if (!parseResult.success) {
      return {
        success: false,
        error: "Invalid response from Firecrawl agent",
        rawData: { firecrawlResult: result.data as Record<string, unknown> },
      };
    }

    const data = parseResult.data;
    const rawAtsName = data.ats_name ?? data.ats;

    if (!rawAtsName) {
      return {
        success: false,
        error: "Could not identify ATS vendor",
        rawData: { firecrawlResult: data },
      };
    }

    const atsName = normalizeATSName(rawAtsName);
    const atsSlug = atsName.toLowerCase().replace(/\s+/g, "_");

    const careerPageURL = data.career_portal_url?.trim() ?? "";
    if (!careerPageURL) {
      return {
        success: false,
        error: "ATS detected but no career portal URL found",
        rawData: { firecrawlResult: data },
      };
    }

    return {
      success: true,
      data: {
        atsName,
        careerPageURL,
        atsSlug,
      },
      rawData: { firecrawlResult: data },
    };
  } catch (error) {
    console.error(`[firecrawl-ats] ATS detection failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "ATS detection failed",
    };
  }
}
