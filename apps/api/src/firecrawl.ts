import FirecrawlModule from "@mendable/firecrawl-js";
import { z } from "zod";
import { env } from "./env.js";

// Handle both ESM default and CJS module.exports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Firecrawl = (FirecrawlModule as any).default ?? FirecrawlModule;
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

export interface FundedStartup {
  companyName: string;
  websiteDomain: string;
  fundingAmount: string;
  investors: string[];
  citationUrl?: string;
}

export interface FetchRecentlyFundedResult {
  success: boolean;
  startups: FundedStartup[];
  error?: string;
}

// Flexible per-item schema — handles both camelCase and snake_case from Firecrawl
const startupItemSchema = z.object({
  company_name: z.string().optional(),
  companyName: z.string().optional(),
  website_domain: z.string().optional(),
  websiteDomain: z.string().optional(),
  funding_amount: z.string().optional(),
  fundingAmount: z.string().optional(),
  investors: z.union([
    z.array(z.string()),
    z.array(z.object({ value: z.string() }).passthrough()),
  ]).optional(),
  companyName_citation: z.string().optional(),
  websiteDomain_citation: z.string().optional(),
  company_name_citation: z.string().optional(),
  website_domain_citation: z.string().optional(),
}).passthrough();

function normalizeRawStartups(raw: unknown): FundedStartup[] {
  let items: unknown[] = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.startups)) {
      items = obj.startups;
    } else {
      // Numeric-keyed object: {"0": {...}, "1": {...}}
      const numericKeys = Object.keys(obj).filter((k) => /^\d+$/.test(k));
      if (numericKeys.length > 0) {
        items = numericKeys.sort((a, b) => Number(a) - Number(b)).map((k) => obj[k]);
      }
    }
  }

  return items.flatMap((item) => {
    const parsed = startupItemSchema.safeParse(item);
    if (!parsed.success) return [];
    const d = parsed.data;
    const companyName = d.companyName ?? d.company_name ?? "";
    const rawDomain = d.websiteDomain ?? d.website_domain ?? "";
    const websiteDomain = rawDomain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    const fundingAmount = d.fundingAmount ?? d.funding_amount ?? "";
    const investors = (d.investors ?? []).map((i) =>
      typeof i === "string" ? i : (i as { value: string }).value,
    );
    const citationUrl = d.companyName_citation ?? d.company_name_citation ?? d.websiteDomain_citation ?? d.website_domain_citation;
    if (!companyName || !websiteDomain) return [];
    return [{ companyName, websiteDomain, fundingAmount, investors, citationUrl }];
  });
}

export async function fetchRecentlyFundedStartups(sinceDate?: string): Promise<FetchRecentlyFundedResult> {
  const window = sinceDate ? `since ${sinceDate}` : "in the last 7 days";
  try {
    console.log(`[firecrawl-funded] Searching for startups funded ${window}...`);
    const result = await firecrawl.agent({
      prompt: `Extract startups based in the US that received funding ${window}. For each startup, capture the company name, website domain, funding amount, and names of the investors involved.`,
      model: "spark-1-mini",
    });

    console.log("[firecrawl-funded] Raw result:", JSON.stringify(result.data).slice(0, 3000));

    const startups = normalizeRawStartups(result.data);
    console.log(`[firecrawl-funded] Normalized ${startups.length} funded startups`);
    return { success: true, startups };
  } catch (error) {
    console.error("[firecrawl-funded] Failed:", error);
    return { success: false, startups: [], error: error instanceof Error ? error.message : "Fetch failed" };
  }
}
