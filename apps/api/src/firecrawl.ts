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
  ats: z.string().describe("Name of the ATS vendor (e.g. Ashby, Greenhouse, Lever)"),
  career_portal_url: z.string().describe("Direct public careers/jobs portal URL"),
});

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

    if (!data.ats) {
      return {
        success: false,
        error: "Could not identify ATS vendor",
        rawData: { firecrawlResult: data },
      };
    }

    const atsSlug = data.ats.toLowerCase().replace(/\s+/g, "_");

    return {
      success: true,
      data: {
        atsName: data.ats,
        careerPageURL: data.career_portal_url || "",
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
