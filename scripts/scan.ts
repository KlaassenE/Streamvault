import { isAbsolute } from "node:path";
import { addRoot, scanLibrary } from "../src/lib/indexer";
const [argument, job] = process.argv.slice(2);
if (!argument) {
  console.error("Usage: pnpm scan <absolute-folder-or-root-id>");
  process.exitCode = 1;
} else {
  try {
    const root = isAbsolute(argument) ? await addRoot(argument, "") : argument;
    console.log(JSON.stringify(await scanLibrary(root, job)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
