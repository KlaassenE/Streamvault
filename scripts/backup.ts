import { backup } from "node:sqlite";
import path from "node:path";
import { database } from "../src/lib/db";
const output = process.argv[2];
if (!output) throw new Error("Usage: pnpm backup /absolute/path/backup.sqlite");
await backup(database(), path.resolve(output));
console.log(
  "Consistent SQLite backup created. Store it with the library media and app-owned compatibility copies.",
);
