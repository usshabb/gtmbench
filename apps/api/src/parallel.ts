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

export async function fetchATSJobs(atsUrl: string): Promise<FetchATSJobsResult> {
  try {
    const response = await fetch(`${env.PARALLEL_API_BASE_URL}/companies/ats/jobs/preview`, {
      method: "POST",
      headers: {
        "x-api-key": env.PARALLEL_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ atsUrl }),
      signal: AbortSignal.timeout(30_000),
    });

    const rawData = await response.json() as unknown;

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
      jobs = rawData as ParallelJob[];
    } else if (rawData && typeof rawData === "object") {
      const obj = rawData as Record<string, unknown>;
      const jobsArr = obj.jobs ?? obj.data ?? obj.results ?? obj.postings ?? [];
      if (Array.isArray(jobsArr)) {
        jobs = jobsArr as ParallelJob[];
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
