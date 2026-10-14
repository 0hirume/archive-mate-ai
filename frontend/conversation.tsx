import { Avatar } from "@ark-ui/solid/avatar";
import { ark } from "@ark-ui/solid/factory";
import { Field } from "@ark-ui/solid/field";
import { For, Show, createEffect, createSignal, on } from "solid-js";

import type { ChatResponse, Result, Status } from "../shared/metadata";

import happy from "./assets/archie-happy.png";
import thinking from "./assets/archie-thinking.png";
import composition from "./composition";
import { numbers } from "./footage";
import glass from "./glass";

const greetings = [
    "Hey, I’m Archie! Glad you’re here. What are we exploring?",
    "Hi, I’m Archie! Got a spark of an idea? Let’s follow it.",
    "Welcome! I’m Archie. Bring your curiosity. We’ll find a starting point together.",
    "Hey there! I’m Archie. What’s caught your curiosity today?",
    "Hi, I’m Archie! Tell me what you’re working on. I’d love to help.",
    "Archie here! Your questions are welcome. What’s on your mind?",
    "Hi! I’m Archie. Pick something you’re curious about, and let’s explore.",
    "Hey, I’m Archie! Have a story in mind? Let’s give it a starting point.",
    "Welcome in! I’m Archie. Got a lead? Let’s see where it takes us.",
    "I’m Archie, happy to help! Where would you like to begin?",
    "Hey, I’m Archie! Let’s make a little headway on your research.",
    "Hi, I’m Archie! A name, a place, a topic. Any of those is a lovely start.",
    "Welcome to the archive! I’m Archie. What brought you our way?",
    "Hey there, I’m Archie! Looking for something? Let’s have a look together.",
    "Hi, I’m Archie! Just browsing? There’s room for curiosity here.",
    "Archie here! Tell me what you’re curious about, and we’ll take it from there.",
    "Hello! I’m Archie. Ready to explore a question together?",
    "Hey, I’m Archie! Ideas still taking shape are welcome. What’s yours?",
    "Hi, I’m Archie! Let’s follow your curiosity and see where it leads.",
    "Archie here! What’s the question you’ve been itching to explore?",
    "Hi, I’m Archie! Happy to be your guide. Where shall we start?",
    "Hey there! I’m Archie. Bring whatever’s on your mind.",
    "Welcome! I’m Archie. Let’s ease into it. What’s your topic?",
    "Hi, I’m Archie! Working on a story? I’d be happy to help you research it.",
    "Hello, I’m Archie! Let’s find our way around the archive together.",
    "Hey, I’m Archie! Got pieces of a story? Let’s start putting them together.",
    "Archie here! A little thread can be a great start. Got one in mind?",
    "Hi, I’m Archie! Your idea doesn’t need to be polished. Let’s start with it.",
    "Hey there! I’m Archie. What would you love to learn more about?",
    "Hi, I’m Archie! Tell me a little about your idea. I’m listening.",
    "Welcome! I’m Archie, your archive guide. You choose the direction.",
    "Archie here! Something caught your eye? Let’s take a closer look.",
    "Hey, I’m Archie! Big research questions are welcome here.",
    "Hi, I’m Archie! A story taking shape? Let’s explore the leads together.",
    "Hello! I’m Archie. Looking for a missing piece? I’ll help you search.",
    "Archie here! Let’s give your question a little room to wander.",
    "Hi, I’m Archie! Starting fresh is a good place to be. What interests you?",
    "Hey, I’m Archie! What’s got you wondering today?",
    "Welcome! I’m Archie. One little question is all we need to get started.",
    "Hi! I’m Archie. Let’s see where your curiosity takes us today.",
    "Archie here! Fancy a different angle? Let’s explore one together.",
    "Hey, I’m Archie! Tell me what you know, and we’ll build from there.",
    "Hi, I’m Archie! Got a name in mind? Let’s look it up together.",
    "Hello! I’m Archie. Have a date you’re curious about? Let’s start there.",
    "Welcome in! I’m Archie. Happy to join you on your next research step.",
    "Archie here! Rough ideas are a great starting point. Tell me yours.",
    "Hi, I’m Archie! Big questions or tiny details, I’m here to help with either.",
    "Hey there! I’m Archie. Let’s untangle your question one piece at a time.",
    "Hi, I’m Archie! Let’s get your research rolling. What’s the topic?",
    "Archie here! Which part of the story has you curious?",
    "Hello, I’m Archie! Need a starting lead? Let’s look for one together.",
    "Hey, I’m Archie! Tell me what you’re hoping to find.",
    "Hi, I’m Archie! Want a hand comparing a few sources?",
    "Welcome! I’m Archie. Let’s make your next research step a little easier.",
    "Archie here! Bring a question, and let’s explore what the archive offers.",
    "Hey, I’m Archie! Got a place in mind? Let’s make it our starting point.",
    "Hi, I’m Archie! That detail you keep wondering about? Let’s look into it.",
    "Welcome! I’m Archie. A little curiosity goes a long way. Let’s start there.",
    "Archie here! Happy to help you find your bearings. Where are we headed?",
    "Hi, I’m Archie! Glad you stopped by. Let’s explore an idea together.",
];

const starters = [
    { label: "Find a starting point", prompt: "Help me find a starting point for researching [topic]." },
    { label: "Compare coverage", prompt: "How do the source titles and descriptions differ on [topic]?" },
    { label: "Trace a timeline", prompt: "Help me trace [topic] through sources ordered by publication date." },
    { label: "Find another angle", prompt: "What other research angles do the available records suggest for [topic]?" },
    { label: "Explore related stories", prompt: "Find related sources worth exploring about [topic]." },
    {
        label: "Give me a shortlist",
        prompt: "Give me a short list of promising sources about [topic] and why each might help.",
    },
    {
        label: "Start with the basics",
        prompt: "I’m new to [topic]. Which source descriptions offer a useful starting point?",
    },
    {
        label: "Follow a thread",
        prompt: "Pick a recurring detail in the records about [topic] that I could research further.",
    },
    {
        label: "Make it manageable",
        prompt: "Help me narrow [topic] to one manageable research question using the available records.",
    },
    {
        label: "Take a closer look",
        prompt: "Which record about [topic] deserves a closer look, and what in its description stands out?",
    },
    {
        label: "Look further back",
        prompt: "Which of the available dated sources about [topic] were published earliest?",
    },
    {
        label: "Look at later coverage",
        prompt: "Which of the available dated sources about [topic] were published most recently?",
    },
    {
        label: "Compare two periods",
        prompt: "Do the records about [topic] span different publication periods? Help me compare two.",
    },
    {
        label: "Spot date clusters",
        prompt: "Are there clusters of publication dates in the available sources about [topic]?",
    },
    {
        label: "Separate the dates",
        prompt: "For [topic], distinguish publication dates from any event dates explicitly mentioned in descriptions.",
    },
    {
        label: "Check the sequence",
        prompt: "Put the dated records about [topic] in publication order and flag any unknown dates.",
    },
    {
        label: "Find a dated lead",
        prompt: "Find a source about [topic] with a known publication date that could anchor my research.",
    },
    {
        label: "Look across years",
        prompt: "Which publication years appear in the retrieved records about [topic], and what do their descriptions focus on?",
    },
    {
        label: "Read the retrospectives",
        prompt: "Do any titles or descriptions about [topic] explicitly identify retrospective coverage?",
    },
    {
        label: "Mark the gaps",
        prompt: "Where are the publication-date gaps in this set of sources about [topic]? Keep that separate from gaps in actual coverage.",
    },
    {
        label: "Compare two sources",
        prompt: "Choose two promising sources about [topic] and compare their available descriptions.",
    },
    { label: "Find common ground", prompt: "What details recur across the source descriptions about [topic]?" },
    {
        label: "Spot different emphases",
        prompt: "What different aspects of [topic] do the source descriptions emphasize?",
    },
    { label: "Compare the titles", prompt: "How do the available titles frame [topic] differently?" },
    {
        label: "Compare source categories",
        prompt: "How do descriptions about [topic] differ across the available source categories?",
    },
    {
        label: "Pair two leads",
        prompt: "Suggest two sources about [topic] whose descriptions could complement each other.",
    },
    {
        label: "Check for overlap",
        prompt: "Which records about [topic] appear to cover similar ground based on their titles and descriptions?",
    },
    {
        label: "Find a contrast",
        prompt: "Find two descriptions about [topic] with a clear difference in focus, without inferring the videos’ viewpoints.",
    },
    {
        label: "Compare the detail",
        prompt: "Which records about [topic] have detailed descriptions, and which give us little to work with?",
    },
    {
        label: "Weigh the leads",
        prompt: "Compare the strongest leads about [topic] by how directly their supplied metadata supports a match.",
    },
    {
        label: "Follow a name",
        prompt: "Which people are explicitly named in the records about [topic], and which sources mention them?",
    },
    {
        label: "Map the place names",
        prompt: "List the places explicitly named in the records about [topic], with their sources.",
    },
    {
        label: "Look at organizations",
        prompt: "Which organizations are mentioned in the available descriptions about [topic]?",
    },
    {
        label: "Find a local angle",
        prompt: "Do the descriptions about [topic] name a specific community or locality I could focus on?",
    },
    {
        label: "Broaden the geography",
        prompt: "Do the records about [topic] mention different locations worth researching separately?",
    },
    {
        label: "Connect named details",
        prompt: "Which names or places recur across records about [topic]? Show only connections supported by the text.",
    },
    {
        label: "Find a named event",
        prompt: "Are any specific events named in the titles or descriptions about [topic]?",
    },
    {
        label: "Look for interviews",
        prompt: "Do any records about [topic] explicitly describe an interview? Identify only what the metadata says.",
    },
    {
        label: "Look for public statements",
        prompt: "Do any descriptions about [topic] explicitly mention a speech or public statement?",
    },
    {
        label: "Try a place-led search",
        prompt: "Suggest a place name from the records about [topic] that could make a useful follow-up search.",
    },
    {
        label: "Find useful keywords",
        prompt: "Suggest useful follow-up keywords drawn from the titles and descriptions about [topic].",
    },
    {
        label: "Try another phrase",
        prompt: "What wording in the source descriptions could help me search for [topic] another way?",
    },
    {
        label: "Find an exact mention",
        prompt: "Which available records explicitly mention [topic] in their titles or descriptions?",
    },
    {
        label: "Look beyond the title",
        prompt: "Which descriptions mention [topic] even when the title gives little indication?",
    },
    {
        label: "Pull a useful excerpt",
        prompt: "Show a short exact excerpt from a source description that makes it relevant to [topic].",
    },
    {
        label: "Untangle a term",
        prompt: "Do the records use [topic] in different contexts? Explain those contexts using the supplied text.",
    },
    {
        label: "Spot recurring phrases",
        prompt: "Which meaningful phrases recur in the available descriptions about [topic]?",
    },
    {
        label: "Follow the description",
        prompt: "Choose a specific detail from a description about [topic] and suggest a follow-up search.",
    },
    {
        label: "Check name variations",
        prompt: "Do the records about [topic] contain apparent variations of a name? Flag uncertainty rather than assuming they are equivalent.",
    },
    {
        label: "Refine my wording",
        prompt: "Help me turn [topic] into a more precise search using terms found in the available records.",
    },
    { label: "Narrow the focus", prompt: "Suggest a narrower focus for [topic] supported by the source descriptions." },
    {
        label: "Widen the search",
        prompt: "Suggest a broader search related to [topic], using categories or terms in the available records.",
    },
    {
        label: "Split the question",
        prompt: "Break [topic] into a few distinct research questions suggested by the records.",
    },
    {
        label: "Choose a date range",
        prompt: "Based on the available publication dates for [topic], suggest a date range to explore first.",
    },
    {
        label: "Choose a source category",
        prompt: "Which available source category looks useful for researching [topic], and why?",
    },
    {
        label: "Find the direct matches",
        prompt: "Separate direct mentions of [topic] from records that are only loosely related.",
    },
    {
        label: "Keep it focused",
        prompt: "Give me only the clearest metadata-supported leads for [topic]. A short list is fine.",
    },
    {
        label: "Explore one subtopic",
        prompt: "Pick a subtopic explicitly mentioned in the records about [topic] and suggest where to start.",
    },
    {
        label: "Look for context",
        prompt: "Which descriptions offer useful background context for researching [topic]?",
    },
    {
        label: "Find a specific detail",
        prompt: "What concrete detail in the records about [topic] could turn a broad search into a specific one?",
    },
    { label: "What’s uncertain?", prompt: "What remains uncertain about the relevance of these sources to [topic]?" },
    {
        label: "Check the evidence",
        prompt: "For the best leads about [topic], show the exact source text supporting each recommendation.",
    },
    {
        label: "Flag thin descriptions",
        prompt: "Which records about [topic] have too little descriptive information to judge confidently?",
    },
    {
        label: "Separate fact from inference",
        prompt: "For [topic], separate what the records explicitly state from possible research interpretations.",
    },
    {
        label: "Explain a weak match",
        prompt: "If any retrieved source is only a weak match for [topic], explain why rather than stretching the connection.",
    },
    {
        label: "What needs checking?",
        prompt: "What should I verify in the original videos before using these sources for research on [topic]?",
    },
    {
        label: "Check missing dates",
        prompt: "Which candidate sources about [topic] lack publication dates, and how does that limit a timeline?",
    },
    {
        label: "Keep the caveats clear",
        prompt: "Summarize the main limitations of the available records about [topic] in plain language.",
    },
    {
        label: "Question the shortlist",
        prompt: "What are the reasons to be cautious about each shortlisted source on [topic]?",
    },
    {
        label: "Know what we can say",
        prompt: "What can we responsibly say about these candidate sources on [topic] from their metadata alone?",
    },
    {
        label: "Plan the next step",
        prompt: "Based on the available records about [topic], what is one useful next research step?",
    },
    {
        label: "Make a research checklist",
        prompt: "Make a short checklist for evaluating the candidate sources about [topic].",
    },
    {
        label: "Draft three questions",
        prompt: "Suggest three research questions prompted by the source descriptions about [topic].",
    },
    {
        label: "Build a source list",
        prompt: "Put together a concise candidate source list for [topic], with a reason to inspect each.",
    },
    {
        label: "Organize the leads",
        prompt: "Group the available leads about [topic] by the themes explicitly present in their descriptions.",
    },
    {
        label: "Find a follow-up search",
        prompt: "What specific search should I try next for [topic], based on the records we have?",
    },
    {
        label: "Prepare to watch",
        prompt: "What questions should I keep in mind when watching candidate videos about [topic]? Don’t assume what they contain.",
    },
    {
        label: "Make a quick brief",
        prompt: "Give me a brief overview of the available candidate sources about [topic], with their main limitations.",
    },
    {
        label: "Choose what to inspect",
        prompt: "Which candidate source about [topic] would you suggest I inspect first, based on its metadata?",
    },
    {
        label: "Leave a research trail",
        prompt: "Summarize the most useful leads about [topic] and the follow-up questions their descriptions raise.",
    },
];

function welcome() {
    const suggestions = [...starters];

    for (let index = suggestions.length - 1; index > 0; index--) {
        const selected = Math.floor(Math.random() * (index + 1));
        [suggestions[index], suggestions[selected]] = [suggestions[selected]!, suggestions[index]!];
    }

    return {
        greeting: greetings[Math.floor(Math.random() * greetings.length)],
        suggestions: suggestions.slice(0, 3),
    };
}

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
    const [introduction, introduce] = createSignal(welcome());

    createEffect(
        on(
            () => props.clearing,
            (clearing, previous) => {
                if (previous && !clearing && !props.entries.length) {
                    introduce(welcome());
                }
            },
        ),
    );

    return (
        <section class="flex h-full min-h-0 min-w-0 flex-col bg-surface-raised" aria-label="Conversation with Archie">
            <header class="flex flex-wrap items-start justify-between gap-2 border-b border-border p-4">
                <div class="flex items-center gap-3">
                    <Show when={introduction()} keyed>
                        {(_introduction) => (
                            <ark.div
                                class="mascot relative size-10 shrink-0 sm:size-12"
                                data-thinking={props.sending}
                                aria-hidden="true"
                            >
                                <Avatar.Root class="contents">
                                    <Avatar.Image
                                        class="mascot-default absolute inset-0 size-full object-contain"
                                        src={happy}
                                        alt=""
                                        width="48"
                                        height="48"
                                        draggable={false}
                                    />
                                </Avatar.Root>
                                <Avatar.Root class="contents">
                                    <Avatar.Image
                                        class="mascot-thinking absolute inset-0 size-full object-contain"
                                        src={thinking}
                                        alt=""
                                        width="48"
                                        height="48"
                                        draggable={false}
                                    />
                                </Avatar.Root>
                            </ark.div>
                        )}
                    </Show>
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
                                : props.status.catalog === "restoring"
                                  ? "Archie is waiting for the archive to finish restoring."
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
                            {introduction().greeting}
                        </p>
                        <Avatar.Root class="mt-3 block size-24" aria-hidden="true">
                            <Avatar.Image
                                class="size-full object-contain"
                                src={happy}
                                alt=""
                                width="96"
                                height="96"
                                draggable={false}
                            />
                        </Avatar.Root>
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
                    <button
                        type="button"
                        class="action gap-2 text-sm hover:bg-surface-muted"
                        onClick={props.bottom}
                    >
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
                        each={
                            props.query.trim()
                                ? [
                                      { label: "Use current search", prompt: props.query.trim() },
                                      ...introduction()
                                          .suggestions.slice(0, 2)
                                          .map((suggestion) => ({
                                              label: suggestion.label,
                                              prompt: suggestion.prompt.replace("[topic]", () => props.query.trim()),
                                          })),
                                  ]
                                : introduction().suggestions
                        }
                    >
                        {(suggestion) => (
                            <button
                                type="button"
                                ref={glass}
                                class="glass ps-glass action rounded-full border border-border px-3 text-sm"
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
                            ref={glass}
                            class="glass ps-glass send-action action min-h-12 shrink-0 rounded-full text-foreground"
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
