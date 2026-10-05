   import { Ratelimit } from "@upstash/ratelimit";
   import { Redis } from "@upstash/redis";

   const redis = Redis.fromEnv();

   const perUser = new Ratelimit({
     redis,
     limiter: Ratelimit.slidingWindow(10, "1 h"),
     prefix: "jn:user",
   });

   const global = new Ratelimit({
     redis,
     limiter: Ratelimit.fixedWindow(30, "1 d"),
     prefix: "jn:global",
   });

   export async function allowed(ip: string) {
     const a = await perUser.limit(ip);
     if (!a.success) return false;
     const b = await global.limit("all");
     return b.success;
   }