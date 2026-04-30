import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "nexus.cache.v1.";

interface Envelope<T> {
  ts: number;
  v: T;
}

export async function cacheGet<T>(
  key: string,
  maxAgeMs: number,
): Promise<{ value: T; ageMs: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env.ts !== "number") return null;
    const age = Date.now() - env.ts;
    if (age > maxAgeMs) return null;
    return { value: env.v, ageMs: age };
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    const env: Envelope<T> = { ts: Date.now(), v: value };
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(env));
  } catch {
    // best-effort; silent
  }
}

export async function cacheRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    // best-effort
  }
}

const memSnapshots = new Map<string, { ts: number; v: unknown }>();

export function memGet<T>(key: string, maxAgeMs: number): T | null {
  const e = memSnapshots.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > maxAgeMs) return null;
  return e.v as T;
}

export function memSet<T>(key: string, value: T): void {
  memSnapshots.set(key, { ts: Date.now(), v: value });
}
