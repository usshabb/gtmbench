import { Queue, Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { env } from "./env.js";
import { getCompanyATSCollection, getJobsCollection, getLeadsCollection, getLinkedinContentForPersonCollection, getPersonsCollection, getSignalsCollection, getSkillJobsCollection, getSkillsCollection } from "./db.js";
import { fetchLinkedinPosts } from "./linkedin.js";
import { fetchATSJobs } from "./parallel.js";
import type { ATSJobsSignalData, JobData, LinkedinPostData } from "./types.js";

const QUEUE_NAME = "skill-jobs";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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

export function getSkillJobQueue(): Queue {
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
  skillJobId: string;
  skillId: string;
  userEmail: string;
  personId: string;
  linkedinUrl: string;
  keyword: string | null;
  personName: string;
}

interface ATSJobsJobData {
  type: "ATSJobs";
  skillJobId: string;
  skillId: string;
  userEmail: string;
  leadId: string;
  atsUrl: string;
  domain: string;
}

type SkillJobData = LinkedinPostJobData | ATSJobsJobData;

/**
 * Enqueue all pending SkillJobs for processing.
 * Called by the midnight cron.
 */
export async function enqueueAllPendingJobs(): Promise<number> {
  const skillJobsCol = await getSkillJobsCollection();
  const skillsCol = await getSkillsCollection();

  // Only process jobs for active skills
  const activeSkills = await skillsCol.find({ status: "active" }).toArray();
  const activeSkillIds = new Set(activeSkills.map((s) => s._id!.toHexString()));
  const skillConfigMap = new Map(activeSkills.map((s) => [s._id!.toHexString(), s]));

  // Reset all jobs for active skills back to pending for the new day's run
  await skillJobsCol.updateMany(
    { skillId: { $in: activeSkills.map((s) => s._id!) }, status: { $in: ["completed", "failed"] } },
    { $set: { status: "pending" } },
  );

  const pendingJobs = await skillJobsCol.find({ status: "pending" }).toArray();
  const jobQueue = getSkillJobQueue();
  let enqueued = 0;

  // Enqueue in batches for parallel processing
  const bulkJobs = pendingJobs
    .filter((job) => activeSkillIds.has(job.skillId.toHexString()))
    .map((job) => {
      if (job.jobType === "ATSJobs") {
        const jobData: ATSJobsJobData = {
          type: "ATSJobs",
          skillJobId: job._id!.toHexString(),
          skillId: job.skillId.toHexString(),
          userEmail: job.userEmail,
          leadId: job.leadId!.toHexString(),
          atsUrl: job.atsUrl!,
          domain: job.domain!,
        };
        return {
          name: "ats-jobs",
          data: jobData,
          opts: { jobId: `ats-${job._id!.toHexString()}-${Date.now()}` },
        };
      }
      const skill = skillConfigMap.get(job.skillId.toHexString());
      const jobData: LinkedinPostJobData = {
        type: "LinkedinPost",
        skillJobId: job._id!.toHexString(),
        skillId: job.skillId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId!.toHexString(),
        linkedinUrl: job.linkedinUrl!,
        keyword: skill?.config?.keyword ?? null,
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

  console.log(`[skills-worker] Enqueued ${enqueued} LinkedIn post jobs`);
  return enqueued;
}

/**
 * Create/sync pending skill jobs for a specific user without running them.
 * Resets completed/failed jobs to pending and inserts any missing ones.
 */
export async function createPendingJobs(userEmail: string): Promise<number> {
  const skillsCol = await getSkillsCollection();
  const skillJobsCol = await getSkillJobsCollection();

  const activeSkills = await skillsCol.find({ userEmail, status: "active" }).toArray();
  if (activeSkills.length === 0) return 0;

  // Reset completed/failed jobs back to pending
  const resetResult = await skillJobsCol.updateMany(
    { userEmail, skillId: { $in: activeSkills.map((s) => s._id!) }, status: { $in: ["completed", "failed"] } },
    { $set: { status: "pending" } },
  );

  let created = resetResult.modifiedCount;
  const now = new Date().toISOString();

  for (const skill of activeSkills) {
    if (skill.skillType === "linkedin_content") {
      const personsCol = await getPersonsCollection();
      const persons = await personsCol.find({ userEmails: userEmail }).toArray();
      for (const person of persons) {
        try {
          await skillJobsCol.insertOne({
            skillId: skill._id!,
            userEmail,
            jobType: "LinkedinPost",
            personId: person._id!,
            linkedinUrl: person.linkedinUrl,
            status: "pending",
            createdAt: now,
          });
          created++;
        } catch {
          // Already exists (unique index) — skip
        }
      }
    } else if (skill.skillType === "ats_jobs") {
      const leadsCol = await getLeadsCollection();
      const atsCol = await getCompanyATSCollection();
      const userLeads = await leadsCol.find({ userEmails: userEmail }).toArray();
      const leadIds = userLeads.map((l) => l._id!);
      if (leadIds.length > 0) {
        const atsRecords = await atsCol
          .find({ leadId: { $in: leadIds }, detectionStatus: "completed", careerPageUrl: { $ne: null } })
          .toArray();
        for (const ats of atsRecords) {
          try {
            await skillJobsCol.insertOne({
              skillId: skill._id!,
              userEmail,
              jobType: "ATSJobs",
              leadId: ats.leadId,
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

  return created;
}

/**
 * Enqueue all pending skill jobs for a specific user (without resetting status).
 */
export async function enqueuePendingJobsForUser(userEmail: string): Promise<number> {
  const skillJobsCol = await getSkillJobsCollection();
  const skillsCol = await getSkillsCollection();

  const activeSkills = await skillsCol.find({ userEmail, status: "active" }).toArray();
  const activeSkillIds = new Set(activeSkills.map((s) => s._id!.toHexString()));
  const skillConfigMap = new Map(activeSkills.map((s) => [s._id!.toHexString(), s]));

  const pendingJobs = await skillJobsCol.find({ userEmail, status: "pending" }).toArray();
  const jobQueue = getSkillJobQueue();

  const bulkJobs = pendingJobs
    .filter((job) => activeSkillIds.has(job.skillId.toHexString()))
    .map((job) => {
      if (job.jobType === "ATSJobs") {
        const data: ATSJobsJobData = {
          type: "ATSJobs",
          skillJobId: job._id!.toHexString(),
          skillId: job.skillId.toHexString(),
          userEmail: job.userEmail,
          leadId: job.leadId!.toHexString(),
          atsUrl: job.atsUrl!,
          domain: job.domain!,
        };
        return { name: "ats-jobs", data, opts: { jobId: `ats-${job._id!.toHexString()}-${Date.now()}` } };
      }
      const skill = skillConfigMap.get(job.skillId.toHexString());
      const data: LinkedinPostJobData = {
        type: "LinkedinPost",
        skillJobId: job._id!.toHexString(),
        skillId: job.skillId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId!.toHexString(),
        linkedinUrl: job.linkedinUrl!,
        keyword: skill?.config?.keyword ?? null,
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
 * Enqueue a single skill job by ID (resets it to pending first if needed).
 */
export async function enqueueSpecificJob(skillJobId: string, userEmail: string): Promise<boolean> {
  const skillJobsCol = await getSkillJobsCollection();
  const skillsCol = await getSkillsCollection();

  let job;
  try {
    job = await skillJobsCol.findOne({ _id: new ObjectId(skillJobId), userEmail });
  } catch {
    return false;
  }
  if (!job) return false;

  if (job.status !== "pending" && job.status !== "processing") {
    await skillJobsCol.updateOne({ _id: job._id }, { $set: { status: "pending" } });
  }

  const skill = await skillsCol.findOne({ _id: job.skillId });
  const jobQueue = getSkillJobQueue();

  if (job.jobType === "ATSJobs") {
    await jobQueue.add(
      "ats-jobs",
      {
        type: "ATSJobs",
        skillJobId: job._id!.toHexString(),
        skillId: job.skillId.toHexString(),
        userEmail: job.userEmail,
        leadId: job.leadId!.toHexString(),
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
        skillJobId: job._id!.toHexString(),
        skillId: job.skillId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId!.toHexString(),
        linkedinUrl: job.linkedinUrl!,
        keyword: skill?.config?.keyword ?? null,
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
  const skillJobsCol = await getSkillJobsCollection();
  const signalsCol = await getSignalsCollection();
  const skillJobId = new ObjectId(jobData.skillJobId);

  // Mark as processing
  await skillJobsCol.updateOne({ _id: skillJobId }, { $set: { status: "processing" } });

  try {
    const result = await fetchLinkedinPosts(jobData.linkedinUrl);

    if (!result.success) {
      await skillJobsCol.updateOne(
        { _id: skillJobId },
        { $set: { status: "failed", error: result.error, lastProcessedAt: new Date().toISOString() } },
      );
      throw new Error(result.error ?? "Failed to fetch LinkedIn posts");
    }

    // Store all fetched posts in LinkedinContentForPerson
    const linkedinContentCol = await getLinkedinContentForPersonCollection();
    const fetchedAt = new Date().toISOString();
    for (const post of result.posts) {
      try {
        await linkedinContentCol.insertOne({
          personId: new ObjectId(jobData.personId),
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
        // Duplicate postId — skip
        if (err instanceof Error && "code" in err && (err as any).code === 11000) {
          continue;
        }
        throw err;
      }
    }

    const now = Date.now();
    const recentPosts = result.posts.filter((post) => {
      const postTime = new Date(post.postedAt).getTime();
      return now - postTime < TWENTY_FOUR_HOURS_MS;
    });

    // Apply keyword filter if configured
    const matchingPosts = filterByKeyword(recentPosts, jobData.keyword);

    // Bulk insert signals (skip duplicates)
    for (const post of matchingPosts) {
      try {
        await signalsCol.insertOne({
          userEmail: jobData.userEmail,
          skillId: new ObjectId(jobData.skillId),
          signalType: "linkedin_post",
          personId: new ObjectId(jobData.personId),
          personName: post.authorName,
          personLinkedinUrl: jobData.linkedinUrl,
          data: post,
          matchedKeyword: jobData.keyword,
          createdAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        // Duplicate key error (signal already exists) — skip
        if (err instanceof Error && "code" in err && (err as any).code === 11000) {
          continue;
        }
        throw err;
      }
    }

    await skillJobsCol.updateOne(
      { _id: skillJobId },
      { $set: { status: "completed", lastProcessedAt: new Date().toISOString(), error: undefined } },
    );

    console.log(
      `[skills-worker] Processed ${jobData.linkedinUrl}: ${result.posts.length} posts, ${recentPosts.length} recent, ${matchingPosts.length} signals created`,
    );
  } catch (error) {
    await skillJobsCol.updateOne(
      { _id: skillJobId },
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
  const skillJobsCol = await getSkillJobsCollection();
  const jobsCol = await getJobsCollection();
  const signalsCol = await getSignalsCollection();
  const skillJobId = new ObjectId(jobData.skillJobId);

  await skillJobsCol.updateOne({ _id: skillJobId }, { $set: { status: "processing" } });

  try {
    const result = await fetchATSJobs(jobData.atsUrl);

    if (!result.success) {
      await skillJobsCol.updateOne(
        { _id: skillJobId },
        { $set: { status: "failed", error: result.error, lastProcessedAt: new Date().toISOString() } },
      );
      throw new Error(result.error ?? "Failed to fetch ATS jobs");
    }

    const fetchedAt = new Date().toISOString();
    const today = fetchedAt.slice(0, 10); // YYYY-MM-DD
    const leadObjectId = new ObjectId(jobData.leadId);
    let newJobsCount = 0;
    const newRecentJobs: JobData[] = [];

    for (const job of result.jobs) {
      const jobUrl = (job.url as string | null | undefined) ?? null;
      const postedAt = (job.postedAt as string | null | undefined) ?? null;

      const jobDoc = {
        leadId: leadObjectId,
        domain: jobData.domain,
        title: job.title ?? "Untitled",
        jobUrl,
        location: (job.location as string | null | undefined) ?? null,
        department: (job.department as string | null | undefined) ?? null,
        postedAt,
        fetchedAt,
        rawData: job as Record<string, unknown>,
      };

      // Try to insert — skip if already exists (dedup by leadId + jobUrl)
      let isNew = false;
      try {
        await jobsCol.insertOne(jobDoc);
        isNew = true;
        newJobsCount++;
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as Record<string, unknown>).code === 11000) {
          // Already stored — skip
          continue;
        }
        throw err;
      }

      // Collect new jobs for aggregated signal (recent by postedAt, or unknown date = treat as recent)
      if (isNew) {
        const isRecent = postedAt
          ? Date.now() - new Date(postedAt).getTime() < TWENTY_FOUR_HOURS_MS
          : true;

        if (isRecent) {
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
    }

    // Create ONE aggregated signal for all new recent jobs at this company
    let signalsCreated = 0;
    if (newRecentJobs.length > 0) {
      const signalData: ATSJobsSignalData = {
        newJobsCount: newRecentJobs.length,
        jobs: newRecentJobs,
        companyDomain: jobData.domain,
      };
      await signalsCol.updateOne(
        { userEmail: jobData.userEmail, signalType: "ats_new_job", leadId: leadObjectId, signalDate: today },
        {
          $set: {
            userEmail: jobData.userEmail,
            skillId: new ObjectId(jobData.skillId),
            signalType: "ats_new_job",
            leadId: leadObjectId,
            companyDomain: jobData.domain,
            signalDate: today,
            data: signalData,
            createdAt: fetchedAt,
          },
        },
        { upsert: true },
      );
      signalsCreated = 1;
    }

    await skillJobsCol.updateOne(
      { _id: skillJobId },
      { $set: { status: "completed", lastProcessedAt: fetchedAt, error: undefined } },
    );

    console.log(
      `[skills-worker] ATS jobs for ${jobData.domain}: ${result.jobs.length} total, ${newJobsCount} new, ${signalsCreated} signals`,
    );
  } catch (error) {
    await skillJobsCol.updateOne(
      { _id: skillJobId },
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
export function startSkillsWorker(): void {
  const worker = new Worker<SkillJobData>(
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
    console.log(`[skills-worker] Job ${job?.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[skills-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[skills-worker] Worker started");
}

/**
 * Schedule the midnight cron. Uses a simple setInterval approach
 * that checks every minute if it's midnight.
 */
export function scheduleSkillsCron(): void {
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
      console.log(`[skills-cron] Midnight run triggered for ${todayDate}`);
      try {
        await enqueueAllPendingJobs();
      } catch (err) {
        console.error("[skills-cron] Failed to enqueue jobs:", err);
      }
    }
  }, 60_000);

  console.log("[skills-cron] Cron scheduled (runs at midnight daily)");
}

/**
 * Manually trigger job processing (useful for testing / on-demand runs).
 */
export async function triggerSkillsProcessing(): Promise<number> {
  return enqueueAllPendingJobs();
}
