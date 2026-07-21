import Link from "next/link";
import { projects } from "@pactlane/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const list = await db.select().from(projects);
  return (
    <main style={{ maxWidth: 640, margin: "5vh auto", display: "grid", gap: 12 }}>
      <h1>Projects</h1>
      <form
        action={async (fd: FormData) => {
          "use server";
          await db.insert(projects).values({ name: String(fd.get("name")) });
        }}
      >
        <input name="name" placeholder="new project name" required /> <button>Create</button>
      </form>
      <ul>
        {list.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`}>{p.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
