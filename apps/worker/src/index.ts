import { startWorker } from "./queue.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
await startWorker({ connectionString: url });
console.log("[worker] listening on run.execute");
