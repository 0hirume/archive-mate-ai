import type {
    ChatResponse,
    SourceStatus,
    SourceSummary,
    Filters,
    RetrievalOptions,
    Ingestion,
    Result,
    SearchResponse,
    Status,
    Video,
} from "../shared/metadata";

import { orders } from "../shared/metadata";

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullable(value: unknown): value is string | null {
    return value === null || typeof value === "string";
}

function count(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function list<Type>(value: unknown, validate: (item: unknown) => item is Type): value is Type[] {
    return Array.isArray(value) && value.every((item: unknown) => validate(item));
}

function video(value: unknown): value is Video {
    return (
        record(value) &&
        typeof value.identifier === "string" &&
        typeof value.title === "string" &&
        typeof value.description === "string" &&
        typeof value.channel === "string" &&
        typeof value.channelIdentifier === "string" &&
        nullable(value.publishedAt) &&
        nullable(value.duration) &&
        nullable(value.language) &&
        nullable(value.audioLanguage) &&
        typeof value.url === "string" &&
        typeof value.ingestedAt === "string" &&
        (value.details === "pending" || value.details === "complete") &&
        (value.availability === "available" ||
            value.availability === "unavailable" ||
            value.availability === "unknown") &&
        nullable(value.availabilityReason) &&
        (value.live === "none" || value.live === "live" || value.live === "upcoming" || value.live === "unknown") &&
        list(
            value.thumbnails,
            (item): item is Video["thumbnails"][number] =>
                record(item) && typeof item.url === "string" && count(item.width) && count(item.height),
        ) &&
        list(
            value.memberships,
            (item): item is Video["memberships"][number] =>
                record(item) &&
                typeof item.playlistIdentifier === "string" &&
                typeof item.category === "string" &&
                nullable(item.addedAt),
        ) &&
        list(
            value.chapters,
            (item): item is Video["chapters"][number] =>
                record(item) && count(item.seconds) && typeof item.title === "string",
        )
    );
}

function result(value: unknown): value is Result {
    return record(value) && video(value.video) && typeof value.explanation === "string";
}

function filters(value: unknown): value is Filters {
    return (
        record(value) &&
        list(value.categories, (item): item is string => typeof item === "string" && item.length <= 200) &&
        list(value.playlists, (item): item is string => typeof item === "string" && /^[\w-]{1,100}$/.test(item)) &&
        typeof value.from === "string" &&
        typeof value.until === "string" &&
        orders.some((order) => value.order === order)
    );
}

function coverage(value: unknown): value is SourceStatus {
    return (
        record(value) &&
        typeof value.identifier === "string" &&
        typeof value.category === "string" &&
        (value.status === "complete" ||
            value.status === "partial" ||
            value.status === "failed" ||
            value.status === "pending") &&
        count(value.entries) &&
        (value.expected === null || count(value.expected)) &&
        count(value.unavailable) &&
        nullable(value.attemptedAt) &&
        nullable(value.completedAt) &&
        (value.listing === null ||
            (record(value.listing) && typeof value.listing.completedAt === "string" && count(value.listing.count))) &&
        nullable(value.error)
    );
}

function sourceSummary(value: unknown): value is SourceSummary {
    return (
        record(value) &&
        coverage(value) &&
        count(value.videos) &&
        count(value.searchable) &&
        value.searchable <= value.videos &&
        (value.publication === null ||
            (record(value.publication) &&
                typeof value.publication.from === "string" &&
                typeof value.publication.until === "string")) &&
        list(
            value.years,
            (year): year is SourceSummary["years"][number] =>
                record(year) &&
                typeof year.year === "string" &&
                /^\d{4}$/.test(year.year) &&
                count(year.count) &&
                count(year.searchable) &&
                year.searchable <= year.count,
        )
    );
}

function ingestion(value: unknown): value is Ingestion {
    return (
        record(value) &&
        typeof value.startedAt === "string" &&
        typeof value.finishedAt === "string" &&
        (value.phase === "listing" || value.phase === "enriching" || value.phase === "finished") &&
        count(value.entries) &&
        count(value.uniqueVideos) &&
        count(value.duplicates) &&
        count(value.unavailable) &&
        count(value.requests) &&
        count(value.failures) &&
        typeof value.complete === "boolean"
    );
}

function catalog(value: unknown): value is Status {
    return (
        record(value) &&
        (value.catalog === "ready" ||
            value.catalog === "missing" ||
            value.catalog === "error" ||
            value.catalog === "restoring") &&
        nullable(value.error) &&
        count(value.total) &&
        count(value.unavailable) &&
        count(value.unknownAvailability) &&
        count(value.pending) &&
        list(
            value.categories,
            (item): item is Status["categories"][number] =>
                record(item) && typeof item.name === "string" && count(item.count),
        ) &&
        list(value.sources, coverage) &&
        (value.ingestion === null || ingestion(value.ingestion)) &&
        list(value.suggestions, (item): item is string => typeof item === "string") &&
        record(value.assistance) &&
        typeof value.assistance.configured === "boolean" &&
        nullable(value.assistance.model)
    );
}

function collection(value: unknown): value is SearchResponse {
    return (
        record(value) &&
        list(value.results, result) &&
        count(value.total) &&
        count(value.page) &&
        value.page >= 1 &&
        typeof value.notice === "string"
    );
}

function conversation(value: unknown): value is ChatResponse {
    return (
        record(value) &&
        typeof value.session === "string" &&
        typeof value.message === "string" &&
        list(value.results, result) &&
        filters(value.filters) &&
        count(value.total)
    );
}

async function failure(response: Response): Promise<Error> {
    let payload: unknown;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    return new Error(
        record(payload) && typeof payload.error === "string"
            ? payload.error
            : `The server could not complete this request (${response.status}).`,
    );
}

async function request<Type>(
    path: string,
    validate: (value: unknown) => value is Type,
    options: RequestInit,
): Promise<Type> {
    const response = await fetch(path, options);

    if (!response.ok) {
        throw await failure(response);
    }

    const payload: unknown = await response.json();

    if (!validate(payload)) {
        throw new Error("The server returned an unexpected response. Refresh and try again.");
    }

    return payload;
}

export function status(signal: AbortSignal): Promise<Status> {
    return request("/api/status", catalog, { signal });
}

export function sources(signal: AbortSignal): Promise<SourceSummary[]> {
    return request("/api/sources", (value): value is SourceSummary[] => list(value, sourceSummary), { signal });
}

export function search(
    query: string,
    selection: Filters,
    page: number,
    signal: AbortSignal,
    options: RetrievalOptions = {},
): Promise<SearchResponse> {
    const parameters = new URLSearchParams({ page: String(page), order: selection.order });

    if (options.semantic) {
        parameters.set("semantic", "true");
    }

    if (query.trim()) {
        parameters.set("query", query.trim());
    }

    for (const category of selection.categories) {
        parameters.append("categories", category);
    }

    for (const playlist of selection.playlists) {
        parameters.append("playlists", playlist);
    }

    if (selection.from) {
        parameters.set("from", selection.from);
    }

    if (selection.until) {
        parameters.set("until", selection.until);
    }

    return request(`/api/search?${parameters}`, collection, { signal });
}

export function videoDetails(identifier: string, signal: AbortSignal): Promise<Video> {
    return request(`/api/videos/${encodeURIComponent(identifier)}`, video, { signal });
}

export function chat(
    message: string,
    session: string | undefined,
    selection: Filters,
    signal: AbortSignal,
): Promise<ChatResponse> {
    return request("/api/chat", conversation, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session, filters: selection }),
    });
}

export async function clear(session: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(`/api/chat/${encodeURIComponent(session)}`, {
        method: "DELETE",
        signal,
    });

    if (!response.ok) {
        throw await failure(response);
    }
}
