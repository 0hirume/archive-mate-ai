import { Collapsible } from "@ark-ui/solid/collapsible";
import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";

import type { Result, SourceSummary, Status } from "../shared/metadata";

import { Footage, date, numbers } from "./footage";
import * as gateway from "./gateway";

export default function Collection(props: {
    view: "overview" | "sources" | "setup";
    active: boolean;
    status?: Status;
    failure: string;
    refreshing: boolean;
    refresh: () => void;
    browse: (source: SourceSummary, year?: string, all?: boolean) => void;
    open: (result: Result) => void;
    locked: boolean;
}) {
    const [sources, setSources] = createSignal<SourceSummary[]>();
    const [loading, setLoading] = createSignal(false);
    const [failure, setFailure] = createSignal("");

    const [previews, setPreviews] = createSignal<
        Record<string, { results?: Result[]; loading: boolean; error: string }>
    >({});

    let request: AbortController | undefined;
    let fetchedStatus: Status | undefined;
    const previewRequests = new Map<string, AbortController>();

    async function loadSources() {
        request?.abort();
        const controller = new AbortController();
        request = controller;
        fetchedStatus = props.status;
        setLoading(true);
        setFailure("");

        try {
            const response = await gateway.sources(controller.signal);

            if (request !== controller || controller.signal.aborted) {
                return;
            }

            setSources(response);

            for (const pending of previewRequests.values()) {
                pending.abort();
            }

            previewRequests.clear();
            setPreviews({});
        } catch (value) {
            if (!controller.signal.aborted) {
                setFailure(value instanceof Error ? value.message : "Sources could not be loaded. Try again.");
            }
        } finally {
            if (request === controller) {
                request = undefined;
                setLoading(false);
            }
        }
    }

    async function loadPreview(source: SourceSummary) {
        if (previews()[source.identifier]?.results || previewRequests.has(source.identifier) || !source.videos) {
            return;
        }

        const controller = new AbortController();
        previewRequests.set(source.identifier, controller);
        setPreviews((current) => ({ ...current, [source.identifier]: { loading: true, error: "" } }));

        try {
            const videos = await gateway.sourcePreview(source.identifier, controller.signal);

            if (controller.signal.aborted) {
                return;
            }

            setPreviews((current) => ({
                ...current,

                [source.identifier]: {
                    results: videos.map((video) => ({
                        video,

                        explanation:
                            "Playlist member metadata. Review the original video to confirm relevance and current availability.",
                    })),

                    loading: false,
                    error: "",
                },
            }));
        } catch (value) {
            if (!controller.signal.aborted) {
                setPreviews((current) => ({
                    ...current,

                    [source.identifier]: {
                        loading: false,
                        error: value instanceof Error ? value.message : "Preview could not be loaded. Try again.",
                    },
                }));
            }
        } finally {
            if (previewRequests.get(source.identifier) === controller) {
                previewRequests.delete(source.identifier);
            }
        }
    }

    createEffect(
        on([() => props.active, () => props.status], ([active, status]) => {
            if (props.view === "sources" && active && status && fetchedStatus !== status) {
                void loadSources();
            }
        }),
    );

    onCleanup(() => {
        request?.abort();

        for (const controller of previewRequests.values()) {
            controller.abort();
        }
    });

    return (
        <div class="space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 id="collection-title" class="text-xl font-semibold">
                    {props.view === "overview" ? "Overview" : props.view === "sources" ? "Sources" : "Setup"}
                </h1>
            </div>
            <Show when={props.failure || props.status?.error}>
                <p class="text-danger" role="alert">
                    {props.failure || props.status?.error}
                </p>
            </Show>
            <Show when={props.view === "overview"}>
                <dl class="grid grid-cols-2 gap-4 text-sm [&_dt]:text-muted [&_dd]:mt-1 [&_dd]:tabular-nums">
                    <div>
                        <dt>Catalog</dt>
                        <dd>{props.status?.catalog || "Status unavailable"}</dd>
                    </div>
                    <div>
                        <dt>Searchable videos</dt>
                        <dd>{props.status ? numbers.format(props.status.total) : "Unknown"}</dd>
                    </div>
                    <div>
                        <dt>Playlist listings complete</dt>
                        <dd>
                            {props.status
                                ? `${props.status.sources.filter((source) => source.listing).length} of ${props.status.sources.length}`
                                : "Unknown"}
                        </dd>
                    </div>
                    <div>
                        <dt>Details pending</dt>
                        <dd>{props.status ? numbers.format(props.status.pending) : "Unknown"}</dd>
                    </div>
                    <div>
                        <dt>Unavailable videos</dt>
                        <dd>{props.status ? numbers.format(props.status.unavailable) : "Unknown"}</dd>
                    </div>
                    <Show when={props.status?.unknownAvailability}>
                        {(unknown) => (
                            <div>
                                <dt>Availability unknown</dt>
                                <dd>{numbers.format(unknown())}</dd>
                            </div>
                        )}
                    </Show>
                    <div>
                        <dt>Archie</dt>
                        <dd>
                            {props.status?.assistance.configured
                                ? props.status.assistance.model || "Model not supplied"
                                : "Not configured"}
                        </dd>
                    </div>
                </dl>
                <Show when={props.status?.ingestion}>
                    {(ingestion) => (
                        <section class="space-y-3 border-t border-border pt-4">
                            <h3 class="text-base font-semibold">Last ingestion attempt</h3>
                            <p class="text-sm">
                                {ingestion().phase === "finished"
                                    ? ingestion().complete
                                        ? "Last update complete"
                                        : "Last update incomplete"
                                    : ingestion().phase === "listing"
                                      ? "Listing sources"
                                      : "Enriching metadata"}
                            </p>
                            <dl class="grid grid-cols-2 gap-4 text-sm [&_dt]:text-muted [&_dd]:mt-1 [&_dd]:tabular-nums">
                                <div>
                                    <dt>Started</dt>
                                    <dd>{date(ingestion().startedAt) || "Not supplied"}</dd>
                                </div>
                                <div>
                                    <dt>Last updated</dt>
                                    <dd>{date(ingestion().finishedAt) || "Not supplied"}</dd>
                                </div>
                                <div>
                                    <dt>Playlist entries</dt>
                                    <dd>{numbers.format(ingestion().entries)}</dd>
                                </div>
                                <div>
                                    <dt>Unique videos</dt>
                                    <dd>{numbers.format(ingestion().uniqueVideos)}</dd>
                                </div>
                                <div>
                                    <dt>Duplicates</dt>
                                    <dd>{numbers.format(ingestion().duplicates)}</dd>
                                </div>
                                <div>
                                    <dt>Unavailable</dt>
                                    <dd>{numbers.format(ingestion().unavailable)}</dd>
                                </div>
                                <div>
                                    <dt>Requests</dt>
                                    <dd>{numbers.format(ingestion().requests)}</dd>
                                </div>
                                <div>
                                    <dt>Failures</dt>
                                    <dd>{numbers.format(ingestion().failures)}</dd>
                                </div>
                            </dl>
                        </section>
                    )}
                </Show>
            </Show>
            <Show when={props.view === "sources"}>
                <section class="space-y-4" aria-label="Source playlists">
                    <p class="text-sm text-muted">
                        Publication dates describe uploads, not event dates. Browse searches indexed metadata; it does
                        not confirm playback.
                    </p>
                    <Show when={loading()}>
                        <p class="text-sm text-muted" role="status">
                            Loading source coverage…
                        </p>
                    </Show>
                    <Show when={failure()}>
                        <div class="space-y-2">
                            <p class="text-sm text-danger" role="alert">
                                {failure()}
                                {sources() ? " Showing the previous source coverage." : ""}
                            </p>
                            <button
                                type="button"
                                class="action bg-surface-muted hover:bg-border"
                                disabled={loading()}
                                onClick={() => {
                                    void loadSources();
                                }}
                            >
                                Retry sources
                            </button>
                        </div>
                    </Show>
                    <ul class="divide-y divide-border">
                        <For each={sources()}>
                            {(source) => (
                                <li class="min-w-0 py-5">
                                    <div class="space-y-2">
                                        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                            <h2 class="min-w-0 break-words text-base font-semibold">
                                                {source.category}
                                                <Show
                                                    when={
                                                        (sources()?.filter((item) => item.category === source.category)
                                                            .length ?? 0) > 1
                                                    }
                                                >
                                                    <span class="font-normal text-muted">
                                                        {" "}
                                                        · Playlist{" "}
                                                        {(sources()
                                                            ?.filter((item) => item.category === source.category)
                                                            .findIndex(
                                                                (item) => item.identifier === source.identifier,
                                                            ) ?? 0) + 1}
                                                    </span>
                                                </Show>
                                            </h2>
                                            <Show when={!source.listing}>
                                                <p
                                                    class={`text-sm ${source.status === "failed" ? "text-danger" : "text-muted"}`}
                                                >
                                                    {source.status === "failed"
                                                        ? "Playlist listing failed"
                                                        : source.status === "pending"
                                                          ? "Waiting to list playlist"
                                                          : "Playlist listing incomplete"}
                                                </p>
                                            </Show>
                                        </div>
                                        <p class="text-sm tabular-nums">
                                            {numbers.format(source.videos)} unique videos
                                            {source.searchable !== source.videos
                                                ? ` · ${numbers.format(source.searchable)} searchable`
                                                : ""}
                                            <Show when={source.publication}>
                                                {(publication) => (
                                                    <span class="text-muted">
                                                        {" "}
                                                        · Published {date(publication().from)}
                                                        {publication().from.slice(0, 10) !==
                                                        publication().until.slice(0, 10)
                                                            ? ` – ${date(publication().until)}`
                                                            : ""}
                                                    </span>
                                                )}
                                            </Show>
                                        </p>
                                        <Show
                                            when={
                                                source.unknownPublication ||
                                                source.unavailable ||
                                                source.pending ||
                                                source.unknownAvailability
                                            }
                                        >
                                            <p class="text-sm text-muted">
                                                {[
                                                    source.unknownPublication &&
                                                        `${numbers.format(source.unknownPublication)} publication dates unknown`,
                                                    source.unavailable &&
                                                        `${numbers.format(source.unavailable)} unavailable when checked`,
                                                    source.pending &&
                                                        `${numbers.format(source.pending)} details pending`,
                                                    source.unknownAvailability &&
                                                        `Availability unknown for ${numbers.format(source.unknownAvailability)} video${source.unknownAvailability === 1 ? "" : "s"}`,
                                                ]
                                                    .filter(Boolean)
                                                    .join(" · ")}
                                            </p>
                                        </Show>
                                        <Show when={source.channels.length}>
                                            <div class="flex flex-wrap items-center gap-x-3 text-sm">
                                                <span class="text-muted">Contributing channels</span>
                                                <For each={source.channels}>
                                                    {(channel) => (
                                                        <Show
                                                            when={channel.identifier}
                                                            fallback={<span class="break-words">{channel.name}</span>}
                                                        >
                                                            <a
                                                                class="inline-flex min-h-11 min-w-0 items-center break-words underline hover:text-accent"
                                                                href={`https://www.youtube.com/channel/${encodeURIComponent(channel.identifier)}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                {channel.name}
                                                                <span class="sr-only"> (opens in a new tab)</span>
                                                            </a>
                                                        </Show>
                                                    )}
                                                </For>
                                                <Show when={source.channelCount > source.channels.length}>
                                                    <span class="text-muted">
                                                        and{" "}
                                                        {numbers.format(source.channelCount - source.channels.length)}{" "}
                                                        more in the footage metadata
                                                    </span>
                                                </Show>
                                            </div>
                                        </Show>
                                        <Show when={source.years.length}>
                                            <div class="space-y-1">
                                                <p class="text-sm text-muted">
                                                    Published by year · select a year to browse
                                                </p>
                                                <div
                                                    class="flex flex-wrap gap-1"
                                                    role="group"
                                                    aria-label={`Publication years for ${source.category}`}
                                                >
                                                    <For each={source.years}>
                                                        {(year) => (
                                                            <button
                                                                type="button"
                                                                class="min-h-11 min-w-16 space-y-1 rounded-sm px-2 py-2 text-left text-sm tabular-nums hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                                                                disabled={props.locked || !year.searchable}
                                                                aria-label={`${year.year}: ${numbers.format(year.count)} videos, ${numbers.format(year.searchable)} searchable. Browse ${source.category} published in ${year.year}`}
                                                                onClick={() => props.browse(source, year.year)}
                                                            >
                                                                <span class="flex items-baseline justify-between gap-2">
                                                                    <span>{year.year}</span>
                                                                    <span class="text-muted">
                                                                        {numbers.format(year.count)}
                                                                    </span>
                                                                </span>
                                                                <span
                                                                    class="block h-1 bg-surface-muted"
                                                                    aria-hidden="true"
                                                                >
                                                                    <span
                                                                        class="block h-1 bg-accent"
                                                                        style={{
                                                                            width: `${(year.count / Math.max(1, ...source.years.map((item) => item.count))) * 100}%`,
                                                                        }}
                                                                    />
                                                                </span>
                                                            </button>
                                                        )}
                                                    </For>
                                                </div>
                                            </div>
                                        </Show>
                                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                                            <button
                                                type="button"
                                                class="action px-0 text-sm text-accent hover:underline"
                                                disabled={props.locked || !source.searchable}
                                                onClick={() => props.browse(source)}
                                            >
                                                Browse footage
                                            </button>
                                            <a
                                                class="inline-flex min-h-11 items-center text-sm underline hover:text-accent"
                                                href={`https://www.youtube.com/playlist?list=${encodeURIComponent(source.identifier)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                Original playlist<span class="sr-only"> (opens in a new tab)</span>
                                            </a>
                                        </div>
                                        <Collapsible.Root
                                            lazyMount
                                            unmountOnExit
                                            onOpenChange={(details) => {
                                                if (details.open) {
                                                    void loadPreview(source);
                                                }
                                            }}
                                        >
                                            <Collapsible.Trigger class="flex min-h-11 items-center gap-2 text-left text-sm hover:text-accent">
                                                <svg
                                                    class="size-4 shrink-0 [[data-state=open]_&]:rotate-90"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    aria-hidden="true"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        d="m9 5 7 7-7 7"
                                                    />
                                                </svg>
                                                Preview footage
                                            </Collapsible.Trigger>
                                            <Collapsible.Content class="space-y-2 pb-2">
                                                <Show when={previews()[source.identifier]?.loading}>
                                                    <p class="text-sm text-muted" role="status">
                                                        Loading footage preview…
                                                    </p>
                                                </Show>
                                                <Show when={previews()[source.identifier]?.error}>
                                                    <p class="text-sm text-danger" role="alert">
                                                        {previews()[source.identifier]?.error}
                                                    </p>
                                                    <button
                                                        type="button"
                                                        class="action text-sm hover:bg-surface-muted"
                                                        onClick={() => {
                                                            void loadPreview(source);
                                                        }}
                                                    >
                                                        Retry preview
                                                    </button>
                                                </Show>
                                                <Show when={!source.videos}>
                                                    <p class="text-sm text-muted">
                                                        No footage metadata indexed for this playlist.
                                                    </p>
                                                </Show>
                                                <Show when={previews()[source.identifier]?.results}>
                                                    {(results) => (
                                                        <Footage compact results={results()} open={props.open} />
                                                    )}
                                                </Show>
                                                <Show when={source.searchable}>
                                                    <button
                                                        type="button"
                                                        class="action px-0 text-sm text-accent hover:underline"
                                                        disabled={props.locked}
                                                        onClick={() => props.browse(source, undefined, true)}
                                                    >
                                                        Browse all {numbers.format(source.searchable)} searchable videos
                                                    </button>
                                                </Show>
                                            </Collapsible.Content>
                                        </Collapsible.Root>
                                    </div>
                                </li>
                            )}
                        </For>
                    </ul>
                </section>
            </Show>
            <Show when={props.view === "setup"}>
                <section class="space-y-3 border-t border-border pt-4">
                    <Show when={props.status?.catalog !== "ready"}>
                        <p class="text-sm">
                            Install <code>yt-dlp</code> on the backend PATH, then run <code>bun run ingest</code> for
                            all sources. Refresh status when the collection is ready.
                        </p>
                    </Show>
                    <Show when={!props.status?.assistance.configured}>
                        <p class="text-sm">
                            Set <code>GEMINI_API_KEY</code> and <code>GEMINI_MODEL</code> on the backend, then restart
                            it to enable Archie.
                        </p>
                    </Show>
                    <Show when={props.status?.sources.some((source) => source.error)}>
                        <Collapsible.Root>
                            <Collapsible.Trigger class="action px-0 text-sm hover:text-accent">
                                Last collection diagnostics
                            </Collapsible.Trigger>
                            <Collapsible.Content>
                                <ul class="divide-y divide-border">
                                    <For each={props.status?.sources.filter((source) => source.error)}>
                                        {(source) => (
                                            <li class="space-y-1 py-3 text-sm">
                                                <a
                                                    class="inline-flex min-h-11 items-center underline hover:text-accent"
                                                    href={`https://www.youtube.com/playlist?list=${encodeURIComponent(source.identifier)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {source.category}
                                                    <span class="sr-only"> (opens in a new tab)</span>
                                                </a>
                                                <p class="break-words text-danger">{source.error}</p>
                                            </li>
                                        )}
                                    </For>
                                </ul>
                            </Collapsible.Content>
                        </Collapsible.Root>
                    </Show>
                    <p class="text-sm">If errors continue after refreshing, contact your archive administrator.</p>
                    <button
                        type="button"
                        class="action bg-surface-muted hover:bg-border"
                        disabled={props.refreshing}
                        onClick={props.refresh}
                    >
                        {props.refreshing ? "Refreshing…" : "Refresh status"}
                    </button>
                </section>
            </Show>
        </div>
    );
}
