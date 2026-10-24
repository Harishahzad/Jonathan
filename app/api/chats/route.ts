import { auth } from "@clerk/nextjs/server";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const key = (userId: string) => `jn:chats:${userId}`;

type Chat = { id: string; title: string; turns: unknown[]; updated: number };

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in first.", { status: 401 });

  const data = await redis.hgetall<Record<string, Chat>>(key(userId));
  const list = Object.values(data ?? {}).sort((a, b) => b.updated - a.updated);
  return Response.json(list);
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in first.", { status: 401 });

  const chat = (await req.json()) as Chat;
  if (!chat?.id || !Array.isArray(chat.turns)) {
    return new Response("Bad chat.", { status: 400 });
  }

  const k = key(userId);
  await redis.hset(k, { [chat.id]: chat });

  // keep only the 30 newest chats
  if ((await redis.hlen(k)) > 30) {
    const all = await redis.hgetall<Record<string, Chat>>(k);
    const old = Object.values(all ?? {})
      .sort((a, b) => b.updated - a.updated)
      .slice(30)
      .map((c) => c.id);
    if (old.length) await redis.hdel(k, ...old);
  }
  return new Response("ok");
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Sign in first.", { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (id) await redis.hdel(key(userId), id);
  return new Response("ok");
}