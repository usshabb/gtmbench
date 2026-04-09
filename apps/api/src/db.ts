import { Collection, MongoClient } from "mongodb";
import { env } from "./env.js";
import { BuyerProfileRecord, BuyerSearchResultRecord, CompanyATSRecord, CompanyRecord, EmailSignatureRecord, EmailTemplateRecord, GoogleTokenRecord, InviteRecord, JobRecord, LinkedinPostForUserRecord, PersonRecord, SignalRecord, SkillRecord, TriggerJobRecord, TriggerRecord, UserRecord, WorkspaceRecord } from "./types.js";

const mongoClient = new MongoClient(env.MONGODB_URL);

let companiesCollection: Collection<CompanyRecord> | null = null;
let personsCollection: Collection<PersonRecord> | null = null;
let buyerProfilesCollection: Collection<BuyerProfileRecord> | null = null;
let triggersCollection: Collection<TriggerRecord> | null = null;
let triggerJobsCollection: Collection<TriggerJobRecord> | null = null;
let signalsCollection: Collection<SignalRecord> | null = null;
let buyerSearchResultsCollection: Collection<BuyerSearchResultRecord> | null = null;
let companyATSCollection: Collection<CompanyATSRecord> | null = null;
let jobsCollection: Collection<JobRecord> | null = null;
let skillsCollection: Collection<SkillRecord> | null = null;
let linkedinPostsForUserCollection: Collection<LinkedinPostForUserRecord> | null = null;
let googleTokensCollection: Collection<GoogleTokenRecord> | null = null;
let workspacesCollection: Collection<WorkspaceRecord> | null = null;
let usersCollection: Collection<UserRecord> | null = null;
let invitesCollection: Collection<InviteRecord> | null = null;
let emailTemplatesCollection: Collection<EmailTemplateRecord> | null = null;
let emailSignaturesCollection: Collection<EmailSignatureRecord> | null = null;

export async function getCompaniesCollection(): Promise<Collection<CompanyRecord>> {
  if (companiesCollection) return companiesCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  companiesCollection = database.collection<CompanyRecord>("companies");

  // Drop stale indexes from previous schema
  try {
    await companiesCollection.dropIndex("domain_1");
  } catch {
    // Index may not exist, ignore
  }
  try {
    await companiesCollection.dropIndex("userEmail_1_domain_1");
  } catch {
    // Index may not exist, ignore
  }

  await companiesCollection.createIndex({ domain: 1 }, { unique: true });
  await companiesCollection.createIndex({ userEmails: 1 });

  return companiesCollection;
}

export async function getBuyerProfilesCollection(): Promise<Collection<BuyerProfileRecord>> {
  if (buyerProfilesCollection) return buyerProfilesCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  buyerProfilesCollection = database.collection<BuyerProfileRecord>("buyerProfiles");

  await buyerProfilesCollection.createIndex({ userEmail: 1 });

  return buyerProfilesCollection;
}

export async function getPersonsCollection(): Promise<Collection<PersonRecord>> {
  if (personsCollection) return personsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  personsCollection = database.collection<PersonRecord>("persons");

  await personsCollection.createIndex({ linkedinUrl: 1 }, { unique: true });
  await personsCollection.createIndex({ userEmails: 1 });
  await personsCollection.createIndex({ companyDomain: 1 });
  await personsCollection.createIndex({ workEmail: 1 }, { sparse: true });

  return personsCollection;
}

export async function getTriggersCollection(): Promise<Collection<TriggerRecord>> {
  if (triggersCollection) return triggersCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  triggersCollection = database.collection<TriggerRecord>("triggers");

  await triggersCollection.createIndex({ userEmail: 1, triggerType: 1 }, { unique: true });

  return triggersCollection;
}

export async function getTriggerJobsCollection(): Promise<Collection<TriggerJobRecord>> {
  if (triggerJobsCollection) return triggerJobsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  triggerJobsCollection = database.collection<TriggerJobRecord>("triggerJobs");

  await triggerJobsCollection.createIndex({ triggerId: 1 });
  await triggerJobsCollection.createIndex({ userEmail: 1 });
  await triggerJobsCollection.createIndex({ status: 1 });

  // Drop old sparse indexes — sparse:true still indexes null values, causing
  // duplicate key errors when multiple LinkedinPost jobs share companyId=null
  // (or multiple ATSJobs share personId=null). Replace with partialFilterExpression
  // so the unique index only covers documents that actually have the field.
  try {
    await triggerJobsCollection.dropIndex("personId_1_triggerId_1");
  } catch {
    // Index may not exist
  }
  try {
    await triggerJobsCollection.dropIndex("companyId_1_triggerId_1");
  } catch {
    // Index may not exist
  }
  await triggerJobsCollection.createIndex(
    { personId: 1, triggerId: 1 },
    { unique: true, partialFilterExpression: { personId: { $exists: true, $type: "objectId" } } },
  );
  await triggerJobsCollection.createIndex(
    { companyId: 1, triggerId: 1 },
    { unique: true, partialFilterExpression: { companyId: { $exists: true, $type: "objectId" } } },
  );

  return triggerJobsCollection;
}

export async function getSignalsCollection(): Promise<Collection<SignalRecord>> {
  if (signalsCollection) return signalsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  signalsCollection = database.collection<SignalRecord>("signals");

  await signalsCollection.createIndex({ userEmail: 1, createdAt: -1 });

  // Drop old non-sparse postId index and recreate as sparse (so ATS job signals without postId don't clash)
  try {
    await signalsCollection.dropIndex("data.postId_1_userEmail_1");
  } catch {
    // Index may not exist
  }
  await signalsCollection.createIndex({ "data.postId": 1, userEmail: 1 }, { unique: true, sparse: true });
  // Drop old per-job ATS dedup index, replaced by per-day aggregated dedup
  try {
    await signalsCollection.dropIndex("companyId_1_data.jobUrl_1_userEmail_1");
  } catch {
    // Index may not exist
  }
  // Dedup for aggregated ATS signals: one per company per user per day
  await signalsCollection.createIndex({ companyId: 1, userEmail: 1, signalDate: 1 }, { unique: true, sparse: true });

  return signalsCollection;
}

export async function getBuyerSearchResultsCollection(): Promise<Collection<BuyerSearchResultRecord>> {
  if (buyerSearchResultsCollection) return buyerSearchResultsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  buyerSearchResultsCollection = database.collection<BuyerSearchResultRecord>("buyerSearchResults");

  await buyerSearchResultsCollection.createIndex({ companyId: 1, buyerProfileId: 1 }, { unique: true });
  await buyerSearchResultsCollection.createIndex({ userEmail: 1 });

  return buyerSearchResultsCollection;
}

export async function getCompanyATSCollection(): Promise<Collection<CompanyATSRecord>> {
  if (companyATSCollection) return companyATSCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  companyATSCollection = database.collection<CompanyATSRecord>("companyATS");

  // Drop stale index from previous schema
  try {
    await companyATSCollection.dropIndex("leadId_1");
  } catch {
    // Index may not exist, ignore
  }

  await companyATSCollection.createIndex({ companyId: 1 }, { unique: true });
  await companyATSCollection.createIndex({ domain: 1 });

  return companyATSCollection;
}

export async function getJobsCollection(): Promise<Collection<JobRecord>> {
  if (jobsCollection) return jobsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  jobsCollection = database.collection<JobRecord>("jobs");

  await jobsCollection.createIndex({ companyId: 1 });
  await jobsCollection.createIndex({ domain: 1 });
  await jobsCollection.createIndex({ fetchedAt: -1 });
  // Dedup by jobUrl per company (sparse so null jobUrls don't collide)
  await jobsCollection.createIndex({ companyId: 1, jobUrl: 1 }, { unique: true, sparse: true });

  return jobsCollection;
}

export async function getLinkedinPostsForUserCollection(): Promise<Collection<LinkedinPostForUserRecord>> {
  if (linkedinPostsForUserCollection) return linkedinPostsForUserCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  linkedinPostsForUserCollection = database.collection<LinkedinPostForUserRecord>("linkedinPostsForUser");

  await linkedinPostsForUserCollection.createIndex({ userEmail: 1, postedAt: -1 });
  await linkedinPostsForUserCollection.createIndex({ personId: 1 });
  // Dedup: one row per (user, post)
  await linkedinPostsForUserCollection.createIndex({ userEmail: 1, postId: 1 }, { unique: true });

  return linkedinPostsForUserCollection;
}

export async function getGoogleTokensCollection(): Promise<Collection<GoogleTokenRecord>> {
  if (googleTokensCollection) return googleTokensCollection;
  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);
  googleTokensCollection = database.collection<GoogleTokenRecord>("googleTokens");
  await googleTokensCollection.createIndex({ userEmail: 1 }, { unique: true });
  return googleTokensCollection;
}

export async function getWorkspacesCollection(): Promise<Collection<WorkspaceRecord>> {
  if (workspacesCollection) return workspacesCollection;
  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);
  workspacesCollection = database.collection<WorkspaceRecord>("workspaces");
  await workspacesCollection.createIndex({ domain: 1 }, { unique: true });
  return workspacesCollection;
}

export async function getUsersCollection(): Promise<Collection<UserRecord>> {
  if (usersCollection) return usersCollection;
  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);
  usersCollection = database.collection<UserRecord>("users");
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await usersCollection.createIndex({ workspaceId: 1 }, { sparse: true });
  return usersCollection;
}

export async function getInvitesCollection(): Promise<Collection<InviteRecord>> {
  if (invitesCollection) return invitesCollection;
  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);
  invitesCollection = database.collection<InviteRecord>("invites");
  await invitesCollection.createIndex({ token: 1 }, { unique: true });
  await invitesCollection.createIndex({ workspaceId: 1 });
  return invitesCollection;
}

/** Raw accessor for the legacy linkedinContentForPerson collection (migration use only). */
export async function getLegacyLinkedinContentForPersonCollection() {
  await mongoClient.connect();
  return mongoClient.db(env.MONGODB_DB_NAME).collection("linkedinContentForPerson");
}

export async function getSkillsCollection(): Promise<Collection<SkillRecord>> {
  if (skillsCollection) return skillsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  skillsCollection = database.collection<SkillRecord>("skills");

  await skillsCollection.createIndex({ userEmail: 1, skillType: 1 }, { unique: true });

  return skillsCollection;
}

export async function getEmailTemplatesCollection(): Promise<Collection<EmailTemplateRecord>> {
  if (emailTemplatesCollection) return emailTemplatesCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  emailTemplatesCollection = database.collection<EmailTemplateRecord>("emailTemplates");

  await emailTemplatesCollection.createIndex({ userEmail: 1 });

  return emailTemplatesCollection;
}

export async function getEmailSignaturesCollection(): Promise<Collection<EmailSignatureRecord>> {
  if (emailSignaturesCollection) return emailSignaturesCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  emailSignaturesCollection = database.collection<EmailSignatureRecord>("emailSignatures");

  await emailSignaturesCollection.createIndex({ userEmail: 1 }, { unique: true });

  return emailSignaturesCollection;
}
