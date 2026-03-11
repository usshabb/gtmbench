import { Queue, Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { env } from "./env.js";
import { getLinkedinContentForPersonCollection, getSignalsCollection, getSkillJobsCollection, getSkillsCollection } from "./db.js";
import { fetchLinkedinPosts } from "./linkedin.js";
import type { LinkedinPostData } from "./types.js";

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
  skillJobId: string;
  skillId: string;
  userEmail: string;
  personId: string;
  linkedinUrl: string;
  keyword: string | null;
  personName: string;
}

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
      const skill = skillConfigMap.get(job.skillId.toHexString());
      const jobData: LinkedinPostJobData = {
        skillJobId: job._id!.toHexString(),
        skillId: job.skillId.toHexString(),
        userEmail: job.userEmail,
        personId: job.personId.toHexString(),
        linkedinUrl: job.linkedinUrl,
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
  const worker = new Worker<LinkedinPostJobData>(
    QUEUE_NAME,
    async (job) => {
      await processLinkedinPostJob(job.data);
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
