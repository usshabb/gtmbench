import { Collection, MongoClient } from "mongodb";
import { env } from "./env.js";
import { BuyerProfileRecord, LeadRecord, LinkedinContentForPersonRecord, PersonRecord, SignalRecord, SkillJobRecord, SkillRecord } from "./types.js";

const mongoClient = new MongoClient(env.MONGODB_URL);

let leadsCollection: Collection<LeadRecord> | null = null;
let personsCollection: Collection<PersonRecord> | null = null;
let buyerProfilesCollection: Collection<BuyerProfileRecord> | null = null;
let skillsCollection: Collection<SkillRecord> | null = null;
let skillJobsCollection: Collection<SkillJobRecord> | null = null;
let signalsCollection: Collection<SignalRecord> | null = null;
let linkedinContentForPersonCollection: Collection<LinkedinContentForPersonRecord> | null = null;

export async function getLeadsCollection(): Promise<Collection<LeadRecord>> {
  if (leadsCollection) return leadsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  leadsCollection = database.collection<LeadRecord>("leads");

  // Drop stale indexes from previous schema
  try {
    await leadsCollection.dropIndex("domain_1");
  } catch {
    // Index may not exist, ignore
  }
  try {
    await leadsCollection.dropIndex("userEmail_1_domain_1");
  } catch {
    // Index may not exist, ignore
  }

  await leadsCollection.createIndex({ domain: 1 }, { unique: true });
  await leadsCollection.createIndex({ userEmails: 1 });

  return leadsCollection;
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

  return personsCollection;
}

export async function getSkillsCollection(): Promise<Collection<SkillRecord>> {
  if (skillsCollection) return skillsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  skillsCollection = database.collection<SkillRecord>("skills");

  await skillsCollection.createIndex({ userEmail: 1, skillType: 1 }, { unique: true });

  return skillsCollection;
}

export async function getSkillJobsCollection(): Promise<Collection<SkillJobRecord>> {
  if (skillJobsCollection) return skillJobsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  skillJobsCollection = database.collection<SkillJobRecord>("skillJobs");

  await skillJobsCollection.createIndex({ skillId: 1 });
  await skillJobsCollection.createIndex({ userEmail: 1 });
  await skillJobsCollection.createIndex({ status: 1 });
  await skillJobsCollection.createIndex({ personId: 1, skillId: 1 }, { unique: true });

  return skillJobsCollection;
}

export async function getLinkedinContentForPersonCollection(): Promise<Collection<LinkedinContentForPersonRecord>> {
  if (linkedinContentForPersonCollection) return linkedinContentForPersonCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  linkedinContentForPersonCollection = database.collection<LinkedinContentForPersonRecord>("linkedinContentForPerson");

  await linkedinContentForPersonCollection.createIndex({ personId: 1 });
  await linkedinContentForPersonCollection.createIndex({ postId: 1 }, { unique: true });
  await linkedinContentForPersonCollection.createIndex({ linkedinUrl: 1 });

  return linkedinContentForPersonCollection;
}

export async function getSignalsCollection(): Promise<Collection<SignalRecord>> {
  if (signalsCollection) return signalsCollection;

  await mongoClient.connect();
  const database = mongoClient.db(env.MONGODB_DB_NAME);

  signalsCollection = database.collection<SignalRecord>("signals");

  await signalsCollection.createIndex({ userEmail: 1, createdAt: -1 });
  await signalsCollection.createIndex({ "data.postId": 1, userEmail: 1 }, { unique: true });

  return signalsCollection;
}
