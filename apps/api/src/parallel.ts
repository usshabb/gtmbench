import { env } from "./env.js";

export interface ParallelJob {
  title: string;
  url?: string | null;
  location?: string | null;
  department?: string | null;
  postedAt?: string | null;
  [key: string]: unknown;
}

export interface FetchATSJobsResult {
  success: boolean;
  jobs: ParallelJob[];
  error?: string;
  rawData?: unknown;
}

// Normalize job fields from various ATS formats (e.g. Ashby uses jobTitle, externalApplyUrl, jobPublishDate)
function normalizeJob(raw: Record<string, unknown>): ParallelJob {
  return {
    ...raw,
    title: (raw.title ?? raw.jobTitle ?? "Untitled") as string,
    url: (raw.url ?? raw.externalApplyUrl ?? raw.applyUrl ?? null) as string | null,
    location: (raw.location ?? raw.jobLocation ?? null) as string | null,
    department: (raw.department ?? raw.indexedDepartment ?? null) as string | null,
    postedAt: (raw.postedAt ?? raw.jobPublishDate ?? raw.jobAddedDate ?? null) as string | null,
  };
}

export async function fetchATSJobs(atsUrl: string): Promise<FetchATSJobsResult> {
  const requestUrl = `${env.PARALLEL_API_BASE_URL}/companies/ats/jobs/preview`;
  const requestBody = { atsUrl };

  console.log(`[parallel] REQUEST: POST ${requestUrl}`);
  console.log(`[parallel] REQUEST body:`, JSON.stringify(requestBody));

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "x-api-key": env.PARALLEL_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    });

    const rawData = await response.json() as unknown;

    console.log(`[parallel] RESPONSE status: ${response.status}`);
    console.log(`[parallel] RESPONSE body:`, JSON.stringify(rawData));

    if (!response.ok) {
      return {
        success: false,
        jobs: [],
        error: `Parallel API returned ${response.status}`,
        rawData,
      };
    }

    // The API may return jobs under different keys — handle both array and wrapped shapes
    let jobs: ParallelJob[] = [];
    if (Array.isArray(rawData)) {
      jobs = (rawData as Record<string, unknown>[]).map(normalizeJob);
    } else if (rawData && typeof rawData === "object") {
      const obj = rawData as Record<string, unknown>;
      // Try known keys first (including Ashby's currentLiveJobs)
      let found = false;
      for (const key of ["jobs", "data", "results", "postings", "currentLiveJobs", "liveJobs"]) {
        if (Array.isArray(obj[key])) {
          jobs = (obj[key] as Record<string, unknown>[]).map(normalizeJob);
          found = true;
          break;
        }
      }
      // Fallback: find the largest array among all values
      if (!found) {
        let largest: Record<string, unknown>[] = [];
        for (const val of Object.values(obj)) {
          if (Array.isArray(val) && val.length > largest.length) {
            largest = val as Record<string, unknown>[];
          }
        }
        if (largest.length > 0) {
          jobs = largest.map(normalizeJob);
        }
      }
    }

    console.log(`[parallel] Fetched ${jobs.length} jobs for ${atsUrl}`);
    return { success: true, jobs, rawData };
  } catch (error) {
    console.error(`[parallel] Failed to fetch jobs for ${atsUrl}:`, error);
    return {
      success: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Failed to fetch ATS jobs",
    };
  }
}
