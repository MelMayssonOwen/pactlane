import { createDb, type Db } from "@pactlane/db";

let instance: Db | undefined;

// Lazy: `next build` imports this module in environments with no database.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    if (!instance) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL required");
      instance = createDb(url);
    }
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
