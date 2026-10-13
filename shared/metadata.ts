export interface Source {
    identifier: string;
    category: string;
}

export interface Membership {
    playlistIdentifier: string;
    category: string;
    addedAt: string | null;
}

export interface Chapter {
    seconds: number;
    title: string;
}

export interface Video {
    identifier: string;
    title: string;
    description: string;
    channel: string;
    channelIdentifier: string;
    publishedAt: string | null;
    duration: string | null;
    language: string | null;
    audioLanguage: string | null;
    thumbnails: { url: string; width: number; height: number }[];
    url: string;
    ingestedAt: string;
    details: "pending" | "complete";
    availability: "available" | "unavailable" | "unknown";
    availabilityReason: string | null;
    live: "none" | "live" | "upcoming" | "unknown";
    memberships: Membership[];
    chapters: Chapter[];
}

export interface Coverage extends Source {
    status: "complete" | "partial" | "failed" | "pending";
    entries: number;
    expected: number | null;
    unavailable: number;
    attemptedAt: string | null;
    completedAt: string | null;
    listing: { completedAt: string; identifiers: string[] } | null;
    error: string | null;
}

export interface SourceStatus extends Omit<Coverage, "listing"> {
    listing: { completedAt: string; count: number } | null;
}

export interface SourceSummary extends SourceStatus {
    videos: number;
    searchable: number;
    unknownPublication: number;
    pending: number;
    unknownAvailability: number;
    publication: { from: string; until: string } | null;
    years: { year: string; count: number; searchable: number }[];
    channels: { identifier: string; name: string; count: number }[];
    channelCount: number;
}

export interface Ingestion {
    startedAt: string;
    finishedAt: string;
    phase: "listing" | "enriching" | "finished";
    entries: number;
    uniqueVideos: number;
    duplicates: number;
    unavailable: number;
    requests: number;
    failures: number;
    complete: boolean;
}

export interface Catalog {
    version: 1;
    videos: Video[];
    sources: Coverage[];
    ingestion: Ingestion | null;
}

export const orders = [
    "relevance",
    "latest",
    "oldest",
    "shortest",
    "longest",
    "titleAscending",
    "titleDescending",
] as const;

export const orderLabels: Record<(typeof orders)[number], string> = {
    relevance: "Best match",
    latest: "Newest first",
    oldest: "Oldest first",
    shortest: "Shortest first",
    longest: "Longest first",
    titleAscending: "Title A–Z",
    titleDescending: "Title Z–A",
};

export interface Filters {
    categories: string[];
    playlists: string[];
    from: string;
    until: string;
    order: (typeof orders)[number];
}

export interface RetrievalOptions {
    semantic?: boolean;
}

export interface Result {
    video: Video;
    explanation: string;
}

export interface Status {
    catalog: "ready" | "missing" | "error";
    error: string | null;
    total: number;
    unavailable: number;
    unknownAvailability: number;
    pending: number;
    categories: { name: string; count: number }[];
    sources: SourceStatus[];
    ingestion: Ingestion | null;
    suggestions: string[];
    assistance: { configured: boolean; model: string | null };
}

export interface SearchResponse {
    results: Result[];
    total: number;
    page: number;
    notice: string;
}

export interface ChatResponse {
    session: string;
    message: string;
    results: Result[];
    filters: Filters;
    total: number;
}
