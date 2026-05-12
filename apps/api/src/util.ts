/**
 * Core job functions — invoked directly by API endpoints.
 *
 * Each function performs one piece of work end-to-end: hits the upstream API,
 * persists results to MongoDB, and creates Signal records. No queue, no cron,
 * no background workers — just plain async functions.
 */

import { ObjectId } from "mongodb";
import {
  getCompanyATSCollection,
  getFundedStartupsCollection,
  getJobsCollection,
  getLinkedinPostsForUserCollection,
  getNotificationsCollection,
  getSignalsCollection,
} from "./db.js";
import { enrichDomainWithFiber, enrichPersonWithFiber, findEmailWithContactDetails, type ContactEmail } from "./fiber.js";
import { fetchRecentlyFundedStartups } from "./firecrawl.js";
import { fetchLinkedinPosts } from "./linkedin.js";
import { fetchATSJobs } from "./parallel.js";
import type {
  ATSJobsSignalData,
  FundedStartupSignalData,
  JobData,
  LinkedinPostData,
  NotificationJobType,
} from "./types.js";

/** Small helper to log function entry/exit consistently. */
function log(fn: string, msg: string, extra?: Record<string, unknown>) {
  const parts = [`[util:${fn}] ${msg}`];
  if (extra) parts.push(JSON.stringify(extra));
  console.log(parts.join(" "));
}

function logError(fn: string, msg: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[util:${fn}] ${msg}: ${message}`);
}

/** Sleep helper — used by callers that want to space out rapid-fire calls. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a date for user-facing notification text, e.g. "May 12, 2026". */
function formatDateFriendly(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Turn `https://www.linkedin.com/in/john-doe/` → `John Doe`. */
function nameFromLinkedinUrl(url: string): string {
  const slug = url.split("/in/")[1]?.replace(/\/+$/, "")?.split("?")[0] ?? url;
  return slug
    .split("-")
    .filter((p) => !/^\d+$/.test(p))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || slug;
}

/** Strip protocol + trailing slash from a URL for friendly display. */
function tidyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * Persist a notification entry. Errors here are swallowed so they never
 * break the underlying job.
 */
async function createNotification(
  jobType: NotificationJobType,
  notificationText: string,
  userEmail?: string,
): Promise<void> {
  try {
    const col = await getNotificationsCollection();
    await col.insertOne({
      ...(userEmail ? { userEmail } : {}),
      jobType,
      notificationText,
      read: false,
      createdAt: new Date().toISOString(),
    });
    console.log(`[util:notify] ${jobType} — ${notificationText}`);
  } catch (err) {
    console.error("[util:notify] insert failed:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/*  getLinkedinContent                                                  */
/* ------------------------------------------------------------------ */

export interface GetLinkedinContentParams {
  linkedinUrl: string;
  personId: string | ObjectId;
  userEmail: string;
  triggerId?: string | ObjectId | null;
  keyword?: string | null;
  /** If set, drop any post whose postedAt is older than this many hours. */
  withinHours?: number | null;
}

export interface GetLinkedinContentResult {
  success: boolean;
  postsFetched: number;
  signalsCreated: number;
  error?: string;
}

export async function getLinkedinContent(params: GetLinkedinContentParams): Promise<GetLinkedinContentResult> {
  const { linkedinUrl, userEmail, keyword, withinHours } = params;
  const personId = params.personId instanceof ObjectId ? params.personId : new ObjectId(params.personId);
  const triggerId = params.triggerId
    ? (params.triggerId instanceof ObjectId ? params.triggerId : new ObjectId(params.triggerId))
    : null;

  log("getLinkedinContent", "start", { linkedinUrl, userEmail, keyword: keyword ?? null, withinHours: withinHours ?? null });

  try {
    const result = await fetchLinkedinPosts(linkedinUrl);
    if (!result.success) {
      logError("getLinkedinContent", "fetchLinkedinPosts failed", result.error);
      return { success: false, postsFetched: 0, signalsCreated: 0, error: result.error };
    }

    // Apply recency filter — cron runs pass 72h to scope to fresh content
    let posts = result.posts;
    if (withinHours && withinHours > 0) {
      const cutoff = Date.now() - withinHours * 3_600_000;
      const before = posts.length;
      posts = posts.filter((p) => {
        const t = new Date(p.postedAt).getTime();
        return Number.isFinite(t) && t >= cutoff;
      });
      log("getLinkedinContent", "recency filter", { withinHours, before, after: posts.length });
    }

    const postsCol = await getLinkedinPostsForUserCollection();
    const signalsCol = await getSignalsCollection();
    const fetchedAt = new Date().toISOString();

    // Store the filtered posts (dedup by userEmail + postId)
    for (const post of posts) {
      try {
        await postsCol.insertOne({
          userEmail,
          personId,
          linkedinUrl,
          postId: post.postId,
          postUrl: post.postUrl,
          caption: post.caption,
          postedAt: post.postedAt,
          authorName: post.authorName,
          authorLinkedinUrl: post.authorLinkedinUrl,
          authorProfilePicture: post.authorProfilePicture,
          engagement: post.engagement,
          imageUrls: post.imageUrls,
          hasVideo: post.hasVideo,
          isReshare: post.isReshare,
          fetchedAt,
        });
      } catch (err: unknown) {
        if (!isDuplicateKeyError(err)) throw err;
      }
    }

    const matching = filterPostsByKeyword(posts, keyword ?? null);

    let signalsCreated = 0;
    for (const post of matching) {
      try {
        await signalsCol.insertOne({
          userEmail,
          triggerId: triggerId ?? new ObjectId(),
          signalType: "linkedin_post",
          personId,
          personName: post.authorName,
          personLinkedinUrl: linkedinUrl,
          data: post,
          matchedKeyword: keyword ?? null,
          createdAt: post.postedAt,
        });
        signalsCreated++;
      } catch (err: unknown) {
        if (!isDuplicateKeyError(err)) throw err;
      }
    }

    log("getLinkedinContent", "done", {
      linkedinUrl,
      postsFetched: posts.length,
      signalsCreated,
    });

    const displayName = posts[0]?.authorName ?? result.posts[0]?.authorName ?? nameFromLinkedinUrl(linkedinUrl);
    const noun = posts.length === 1 ? "post" : "posts";
    await createNotification(
      "getLinkedinContent",
      `Synced ${posts.length} LinkedIn ${noun} for ${displayName} on ${formatDateFriendly()}`,
      userEmail,
    );

    return { success: true, postsFetched: posts.length, signalsCreated };
  } catch (err) {
    logError("getLinkedinContent", "uncaught", err);
    return {
      success: false,
      postsFetched: 0,
      signalsCreated: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function filterPostsByKeyword(posts: LinkedinPostData[], keyword: string | null): LinkedinPostData[] {
  if (!keyword) return posts;
  const lower = keyword.toLowerCase();
  return posts.filter((post) => (post.caption?.toLowerCase() ?? "").includes(lower));
}

/* ------------------------------------------------------------------ */
/*  enrichLinkedinProfile                                               */
/* ------------------------------------------------------------------ */

export interface EnrichLinkedinProfileResult {
  success: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

export async function enrichLinkedinProfile(
  linkedinUrl: string,
  opts: { userEmail?: string } = {},
): Promise<EnrichLinkedinProfileResult> {
  log("enrichLinkedinProfile", "start", { linkedinUrl });
  const result = await enrichPersonWithFiber(linkedinUrl);
  if (!result.success) {
    logError("enrichLinkedinProfile", "fiber enrichment failed", result.error);
    return { success: false, error: result.error, payload: result.payload };
  }
  log("enrichLinkedinProfile", "done", { linkedinUrl });

  // Prefer the name from the Fiber payload if available; otherwise the slug.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const personData = (result.payload as any)?.output?.data?.[0];
  const fiberName: string | undefined =
    (personData?.name as string | undefined) ??
    ([personData?.first_name, personData?.last_name].filter(Boolean).join(" ").trim() || undefined);
  const displayName = fiberName?.length ? fiberName : nameFromLinkedinUrl(linkedinUrl);

  await createNotification(
    "enrichLinkedinProfile",
    `Enriched LinkedIn profile for ${displayName} on ${formatDateFriendly()}`,
    opts.userEmail,
  );

  return { success: true, payload: result.payload };
}

/* ------------------------------------------------------------------ */
/*  getEmail                                                            */
/* ------------------------------------------------------------------ */

export interface GetEmailResult {
  success: boolean;
  email: string | null;
  emails: ContactEmail[];
  error?: string;
}

export async function getEmail(
  linkedinUrl: string,
  opts: { userEmail?: string } = {},
): Promise<GetEmailResult> {
  log("getEmail", "start", { linkedinUrl });
  try {
    const result = await findEmailWithContactDetails(linkedinUrl);
    log("getEmail", "done", { linkedinUrl, emailCount: result.emails.length, best: result.email ?? null });

    const displayName = nameFromLinkedinUrl(linkedinUrl);
    const text = result.email
      ? `Found email ${result.email} for ${displayName} on ${formatDateFriendly()}`
      : `Searched for email for ${displayName} on ${formatDateFriendly()} — no match`;
    await createNotification("getEmail", text, opts.userEmail);

    return { success: true, email: result.email, emails: result.emails };
  } catch (err) {
    logError("getEmail", "failed", err);
    return {
      success: false,
      email: null,
      emails: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  getJobsbyCompany                                                    */
/* ------------------------------------------------------------------ */

export interface GetJobsbyCompanyParams {
  companyId: string | ObjectId;
  atsUrl: string;
  domain: string;
  userEmail: string;
  triggerId?: string | ObjectId | null;
  jobTitles?: string[] | null;
  keyword?: string | null;
}

export interface GetJobsbyCompanyResult {
  success: boolean;
  jobsFetched: number;
  newJobsCount: number;
  signalsCreated: number;
  error?: string;
}

export async function getJobsbyCompany(params: GetJobsbyCompanyParams): Promise<GetJobsbyCompanyResult> {
  const { atsUrl, domain, userEmail, jobTitles, keyword } = params;
  const companyId = params.companyId instanceof ObjectId ? params.companyId : new ObjectId(params.companyId);
  const triggerId = params.triggerId
    ? (params.triggerId instanceof ObjectId ? params.triggerId : new ObjectId(params.triggerId))
    : null;

  log("getJobsbyCompany", "start", { domain, atsUrl, jobTitles: jobTitles ?? null, keyword: keyword ?? null });

  try {
    if (!atsUrl) {
      // Look up career page from companyATS
      const atsCol = await getCompanyATSCollection();
      const ats = await atsCol.findOne({
        companyId,
        detectionStatus: "completed",
        careerPageUrl: { $nin: [null, ""] },
      });
      if (!ats?.careerPageUrl) {
        return { success: false, jobsFetched: 0, newJobsCount: 0, signalsCreated: 0, error: "No ATS career page URL available" };
      }
      params.atsUrl = ats.careerPageUrl;
    }

    const result = await fetchATSJobs(params.atsUrl);
    if (!result.success) {
      logError("getJobsbyCompany", "fetchATSJobs failed", result.error);
      return { success: false, jobsFetched: 0, newJobsCount: 0, signalsCreated: 0, error: result.error };
    }

    // Apply job title filter
    let jobs = result.jobs;
    if (jobTitles && jobTitles.length > 0) {
      const lc = jobTitles.map((t) => t.toLowerCase());
      const before = jobs.length;
      jobs = jobs.filter((j) => {
        const t = j.title.toLowerCase();
        return lc.some((p) => t.includes(p) || p.includes(t));
      });
      log("getJobsbyCompany", "title filter", { before, after: jobs.length });
    }

    // Apply keyword filter
    if (keyword) {
      const kw = keyword.toLowerCase();
      const before = jobs.length;
      jobs = jobs.filter((j) => {
        const searchable = [
          j.title,
          j.department,
          j.location,
          typeof j.description === "string" ? j.description : "",
          typeof j.content === "string" ? j.content : "",
          typeof j.descriptionHtml === "string" ? j.descriptionHtml : "",
        ].join(" ").toLowerCase();
        return searchable.includes(kw);
      });
      log("getJobsbyCompany", "keyword filter", { keyword, before, after: jobs.length });
    }

    const jobsCol = await getJobsCollection();
    const signalsCol = await getSignalsCollection();
    const fetchedAt = new Date().toISOString();
    const today = fetchedAt.slice(0, 10);

    let newJobsCount = 0;
    const newJobs: JobData[] = [];

    for (const job of jobs) {
      const jobUrl = (job.url as string | null | undefined) ?? null;
      const postedAt = (job.postedAt as string | null | undefined) ?? null;
      const jobDoc = {
        companyId,
        domain,
        title: job.title ?? "Untitled",
        jobUrl,
        location: (job.location as string | null | undefined) ?? null,
        department: (job.department as string | null | undefined) ?? null,
        postedAt,
        fetchedAt,
        rawData: job as Record<string, unknown>,
      };

      try {
        await jobsCol.insertOne(jobDoc);
        newJobsCount++;
        newJobs.push({
          title: jobDoc.title,
          jobUrl,
          location: jobDoc.location,
          department: jobDoc.department,
          postedAt,
          companyDomain: domain,
        });
      } catch (err: unknown) {
        if (!isDuplicateKeyError(err)) throw err;
      }
    }

    // Net-new only: signals come strictly from jobs we just inserted.
    // The jobs collection (unique on companyId + jobUrl) is the state store.
    const byDate = new Map<string, JobData[]>();
    for (const job of newJobs) {
      const dateKey = job.postedAt ? job.postedAt.slice(0, 10) : today;
      const bucket = byDate.get(dateKey) ?? [];
      bucket.push(job);
      byDate.set(dateKey, bucket);
    }

    let signalsCreated = 0;
    for (const [signalDate, dayJobs] of byDate) {
      const signalData: ATSJobsSignalData = {
        newJobsCount: dayJobs.length,
        jobs: dayJobs,
        companyDomain: domain,
      };
      await signalsCol.updateOne(
        { userEmail, signalType: "ats_new_job", companyId, signalDate },
        {
          $set: {
            userEmail,
            triggerId: triggerId ?? new ObjectId(),
            signalType: "ats_new_job",
            companyId,
            companyDomain: domain,
            signalDate,
            data: signalData,
            createdAt: fetchedAt,
          },
        },
        { upsert: true },
      );
      signalsCreated++;
    }

    log("getJobsbyCompany", "done", {
      domain,
      jobsFetched: result.jobs.length,
      newJobsCount,
      signalsCreated,
    });

    const noun = newJobsCount === 1 ? "job" : "jobs";
    const source = params.atsUrl ? tidyUrl(params.atsUrl) : domain;
    await createNotification(
      "getJobsbyCompany",
      `Synced ${newJobsCount} new ${noun} from ${source} for ${domain} on ${formatDateFriendly()}`,
      userEmail,
    );

    return { success: true, jobsFetched: result.jobs.length, newJobsCount, signalsCreated };
  } catch (err) {
    logError("getJobsbyCompany", "uncaught", err);
    return {
      success: false,
      jobsFetched: 0,
      newJobsCount: 0,
      signalsCreated: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  getRecentlyFundedCompany                                            */
/* ------------------------------------------------------------------ */

export interface GetRecentlyFundedCompanyParams {
  userEmail: string;
  triggerId?: string | ObjectId | null;
  sinceDate?: string;
}

export interface GetRecentlyFundedCompanyResult {
  success: boolean;
  startupsFound: number;
  newCount: number;
  signalsCreated: number;
  error?: string;
}

export async function getRecentlyFundedCompany(params: GetRecentlyFundedCompanyParams): Promise<GetRecentlyFundedCompanyResult> {
  const { userEmail, sinceDate } = params;
  const triggerId = params.triggerId
    ? (params.triggerId instanceof ObjectId ? params.triggerId : new ObjectId(params.triggerId))
    : new ObjectId();

  log("getRecentlyFundedCompany", "start", { userEmail, sinceDate: sinceDate ?? null });

  try {
    const result = await fetchRecentlyFundedStartups(sinceDate);
    if (!result.success) {
      logError("getRecentlyFundedCompany", "fetchRecentlyFundedStartups failed", result.error);
      return { success: false, startupsFound: 0, newCount: 0, signalsCreated: 0, error: result.error };
    }

    const fundedCol = await getFundedStartupsCollection();
    const signalsCol = await getSignalsCollection();
    const fetchedAt = new Date().toISOString();
    const signalDate = fetchedAt.slice(0, 10);

    let newCount = 0;
    let signalsCreated = 0;

    for (const startup of result.startups) {
      let enrichmentData: Record<string, unknown> | null = null;
      if (startup.websiteDomain) {
        const enrich = await enrichDomainWithFiber(startup.websiteDomain);
        if (enrich.success && enrich.payload) enrichmentData = enrich.payload;
      }

      try {
        await fundedCol.insertOne({
          userEmail,
          triggerId,
          companyName: startup.companyName,
          websiteDomain: startup.websiteDomain,
          fundingAmount: startup.fundingAmount,
          investors: startup.investors,
          citationUrl: startup.citationUrl ?? null,
          enrichmentData,
          fetchedAt,
          signalDate,
        });
        newCount++;

        const signalData: FundedStartupSignalData = {
          companyName: startup.companyName,
          websiteDomain: startup.websiteDomain,
          fundingAmount: startup.fundingAmount,
          investors: startup.investors,
          citationUrl: startup.citationUrl ?? null,
          enrichmentData: enrichmentData ?? undefined,
        };

        await signalsCol.updateOne(
          { userEmail, signalType: "recently_funded", triggerId, companyDomain: startup.websiteDomain },
          {
            $setOnInsert: {
              userEmail,
              triggerId,
              signalType: "recently_funded",
              signalDate,
              companyDomain: startup.websiteDomain,
              data: signalData,
              createdAt: fetchedAt,
              dismissed: false,
            },
          },
          { upsert: true },
        );
        signalsCreated++;
        log("getRecentlyFundedCompany", "stored", { companyName: startup.companyName, domain: startup.websiteDomain });
      } catch (err: unknown) {
        if (isDuplicateKeyError(err)) continue;
        throw err;
      }
    }

    // Backfill signals for any stored startups missing one (only when no new startups were found)
    if (newCount === 0) {
      const stored = await fundedCol
        .find({ userEmail, triggerId })
        .sort({ fetchedAt: -1 })
        .limit(50)
        .toArray();
      for (const s of stored) {
        const signalData: FundedStartupSignalData = {
          companyName: s.companyName,
          websiteDomain: s.websiteDomain,
          fundingAmount: s.fundingAmount,
          investors: s.investors,
          citationUrl: s.citationUrl ?? null,
          enrichmentData: s.enrichmentData ?? undefined,
        };
        const upsert = await signalsCol.updateOne(
          { userEmail, signalType: "recently_funded", triggerId, companyDomain: s.websiteDomain },
          {
            $setOnInsert: {
              userEmail,
              triggerId,
              signalType: "recently_funded",
              signalDate: s.signalDate,
              companyDomain: s.websiteDomain,
              data: signalData,
              createdAt: s.fetchedAt,
              dismissed: false,
            },
          },
          { upsert: true },
        );
        if (upsert.upsertedCount > 0) signalsCreated++;
      }
    }

    log("getRecentlyFundedCompany", "done", {
      startupsFound: result.startups.length,
      newCount,
      signalsCreated,
    });

    const noun = newCount === 1 ? "startup" : "startups";
    await createNotification(
      "getRecentlyFundedCompany",
      `Synced ${newCount} recently funded ${noun} on ${formatDateFriendly()}`,
      userEmail,
    );

    return {
      success: true,
      startupsFound: result.startups.length,
      newCount,
      signalsCreated,
    };
  } catch (err) {
    logError("getRecentlyFundedCompany", "uncaught", err);
    return {
      success: false,
      startupsFound: 0,
      newCount: 0,
      signalsCreated: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                              */
/* ------------------------------------------------------------------ */

function isDuplicateKeyError(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code?: number }).code === 11000;
}
