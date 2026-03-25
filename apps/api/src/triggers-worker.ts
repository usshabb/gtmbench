import { Queue, Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { env } from "./env.js";
import { getCompaniesCollection, getCompanyATSCollection, getJobsCollection, getLinkedinPostsForUserCollection, getPersonsCollection, getSignalsCollection, getTriggerJobsCollection, getTriggersCollection } from "./db.js";
import { fetchLinkedinPosts } from "./linkedin.js";
import { fetchATSJobs } from "./parallel.js";
import { detectCompanyATS } from "./firecrawl.js";
import type { ATSJobsSignalData, JobData, LinkedinPostData } from "./types.js";

const QUEUE_NAME = "trigger-jobs";
// Rate limit: 60 req/min from Fiber = 1 req/sec
// We use BullMQ's built-in rate limiter for this
const RATE_LIMIT_MAX = 55; // slightly under 60 to be safe
const RATE_LIMIT_DURATION = 60_000; // per minute

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parseInt(parsed.port) || 6379,
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

function getRedisOpts() {
  return { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null };
}


let queue: Queue | null = null;

export function getTriggerJobQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getRedisOpts(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

interface LinkedinPostJobData {
  type: "LinkedinPost";
  triggerJobId: string;
  triggerId: string;
  userEmail: string;
  personId: string;
  linkedinUrl: string;
  keyword: string | null;
  personName: string;
}

interface ATSJobsJobData {
  type: "ATSJobs";
  triggerJobId: string;
  triggerId: string;
  userEmail: string;
  companyId: string;
  atsUrl: string;
  domain: string;
}

type TriggerJobData = LinkedinPostJobData | ATSJobsJobData;

/**
 * Enqueue all pending TriggerJobs for processing.
 * Called by the midnight cron.
 */
export async function enqueueAllPendingJobs(): Promise<number> {
  const triggerJobsCol = await getTriggerJobsCollection();
  const triggersCol = await getTriggersCollection();

  // Only process jobs for active triggers
  const activeTriggers = await triggersCol.find({ status: "active" }).toArray();
  const activeTriggerIds = new Set(activeTriggers.map((s) => s._id!.toHexString()));
  const triggerConfigMap = new Map(activeTriggers.map((s) => [s._id!.toHexString(), s]));

  // Reset all jobs for active triggers back to pending for the new day's run
  await triggerJobsCol.updateMany(
    { triggerId: { $in: activeTriggers.map((s) => s._id!) }, status: { $in: ["completed", "failed"] } },
    { $set: { status: "pending" } },
  );

  const pendingJobs = await triggerJobsCol.find({ status: "pending" }).toArray();
  const jobQueue = getTriggerJobQueue();
  let enqueued = 0;

  // Enqueue in batches for parallel processing
  const bulkJobs = pendingJobs
    .filter((job) => activeTriggerIds.has(job.triggerId.toHexString()))
    .map((job) => {
      if (job.jobType === "ATSJobs") {
        const jobData: ATSJobsJobData = {
          type: "ATSJobs",
          triggerJobId: job._id!.toHexString(),
          triggerId: job.triggerId.toHexString(),
          userEmail: job.userEmail,
          companyId: job.companyId!.toHexString(),
          atsUrl: job.atsUrl!,
          domain: job.domain!,
        };
        return {
          name: "ats-jobs",
          data: jobData,
          opts: { jobId: `ats-${job._id!.toHexString()}-${Date.now()}` },
        };
      }
      const trigger = triggerConfigMap.get(job.triggerId.toHexString());
      const jobData: LinkedinPostJobData = {
        type: "LinkedinPost",
        triggerJobId: job._id!.toHexString(),
        triggerId: job.triggerId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId!.toHexString(),
        linkedinUrl: job.linkedinUrl!,
        keyword: trigger?.config?.keyword ?? null,
        personName: "", // Will be resolved from the linkedinUrl slug
      };
      return {
        name: "linkedin-post",
        data: jobData,
        opts: { jobId: `lp-${job._id!.toHexString()}-${Date.now()}` },
      };
    });

  if (bulkJobs.length > 0) {
    await jobQueue.addBulk(bulkJobs);
    enqueued = bulkJobs.length;
  }

  console.log(`[triggers-worker] Enqueued ${enqueued} LinkedIn post jobs`);
  return enqueued;
}

/**
 * Create/sync pending trigger jobs for a specific user without running them.
 * Resets completed/failed jobs to pending and inserts any missing ones.
 */
export async function createPendingJobs(userEmail: string): Promise<number> {
  console.log(`[createPendingJobs] Starting for userEmail=${userEmail}`);
  const triggersCol = await getTriggersCollection();
  const triggerJobsCol = await getTriggerJobsCollection();

  const activeTriggers = await triggersCol.find({ userEmail, status: "active" }).toArray();
  console.log(`[createPendingJobs] Found ${activeTriggers.length} active triggers`);
  if (activeTriggers.length === 0) return 0;

  // Reset completed/failed jobs back to pending
  const resetResult = await triggerJobsCol.updateMany(
    { userEmail, triggerId: { $in: activeTriggers.map((s) => s._id!) }, status: { $in: ["completed", "failed"] } },
    { $set: { status: "pending" } },
  );
  console.log(`[createPendingJobs] Reset ${resetResult.modifiedCount} completed/failed jobs to pending`);

  let created = resetResult.modifiedCount;
  const now = new Date().toISOString();

  for (const trigger of activeTriggers) {
    if (trigger.triggerType === "linkedin_content") {
      const personsCol = await getPersonsCollection();
      const persons = await personsCol.find({ userEmails: userEmail }).toArray();
      console.log(`[createPendingJobs] linkedin_content trigger ${trigger._id}: found ${persons.length} persons for userEmail=${userEmail}`);
      for (const p of persons) {
        console.log(`[createPendingJobs]   person _id=${p._id} linkedinUrl=${p.linkedinUrl} userEmails=${JSON.stringify(p.userEmails)}`);
      }

      // Also log existing trigger jobs for this trigger to understand the current state
      const existingJobs = await triggerJobsCol.find({ triggerId: trigger._id!, userEmail }).toArray();
      console.log(`[createPendingJobs] Existing trigger jobs for this trigger: ${existingJobs.length}`);
      for (const j of existingJobs) {
        console.log(`[createPendingJobs]   job _id=${j._id} personId=${j.personId} linkedinUrl=${j.linkedinUrl} status=${j.status}`);
      }

      for (const person of persons) {
        try {
          await triggerJobsCol.insertOne({
            triggerId: trigger._id!,
            userEmail,
            jobType: "LinkedinPost",
            personId: person._id!,
            linkedinUrl: person.linkedinUrl,
            status: "pending",
            createdAt: now,
          });
          created++;
          console.log(`[createPendingJobs] Created new trigger job for person ${person._id} (${person.linkedinUrl})`);
        } catch (err: any) {
          console.log(`[createPendingJobs] Skipped person ${person._id} (${person.linkedinUrl}): ${err.message}`);
        }
      }
    } else if (trigger.triggerType === "ats_jobs") {
      const companiesCol = await getCompaniesCollection();
      const atsCol = await getCompanyATSCollection();
      const userCompanies = await companiesCol.find({ userEmails: userEmail }).toArray();
      const companyIds = userCompanies.map((c) => c._id!);
      if (companyIds.length > 0) {
        // Auto-detect ATS for companies that don't have it yet
        const existingAts = await atsCol.find({ companyId: { $in: companyIds } }).toArray();
        const atsCompanyIdSet = new Set(existingAts.map((a) => a.companyId.toHexString()));
        const companiesWithoutAts = userCompanies.filter((c) => !atsCompanyIdSet.has(c._id!.toHexString()));
        for (const comp of companiesWithoutAts) {
          console.log(`[createPendingJobs] Auto-detecting ATS for ${comp.domain}...`);
          const atsNow = new Date().toISOString();
          await atsCol.insertOne({
            companyId: comp._id!,
            domain: comp.domain,
            detectedAt: atsNow,
            detectionStatus: "pending",
          });
          const detection = await detectCompanyATS(comp.domain);
          if (detection.success && detection.data) {
            await atsCol.updateOne(
              { companyId: comp._id! },
              {
                $set: {
                  atsName: detection.data.atsName ?? null,
                  atsUrlSlug: detection.data.atsSlug ?? null,
                  careerPageUrl: detection.data.careerPageURL ?? null,
                  detectionStatus: "completed",
                  rawData: detection.rawData,
                },
              },
            );
          } else {
            await atsCol.updateOne(
              { companyId: comp._id! },
              {
                $set: {
                  detectionStatus: "failed",
                  detectionError: detection.error ?? "ATS detection failed",
                  rawData: detection.rawData,
                },
              },
            );
          }
        }

        const atsRecords = await atsCol
          .find({ companyId: { $in: companyIds }, detectionStatus: "completed", careerPageUrl: { $ne: null } })
          .toArray();
        for (const ats of atsRecords) {
          try {
            await triggerJobsCol.insertOne({
              triggerId: trigger._id!,
              userEmail,
              jobType: "ATSJobs",
              companyId: ats.companyId,
              atsUrl: ats.careerPageUrl!,
              domain: ats.domain,
              status: "pending",
              createdAt: now,
            });
            created++;
          } catch {
            // Already exists — skip
          }
        }
      }
    }
  }

  console.log(`[createPendingJobs] Done. Total created/reset: ${created}`);
  return created;
}

/**
 * Enqueue all pending trigger jobs for a specific user (without resetting status).
 */
export async function enqueuePendingJobsForUser(userEmail: string): Promise<number> {
  const triggerJobsCol = await getTriggerJobsCollection();
  const triggersCol = await getTriggersCollection();

  const activeTriggers = await triggersCol.find({ userEmail, status: "active" }).toArray();
  const activeTriggerIds = new Set(activeTriggers.map((s) => s._id!.toHexString()));
  const triggerConfigMap = new Map(activeTriggers.map((s) => [s._id!.toHexString(), s]));

  const pendingJobs = await triggerJobsCol.find({ userEmail, status: "pending" }).toArray();
  const jobQueue = getTriggerJobQueue();

  const bulkJobs = pendingJobs
    .filter((job) => activeTriggerIds.has(job.triggerId.toHexString()))
    .map((job) => {
      if (job.jobType === "ATSJobs") {
        const data: ATSJobsJobData = {
          type: "ATSJobs",
          triggerJobId: job._id!.toHexString(),
          triggerId: job.triggerId.toHexString(),
          userEmail: job.userEmail,
          companyId: job.companyId!.toHexString(),
          atsUrl: job.atsUrl!,
          domain: job.domain!,
        };
        return { name: "ats-jobs", data, opts: { jobId: `ats-${job._id!.toHexString()}-${Date.now()}` } };
      }
      const trigger = triggerConfigMap.get(job.triggerId.toHexString());
      const data: LinkedinPostJobData = {
        type: "LinkedinPost",
        triggerJobId: job._id!.toHexString(),
        triggerId: job.triggerId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId!.toHexString(),
        linkedinUrl: job.linkedinUrl!,
        keyword: trigger?.config?.keyword ?? null,
        personName: "",
      };
      return { name: "linkedin-post", data, opts: { jobId: `lp-${job._id!.toHexString()}-${Date.now()}` } };
    });

  if (bulkJobs.length > 0) {
    await jobQueue.addBulk(bulkJobs);
  }

  return bulkJobs.length;
}

/**
 * Enqueue a single trigger job by ID (resets it to pending first if needed).
 */
export async function enqueueSpecificJob(triggerJobId: string, userEmail: string): Promise<boolean> {
  const triggerJobsCol = await getTriggerJobsCollection();
  const triggersCol = await getTriggersCollection();

  let job;
  try {
    job = await triggerJobsCol.findOne({ _id: new ObjectId(triggerJobId), userEmail });
  } catch {
    return false;
  }
  if (!job) return false;

  if (job.status !== "pending" && job.status !== "processing") {
    await triggerJobsCol.updateOne({ _id: job._id }, { $set: { status: "pending" } });
  }

  const trigger = await triggersCol.findOne({ _id: job.triggerId });
  const jobQueue = getTriggerJobQueue();

  if (job.jobType === "ATSJobs") {
    await jobQueue.add(
      "ats-jobs",
      {
        type: "ATSJobs",
        triggerJobId: job._id!.toHexString(),
        triggerId: job.triggerId.toHexString(),
        userEmail: job.userEmail,
        companyId: job.companyId!.toHexString(),
        atsUrl: job.atsUrl!,
        domain: job.domain!,
      } satisfies ATSJobsJobData,
      { jobId: `ats-${job._id!.toHexString()}-${Date.now()}` },
    );
  } else {
    await jobQueue.add(
      "linkedin-post",
      {
        type: "LinkedinPost",
        triggerJobId: job._id!.toHexString(),
        triggerId: job.triggerId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId!.toHexString(),
        linkedinUrl: job.linkedinUrl!,
        keyword: trigger?.config?.keyword ?? null,
        personName: "",
      } satisfies LinkedinPostJobData,
      { jobId: `lp-${job._id!.toHexString()}-${Date.now()}` },
    );
  }

  return true;
}

/**
 * Process a single LinkedIn post job:
 * 1. Fetch posts from Fiber API
 * 2. Filter to posts < 24h old
 * 3. Optionally filter by keyword
 * 4. Insert matching posts as signals
 */
async function processLinkedinPostJob(jobData: LinkedinPostJobData): Promise<void> {
  const triggerJobsCol = await getTriggerJobsCollection();
  const signalsCol = await getSignalsCollection();
  const triggerJobId = new ObjectId(jobData.triggerJobId);

  // Mark as processing
  await triggerJobsCol.updateOne({ _id: triggerJobId }, { $set: { status: "processing" } });

  try {
    const result = await fetchLinkedinPosts(jobData.linkedinUrl);

    if (!result.success) {
      await triggerJobsCol.updateOne(
        { _id: triggerJobId },
        { $set: { status: "failed", error: result.error, lastProcessedAt: new Date().toISOString() } },
      );
      throw new Error(result.error ?? "Failed to fetch LinkedIn posts");
    }

    // Store all fetched posts in LinkedinPostsForUser (per-user store)
    const linkedinPostsForUserCol = await getLinkedinPostsForUserCollection();
    const fetchedAt = new Date().toISOString();
    const personObjectId = new ObjectId(jobData.personId);
    for (const post of result.posts) {
      try {
        await linkedinPostsForUserCol.insertOne({
          userEmail: jobData.userEmail,
          personId: personObjectId,
          linkedinUrl: jobData.linkedinUrl,
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
        // Duplicate (userEmail, postId) — skip
        if (!(err instanceof Error && "code" in err && (err as any).code === 11000)) {
          throw err;
        }
      }
    }

    // Apply keyword filter if configured, then create signals for all matching posts
    const matchingPosts = filterByKeyword(result.posts, jobData.keyword);

    // Bulk insert signals (skip duplicates via unique index on data.postId+userEmail)
    for (const post of matchingPosts) {
      try {
        await signalsCol.insertOne({
          userEmail: jobData.userEmail,
          triggerId: new ObjectId(jobData.triggerId),
          signalType: "linkedin_post",
          personId: new ObjectId(jobData.personId),
          personName: post.authorName,
          personLinkedinUrl: jobData.linkedinUrl,
          data: post,
          matchedKeyword: jobData.keyword,
          createdAt: post.postedAt,
        });
      } catch (err: unknown) {
        // Duplicate key error (signal already exists) — skip
        if (err instanceof Error && "code" in err && (err as any).code === 11000) {
          continue;
        }
        throw err;
      }
    }

    await triggerJobsCol.updateOne(
      { _id: triggerJobId },
      { $set: { status: "completed", lastProcessedAt: new Date().toISOString(), error: undefined } },
    );

    console.log(
      `[triggers-worker] Processed ${jobData.linkedinUrl}: ${result.posts.length} posts, ${matchingPosts.length} signals created`,
    );
  } catch (error) {
    await triggerJobsCol.updateOne(
      { _id: triggerJobId },
      {
        $set: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          lastProcessedAt: new Date().toISOString(),
        },
      },
    );
    throw error;
  }
}

/**
 * Process a single ATS jobs fetch job:
 * 1. Call Parallel API to get current job listings for the company's ATS URL
 * 2. Store new jobs in the jobs collection
 * 3. Create signals for jobs posted in the last 24 hours
 */
async function processATSJobsJob(jobData: ATSJobsJobData): Promise<void> {
  const triggerJobsCol = await getTriggerJobsCollection();
  const jobsCol = await getJobsCollection();
  const signalsCol = await getSignalsCollection();
  const triggerJobId = new ObjectId(jobData.triggerJobId);

  console.log(`[triggers-worker] [ATS] Starting job for domain=${jobData.domain} atsUrl=${jobData.atsUrl} companyId=${jobData.companyId} triggerJobId=${jobData.triggerJobId}`);

  await triggerJobsCol.updateOne({ _id: triggerJobId }, { $set: { status: "processing" } });
  console.log(`[triggers-worker] [ATS] Marked triggerJob ${jobData.triggerJobId} as processing`);

  try {
    console.log(`[triggers-worker] [ATS] Calling fetchATSJobs for ${jobData.atsUrl}...`);
    const result = await fetchATSJobs(jobData.atsUrl);
    console.log(`[triggers-worker] [ATS] fetchATSJobs returned: success=${result.success} jobsCount=${result.jobs.length} error=${result.error ?? "none"}`);

    if (!result.success) {
      console.error(`[triggers-worker] [ATS] fetchATSJobs failed for ${jobData.domain}: ${result.error}`);
      await triggerJobsCol.updateOne(
        { _id: triggerJobId },
        { $set: { status: "failed", error: result.error, lastProcessedAt: new Date().toISOString() } },
      );
      throw new Error(result.error ?? "Failed to fetch ATS jobs");
    }

    const fetchedAt = new Date().toISOString();
    const today = fetchedAt.slice(0, 10); // YYYY-MM-DD
    const companyObjectId = new ObjectId(jobData.companyId);
    let newJobsCount = 0;
    const newRecentJobs: JobData[] = [];

    console.log(`[triggers-worker] [ATS] Processing ${result.jobs.length} jobs for ${jobData.domain}...`);

    for (const job of result.jobs) {
      const jobUrl = (job.url as string | null | undefined) ?? null;
      const postedAt = (job.postedAt as string | null | undefined) ?? null;

      const jobDoc = {
        companyId: companyObjectId,
        domain: jobData.domain,
        title: job.title ?? "Untitled",
        jobUrl,
        location: (job.location as string | null | undefined) ?? null,
        department: (job.department as string | null | undefined) ?? null,
        postedAt,
        fetchedAt,
        rawData: job as Record<string, unknown>,
      };

      // Try to insert — skip if already exists (dedup by companyId + jobUrl)
      let isNew = false;
      try {
        await jobsCol.insertOne(jobDoc);
        isNew = true;
        newJobsCount++;
        console.log(`[triggers-worker] [ATS] Inserted new job: "${jobDoc.title}" url=${jobUrl} for ${jobData.domain}`);
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as Record<string, unknown>).code === 11000) {
          // Already stored — skip
          console.log(`[triggers-worker] [ATS] Skipped duplicate job: "${jobDoc.title}" url=${jobUrl}`);
          continue;
        }
        throw err;
      }

      // Any job newly inserted into our DB is worth signaling — we just discovered it
      if (isNew) {
        console.log(`[triggers-worker] [ATS] Job "${jobDoc.title}" postedAt=${postedAt} — newly discovered, adding to signal`);
        newRecentJobs.push({
          title: jobDoc.title,
          jobUrl,
          location: jobDoc.location,
          department: jobDoc.department,
          postedAt,
          companyDomain: jobData.domain,
        });
      }
    }

    console.log(`[triggers-worker] [ATS] ${jobData.domain}: ${newJobsCount} new jobs, ${newRecentJobs.length} newly discovered jobs for signal`);

    // If no newly-discovered jobs, check if any signal exists for this company.
    // If not, fall back to all known jobs so the user sees activity on first discovery.
    let jobsForSignal = newRecentJobs;
    if (jobsForSignal.length === 0) {
      const existingSignal = await signalsCol.findOne({
        userEmail: jobData.userEmail,
        signalType: "ats_new_job",
        companyId: companyObjectId,
      });
      if (!existingSignal) {
        const allKnownJobs = await jobsCol
          .find({ companyId: companyObjectId })
          .sort({ fetchedAt: -1 })
          .limit(50)
          .toArray();
        jobsForSignal = allKnownJobs.map((j) => ({
          title: j.title,
          jobUrl: j.jobUrl ?? null,
          location: j.location ?? null,
          department: j.department ?? null,
          postedAt: j.postedAt ?? null,
          companyDomain: jobData.domain,
        }));
        console.log(`[triggers-worker] [ATS] No signal exists yet for ${jobData.domain} — surfacing ${jobsForSignal.length} existing jobs`);
      }
    }

    // Group jobs by their postedAt date (YYYY-MM-DD), falling back to today for undated jobs.
    // Create one signal per date so the feed shows separate entries per posting date.
    const byDate = new Map<string, JobData[]>();
    for (const job of jobsForSignal) {
      const dateKey = job.postedAt ? job.postedAt.slice(0, 10) : today;
      const bucket = byDate.get(dateKey) ?? [];
      bucket.push(job);
      byDate.set(dateKey, bucket);
    }

    let signalsCreated = 0;
    for (const [signalDate, jobs] of byDate) {
      const signalData: ATSJobsSignalData = {
        newJobsCount: jobs.length,
        jobs,
        companyDomain: jobData.domain,
      };
      console.log(`[triggers-worker] [ATS] Upserting signal for ${jobData.domain} date=${signalDate} with ${jobs.length} jobs`);
      await signalsCol.updateOne(
        { userEmail: jobData.userEmail, signalType: "ats_new_job", companyId: companyObjectId, signalDate },
        {
          $set: {
            userEmail: jobData.userEmail,
            triggerId: new ObjectId(jobData.triggerId),
            signalType: "ats_new_job",
            companyId: companyObjectId,
            companyDomain: jobData.domain,
            signalDate,
            data: signalData,
            createdAt: fetchedAt,
          },
        },
        { upsert: true },
      );
      signalsCreated++;
    }

    if (signalsCreated === 0) {
      console.log(`[triggers-worker] [ATS] No jobs found for ${jobData.domain}, skipping signal creation`);
    } else {
      console.log(`[triggers-worker] [ATS] ${signalsCreated} signals upserted for ${jobData.domain}`);
    }

    await triggerJobsCol.updateOne(
      { _id: triggerJobId },
      { $set: { status: "completed", lastProcessedAt: fetchedAt, error: undefined } },
    );

    console.log(
      `[triggers-worker] [ATS] DONE ${jobData.domain}: ${result.jobs.length} total, ${newJobsCount} new, ${signalsCreated} signals`,
    );
  } catch (error) {
    console.error(`[triggers-worker] [ATS] FAILED for ${jobData.domain}:`, error instanceof Error ? error.message : error);
    await triggerJobsCol.updateOne(
      { _id: triggerJobId },
      {
        $set: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          lastProcessedAt: new Date().toISOString(),
        },
      },
    );
    throw error;
  }
}

function filterByKeyword(posts: LinkedinPostData[], keyword: string | null): LinkedinPostData[] {
  if (!keyword) return posts;
  const lowerKeyword = keyword.toLowerCase();
  return posts.filter((post) => {
    const caption = post.caption?.toLowerCase() ?? "";
    return caption.includes(lowerKeyword);
  });
}

/**
 * Start the BullMQ worker that processes LinkedIn post jobs.
 * Call once at server startup.
 */
export function startTriggersWorker(): void {
  const worker = new Worker<TriggerJobData>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === "ATSJobs") {
        await processATSJobsJob(job.data);
      } else {
        await processLinkedinPostJob(job.data);
      }
    },
    {
      connection: getRedisOpts(),
      concurrency: 5, // Process up to 5 jobs in parallel
      limiter: {
        max: RATE_LIMIT_MAX,
        duration: RATE_LIMIT_DURATION,
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(`[triggers-worker] Job ${job?.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[triggers-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[triggers-worker] Worker started");
}

/**
 * Schedule the midnight cron. Uses a simple setInterval approach
 * that checks every minute if it's midnight.
 */
export function scheduleTriggersCron(): void {
  // Check every 60 seconds if it's time to run (within the 00:00 minute)
  let lastRunDate = "";

  setInterval(async () => {
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Run at midnight (00:00)
    if (hour === 0 && minute === 0 && lastRunDate !== todayDate) {
      lastRunDate = todayDate;
      console.log(`[triggers-cron] Midnight run triggered for ${todayDate}`);
      try {
        await enqueueAllPendingJobs();
      } catch (err) {
        console.error("[triggers-cron] Failed to enqueue jobs:", err);
      }
    }
  }, 60_000);

  console.log("[triggers-cron] Cron scheduled (runs at midnight daily)");
}

/**
 * Manually trigger job processing (useful for testing / on-demand runs).
 */
export async function triggerTriggersProcessing(): Promise<number> {
  return enqueueAllPendingJobs();
}
