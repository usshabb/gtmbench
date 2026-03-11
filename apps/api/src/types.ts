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
