import OpenAI from "openai";
import { env } from "./env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

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

// Known ATS URL patterns — used to validate and override AI's slug guess
const ATS_URL_PATTERNS: { slug: string; name: string; pattern: RegExp }[] = [
  { slug: "greenhouse", name: "Greenhouse", pattern: /\bboards\.greenhouse\.io\b|\bjob-boards\.greenhouse\.io\b/i },
  { slug: "lever", name: "Lever", pattern: /\bjobs\.lever\.co\b/i },
  { slug: "ashby", name: "Ashby", pattern: /\bjobs\.ashbyhq\.com\b/i },
  { slug: "workable", name: "Workable", pattern: /\bapply\.workable\.com\b|\b[\w-]+\.workable\.com\b/i },
  { slug: "breezy", name: "Breezy HR", pattern: /\b[\w-]+\.breezy\.hr\b/i },
  { slug: "smartrecruiters", name: "SmartRecruiters", pattern: /\bcareers\.smartrecruiters\.com\b/i },
  { slug: "jobvite", name: "Jobvite", pattern: /\bjobs\.jobvite\.com\b/i },
  { slug: "icims", name: "iCIMS", pattern: /\bicims\.com\b/i },
  { slug: "bamboohr", name: "BambooHR", pattern: /\bbamboohr\.com\b/i },
  // Rippling ATS hosts jobs at ats.rippling.com — NOT the generic rippling.com homepage
  { slug: "rippling", name: "Rippling", pattern: /\bats\.rippling\.com\b/i },
  { slug: "workday", name: "Workday", pattern: /\bworkday\.com\b|\bmyworkdayjobs\.com\b/i },
  { slug: "taleo", name: "Taleo", pattern: /\btaleo\.net\b/i },
];

// Direct URL templates to probe for each ATS, using {slug} as placeholder for the company slug
const ATS_DIRECT_PROBES: { slug: string; name: string; urlTemplate: string }[] = [
  { slug: "ashby", name: "Ashby", urlTemplate: "https://jobs.ashbyhq.com/{slug}" },
  { slug: "greenhouse", name: "Greenhouse", urlTemplate: "https://boards.greenhouse.io/{slug}" },
  { slug: "lever", name: "Lever", urlTemplate: "https://jobs.lever.co/{slug}" },
  { slug: "workable", name: "Workable", urlTemplate: "https://apply.workable.com/{slug}" },
  { slug: "smartrecruiters", name: "SmartRecruiters", urlTemplate: "https://careers.smartrecruiters.com/{slug}" },
  { slug: "rippling", name: "Rippling", urlTemplate: "https://ats.rippling.com/{slug}/jobs" },
  { slug: "jobvite", name: "Jobvite", urlTemplate: "https://jobs.jobvite.com/{slug}" },
];

function detectATSFromURL(url: string): { slug: string; name: string } | null {
  for (const entry of ATS_URL_PATTERNS) {
    if (entry.pattern.test(url)) return { slug: entry.slug, name: entry.name };
  }
  return null;
}

/**
 * Extract a company slug from a domain.
 * e.g. "pylon.com" → "pylon", "linear.app" → "linear"
 */
function domainToSlug(domain: string): string {
  return domain.split(".")[0].toLowerCase();
}

/**
 * Probe known ATS URL patterns directly using the company slug.
 * Returns the first confirmed hit, or null if none resolve.
 * This is faster and more accurate than AI search for well-known ATS platforms.
 */
async function probeDirectATSURLs(
  companySlug: string,
): Promise<ATSDetectionResult | null> {
  const probeUrls = ATS_DIRECT_PROBES.map((probe) => ({
    ...probe,
    url: probe.urlTemplate.replace("{slug}", companySlug),
  }));

  const results = await Promise.allSettled(
    probeUrls.map(async (probe) => {
      const res = await fetch(probe.url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ATSDetector/1.0)" },
      });
      return { probe, status: res.status, finalUrl: res.url };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.status < 400) {
      const { probe, finalUrl } = result.value;
      // Double-check final URL still matches the expected ATS domain (handles redirects)
      const urlDetected = detectATSFromURL(finalUrl);
      const finalSlug = urlDetected?.slug ?? probe.slug;
      const finalName = urlDetected?.name ?? probe.name;
      console.log(`[ats-probe] Hit: ${finalUrl} → ${finalSlug}`);
      return { atsName: finalName, careerPageURL: finalUrl, atsSlug: finalSlug };
    }
  }

  return null;
}

async function validateCareerPageURL(
  url: string,
): Promise<{ valid: boolean; finalUrl: string; statusCode: number }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ATSDetector/1.0)" },
    });
    return { valid: res.status < 400, finalUrl: res.url, statusCode: res.status };
  } catch (err) {
    console.warn(
      `[ats-validate] Failed to fetch ${url}:`,
      err instanceof Error ? err.message : err,
    );
    return { valid: false, finalUrl: url, statusCode: 0 };
  }
}

export async function detectCompanyATS(domain: string): Promise<ATSDetectionResponse> {
  try {
    const companyUrl = `https://${domain}`;
    console.log(`[openai-ats] Detecting ATS for ${companyUrl}...`);

    // Step 1: Try direct URL probing — fast, accurate, stale-proof
    const companySlug = domainToSlug(domain);
    console.log(`[ats-probe] Probing direct ATS URLs for slug "${companySlug}"...`);
    const directResult = await probeDirectATSURLs(companySlug);
    if (directResult) {
      console.log(`[ats-probe] Direct probe succeeded: ${directResult.atsSlug} at ${directResult.careerPageURL}`);
      return { success: true, data: directResult };
    }
    console.log(`[ats-probe] No direct match found, falling back to AI search`);

    // Step 2: Fall back to AI web search
    const response = await openai.responses.create({
      model: "gpt-4.1",
      tools: [
        { type: "web_search_preview" },
        {
          type: "function",
          name: "saveATS",
          description:
            "Return ATS detection result. Only call this after finding a real career page URL from search results — never guess or construct URLs.",
          parameters: {
            type: "object",
            properties: {
              atsName: {
                type: "string",
                description: "Name of the ATS (e.g. 'Greenhouse', 'Lever', 'Ashby')",
              },
              careerPageURL: {
                type: "string",
                description:
                  "The real career page URL you found in search results (e.g. boards.greenhouse.io/company, jobs.lever.co/company). Must be a URL you actually saw — do not construct or guess it.",
              },
              atsSlug: {
                type: "string",
                description:
                  "Normalized slug: greenhouse, lever, ashby, breezy, workable, smartrecruiters, bamboohr, workday, taleo, icims, rippling, jobvite",
              },
            },
            required: ["atsName", "careerPageURL", "atsSlug"],
          },
        },
      ],
      tool_choice: "auto",
      input: `Find the ATS (Applicant Tracking System) used by the company at ${companyUrl}.

The company slug is "${companySlug}". You are looking for a career page specifically for THIS company — not a general HR platform page.

Steps:
1. Search for "${domain} careers site:jobs.ashbyhq.com OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:apply.workable.com"
2. Also try searching "${domain} jobs apply" and look for ATS-hosted URLs in results
3. The URL must be a page specifically for ${domain}'s own job listings — NOT a generic HR platform homepage
4. Valid examples: boards.greenhouse.io/${companySlug}, jobs.lever.co/${companySlug}, jobs.ashbyhq.com/${companySlug}
5. Only call saveATS if you found a URL that is clearly for ${domain}'s own jobs
6. Do NOT call saveATS for generic platform pages (e.g. rippling.com, workday.com without a company path)
`,
    });

    console.log(`[openai-ats] ATS detection response:`, JSON.stringify(response.output));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fnCall = (response.output as any[]).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item: any) => item.type === "function_call" && item.name === "saveATS",
    );

    if (!fnCall?.arguments) {
      return {
        success: false,
        error: "Model could not locate a real career page URL",
        rawData: { output: response.output },
      };
    }

    const aiData: ATSDetectionResult = JSON.parse(fnCall.arguments);

    // Validate the URL actually resolves
    console.log(`[ats-validate] Validating URL: ${aiData.careerPageURL}`);
    const validation = await validateCareerPageURL(aiData.careerPageURL);

    if (!validation.valid) {
      return {
        success: false,
        error: `Career page URL did not resolve (HTTP ${validation.statusCode}): ${aiData.careerPageURL}`,
        rawData: { output: response.output, aiData, validation },
      };
    }

    // Detect ATS from the actual final URL — overrides AI guess if pattern matches
    const urlDetected = detectATSFromURL(validation.finalUrl);

    // Require the final URL to match a known ATS domain — prevents accepting generic HR platform pages
    if (!urlDetected) {
      console.warn(
        `[ats-validate] Final URL does not match any known ATS domain: ${validation.finalUrl}`,
      );
      return {
        success: false,
        error: `Career page URL does not match a known ATS domain: ${validation.finalUrl}`,
        rawData: { output: response.output, aiData, validation },
      };
    }

    console.log(
      `[ats-validate] Valid (${validation.statusCode}), finalUrl=${validation.finalUrl}, ats=${urlDetected.slug}`,
    );

    return {
      success: true,
      data: {
        atsName: urlDetected.name,
        careerPageURL: validation.finalUrl,
        atsSlug: urlDetected.slug,
      },
      rawData: { output: response.output, validation },
    };
  } catch (error) {
    console.error(`[openai-ats] ATS detection failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "ATS detection failed",
    };
  }
}
