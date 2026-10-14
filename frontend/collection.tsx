import { ark } from "@ark-ui/solid/factory";
import { Menu } from "@ark-ui/solid/menu";
import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import type { SourceSummary, Status } from "../shared/metadata";

import { date, numbers } from "./footage";
import * as gateway from "./gateway";
import glass from "./glass";

export default function Collection(props: {
    view: "overview" | "sources";
    active: boolean;
    status?: Status;
    failure: string;
    browse: (source: SourceSummary, year?: string) => void;
    locked: boolean;
}) {
    const [sources, setSources] = createSignal<SourceSummary[]>();
    const [loading, setLoading] = createSignal(false);
    const [failure, setFailure] = createSignal("");

    let request: AbortController | undefined;
    let fetchedStatus: Status | undefined;

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

    createEffect(
        on([() => props.active, () => props.status], ([active, status]) => {
            if (props.view === "sources" && active && status && fetchedStatus !== status) {
                void loadSources();
            }
        }),
    );

    onCleanup(() => {
        request?.abort();
    });

    return (
        <div class="space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 id="collection-title" class="text-xl font-semibold">
                    {props.view === "overview" ? "Overview" : "Sources"}
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
                            <ark.button
                                type="button"
                                class="action bg-surface-muted hover:bg-border"
                                disabled={loading()}
                                onClick={() => {
                                    void loadSources();
                                }}
                            >
                                Retry sources
                            </ark.button>
                        </div>
                    </Show>
                    <ul class="divide-y divide-border">
                        <For each={[...new Set(sources()?.map((source) => source.category))]}>
                            {(category) => (
                                <li class="py-5">
                                    <h2 class="break-words text-base font-semibold">{category}</h2>
                                    <ul class="divide-y divide-border">
                                        <For each={sources()?.filter((source) => source.category === category)}>
                                            {(source, position) => (
                                                <li class="source-row -mx-3 min-w-0 rounded-sm px-3 py-5">
                                                    <div class="space-y-2">
                                                        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                                            <Show
                                                                when={
                                                                    (sources()?.filter(
                                                                        (item) => item.category === category,
                                                                    ).length ?? 0) > 1
                                                                }
                                                            >
                                                                <h3 class="text-sm font-medium">
                                                                    Playlist {position() + 1}
                                                                </h3>
                                                            </Show>
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
                                                        <div class="flex flex-wrap items-center gap-4">
                                                            <Show when={source.years.length}>
                                                                <Menu.Root
                                                                    positioning={{
                                                                        placement: "bottom-start",
                                                                        fitViewport: true,
                                                                    }}
                                                                    onSelect={(details) =>
                                                                        props.browse(source, details.value)
                                                                    }
                                                                >
                                                                    <Menu.Trigger
                                                                        class="action gap-2 px-0 text-sm hover:text-accent"
                                                                        disabled={props.locked}
                                                                        aria-label={`Publication years for ${source.category}`}
                                                                    >
                                                                        Years
                                                                        <Menu.Indicator>
                                                                            <svg
                                                                                aria-hidden="true"
                                                                                viewBox="0 0 24 24"
                                                                                class="size-4"
                                                                                fill="none"
                                                                                stroke="currentColor"
                                                                                stroke-width="1.5"
                                                                            >
                                                                                <path d="m6 9 6 6 6-6" />
                                                                            </svg>
                                                                        </Menu.Indicator>
                                                                    </Menu.Trigger>
                                                                    <Portal>
                                                                        <Menu.Positioner class="z-50">
                                                                            <Menu.Content
                                                                                class="popup max-h-[min(20rem,calc(100dvh-2rem))] w-48 max-w-[calc(100vw-2rem)] overflow-y-auto p-1"
                                                                                aria-label={`Publication years for ${source.category}`}
                                                                            >
                                                                                <For
                                                                                    each={[...source.years].sort(
                                                                                        (first, second) =>
                                                                                            Number(second.year) -
                                                                                            Number(first.year),
                                                                                    )}
                                                                                >
                                                                                    {(year) => (
                                                                                        <Menu.Item
                                                                                            value={year.year}
                                                                                            disabled={
                                                                                                props.locked ||
                                                                                                !year.searchable
                                                                                            }
                                                                                            class="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-sm px-3 text-sm tabular-nums data-highlighted:bg-surface-muted data-disabled:cursor-not-allowed data-disabled:opacity-50"
                                                                                            aria-label={`${year.year}: ${numbers.format(year.count)} videos, ${numbers.format(year.searchable)} searchable`}
                                                                                        >
                                                                                            <span>{year.year}</span>
                                                                                            <span class="text-muted">
                                                                                                {numbers.format(
                                                                                                    year.count,
                                                                                                )}
                                                                                            </span>
                                                                                        </Menu.Item>
                                                                                    )}
                                                                                </For>
                                                                            </Menu.Content>
                                                                        </Menu.Positioner>
                                                                    </Portal>
                                                                </Menu.Root>
                                                            </Show>
                                                            <a
                                                                class="inline-flex min-h-11 items-center text-sm underline hover:text-accent"
                                                                href={`https://www.youtube.com/playlist?list=${encodeURIComponent(source.identifier)}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                Original playlist
                                                                <span class="sr-only"> (opens in a new tab)</span>
                                                            </a>
                                                            <ark.button
                                                                type="button"
                                                                ref={glass}
                                                                class="glass ps-glass action rounded-full text-foreground"
                                                                disabled={props.locked || !source.searchable}
                                                                onClick={() => props.browse(source)}
                                                            >
                                                                Browse
                                                            </ark.button>
                                                        </div>
                                                    </div>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </li>
                            )}
                        </For>
                    </ul>
                </section>
            </Show>
        </div>
    );
}
