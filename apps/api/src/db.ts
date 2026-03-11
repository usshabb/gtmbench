import { Collection, MongoClient } from "mongodb";
import { env } from "./env.js";
import { BuyerProfileRecord, LeadRecord, PersonRecord } from "./types.js";

const mongoClient = new MongoClient(env.MONGODB_URL);

let leadsCollection: Collection<LeadRecord> | null = null;
let personsCollection: Collection<PersonRecord> | null = null;
let buyerProfilesCollection: Collection<BuyerProfileRecord> | null = null;

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
