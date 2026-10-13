import { Field } from "@ark-ui/solid/field";
import { For, Show } from "solid-js";

import type { ChatResponse, Result, Status } from "../shared/metadata";

import composition from "./composition";
import { numbers } from "./footage";

export type Transcript = { kind: "question"; message: string } | { kind: "answer"; response: ChatResponse };

export default function Conversation(props: {
    entries: Transcript[];
    status?: Status;
    ready: boolean;
    available: boolean;
    message: string;
    query: string;
    sending: boolean;
    newreply: boolean;
    savedDraft: boolean;
    clearing: boolean;
    failure: string;
    failed: string;
    mobile: boolean;
    draft: (value: string) => void;
    send: () => void;
    retry: () => void;
    edit: () => void;
    browse: (text: string) => void;
    clear: () => void;
    close: () => void;
    open: (result: Result) => void;
    composer: (element: HTMLTextAreaElement) => void;
    messages: (element: HTMLDivElement) => void;
    answer: (element: HTMLElement) => void;
    scrolled: () => void;
    bottom: () => void;
}) {
    const messageComposition = composition();

    return (
        <section class="flex h-full min-h-0 min-w-0 flex-col bg-surface-raised" aria-label="Conversation with Archie">
            <header class="flex flex-wrap items-start justify-between gap-2 border-b border-border p-4">
                <div>
                    <h2 id="archie-title" class="text-xl font-semibold">
                        Archie
                    </h2>
                    <p class="mt-1 text-sm text-muted">
                        {props.clearing
                            ? "Clearing conversation"
                            : props.available
                              ? "Research assistant"
                              : "Currently unavailable"}
                    </p>
                </div>
                <div class="flex items-center gap-1">
                    <button
                        type="button"
                        class="action px-2 text-sm hover:bg-surface-muted"
                        disabled={
                            props.sending ||
                            props.clearing ||
                            (!props.entries.length && !props.failure && !props.message)
                        }
                        onClick={props.clear}
                    >
                        New chat
                    </button>
                    <Show when={props.mobile}>
                        <button
                            type="button"
                            class="action px-2 hover:bg-surface-muted"
                            onClick={props.close}
                            aria-label="Close Archie conversation"
                        >
                            Close
                        </button>
                    </Show>
                </div>
            </header>
            <div
                class="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4"
                ref={props.messages}
                onScroll={props.scrolled}
                role="log"
                aria-label="Conversation messages"
                aria-live="polite"
                aria-relevant="additions"
                tabindex="0"
            >
                <Show when={!props.available}>
                    <div class="space-y-2 text-sm" role="status">
                        <p>
                            {!props.status
                                ? "Checking collection and assistant availability…"
                                : !props.ready
                                  ? "Archie needs a working collection. Resolve the collection error, then try again."
                                  : "Archie is unavailable. You can still search the collection."}
                        </p>
                    </div>
                </Show>
                <Show when={props.available && !props.entries.length}>
                    <div class="flex flex-col items-start px-2">
                        <div class="mb-1 text-sm">Archie</div>
                        <p class="message-bubble max-w-full bg-surface-muted text-foreground" data-speaker="archie">
                            What's your lead?
                        </p>
                    </div>
                </Show>
                <For each={props.entries}>
                    {(entry) =>
                        entry.kind === "question" ? (
                            <div class="message-entry flex flex-col items-end px-2">
                                <div class="mb-1 text-sm">You</div>
                                <p
                                    class="message-bubble max-w-[92%] bg-conversation whitespace-pre-wrap text-conversation-foreground"
                                    data-speaker="you"
                                >
                                    {entry.message}
                                </p>
                            </div>
                        ) : (
                            <article class="message-entry space-y-2" ref={props.answer}>
                                <div class="flex flex-col items-start px-2">
                                    <div class="mb-2 text-sm font-semibold">Archie</div>
                                    <p
                                        class="message-bubble max-w-full bg-surface-muted whitespace-pre-wrap text-foreground"
                                        data-speaker="archie"
                                    >
                                        {entry.response.message}
                                    </p>
                                </div>
                                <Show when={entry.response.results.length}>
                                    <ol class="divide-y divide-border">
                                        <For each={entry.response.results}>
                                            {(result, index) => (
                                                <li>
                                                    <button
                                                        type="button"
                                                        class="flex min-h-11 w-full items-start gap-3 rounded-sm px-2 py-3 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                                                        onClick={() => props.open(result)}
                                                        aria-label={`Inspect suggested source: ${result.video.title || "Title not supplied"}`}
                                                    >
                                                        <span class="shrink-0 text-sm tabular-nums text-muted">
                                                            {index() + 1}.
                                                        </span>
                                                        <span class="min-w-0 break-words text-sm font-medium underline decoration-border underline-offset-4">
                                                            {result.video.title || "Title not supplied"}
                                                        </span>
                                                    </button>
                                                </li>
                                            )}
                                        </For>
                                    </ol>
                                </Show>
                                <p class="text-sm text-muted">
                                    {entry.response.results.length} sources suggested ·{" "}
                                    {numbers.format(entry.response.total)} metadata matches
                                </p>
                            </article>
                        )
                    }
                </For>
                <Show when={props.sending}>
                    <div class="flex flex-col items-start px-2" role="status">
                        <div class="mb-1 text-sm">Archie</div>
                        <p
                            class="message-bubble flex items-center gap-2 bg-surface-muted text-foreground"
                            data-speaker="archie"
                        >
                            <span class="sr-only">Archie is responding</span>
                            <span class="typing inline-flex gap-1" aria-hidden="true">
                                <span class="size-1 rounded-full bg-current" />
                                <span class="size-1 rounded-full bg-current" />
                                <span class="size-1 rounded-full bg-current" />
                            </span>
                        </p>
                    </div>
                </Show>
                <Show when={props.clearing}>
                    <p class="text-sm text-muted" role="status">
                        Starting a new conversation…
                    </p>
                </Show>
                <Show when={props.failure}>
                    <div class="space-y-2 rounded-sm border border-danger p-3 text-sm" role="alert">
                        <p class="font-medium">
                            {props.failed ? "Message wasn't answered" : "Conversation needs attention"}
                        </p>
                        <p>{props.failure}</p>
                        <Show when={props.failed}>
                            <div class="flex flex-wrap gap-1">
                                <button
                                    type="button"
                                    class="action px-2 text-sm hover:bg-surface-muted"
                                    disabled={!props.available || props.sending || props.clearing}
                                    onClick={props.retry}
                                >
                                    Retry
                                </button>
                                <button
                                    type="button"
                                    class="action px-2 text-sm hover:bg-surface-muted"
                                    disabled={!props.available || props.sending || props.clearing}
                                    onClick={props.edit}
                                >
                                    Edit message
                                </button>
                                <button
                                    type="button"
                                    class="action px-2 text-sm hover:bg-surface-muted"
                                    disabled={!props.ready || props.sending || props.clearing}
                                    onClick={() => props.browse(props.failed)}
                                >
                                    Search directly
                                </button>
                            </div>
                        </Show>
                    </div>
                </Show>
            </div>
            <Show when={props.newreply}>
                <div class="flex shrink-0 justify-center px-4 py-2">
                    <button type="button" class="action gap-2 text-sm hover:bg-surface-muted" onClick={props.bottom}>
                        New reply
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            aria-hidden="true"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m-6-6 6 6 6-6" />
                        </svg>
                    </button>
                </div>
            </Show>
            <form
                class="shrink-0 space-y-2 border-t border-border p-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!messageComposition.blocked()) {
                        props.send();
                    }
                }}
            >
                <div class="flex flex-wrap gap-2" aria-label="Suggested prompts">
                    <For
                        each={[
                            {
                                label: props.query.trim() ? "Use current search" : "Find a research lead",
                                prompt:
                                    props.query.trim() ||
                                    "Find sources with titles or descriptions mentioning [topic].",
                            },
                            {
                                label: "Compare coverage",
                                prompt: `Compare the titles and descriptions of sources about ${props.query.trim() || "[topic]"}.`.slice(
                                    0,
                                    2000,
                                ),
                            },
                            {
                                label: "Build a timeline",
                                prompt: `Find dated sources about ${props.query.trim() || "[topic]"} and organize them by publication date.`.slice(
                                    0,
                                    2000,
                                ),
                            },
                            {
                                label: "Explore related sources",
                                prompt: `Suggest related sources to research ${props.query.trim() || "[topic]"}, using the available metadata.`.slice(
                                    0,
                                    2000,
                                ),
                            },
                        ]}
                    >
                        {(suggestion) => (
                            <button
                                type="button"
                                class="action rounded-full border border-border px-3 text-sm hover:bg-surface-muted"
                                disabled={!props.available || props.sending || props.clearing}
                                onClick={() => props.draft(suggestion.prompt.slice(0, 2000))}
                            >
                                {suggestion.label}
                            </button>
                        )}
                    </For>
                </div>
                <Field.Root
                    id="archie-message"
                    class="space-y-2"
                    disabled={!props.available || props.clearing}
                    ids={{ helperText: "archie-composer-help" }}
                >
                    <Field.Label class="sr-only">Message Archie</Field.Label>
                    <div class="composer flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2 focus-within:outline-2 focus-within:outline-accent">
                        <Field.Textarea
                            class="max-h-40 min-h-12 w-full min-w-0 flex-1 resize-none rounded-xl bg-transparent px-3 py-2 text-base focus-visible:outline-none disabled:opacity-50"
                            ref={props.composer}
                            placeholder="Message Archie…"
                            value={props.message}
                            maxlength={2000}
                            rows={1}
                            disabled={!props.available || props.clearing}
                            onInput={(event) => props.draft(event.currentTarget.value)}
                            onCompositionStart={() => messageComposition.start()}
                            onCompositionEnd={(event) => {
                                props.draft(event.currentTarget.value);
                                messageComposition.end();
                            }}
                            onKeyUp={() => messageComposition.release()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    if (!messageComposition.blocked(event)) {
                                        props.send();
                                    }
                                }
                            }}
                        />
                        <button
                            type="submit"
                            class="send-action action min-h-12 shrink-0 rounded-full bg-conversation text-conversation-foreground hover:bg-conversation/90"
                            disabled={!props.available || props.sending || props.clearing || !props.message.trim()}
                        >
                            Send
                            <svg
                                class="size-4"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M4 12h16m-6-6 6 6-6 6" />
                            </svg>
                        </button>
                    </div>
                    <Field.HelperText class="block text-right text-sm text-muted">
                        <Show when={props.savedDraft}>
                            <span class="mr-2">Next draft returns after sending this edit.</span>
                        </Show>
                        <span class="tabular-nums">{props.message.length} / 2,000</span>
                    </Field.HelperText>
                </Field.Root>
            </form>
        </section>
    );
}
