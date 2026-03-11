import type { ObjectId } from "mongodb";

export interface LeadRecord {
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
/*  Skills & Signals                                                    */
/* ------------------------------------------------------------------ */

export type SkillType = "linkedin_content";

export interface SkillRecord {
  _id?: ObjectId;
  userEmail: string;
  skillType: SkillType;
  config: {
    keyword?: string | null; // optional keyword filter
  };
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export type SkillJobStatus = "pending" | "processing" | "completed" | "failed";

export interface SkillJobRecord {
  _id?: ObjectId;
  skillId: ObjectId;
  userEmail: string;
  jobType: "LinkedinPost";
  personId: ObjectId;
  linkedinUrl: string;
  status: SkillJobStatus;
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

export interface LinkedinContentForPersonRecord {
  _id?: ObjectId;
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

export interface SignalRecord {
  _id?: ObjectId;
  userEmail: string;
  skillId: ObjectId;
  signalType: "linkedin_post";
  personId: ObjectId;
  personName: string;
  personLinkedinUrl: string;
  data: LinkedinPostData;
  matchedKeyword?: string | null;
  createdAt: string;
}
