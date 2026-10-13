import { Collapsible } from "@ark-ui/solid/collapsible";
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";

import type { Filters, Result, Video } from "../shared/metadata";

import { orderLabels } from "../shared/metadata";

const dates = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
export const numbers = new Intl.NumberFormat();

export function date(value: string | null): string {
    if (!value) {
        return "";
    }

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? "" : dates.format(parsed);
}

function clock(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = String(seconds % 60).padStart(2, "0");

    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function duration(video: Video): string {
    if (video.live === "live") {
        return "Live · duration not final";
    }

    if (video.live === "upcoming") {
        return "Upcoming · duration unknown";
    }

    const match = video.duration?.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);

    if (!match) {
        return "";
    }

    const seconds =
        Number(match[1] ?? 0) * 86400 +
        Number(match[2] ?? 0) * 3600 +
        Number(match[3] ?? 0) * 60 +
        Number(match[4] ?? 0);

    return Number.isFinite(seconds) && seconds > 0 ? clock(Math.floor(seconds)) : "";
}

export function scope(value: Filters): string {
    return [
        value.categories.length ? value.categories.join(", ") : "All categories",
        value.playlists.length && `${value.playlists.length} source playlist${value.playlists.length === 1 ? "" : "s"}`,
        value.from && `from ${value.from}`,
        value.until && `through ${value.until}`,
        orderLabels[value.order],
    ]
        .filter(Boolean)
        .join(" · ");
}

function thumbnail(video: Video): string | undefined {
    for (const image of video.thumbnails.toSorted((first, second) => second.width - first.width)) {
        try {
            const address = new URL(image.url);

            if (
                address.protocol === "https:" &&
                [
                    "i.ytimg.com",
                    "i1.ytimg.com",
                    "i2.ytimg.com",
                    "i3.ytimg.com",
                    "i4.ytimg.com",
                    "img.youtube.com",
                ].includes(address.hostname) &&
                !address.username &&
                !address.password &&
                !address.port
            ) {
                return address.href;
            }
        } catch {
            continue;
        }
    }

    return undefined;
}

function source(video: Video, seconds?: number): string {
    const address = new URL("https://www.youtube.com/watch");
    address.searchParams.set("v", video.identifier);

    if (seconds !== undefined) {
        address.searchParams.set("t", `${seconds}s`);
    }

    return address.href;
}

export function Preview(props: { video: Video; inspection?: boolean }) {
    const image = createMemo(() => thumbnail(props.video));
    const [broken, failure] = createSignal(false);
    const timing = createMemo(() => duration(props.video));

    createEffect(() => {
        image();
        failure(false);
    });

    return (
        <span
            class="footage-preview relative flex aspect-video w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-sm bg-surface-muted text-sm text-muted"
            classList={{ "inspection-preview": props.inspection }}
        >
            <Show
                when={image() && !broken()}
                fallback={<span class="px-2 text-center text-xs leading-tight">No preview available</span>}
            >
                <img
                    class="h-full w-full object-cover"
                    src={image()}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => failure(true)}
                />
            </Show>
            <Show when={timing()}>
                <span
                    class="rounded-sm bg-black/85 px-1.5 py-0.5 text-xs leading-4 font-medium text-white tabular-nums"
                    classList={{ "absolute right-1 bottom-1": !!image() && !broken() }}
                >
                    <span class="sr-only">{timing()}</span>
                    <span aria-hidden="true">
                        {props.video.live === "live" ? "Live" : props.video.live === "upcoming" ? "Upcoming" : timing()}
                    </span>
                </span>
            </Show>
        </span>
    );
}

export function Footage(props: { results: Result[]; selected?: string; open: (result: Result) => void }) {
    return (
        <ul class="divide-y divide-border">
            <For each={props.results}>
                {(result) => (
                    <li>
                        <button
                            type="button"
                            class="footage-row grid w-full grid-cols-[104px_minmax(0,1fr)] items-start gap-4 px-4 py-5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[176px_minmax(0,1fr)] sm:px-6"
                            classList={{ "bg-accent/5": props.selected === result.video.identifier }}
                            aria-pressed={props.selected === result.video.identifier}
                            aria-label={`Inspect source: ${result.video.title || "Title not supplied"}`}
                            onClick={() => props.open(result)}
                        >
                            <Preview video={result.video} />
                            <span class="grid min-w-0 gap-2">
                                <span class="footage-title break-words text-base leading-snug font-semibold">
                                    {result.video.title || "Title not supplied"}
                                </span>
                                <span class="text-sm text-muted">{result.video.channel || "Channel not supplied"}</span>
                                <Show when={date(result.video.publishedAt)}>
                                    {(published) => <span class="text-sm text-muted">Published {published()}</span>}
                                </Show>
                                <Show when={result.video.availability === "unavailable"}>
                                    <span class="text-sm text-danger">Unavailable when last checked</span>
                                </Show>
                                <Show
                                    when={result.video.details === "pending" || result.video.availability === "unknown"}
                                >
                                    <span class="text-sm text-muted">
                                        {[
                                            result.video.details === "pending" && "Details pending",
                                            result.video.availability === "unknown" && "Availability unknown",
                                        ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                    </span>
                                </Show>
                                <Show when={props.selected === result.video.identifier}>
                                    <span class="text-sm font-medium text-accent">Selected source</span>
                                </Show>
                            </span>
                        </button>
                    </li>
                )}
            </For>
        </ul>
    );
}

export function Inspection(props: {
    result: Result;
    loading: boolean;
    failure: string;
    close: () => void;
    refresh: () => void;
}) {
    const video = () => props.result.video;

    const description = createMemo(() =>
        video()
            .description.split(/\r?\n/)
            .filter((line) => {
                const match = line.match(/^\s*(?:[-•]\s*)?(\d{1,3}:\d{2}(?::\d{2})?)\s+(?:[-–—]\s*)?(.+?)\s*$/);

                if (!match) {
                    return true;
                }

                const components = match[1]!.split(":").map(Number);

                if (components.slice(1).some((component) => component > 59)) {
                    return true;
                }

                const seconds = components.reduce((total, component) => total * 60 + component, 0);

                return !video().chapters.some((chapter) => chapter.seconds === seconds && chapter.title === match[2]);
            })
            .join("\n")
            .trim(),
    );

    const [expanded, expand] = createSignal(false);

    createEffect(
        on(
            () => video().identifier,
            () => expand(false),
        ),
    );

    return (
        <div class="space-y-4 p-4 sm:p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="text-xl font-semibold">Selected source</h2>
                <button type="button" class="action hover:bg-surface-muted" onClick={props.close}>
                    Back to results
                </button>
            </div>
            <div class="grid items-start gap-4 sm:grid-cols-[224px_minmax(0,1fr)]">
                <Preview video={video()} inspection />
                <div class="min-w-0 space-y-2">
                    <h3 class="break-words text-xl leading-snug font-semibold">
                        <a
                            class="inline py-2 hover:text-accent"
                            href={source(video())}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${video().title || "source"} on YouTube (opens in a new tab)`}
                        >
                            <span class="underline">{video().title || "Title not supplied"}</span>
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                class="ml-1 inline size-4 align-baseline"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
                            </svg>
                        </a>
                    </h3>
                    <p class="text-sm text-muted">{video().channel || "Channel not supplied"}</p>
                    <Show when={date(video().publishedAt)}>
                        {(published) => <p class="text-sm">Published {published()}</p>}
                    </Show>
                </div>
            </div>
            <Show when={props.loading}>
                <p class="text-sm text-muted" role="status">
                    Refreshing source metadata…
                </p>
            </Show>
            <Show when={props.failure}>
                <div class="space-y-2 text-sm" role="alert">
                    <p class="text-danger">{props.failure} The supplied source details remain available.</p>
                    <button type="button" class="action bg-surface-muted hover:bg-border" onClick={props.refresh}>
                        Retry
                    </button>
                </div>
            </Show>
            <Show when={description()}>
                <Collapsible.Root
                    class="space-y-3 pt-4"
                    open={expanded()}
                    onOpenChange={(details) => expand(details.open)}
                >
                    <h3 class="text-lg font-semibold">Description</h3>
                    <Show when={!expanded()}>
                        <p class="max-w-prose break-words text-base whitespace-pre-wrap">
                            {description().length <= 280 ? description() : description().slice(0, 280).trimEnd()}
                        </p>
                    </Show>
                    <Collapsible.Content class="max-w-prose break-words text-base whitespace-pre-wrap">
                        {description()}
                    </Collapsible.Content>
                    <Show when={description().length > 280}>
                        <Collapsible.Trigger
                            class="min-h-11 py-2 font-semibold hover:underline"
                            aria-label={expanded() ? "Show less description" : "Show more description"}
                        >
                            {expanded() ? "Show less" : "…more"}
                        </Collapsible.Trigger>
                    </Show>
                </Collapsible.Root>
            </Show>
            <Show when={video().chapters.length}>
                <Collapsible.Root class="space-y-3 pt-4">
                    <Collapsible.Trigger class="flex min-h-11 items-center gap-2 py-2 text-left text-lg font-semibold hover:text-accent">
                        <svg
                            class="size-4 shrink-0 [[data-state=open]_&]:rotate-90"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            aria-hidden="true"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                        Chapters ({video().chapters.length})
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                        <ul class="divide-y divide-border pb-4">
                            <For each={video().chapters}>
                                {(chapter) => (
                                    <li>
                                        <a
                                            class="flex min-h-11 items-start gap-3 py-2 underline hover:text-accent"
                                            href={source(video(), chapter.seconds)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <span class="shrink-0 tabular-nums">{clock(chapter.seconds)}</span>
                                            <span>{chapter.title}</span>
                                            <span class="sr-only"> (opens in a new tab)</span>
                                        </a>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </Collapsible.Content>
                </Collapsible.Root>
            </Show>
            <section class="space-y-3">
                <h3 class="text-lg font-semibold">Metadata</h3>
                <dl class="grid gap-4 pb-4 text-sm sm:grid-cols-2 [&_dt]:text-muted [&_dd]:mt-1 [&_dd]:break-words">
                    <div>
                        <dt>Channel</dt>
                        <dd>
                            <Show when={video().channelIdentifier} fallback={video().channel || "Not supplied"}>
                                <a
                                    class="inline-flex min-h-11 items-center underline hover:text-accent"
                                    href={`https://www.youtube.com/channel/${encodeURIComponent(video().channelIdentifier)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {video().channel || "Channel name not supplied"}
                                    <span class="sr-only"> (opens in a new tab)</span>
                                </a>
                            </Show>
                        </dd>
                    </div>
                    <Show when={video().memberships.length}>
                        <div>
                            <dt>Playlists</dt>
                            <dd>
                                <ul>
                                    <For each={video().memberships}>
                                        {(membership) => (
                                            <li>
                                                <a
                                                    class="flex min-h-11 items-center underline hover:text-accent"
                                                    href={`https://www.youtube.com/playlist?list=${encodeURIComponent(membership.playlistIdentifier)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {membership.category || "Untitled playlist"}
                                                    <span class="sr-only"> (opens in a new tab)</span>
                                                </a>
                                                <Show when={date(membership.addedAt)}>
                                                    {(added) => <p class="text-muted">Added {added()}</p>}
                                                </Show>
                                            </li>
                                        )}
                                    </For>
                                </ul>
                            </dd>
                        </div>
                    </Show>
                    <div>
                        <dt>Availability</dt>
                        <dd>
                            {video().availability === "unknown"
                                ? "Not yet confirmed"
                                : video().availability === "available"
                                  ? "Available when last checked"
                                  : "Unavailable when last checked"}
                        </dd>
                    </div>
                    <Show when={video().availabilityReason?.trim()}>
                        <div>
                            <dt>Availability note</dt>
                            <dd>{video().availabilityReason}</dd>
                        </div>
                    </Show>
                    <div>
                        <dt>Metadata status</dt>
                        <dd>{video().details === "complete" ? "Complete" : "Pending"}</dd>
                    </div>
                    <div>
                        <dt>Broadcast state</dt>
                        <dd>
                            {video().live === "none"
                                ? "Not live"
                                : video().live === "unknown"
                                  ? "Unknown"
                                  : video().live === "live"
                                    ? "Live"
                                    : "Upcoming"}
                        </dd>
                    </div>
                    <div>
                        <dt>Added to collection</dt>
                        <dd>{date(video().ingestedAt) || "Not supplied"}</dd>
                    </div>
                    <Show when={video().language?.trim()}>
                        <div>
                            <dt>Source language</dt>
                            <dd>{video().language}</dd>
                        </div>
                    </Show>
                    <Show when={video().audioLanguage?.trim()}>
                        <div>
                            <dt>Audio language</dt>
                            <dd>{video().audioLanguage}</dd>
                        </div>
                    </Show>
                </dl>
                <button
                    type="button"
                    class="action mb-4 bg-surface-muted hover:bg-border"
                    disabled={props.loading}
                    onClick={props.refresh}
                >
                    Refresh source metadata
                </button>
            </section>
        </div>
    );
}
