export type Entry = {
  id: string; kind: "article" | "episode"; sourceId: string; source: string; title: string;
  summary: string; url: string; publishedAt: string; category: string; topics: string[];
  language: string; duration: number | null; artwork: string; color: string; byline: string;
};
export type Source = {
  id: string; name: string; kind: string; feed: string; website: string; language: string;
  color: string; description: string; category: string; artwork?: string; author?: string;
  appleUrl?: string; tagline?: string;
};
export type Health = {id: string; ok: boolean; count?: number; error?: string; checkedAt: string};
export type Follow = {showId: string; followedAt: string; mode: "digest" | "instant" | "off"};
export type Preferences = {enabled: boolean; digestTime: string; quiet: boolean};
export type Snapshot = {
  entries: Entry[]; sources: Source[]; follows: Follow[]; saved: string[]; health: Health[];
  collectedAt: string | null; databaseReady: boolean; feishuConnected: boolean;
  preferences: Preferences; deliveries: {id: string; status: string; createdAt: string; message: string}[];
  user: string | null;
};
