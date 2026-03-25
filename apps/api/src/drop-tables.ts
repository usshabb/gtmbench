import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { MongoClient } from "mongodb";
import * as readline from "node:readline";

// Load .env relative to this file so the script works from any CWD
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

const MONGODB_URL = process.env.MONGODB_URL;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "gtmbench";

if (!MONGODB_URL) {
  console.error("MONGODB_URL is not set");
  process.exit(1);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const tableNameArg = args.find((a) => a.startsWith("--tableName="));
  const specificTable = tableNameArg?.split("=")[1];

  const client = new MongoClient(MONGODB_URL!);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);

  // Get all collections
  const allCollections = (await db.listCollections().toArray()).map((c) => c.name).sort();

  let targetCollections: string[];
  if (specificTable) {
    if (!allCollections.includes(specificTable)) {
      console.error(`\nCollection "${specificTable}" not found.`);
      console.error(`Available collections: ${allCollections.join(", ")}`);
      await client.close();
      process.exit(1);
    }
    targetCollections = [specificTable];
  } else {
    targetCollections = allCollections;
  }

  // Gather counts
  const rows: { collection: string; count: number }[] = [];
  for (const name of targetCollections) {
    const count = await db.collection(name).countDocuments();
    rows.push({ collection: name, count });
  }

  // Print table
  const maxNameLen = Math.max("Collection".length, ...rows.map((r) => r.collection.length));
  const maxCountLen = Math.max("Records".length, ...rows.map((r) => String(r.count).length));

  const header = `${"Collection".padEnd(maxNameLen)}  ${"Records".padStart(maxCountLen)}`;
  const separator = `${"─".repeat(maxNameLen)}  ${"─".repeat(maxCountLen)}`;

  console.log(`\nDatabase: ${MONGODB_DB_NAME}`);
  console.log(`\n${header}`);
  console.log(separator);
  for (const row of rows) {
    console.log(`${row.collection.padEnd(maxNameLen)}  ${String(row.count).padStart(maxCountLen)}`);
  }
  console.log(separator);

  const totalRecords = rows.reduce((sum, r) => sum + r.count, 0);
  console.log(`${"TOTAL".padEnd(maxNameLen)}  ${String(totalRecords).padStart(maxCountLen)}`);
  console.log();

  if (specificTable) {
    console.log(`This will DROP the "${specificTable}" collection (${totalRecords} records).`);
  } else {
    console.log(`This will DROP ALL ${rows.length} collections (${totalRecords} total records).`);
  }

  const answer = await ask("\nType 'yes' to confirm: ");

  if (answer !== "yes") {
    console.log("Aborted.");
    await client.close();
    process.exit(0);
  }

  for (const row of rows) {
    await db.collection(row.collection).drop();
    console.log(`  Dropped ${row.collection} (${row.count} records)`);
  }

  console.log("\nDone.");
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
