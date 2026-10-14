import { Dialog } from "@ark-ui/solid/dialog";
import { Field } from "@ark-ui/solid/field";
import { Pagination } from "@ark-ui/solid/pagination";
import { Select, createListCollection } from "@ark-ui/solid/select";
import { Switch } from "@ark-ui/solid/switch";
import { Tabs } from "@ark-ui/solid/tabs";
import { Toggle } from "@ark-ui/solid/toggle";
import { Tooltip } from "@ark-ui/solid/tooltip";
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

import type { Filters, Result, SearchResponse, SourceSummary, Status } from "../shared/metadata";
import type { Transcript } from "./conversation";

import { orders, orderLabels } from "../shared/metadata";
import Collection from "./collection";
import composition from "./composition";
import Conversation from "./conversation";
import Dates, { validation } from "./dates";
import { Footage, Inspection, numbers, scope } from "./footage";
import * as gateway from "./gateway";

const defaults: Filters = { categories: [], playlists: [], from: "", until: "", order: "relevance" };
const sorting = createListCollection({ items: orders.map((value) => ({ value, label: orderLabels[value] })) });

function error(value: unknown): string {
    return value instanceof Error ? value.message : "The request could not be completed. Try again.";
}

export default function Application() {
    const [status, catalog] = createSignal<Status>();
    const [theme, appearance] = createSignal(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const [themeerror, themefailure] = createSignal("");
    const [refreshing, refreshstate] = createSignal(true);
    const [statuserror, statusfailure] = createSignal("");
    const [filters, selection] = createSignal<Filters>({ ...defaults });
    const [query, searchtext] = createSignal("");
    const [semantic, semanticMode] = createSignal(false);
    const [submitted, submission] = createSignal({ query: "", filters: { ...defaults }, page: 1, semantic: false });
    const [pending, requestscope] = createSignal(submitted());
    const [composing, compositionstate] = createSignal(false);
    const searchComposition = composition();
    const [collection, results] = createSignal<SearchResponse>();
    const [searching, searchstate] = createSignal(false);
    const [searcherror, searchfailure] = createSignal("");
    const [transcript, conversation] = createSignal<Transcript[]>([]);
    const [message, draft] = createSignal("");
    const [session, identifier] = createSignal<string>();
    const [sending, sendstate] = createSignal(false);
    const [unread, unreadstate] = createSignal(false);
    const [newreply, replystate] = createSignal(false);
    const [savedDraft, saveDraft] = createSignal<string>();
    const [clearing, clearstate] = createSignal(false);
    const [chaterror, chatfailure] = createSignal("");
    const [failed, failedmessage] = createSignal("");
    const [detail, metadata] = createSignal<Result>();
    const [detailing, detailstate] = createSignal(false);
    const [detailerror, detailfailure] = createSignal("");
    const [mobile, mobilemode] = createSignal(window.matchMedia("(max-width: 1023px)").matches);
    const [chatopen, chatvisibility] = createSignal(false);
    const [sidebarcollapsed, collapseSidebar] = createSignal(false);
    const [sidebaropen, sidebarvisibility] = createSignal(false);
    const [view, navigate] = createSignal<"search" | "overview" | "sources">("search");
    const [archieVisible, setArchieVisible] = createSignal(true);
    const chatShown = createMemo(() => (mobile() ? chatopen() : archieVisible()));
    const ready = createMemo(() => status()?.catalog === "ready" && !statuserror());
    const restoring = createMemo(() => status()?.catalog === "restoring" && !statuserror());
    const assistance = createMemo(() => ready() && status()?.assistance.configured === true);
    const locked = createMemo(() => !ready() || sending() || clearing());
    const pages = createMemo(() => Math.ceil((collection()?.total ?? 0) / 12));

    let searchtimer: number | undefined;
    let refreshTimer: number | undefined;
    let searchkey = "";

    let statusrequest: AbortController | undefined;
    let searchrequest: AbortController | undefined;
    let chatrequest: AbortController | undefined;
    let detailrequest: AbortController | undefined;
    let chatdialog: HTMLDivElement | undefined;
    let sidebarbutton: HTMLButtonElement | undefined;
    let chatbutton: HTMLButtonElement | undefined;
    let composer: HTMLTextAreaElement | undefined;
    let messages: HTMLDivElement | undefined;
    let latestreply: HTMLElement | undefined;
    let disposed = false;
    let inspector: HTMLElement | undefined;
    let resultheading: HTMLHeadingElement | undefined;
    let searchinput: HTMLInputElement | undefined;
    let sourceopener: HTMLElement | undefined;
    let categorytoggle: HTMLButtonElement | undefined;
    let inspectionTransition: ViewTransition | undefined;
    let transitionPreview: HTMLElement | undefined;

    const categories = createMemo(() =>
        createListCollection({
            items: (status()?.categories ?? []).map((category) => ({
                value: category.name,
                label: `${category.name} (${numbers.format(category.count)})`,
            })),
        }),
    );

    const sources = createMemo(() =>
        createListCollection({
            items: (status()?.sources ?? []).map((source) => ({
                value: source.identifier,
                label: sourceLabel(source.identifier),
            })),
        }),
    );

    function nearBottom() {
        return !!messages && messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 96;
    }

    function seeReply() {
        if (disposed || !chatShown() || document.hidden || !messages?.clientHeight || !latestreply) {
            return;
        }

        const viewport = messages.getBoundingClientRect();
        const panel = chatdialog?.getBoundingClientRect();
        const top = Math.max(0, viewport.top, panel?.top ?? 0);
        const bottom = Math.min(window.innerHeight, viewport.bottom, panel?.bottom ?? window.innerHeight);

        if (top >= bottom) {
            return;
        }

        const reply = latestreply.getBoundingClientRect();

        if (reply.bottom > top && reply.top < bottom) {
            unreadstate(false);
        }

        if (nearBottom()) {
            replystate(false);
        }
    }

    function scrollToReply() {
        if (disposed || !chatShown() || !messages?.clientHeight) {
            return;
        }

        messages.scrollTo({ top: messages.scrollHeight, behavior: "instant" });
        seeReply();
    }

    function textScope(text: string, chosen: Filters, mode = semantic()) {
        return JSON.stringify([
            text.trim(),
            [...chosen.categories].sort(),
            [...chosen.playlists].sort(),
            chosen.from,
            chosen.until,
            chosen.order,
            mode,
        ]);
    }

    function cancelSearch() {
        clearTimeout(searchtimer);
        searchtimer = undefined;

        if (searchrequest) {
            searchrequest.abort();
            searchrequest = undefined;
            searchkey = "";
        }

        searchstate(false);
    }

    async function search(page = 1, text = query(), chosen = filters(), force = false, mode = semantic()) {
        clearTimeout(searchtimer);
        searchtimer = undefined;

        if (!ready() || composing()) {
            return;
        }

        const problem =
            text.trim().length > 2000
                ? "Keep your search within 2,000 characters."
                : validation(chosen.from, chosen.until);

        if (problem) {
            cancelSearch();
            searchfailure(problem);

            return;
        }

        const key = `${textScope(text, chosen, mode)}:${page}`;

        if (!force && key === searchkey) {
            return;
        }

        cancelSearch();
        searchkey = key;
        const controller = new AbortController();

        const requested = {
            query: text,
            filters: { ...chosen, categories: [...chosen.categories], playlists: [...chosen.playlists] },
            page,
            semantic: mode,
        };

        searchrequest = controller;
        requestscope(requested);
        searchstate(true);
        searchfailure("");

        if (document.activeElement?.closest('[aria-label="Result pages"]')) {
            resultheading?.focus();
        }

        try {
            const response = await gateway.search(text, requested.filters, page, controller.signal, { semantic: mode });

            if (searchrequest === controller && !controller.signal.aborted) {
                batch(() => {
                    submission(requested);
                    results(response);
                    searchfailure("");
                });
            }
        } catch (value) {
            if (searchrequest === controller && !controller.signal.aborted) {
                searchkey = "";
                searchfailure(error(value));
            }
        } finally {
            if (searchrequest === controller) {
                searchrequest = undefined;
                searchstate(false);
            }
        }
    }

    async function refresh() {
        if (disposed) {
            return;
        }

        clearTimeout(refreshTimer);
        const wasready = ready();
        statusrequest?.abort();
        const controller = new AbortController();
        statusrequest = controller;
        refreshstate(true);
        statusfailure("");

        try {
            const response = await gateway.status(controller.signal);

            if (statusrequest !== controller || controller.signal.aborted) {
                return;
            }

            catalog(response);

            if (response.catalog === "ready" && wasready) {
                const current = submitted();

                const same =
                    textScope(query(), filters()) === textScope(current.query, current.filters, current.semantic);

                await search(same ? current.page : 1, query(), filters(), true);
            } else if (response.catalog !== "ready") {
                cancelSearch();
                searchkey = "";
                results(undefined);
            }
        } catch (value) {
            if (statusrequest === controller && !controller.signal.aborted) {
                statusfailure(error(value));
            }
        } finally {
            if (statusrequest === controller) {
                refreshstate(false);
                statusrequest = undefined;

                if (!disposed && status()?.catalog === "restoring") {
                    refreshTimer = window.setTimeout(() => void refresh(), 5000);
                }
            }
        }
    }

    async function send(text = message(), retry = false) {
        const content = text.trim();

        if (!assistance() || sending() || clearing() || !content) {
            return;
        }

        if (content.length > 2000) {
            chatfailure("Keep your request within 2,000 characters.");

            return;
        }

        const dateproblem = validation(filters().from, filters().until);

        if (dateproblem) {
            chatfailure(`${dateproblem} Change the research scope to correct it.`);

            return;
        }

        const controller = new AbortController();
        const origin = document.activeElement;
        const restore = chatdialog?.contains(origin);
        chatrequest = controller;
        sendstate(true);
        chatfailure("");
        failedmessage("");

        if (!retry) {
            conversation((items) => items.concat({ kind: "question", message: content }));
            draft(savedDraft() ?? "");
            saveDraft(undefined);
        }

        queueMicrotask(scrollToReply);

        try {
            const response = await gateway.chat(content, session(), { ...filters() }, controller.signal);

            if (chatrequest !== controller || controller.signal.aborted) {
                return;
            }

            identifier(response.session);
            selection(response.filters);
            const follow = chatShown() && !document.hidden && nearBottom();

            if (!chatShown() || document.hidden) {
                unreadstate(true);
            }

            replystate(true);
            conversation((items) => items.concat({ kind: "answer", response }));

            queueMicrotask(() => {
                if (follow) {
                    scrollToReply();
                } else {
                    seeReply();
                }
            });
        } catch (value) {
            if (chatrequest === controller && !controller.signal.aborted) {
                const follow = chatShown() && nearBottom();
                chatfailure(error(value));
                failedmessage(content);

                if (follow) {
                    queueMicrotask(scrollToReply);
                }
            }
        } finally {
            if (chatrequest === controller && !controller.signal.aborted) {
                chatrequest = undefined;
                sendstate(false);

                if (
                    restore &&
                    chatShown() &&
                    (document.activeElement === origin || document.activeElement === document.body)
                ) {
                    composer?.focus({ preventScroll: true });
                }
            }
        }
    }

    async function clear() {
        if (sending() || clearing()) {
            return;
        }

        const origin = document.activeElement;
        const restore = chatdialog?.contains(origin);
        clearstate(true);
        chatfailure("");
        const controller = new AbortController();
        chatrequest = controller;

        try {
            const current = session();

            if (current) {
                await gateway.clear(current, controller.signal);
            }

            if (chatrequest !== controller || controller.signal.aborted) {
                return;
            }

            identifier(undefined);
            conversation([]);
            failedmessage("");
            draft("");
            saveDraft(undefined);
            latestreply = undefined;
            unreadstate(false);
            replystate(false);
        } catch (value) {
            if (chatrequest === controller && !controller.signal.aborted) {
                chatfailure(`Conversation was not cleared. ${error(value)}`);
            }
        } finally {
            if (chatrequest === controller && !controller.signal.aborted) {
                chatrequest = undefined;
                clearstate(false);

                if (
                    restore &&
                    chatShown() &&
                    (document.activeElement === origin || document.activeElement === document.body)
                ) {
                    composer?.focus({ preventScroll: true });
                }
            }
        }
    }

    async function loadDetails(identifier: string) {
        detailrequest?.abort();
        const controller = new AbortController();
        detailrequest = controller;
        detailstate(true);
        detailfailure("");

        try {
            const video = await gateway.videoDetails(identifier, controller.signal);
            const current = detail();

            if (
                detailrequest === controller &&
                !controller.signal.aborted &&
                current?.video.identifier === identifier
            ) {
                metadata({ ...current, video });
            }
        } catch (value) {
            if (
                detailrequest === controller &&
                !controller.signal.aborted &&
                detail()?.video.identifier === identifier
            ) {
                detailfailure(error(value));
            }
        } finally {
            if (detailrequest === controller) {
                detailstate(false);
            }
        }
    }

    function closeChat() {
        if (mobile()) {
            chatvisibility(false);
        }
    }

    function inspect(result?: Result) {
        inspectionTransition?.skipTransition();
        inspectionTransition = undefined;
        transitionPreview?.style.removeProperty("view-transition-name");

        const opener = result
            ? document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined
            : sourceopener;

        const preview = opener?.querySelector<HTMLElement>(".footage-preview");

        const update = () => {
            transitionPreview?.style.removeProperty("view-transition-name");

            if (result) {
                sourceopener = opener;

                batch(() => {
                    closeChat();
                    navigate("search");
                    metadata(result);

                    if (result.video.availability === "available") {
                        void loadDetails(result.video.identifier);
                    } else {
                        detailrequest?.abort();
                        detailrequest = undefined;
                        detailstate(false);
                        detailfailure("");
                    }
                });

                inspector?.focus({ preventScroll: true });
                inspector?.scrollIntoView({ block: "start", behavior: "instant" });
            } else {
                detailrequest?.abort();
                detailrequest = undefined;
                detailstate(false);
                detailfailure("");
                metadata(undefined);

                const target =
                    opener?.isConnected &&
                    opener.getClientRects().length &&
                    (!chatdialog?.contains(opener) || !mobile())
                        ? opener
                        : resultheading;

                target?.focus({ preventScroll: true });
                target?.scrollIntoView({ block: "nearest", behavior: "instant" });
            }
        };

        if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            update();

            return;
        }

        transitionPreview = preview ?? undefined;

        if (result && !detail() && preview) {
            preview.style.viewTransitionName = "source-preview";
        }

        const transition = document.startViewTransition(() => {
            if (inspectionTransition !== transition || disposed) {
                return;
            }

            update();

            if (!result && preview?.isConnected) {
                preview.style.viewTransitionName = "source-preview";
            }
        });

        inspectionTransition = transition;

        void transition.finished.then(() => {
            if (inspectionTransition === transition) {
                preview?.style.removeProperty("view-transition-name");
                inspectionTransition = undefined;
            }
        });
    }

    function browse(text: string) {
        closeChat();
        navigate("search");
        searchtext(text);

        queueMicrotask(() => {
            searchinput?.focus();
        });
    }

    function sourceLabel(identifier: string) {
        const source = status()?.sources.find((item) => item.identifier === identifier);

        if (!source) {
            return "Source playlist";
        }

        const siblings = status()!.sources.filter((item) => item.category === source.category);

        return `${source.category}${siblings.length > 1 ? ` · Playlist ${siblings.findIndex((item) => item.identifier === identifier) + 1}` : ""}`;
    }

    function browseSource(source: SourceSummary, year?: string) {
        closeChat();

        batch(() => {
            navigate("search");

            selection({
                categories: [],
                playlists: [source.identifier],
                from: year ? `${year}-01-01` : "",
                until: year ? `${year}-12-31` : "",
                order: "latest",
            });
        });

        requestAnimationFrame(() => searchinput?.focus());
    }

    function showView(next: "search" | "overview" | "sources") {
        closeChat();

        if (mobile()) {
            sidebarvisibility(false);
        }

        navigate(next);
        queueMicrotask(() => document.getElementById("workspace")?.focus({ preventScroll: true }));
    }

    function toggleArchie() {
        if (mobile()) {
            sidebarvisibility(false);
            chatvisibility(true);
        } else {
            setArchieVisible(!archieVisible());
        }
    }

    onMount(() => {
        const breakpoint = window.matchMedia("(max-width: 1023px)");

        const resize = () => {
            const next = breakpoint.matches;

            if (next === mobile()) {
                return;
            }

            chatvisibility(false);
            sidebarvisibility(false);
            mobilemode(next);
        };

        breakpoint.addEventListener("change", resize);
        onCleanup(() => breakpoint.removeEventListener("change", resize));
        window.addEventListener("scroll", seeReply, { passive: true });
        window.addEventListener("resize", seeReply);
        document.addEventListener("visibilitychange", seeReply);

        onCleanup(() => {
            window.removeEventListener("scroll", seeReply);
            window.removeEventListener("resize", seeReply);
            document.removeEventListener("visibilitychange", seeReply);
        });

        void refresh();
    });

    onCleanup(() => {
        disposed = true;
        inspectionTransition?.skipTransition();
        transitionPreview?.style.removeProperty("view-transition-name");
        statusrequest?.abort();
        searchrequest?.abort();
        clearTimeout(searchtimer);
        clearTimeout(refreshTimer);
        chatrequest?.abort();
        detailrequest?.abort();
    });

    createEffect(
        on([query, filters, ready, composing, semantic], ([text, chosen, available, editing, mode], previous) => {
            const scopekey = textScope("", chosen, mode);
            const oldscope = previous && textScope("", previous[1], previous[4]);

            if (
                previous &&
                text === previous[0] &&
                scopekey === oldscope &&
                available === previous[2] &&
                editing === previous[3]
            ) {
                return;
            }

            cancelSearch();
            searchfailure("");

            if (!available || editing) {
                return;
            }

            const problem =
                text.trim().length > 2000
                    ? "Keep your search within 2,000 characters."
                    : validation(chosen.from, chosen.until);

            if (problem) {
                searchfailure(problem);

                return;
            }

            if (previous?.[2] && (text !== previous[0] || previous[3])) {
                searchtimer = window.setTimeout(() => {
                    void search(1, text, chosen, false, mode);
                }, 250);
            } else {
                void search(1, text, chosen, false, mode);
            }
        }),
    );

    createEffect(() => {
        chatShown();
        queueMicrotask(seeReply);
    });

    createEffect(() => {
        message();

        queueMicrotask(() => {
            if (!composer) {
                return;
            }

            if (disposed) {
                return;
            }

            const follow = chatShown() && nearBottom();

            composer.style.height = "auto";
            composer.style.height = `${Math.min(160, Math.max(48, composer.scrollHeight + 2))}px`;

            if (follow) {
                scrollToReply();
            } else {
                seeReply();
            }
        });
    });

    return (
        <>
            <a
                class="action fixed top-3 left-4 z-50 -translate-y-32 bg-surface-raised focus:translate-y-0"
                href="#workspace"
            >
                Skip to research desk
            </a>
            <p class="sr-only" role="status">
                {unread() ? "Archie has a new reply." : ""}
            </p>
            <Tabs.Root
                class="workspace-shell"
                value={view()}
                ids={{ trigger: (value) => `research-tab-${value}` }}
                orientation="vertical"
                activationMode="manual"
                lazyMount={false}
                unmountOnExit={false}
                onValueChange={(details) => {
                    const next = details.value;
                    if (next === "search" || next === "overview" || next === "sources") {
                        showView(next);
                    }
                }}
            >
                <Dialog.Root
                    open={!mobile() || sidebaropen()}
                    modal={mobile()}
                    trapFocus={mobile()}
                    preventScroll={mobile()}
                    restoreFocus={mobile()}
                    closeOnEscape={mobile()}
                    closeOnInteractOutside={mobile()}
                    onOpenChange={(details) => {
                        if (mobile()) {
                            sidebarvisibility(details.open);
                        }
                    }}
                    finalFocusEl={() => sidebarbutton ?? null}
                    initialFocusEl={() =>
                        !mobile() && document.activeElement instanceof HTMLElement ? document.activeElement : null
                    }
                    ids={{ content: "utility-sidebar", title: "utility-title" }}
                    aria-label="ArchiveMateAI menu"
                >
                    <Show when={mobile()}>
                        <Dialog.Backdrop class="fixed inset-0 z-40 bg-foreground/40" />
                    </Show>
                    <Dialog.Content
                        class="utility-sidebar cursor-pointer bg-surface-raised text-foreground lg:bg-transparent"
                        classList={{ "utility-sidebar-collapsed": !mobile() && sidebarcollapsed(), "z-50": mobile() }}
                        role={mobile() ? "dialog" : "complementary"}
                        onClick={(event) => {
                            if (
                                event.target instanceof Element &&
                                event.target.closest(
                                    'button, a[href], input, select, textarea, summary, label, [role="button"], [role="switch"], [role="tab"]',
                                )
                            ) {
                                return;
                            }
                            if (mobile()) {
                                sidebarvisibility(false);
                            } else {
                                collapseSidebar(!sidebarcollapsed());
                            }
                        }}
                    >
                        <div class="flex h-full min-h-0 flex-col gap-6 px-3 py-6">
                            <button
                                type="button"
                                class="flex min-h-11 shrink-0 items-center gap-3 px-3 text-left"
                                aria-label={
                                    mobile()
                                        ? "Close utility sidebar"
                                        : sidebarcollapsed()
                                          ? "Expand utility sidebar"
                                          : "Collapse utility sidebar"
                                }
                                aria-expanded={mobile() ? sidebaropen() : !sidebarcollapsed()}
                                aria-controls="utility-content"
                                onClick={() =>
                                    mobile() ? sidebarvisibility(false) : collapseSidebar(!sidebarcollapsed())
                                }
                            >
                                <svg
                                    class="shrink-0"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    aria-hidden="true"
                                >
                                    <rect x="3" y="4" width="18" height="16" rx="2" />
                                    <path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4M10 9l4 3-4 3Z" />
                                </svg>
                                <span
                                    id="utility-title"
                                    class="navigation-label min-w-0 text-sm font-semibold tracking-tight"
                                >
                                    ArchiveMateAI
                                </span>
                            </button>
                            <div id="utility-content" class="flex min-h-0 flex-1 flex-col gap-6">
                                <Tabs.List
                                    class="relative isolate min-h-0 flex-1 space-y-1 overflow-y-auto"
                                    aria-label="Research desk views"
                                >
                                    <For each={["search", "overview", "sources"] as const}>
                                        {(destination) => (
                                            <Tooltip.Root
                                                ids={{ trigger: `research-tab-${destination}` }}
                                                disabled={mobile() || !sidebarcollapsed()}
                                                positioning={{ placement: "right" }}
                                            >
                                                <Tooltip.Trigger
                                                    asChild={(props) => (
                                                        <Tabs.Trigger
                                                            {...props}
                                                            value={destination}
                                                            class="action w-full justify-start gap-3 px-3 text-sm hover:bg-surface-muted data-selected:text-accent"
                                                            aria-label={
                                                                destination.charAt(0).toUpperCase() +
                                                                destination.slice(1)
                                                            }
                                                        >
                                                            <svg
                                                                class="shrink-0"
                                                                width="20"
                                                                height="20"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="1.5"
                                                                aria-hidden="true"
                                                            >
                                                                <Show when={destination === "search"}>
                                                                    <circle cx="10" cy="10" r="6" />
                                                                    <path d="m14.5 14.5 6 6" />
                                                                </Show>
                                                                <Show when={destination === "overview"}>
                                                                    <rect x="3" y="3" width="7" height="7" rx="1" />
                                                                    <rect x="14" y="3" width="7" height="7" rx="1" />
                                                                    <rect x="3" y="14" width="7" height="7" rx="1" />
                                                                    <rect x="14" y="14" width="7" height="7" rx="1" />
                                                                </Show>
                                                                <Show when={destination === "sources"}>
                                                                    <rect x="7" y="3" width="14" height="14" rx="2" />
                                                                    <path d="M17 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2M11 7h6M11 11h6" />
                                                                </Show>
                                                            </svg>
                                                            <span class="navigation-label">
                                                                {destination.charAt(0).toUpperCase() +
                                                                    destination.slice(1)}
                                                            </span>
                                                        </Tabs.Trigger>
                                                    )}
                                                />
                                                <Portal>
                                                    <Tooltip.Positioner class="z-50">
                                                        <Tooltip.Content class="popup px-3 py-2 text-sm">
                                                            {destination.charAt(0).toUpperCase() + destination.slice(1)}
                                                        </Tooltip.Content>
                                                    </Tooltip.Positioner>
                                                </Portal>
                                            </Tooltip.Root>
                                        )}
                                    </For>
                                    <Tabs.Indicator
                                        class="navigation-indicator"
                                        style={{
                                            "transition-property": "top",
                                            "transition-duration": "var(--indicator-duration, 0ms)",
                                            "transition-timing-function": "cubic-bezier(0.16, 1, 0.3, 1)",
                                        }}
                                    />
                                </Tabs.List>
                                <div class="mt-auto shrink-0 space-y-2">
                                    <Tooltip.Root
                                        disabled={mobile() || !sidebarcollapsed()}
                                        positioning={{ placement: "right" }}
                                    >
                                        <Tooltip.Trigger
                                            type="button"
                                            class="action w-full justify-start gap-3 px-3 text-sm hover:bg-surface-muted"
                                            onClick={toggleArchie}
                                            aria-label={`${mobile() ? "Open Archie" : archieVisible() ? "Hide Archie" : "Show Archie"}${sending() ? ", Archie is responding" : ""}${unread() ? ", new reply" : ""}`}
                                            aria-expanded={mobile() ? chatopen() : archieVisible()}
                                            aria-controls="archie-panel"
                                            aria-haspopup={mobile() ? "dialog" : undefined}
                                        >
                                            <span class="relative shrink-0">
                                                <svg
                                                    class="shrink-0"
                                                    width="20"
                                                    height="20"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    aria-hidden="true"
                                                >
                                                    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
                                                </svg>
                                                <Show when={unread()}>
                                                    <span
                                                        class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
                                                        aria-hidden="true"
                                                    />
                                                </Show>
                                            </span>
                                            <span class="navigation-label min-w-0 text-left">Archie</span>
                                        </Tooltip.Trigger>
                                        <Portal>
                                            <Tooltip.Positioner class="z-50">
                                                <Tooltip.Content class="popup px-3 py-2 text-sm">
                                                    {archieVisible() ? "Hide Archie" : "Show Archie"}
                                                    {unread() ? " · New reply" : ""}
                                                </Tooltip.Content>
                                            </Tooltip.Positioner>
                                        </Portal>
                                    </Tooltip.Root>
                                    <Tooltip.Root
                                        ids={{ trigger: "theme-switch" }}
                                        disabled={mobile() || !sidebarcollapsed()}
                                        positioning={{ placement: "right" }}
                                    >
                                        <Tooltip.Trigger
                                            asChild={(props) => (
                                                <Switch.Root
                                                    {...props}
                                                    ids={{ root: "theme-switch" }}
                                                    class="action w-full cursor-pointer justify-start gap-3 px-3 text-sm hover:bg-surface-muted data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent"
                                                    checked={theme() === "dark"}
                                                    onCheckedChange={(details) => {
                                                        const value = details.checked ? "dark" : "light";
                                                        appearance(value);
                                                        document.documentElement.dataset.theme = value;
                                                        themefailure("");
                                                        try {
                                                            localStorage.setItem("archive-mate-theme", value);
                                                        } catch {
                                                            themefailure(
                                                                "Theme changed for this visit, but couldn't be saved.",
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <svg
                                                        class="shrink-0"
                                                        width="20"
                                                        height="20"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="1.5"
                                                        aria-hidden="true"
                                                    >
                                                        <Show
                                                            when={theme() === "dark"}
                                                            fallback={<path d="M20 13a8 8 0 0 1-9-9 8 8 0 1 0 9 9Z" />}
                                                        >
                                                            <circle cx="12" cy="12" r="4" />
                                                            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
                                                        </Show>
                                                    </svg>
                                                    <Switch.Label class="navigation-label">
                                                        {theme() === "dark" ? "Dark mode" : "Light mode"}
                                                    </Switch.Label>
                                                    <Switch.HiddenInput role="switch" aria-label="Dark mode" />
                                                </Switch.Root>
                                            )}
                                        />
                                        <Portal>
                                            <Tooltip.Positioner class="z-50">
                                                <Tooltip.Content class="popup px-3 py-2 text-sm">
                                                    {theme() === "dark"
                                                        ? "Switch to light mode"
                                                        : "Switch to dark mode"}
                                                </Tooltip.Content>
                                            </Tooltip.Positioner>
                                        </Portal>
                                    </Tooltip.Root>
                                    <Show when={themeerror()}>
                                        <p
                                            class="text-sm"
                                            classList={{ "sr-only": !mobile() && sidebarcollapsed() }}
                                            role="status"
                                        >
                                            {themeerror()}
                                        </p>
                                    </Show>
                                </div>
                            </div>
                        </div>
                    </Dialog.Content>
                </Dialog.Root>
                <div class="min-w-0 flex-1">
                    <header class="border-b border-border lg:hidden">
                        <div class="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
                            <button
                                type="button"
                                class="action shrink-0 gap-2 px-3 hover:bg-surface-muted"
                                ref={(element) => {
                                    sidebarbutton = element;
                                }}
                                aria-haspopup="dialog"
                                aria-label="Open ArchiveMateAI menu"
                                aria-controls="utility-sidebar"
                                aria-expanded={sidebaropen()}
                                onClick={() => {
                                    closeChat();
                                    sidebarvisibility(true);
                                }}
                            >
                                <svg
                                    class="shrink-0"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    aria-hidden="true"
                                >
                                    <rect x="3" y="4" width="18" height="16" rx="2" />
                                    <path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4M10 9l4 3-4 3Z" />
                                </svg>
                                <span class="hidden sm:inline">ArchiveMateAI</span>
                            </button>
                            <button
                                type="button"
                                class="action shrink-0 gap-2 hover:bg-surface-muted lg:hidden"
                                ref={(element) => {
                                    chatbutton = element;
                                }}
                                onClick={() => {
                                    mobilemode(window.matchMedia("(max-width: 1023px)").matches);
                                    if (!mobile()) {
                                        return;
                                    }
                                    sidebarvisibility(false);
                                    chatvisibility(true);
                                }}
                                aria-haspopup="dialog"
                                aria-label={`Open Archie${sending() ? ", Archie is responding" : ""}${unread() ? ", new reply" : ""}`}
                                title={`Open Archie${unread() ? " · New reply" : ""}`}
                                aria-controls="archie-panel"
                            >
                                <span class="relative shrink-0">
                                    <svg
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.5"
                                        aria-hidden="true"
                                    >
                                        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
                                    </svg>
                                    <Show when={unread()}>
                                        <span
                                            class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
                                            aria-hidden="true"
                                        />
                                    </Show>
                                </span>
                            </button>
                        </div>
                    </header>
                    <main
                        id="workspace"
                        class="grid min-w-0 items-start px-4 py-6 sm:px-6"
                        data-conversation={archieVisible() ? "open" : "closed"}
                        tabindex="-1"
                    >
                        <Tabs.Content value="search" class="min-w-0">
                            <section
                                class="space-y-4 border-b border-border p-4 sm:p-6"
                                aria-labelledby="collection-heading"
                            >
                                <h1 id="collection-heading" class="text-xl font-semibold">
                                    Broadcast collection
                                </h1>
                                <form
                                    class="space-y-4"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        if (!searchComposition.blocked()) {
                                            void search();
                                        }
                                    }}
                                >
                                    <Field.Root id="research-query" disabled={!ready()}>
                                        <Field.Label class="sr-only">Search the collection</Field.Label>
                                        <Field.Input
                                            class="field min-h-12 w-full min-w-0 text-base"
                                            ref={(element) => {
                                                searchinput = element;
                                            }}
                                            type="search"
                                            maxlength={2000}
                                            placeholder="Search a person, event, or phrase"
                                            value={query()}
                                            disabled={!ready()}
                                            onInput={(event) => searchtext(event.currentTarget.value)}
                                            onCompositionStart={() => {
                                                searchComposition.start();
                                                compositionstate(true);
                                            }}
                                            onCompositionEnd={(event) => {
                                                searchComposition.end();
                                                batch(() => {
                                                    searchtext(event.currentTarget.value);
                                                    compositionstate(false);
                                                });
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    if (!searchComposition.blocked(event) && !composing()) {
                                                        event.currentTarget.form?.requestSubmit();
                                                    }
                                                }
                                            }}
                                            onKeyUp={() => searchComposition.release()}
                                        />
                                    </Field.Root>
                                    <fieldset class="flex min-w-0 flex-wrap items-center gap-2" disabled={locked()}>
                                        <legend class="sr-only">Research filters and search mode</legend>
                                        <Select.Root
                                            class="min-w-0 text-sm"
                                            collection={categories()}
                                            multiple
                                            closeOnSelect={false}
                                            disabled={locked()}
                                            value={filters().categories}
                                            onValueChange={(details) =>
                                                selection({ ...filters(), categories: details.value })
                                            }
                                            positioning={{ placement: "bottom-start", fitViewport: true }}
                                        >
                                            <Select.Label class="sr-only">Categories</Select.Label>
                                            <Select.Control>
                                                <Select.Trigger
                                                    class={`action min-w-0 justify-between rounded-full border font-normal hover:bg-surface-muted ${filters().categories.length ? "border-accent text-accent" : "border-border"}`}
                                                    ref={(element) => {
                                                        categorytoggle = element;
                                                    }}
                                                >
                                                    <span>
                                                        {filters().categories.length
                                                            ? `Categories: ${filters().categories.length}`
                                                            : "Categories"}
                                                    </span>
                                                    <Select.Indicator>
                                                        <svg
                                                            aria-hidden="true"
                                                            viewBox="0 0 24 24"
                                                            class="size-4 shrink-0"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.5"
                                                        >
                                                            <path d="m6 9 6 6 6-6" />
                                                        </svg>
                                                    </Select.Indicator>
                                                </Select.Trigger>
                                            </Select.Control>
                                            <Portal>
                                                <Select.Positioner class="z-50">
                                                    <Select.Content class="popup max-h-72 min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto">
                                                        <Select.ClearTrigger class="action w-full justify-start font-normal hover:bg-surface-muted">
                                                            All categories
                                                        </Select.ClearTrigger>
                                                        <For each={categories().items}>
                                                            {(category) => (
                                                                <Select.Item
                                                                    item={category}
                                                                    class="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 data-highlighted:bg-surface-muted data-[state=checked]:text-accent"
                                                                >
                                                                    <Select.ItemText class="min-w-0 break-words">
                                                                        {category.label}
                                                                    </Select.ItemText>
                                                                    <Select.ItemIndicator>
                                                                        <svg
                                                                            aria-hidden="true"
                                                                            viewBox="0 0 24 24"
                                                                            class="size-4 shrink-0"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            stroke-width="1.5"
                                                                        >
                                                                            <path d="m5 12 4 4 10-10" />
                                                                        </svg>
                                                                    </Select.ItemIndicator>
                                                                </Select.Item>
                                                            )}
                                                        </For>
                                                    </Select.Content>
                                                </Select.Positioner>
                                            </Portal>
                                            <Select.HiddenSelect />
                                        </Select.Root>
                                        <Select.Root
                                            class="min-w-0 text-sm"
                                            collection={sources()}
                                            multiple
                                            closeOnSelect={false}
                                            disabled={locked()}
                                            value={filters().playlists}
                                            onValueChange={(details) =>
                                                selection({ ...filters(), playlists: details.value })
                                            }
                                            positioning={{ placement: "bottom-start", fitViewport: true }}
                                        >
                                            <Select.Label class="sr-only">Sources</Select.Label>
                                            <Select.Control>
                                                <Select.Trigger
                                                    class={`action min-w-0 justify-between rounded-full border font-normal hover:bg-surface-muted ${filters().playlists.length ? "border-accent text-accent" : "border-border"}`}
                                                >
                                                    <span>
                                                        {filters().playlists.length
                                                            ? `Sources: ${filters().playlists.length}`
                                                            : "Sources"}
                                                    </span>
                                                    <Select.Indicator>
                                                        <svg
                                                            aria-hidden="true"
                                                            viewBox="0 0 24 24"
                                                            class="size-4 shrink-0"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.5"
                                                        >
                                                            <path d="m6 9 6 6 6-6" />
                                                        </svg>
                                                    </Select.Indicator>
                                                </Select.Trigger>
                                            </Select.Control>
                                            <Portal>
                                                <Select.Positioner class="z-50">
                                                    <Select.Content class="popup max-h-[min(18rem,calc(100dvh-2rem))] min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto">
                                                        <Select.ClearTrigger class="action w-full justify-start font-normal hover:bg-surface-muted">
                                                            All sources
                                                        </Select.ClearTrigger>
                                                        <For each={sources().items}>
                                                            {(source) => (
                                                                <Select.Item
                                                                    item={source}
                                                                    class="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 data-highlighted:bg-surface-muted data-[state=checked]:text-accent"
                                                                >
                                                                    <Select.ItemText class="min-w-0 break-words">
                                                                        {source.label}
                                                                    </Select.ItemText>
                                                                    <Select.ItemIndicator>
                                                                        <svg
                                                                            aria-hidden="true"
                                                                            viewBox="0 0 24 24"
                                                                            class="size-4 shrink-0"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            stroke-width="1.5"
                                                                        >
                                                                            <path d="m5 12 4 4 10-10" />
                                                                        </svg>
                                                                    </Select.ItemIndicator>
                                                                </Select.Item>
                                                            )}
                                                        </For>
                                                    </Select.Content>
                                                </Select.Positioner>
                                            </Portal>
                                            <Select.HiddenSelect />
                                        </Select.Root>
                                        <Dates
                                            from={filters().from}
                                            until={filters().until}
                                            disabled={locked()}
                                            change={(from, until) => selection({ ...filters(), from, until })}
                                            composition={compositionstate}
                                        />
                                        <Select.Root
                                            class="min-w-0 text-sm"
                                            collection={sorting}
                                            disabled={locked()}
                                            value={[filters().order]}
                                            onValueChange={(details) => {
                                                const order = orders.find((order) => order === details.value[0]);
                                                if (order) {
                                                    selection({ ...filters(), order });
                                                }
                                            }}
                                            positioning={{ placement: "bottom-start", fitViewport: true }}
                                        >
                                            <Select.Label class="sr-only">Sort results</Select.Label>
                                            <Select.Control>
                                                <Select.Trigger
                                                    class={`action min-w-0 justify-between gap-2 rounded-full border font-normal hover:bg-surface-muted ${filters().order !== defaults.order ? "border-accent text-accent" : "border-border"}`}
                                                >
                                                    <span>Sort: {orderLabels[filters().order]}</span>
                                                    <Select.Indicator>
                                                        <svg
                                                            aria-hidden="true"
                                                            viewBox="0 0 24 24"
                                                            class="size-4 shrink-0"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.5"
                                                        >
                                                            <path d="m6 9 6 6 6-6" />
                                                        </svg>
                                                    </Select.Indicator>
                                                </Select.Trigger>
                                            </Select.Control>
                                            <Portal>
                                                <Select.Positioner class="z-50">
                                                    <Select.Content class="popup max-h-[min(22rem,calc(100dvh-2rem))] min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto">
                                                        <For each={sorting.items}>
                                                            {(order) => (
                                                                <Select.Item
                                                                    item={order}
                                                                    class="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 data-highlighted:bg-surface-muted data-[state=checked]:text-accent"
                                                                >
                                                                    <Select.ItemText>{order.label}</Select.ItemText>
                                                                    <Select.ItemIndicator>
                                                                        <svg
                                                                            aria-hidden="true"
                                                                            viewBox="0 0 24 24"
                                                                            class="size-4 shrink-0"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            stroke-width="1.5"
                                                                        >
                                                                            <path d="m5 12 4 4 10-10" />
                                                                        </svg>
                                                                    </Select.ItemIndicator>
                                                                </Select.Item>
                                                            )}
                                                        </For>
                                                    </Select.Content>
                                                </Select.Positioner>
                                            </Portal>
                                            <Select.HiddenSelect />
                                        </Select.Root>
                                        <Toggle.Root
                                            class={`action gap-2 rounded-full border text-sm font-normal hover:bg-surface-muted ${semantic() ? "border-accent text-accent" : "border-border"}`}
                                            pressed={semantic()}
                                            disabled={locked()}
                                            aria-label="Hybrid search"
                                            aria-describedby="semantic-description"
                                            onPressedChange={(pressed) => {
                                                cancelSearch();
                                                semanticMode(pressed);
                                            }}
                                        >
                                            <svg
                                                aria-hidden="true"
                                                viewBox="0 0 24 24"
                                                class="size-4 shrink-0"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="1.5"
                                            >
                                                <circle cx="10" cy="10" r="6" />
                                                <path d="m14.5 14.5 6 6" />
                                            </svg>
                                            {semantic() ? "Hybrid" : "Keyword"}
                                        </Toggle.Root>
                                        <Show
                                            when={
                                                filters().categories.length ||
                                                filters().playlists.length ||
                                                filters().from ||
                                                filters().until ||
                                                filters().order !== defaults.order ||
                                                semantic()
                                            }
                                        >
                                            <button
                                                type="button"
                                                class="action rounded-full border border-border px-3 text-sm hover:bg-surface-muted"
                                                disabled={locked()}
                                                onClick={() => {
                                                    batch(() => {
                                                        selection({ ...defaults, categories: [], playlists: [] });
                                                        semanticMode(false);
                                                    });
                                                    categorytoggle?.focus({ preventScroll: true });
                                                }}
                                            >
                                                Clear filters
                                            </button>
                                        </Show>
                                    </fieldset>
                                    <p id="semantic-description" class="sr-only">
                                        Add local multilingual semantic matches to keyword search. Archie uses semantic
                                        retrieval independently. Empty searches browse the collection without semantic
                                        retrieval.
                                    </p>
                                </form>
                            </section>
                            <Show when={statuserror() || (status() && !ready())}>
                                <div
                                    class="p-4 sm:px-6"
                                    classList={{
                                        "bg-surface-muted text-foreground": restoring(),
                                        "bg-danger text-danger-foreground": !restoring(),
                                    }}
                                    role={restoring() ? "status" : "alert"}
                                >
                                    <div class="min-w-0 space-y-2">
                                        <h2 class="text-base font-semibold">
                                            {statuserror()
                                                ? "Couldn't check the collection"
                                                : restoring()
                                                  ? "Restoring archive…"
                                                  : status()?.catalog === "missing"
                                                    ? "Collection hasn't been added yet"
                                                    : "Collection needs attention"}
                                        </h2>
                                        <p>
                                            {statuserror() ||
                                                status()?.error ||
                                                (restoring()
                                                    ? "Preparing the collection. This page will update automatically."
                                                    : "The collection is unavailable. Refresh status to try again.")}
                                        </p>
                                        <div class="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                class="action bg-surface-muted text-foreground hover:bg-border"
                                                disabled={refreshing() || restoring()}
                                                onClick={() => {
                                                    void refresh();
                                                }}
                                            >
                                                {restoring()
                                                    ? "Restoring…"
                                                    : refreshing()
                                                      ? "Refreshing…"
                                                      : "Refresh status"}
                                            </button>
                                            <button
                                                type="button"
                                                class="action hover:bg-danger-foreground/10"
                                                onClick={() => showView("overview")}
                                            >
                                                Overview
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </Show>
                            <Show when={detail()}>
                                {(selected) => (
                                    <section
                                        class="scroll-mt-6 border-b border-border focus-visible:outline-2 focus-visible:outline-accent"
                                        ref={(element) => {
                                            inspector = element;
                                        }}
                                        tabindex="-1"
                                        aria-label="Selected source inspection"
                                    >
                                        <Inspection
                                            result={selected()}
                                            loading={detailing()}
                                            failure={detailerror()}
                                            close={() => inspect()}
                                            refresh={() => {
                                                void loadDetails(selected().video.identifier);
                                            }}
                                        />
                                    </section>
                                )}
                            </Show>
                            <section aria-labelledby="results-heading">
                                <div class="flex flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-3 sm:px-6">
                                    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                        <h2
                                            id="results-heading"
                                            class="text-xl font-semibold"
                                            ref={(element) => {
                                                resultheading = element;
                                            }}
                                            tabindex="-1"
                                        >
                                            {collection()
                                                ? submitted().semantic && submitted().query.trim()
                                                    ? "Ranked results"
                                                    : `${numbers.format(collection()!.total)} ${submitted().query.trim() ? "possible matches" : "videos"}`
                                                : "Sources"}
                                        </h2>
                                        <Show when={collection()?.total}>
                                            <p class="text-sm text-muted">
                                                Page {collection()!.page} of {pages()}
                                            </p>
                                        </Show>
                                    </div>
                                    <Show
                                        when={
                                            submitted().query.trim() ||
                                            submitted().filters.categories.length ||
                                            submitted().filters.playlists.length ||
                                            submitted().filters.from ||
                                            submitted().filters.until ||
                                            submitted().filters.order !== "relevance"
                                        }
                                    >
                                        <p class="w-full text-sm text-muted">
                                            {submitted().query.trim() ? `For “${submitted().query}” · ` : ""}
                                            {scope(submitted().filters)}
                                        </p>
                                    </Show>
                                </div>
                                <Show when={collection()?.notice}>
                                    <p class="px-4 pb-3 text-sm text-muted sm:px-6" role="status">
                                        {collection()!.notice}
                                    </p>
                                </Show>
                                <Show when={searching() || (refreshing() && !status())}>
                                    <div
                                        class={`space-y-4 px-4 ${collection() ? "py-3" : "py-6"} sm:px-6`}
                                        role="status"
                                    >
                                        <p class="text-sm text-muted">
                                            {status() ? "Searching the collection…" : "Loading the collection…"}
                                        </p>
                                        <Show when={!collection()}>
                                            <div
                                                class="grid animate-pulse grid-cols-[104px_minmax(0,1fr)] gap-4 sm:grid-cols-[176px_minmax(0,1fr)]"
                                                aria-hidden="true"
                                            >
                                                <div class="aspect-video rounded-sm bg-surface-muted" />
                                                <div class="space-y-3">
                                                    <div class="h-4 w-4/5 rounded-sm bg-surface-muted" />
                                                    <div class="h-4 w-3/5 rounded-sm bg-surface-muted" />
                                                    <div class="h-4 w-2/5 rounded-sm bg-surface-muted" />
                                                </div>
                                            </div>
                                        </Show>
                                    </div>
                                </Show>
                                <Show when={searcherror()}>
                                    <div class="bg-danger p-4 text-danger-foreground sm:px-6" role="alert">
                                        <div class="space-y-2">
                                            <h3 class="text-base font-semibold">Search couldn't be completed</h3>
                                            <p>{searcherror()}</p>
                                            <button
                                                type="button"
                                                class="action bg-surface-muted text-foreground hover:bg-border"
                                                disabled={
                                                    !ready() ||
                                                    composing() ||
                                                    !!validation(filters().from, filters().until)
                                                }
                                                onClick={() => {
                                                    void search(
                                                        pending().page,
                                                        pending().query,
                                                        pending().filters,
                                                        true,
                                                        pending().semantic,
                                                    );
                                                }}
                                            >
                                                Retry search
                                            </button>
                                        </div>
                                    </div>
                                </Show>
                                <Show when={collection()}>
                                    {(response) => (
                                        <>
                                            <Show
                                                when={response().results.length}
                                                fallback={
                                                    <div class="space-y-2 px-4 py-6 sm:px-6">
                                                        <h3 class="text-base font-semibold">No matching metadata</h3>
                                                        <p class="max-w-prose text-sm text-muted">
                                                            Try broader keywords or fewer filters.
                                                        </p>
                                                    </div>
                                                }
                                            >
                                                <Footage
                                                    results={response().results}
                                                    selected={detail()?.video.identifier}
                                                    open={inspect}
                                                />
                                            </Show>
                                            <Show when={pages() > 1}>
                                                <Pagination.Root
                                                    class="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4 sm:px-6"
                                                    count={response().total}
                                                    pageSize={12}
                                                    page={response().page}
                                                    translations={{ rootLabel: "Result pages" }}
                                                    onPageChange={(details) => {
                                                        if (
                                                            !searching() &&
                                                            !composing() &&
                                                            textScope(query(), filters()) ===
                                                                textScope(
                                                                    submitted().query,
                                                                    submitted().filters,
                                                                    submitted().semantic,
                                                                )
                                                        ) {
                                                            void search(
                                                                details.page,
                                                                submitted().query,
                                                                submitted().filters,
                                                                false,
                                                                submitted().semantic,
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <Pagination.PrevTrigger
                                                        class="action bg-surface-muted hover:bg-border"
                                                        disabled={
                                                            response().page <= 1 ||
                                                            searching() ||
                                                            composing() ||
                                                            textScope(query(), filters()) !==
                                                                textScope(
                                                                    submitted().query,
                                                                    submitted().filters,
                                                                    submitted().semantic,
                                                                )
                                                        }
                                                    >
                                                        Previous
                                                    </Pagination.PrevTrigger>
                                                    <Pagination.Context>
                                                        {(pagination) => (
                                                            <div class="flex min-w-0 flex-wrap justify-center gap-1">
                                                                <For each={pagination().pages}>
                                                                    {(page, position) =>
                                                                        page.type === "ellipsis" ? (
                                                                            <Pagination.Ellipsis
                                                                                index={position()}
                                                                                class="flex min-h-11 items-center px-2 text-muted"
                                                                            >
                                                                                &hellip;
                                                                            </Pagination.Ellipsis>
                                                                        ) : (
                                                                            <Pagination.Item
                                                                                {...page}
                                                                                class="action min-w-11 px-3 tabular-nums hover:bg-surface-muted data-selected:bg-accent data-selected:text-accent-foreground"
                                                                                disabled={
                                                                                    searching() ||
                                                                                    composing() ||
                                                                                    textScope(query(), filters()) !==
                                                                                        textScope(
                                                                                            submitted().query,
                                                                                            submitted().filters,
                                                                                            submitted().semantic,
                                                                                        )
                                                                                }
                                                                            >
                                                                                {page.value}
                                                                            </Pagination.Item>
                                                                        )
                                                                    }
                                                                </For>
                                                            </div>
                                                        )}
                                                    </Pagination.Context>
                                                    <Pagination.NextTrigger
                                                        class="action bg-surface-muted hover:bg-border"
                                                        disabled={
                                                            response().page >= pages() ||
                                                            searching() ||
                                                            composing() ||
                                                            textScope(query(), filters()) !==
                                                                textScope(
                                                                    submitted().query,
                                                                    submitted().filters,
                                                                    submitted().semantic,
                                                                )
                                                        }
                                                    >
                                                        Next
                                                    </Pagination.NextTrigger>
                                                </Pagination.Root>
                                            </Show>
                                        </>
                                    )}
                                </Show>
                            </section>
                        </Tabs.Content>
                        <For each={["overview", "sources"] as const}>
                            {(destination) => (
                                <Tabs.Content value={destination} class="min-w-0 p-4 sm:p-6">
                                    <Collection
                                        view={destination}
                                        active={view() === destination}
                                        status={status()}
                                        failure={statuserror()}
                                        browse={browseSource}
                                        locked={locked()}
                                    />
                                </Tabs.Content>
                            )}
                        </For>
                        <Dialog.Root
                            open={chatShown()}
                            modal={mobile()}
                            trapFocus={mobile()}
                            preventScroll={mobile()}
                            restoreFocus={mobile()}
                            closeOnEscape={mobile()}
                            closeOnInteractOutside={mobile()}
                            onOpenChange={(details) => {
                                if (mobile()) {
                                    chatvisibility(details.open);
                                }
                            }}
                            initialFocusEl={() =>
                                mobile()
                                    ? (composer ?? null)
                                    : document.activeElement instanceof HTMLElement
                                      ? document.activeElement
                                      : null
                            }
                            finalFocusEl={() => chatbutton ?? null}
                            ids={{ content: "archie-panel", title: "archie-title" }}
                            aria-label="Archie conversation"
                        >
                            <Show when={mobile()}>
                                <Dialog.Backdrop class="fixed inset-0 z-40 bg-foreground/40" />
                            </Show>
                            <Dialog.Content
                                ref={(element) => {
                                    chatdialog = element;
                                }}
                                class={
                                    mobile()
                                        ? "fixed inset-0 z-50 h-dvh w-full bg-surface-raised text-foreground"
                                        : "sticky top-6 h-[calc(100dvh-48px)] min-h-0 w-full overflow-y-auto border border-border bg-surface-raised text-foreground"
                                }
                                role={mobile() ? "dialog" : "complementary"}
                                onScroll={seeReply}
                            >
                                <div class="h-full min-h-0">
                                    <Conversation
                                        entries={transcript()}
                                        status={status()}
                                        ready={ready()}
                                        available={assistance()}
                                        message={message()}
                                        query={query()}
                                        sending={sending()}
                                        newreply={newreply()}
                                        savedDraft={!!savedDraft()}
                                        clearing={clearing()}
                                        failure={chaterror()}
                                        failed={failed()}
                                        mobile={mobile()}
                                        draft={(value) => {
                                            draft(value);
                                            composer?.focus({ preventScroll: true });
                                        }}
                                        send={() => {
                                            void send();
                                        }}
                                        retry={() => {
                                            void send(failed(), true);
                                        }}
                                        edit={() => {
                                            const content = failed();
                                            saveDraft(message());
                                            conversation((items) =>
                                                items.at(-1)?.kind === "question" ? items.slice(0, -1) : items,
                                            );
                                            draft(content);
                                            failedmessage("");
                                            chatfailure("");
                                            composer?.focus({ preventScroll: true });
                                        }}
                                        browse={browse}
                                        clear={() => {
                                            void clear();
                                        }}
                                        close={closeChat}
                                        open={inspect}
                                        composer={(element) => {
                                            composer = element;
                                        }}
                                        messages={(element) => {
                                            messages = element;
                                        }}
                                        answer={(element) => {
                                            latestreply = element;
                                        }}
                                        scrolled={seeReply}
                                        bottom={scrollToReply}
                                    />
                                </div>
                            </Dialog.Content>
                        </Dialog.Root>
                    </main>
                </div>
            </Tabs.Root>
        </>
    );
}
