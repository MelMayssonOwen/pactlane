import PgBoss from "pg-boss";

export const RUN_EXECUTE = "run.execute";
let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss(process.env.DATABASE_URL!);
    await boss.start();
    await boss.createQueue(RUN_EXECUTE);
  }
  return boss;
}
