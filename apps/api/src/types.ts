import type { ObjectId } from "mongodb";

export interface CompanyRecord {
  _id?: ObjectId;
  userEmails: string[];
  domain: string;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
}

export interface BuyerProfileRecord {
  _id?: ObjectId;
  userEmail: string;
  name: string;
  titles: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BuyerSearchResultRecord {
  _id?: ObjectId;
  companyId: ObjectId;
  buyerProfileId: ObjectId;
  userEmail: string;
  buyers: Record<string, unknown>[];
  fetchedAt: string;
  nextCursor: string | null;
}

export interface PersonRecord {
  _id?: ObjectId;
  userEmails: string[];
  linkedinUrl: string;
  companyDomain?: string;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
}

/* ------------------------------------------------------------------ */
/*  Triggers & Signals                                                  */
/* ------------------------------------------------------------------ */

export type TriggerType = "linkedin_content" | "ats_jobs";

export interface TriggerRecord {
  _id?: ObjectId;
  userEmail: string;
  triggerType: TriggerType;
  config: {
    keyword?: string | null; // optional keyword filter
  };
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export type TriggerJobStatus = "pending" | "processing" | "completed" | "failed";

export interface TriggerJobRecord {
  _id?: ObjectId;
  triggerId: ObjectId;
  userEmail: string;
  jobType: "LinkedinPost" | "ATSJobs";
  // LinkedinPost fields
  personId?: ObjectId;
  linkedinUrl?: string;
  // ATSJobs fields
  companyId?: ObjectId;
  atsUrl?: string;
  domain?: string;
  status: TriggerJobStatus;
  lastProcessedAt?: string;
  error?: string;
  createdAt: string;
}

export interface LinkedinPostData {
  postId: string;
  postUrl: string;
  caption: string | null;
  postedAt: string; // ISO date from noLaterThan
  authorName: string;
  authorLinkedinUrl: string;
  authorProfilePicture: string | null;
  engagement: {
    numComments: number;
    numShares: number;
    numReactions: number;
  };
  imageUrls: string[] | null;
  hasVideo: boolean;
  isReshare: boolean;
}


export interface LinkedinPostForUserRecord {
  _id?: ObjectId;
  userEmail: string;
  personId: ObjectId;
  linkedinUrl: string;
  postId: string;
  postUrl: string;
  caption: string | null;
  postedAt: string;
  authorName: string;
  authorLinkedinUrl: string;
  authorProfilePicture: string | null;
  engagement: {
    numComments: number;
    numShares: number;
    numReactions: number;
  };
  imageUrls: string[] | null;
  hasVideo: boolean;
  isReshare: boolean;
  fetchedAt: string;
}

export interface JobRecord {
  _id?: ObjectId;
  companyId: ObjectId;
  domain: string;
  title: string;
  jobUrl?: string | null;
  location?: string | null;
  department?: string | null;
  postedAt?: string | null;
  fetchedAt: string;
  rawData?: Record<string, unknown>;
}

export interface JobData {
  title: string;
  jobUrl?: string | null;
  location?: string | null;
  department?: string | null;
  postedAt?: string | null;
  companyDomain: string;
}

export interface ATSJobsSignalData {
  newJobsCount: number;
  jobs: JobData[];
  companyDomain: string;
}

export interface SignalRecord {
  _id?: ObjectId;
  userEmail: string;
  triggerId: ObjectId;
  signalType: "linkedin_post" | "ats_new_job";
  // linkedin_post fields
  personId?: ObjectId;
  personName?: string;
  personLinkedinUrl?: string;
  // ats_new_job fields
  companyId?: ObjectId;
  companyDomain?: string;
  signalDate?: string; // YYYY-MM-DD, used for per-day dedup of ats_new_job
  data: LinkedinPostData | ATSJobsSignalData;
  matchedKeyword?: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Skills                                                               */
/* ------------------------------------------------------------------ */

export type SkillType = "detect_ats";

export interface SkillRecord {
  _id?: ObjectId;
  userEmail: string;
  skillType: SkillType;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Company ATS                                                         */
/* ------------------------------------------------------------------ */

export interface CompanyATSRecord {
  _id?: ObjectId;
  companyId: ObjectId;
  domain: string;
  atsName?: string | null;
  atsUrlSlug?: string | null;
  careerPageUrl?: string | null;
  detectedAt: string;
  detectionStatus: "pending" | "completed" | "failed";
  detectionError?: string;
  rawData?: Record<string, unknown>;
}
