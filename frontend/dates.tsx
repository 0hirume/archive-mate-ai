import { DatePicker, parseDate, type DateValue } from "@ark-ui/solid/date-picker";
import { For, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

function date(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
    }

    try {
        const parsed = parseDate(value);

        return parsed.toString() === value ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function validation(from: string, until: string): string {
    if ((from && !date(from)) || (until && !date(until))) {
        return "Enter a real publication date as YYYY-MM-DD, or leave it blank.";
    }

    return from && until && from > until ? "The publication start date must be on or before the end date." : "";
}

export default function Dates(props: {
    from: string;
    until: string;
    disabled: boolean;
    change: (from: string, until: string) => void;
    composition?: (active: boolean) => void;
}) {
    let typing = false;
    onCleanup(() => props.composition?.(false));
    const [months, setMonths] = createSignal(1);

    onMount(() => {
        const available = () => setMonths((window.visualViewport?.width ?? window.innerWidth) >= 720 ? 2 : 1);
        available();
        window.addEventListener("resize", available);
        window.visualViewport?.addEventListener("resize", available);

        onCleanup(() => {
            window.removeEventListener("resize", available);
            window.visualViewport?.removeEventListener("resize", available);
        });
    });

    const compact = createMemo(() => {
        const from = date(props.from);
        const until = date(props.until);

        const format = (value: DateValue, year = true) =>
            new Intl.DateTimeFormat("en-GB", {
                day: "numeric",
                month: "short",
                ...(year ? { year: "numeric" as const } : {}),
                timeZone: "UTC",
            }).format(value.toDate("UTC"));

        if (validation(props.from, props.until)) {
            return "Published date: check dates";
        }

        if (from && until) {
            if (from.year === until.year && from.month === until.month) {
                return `${from.day}–${format(until)}`;
            }

            return `${format(from, from.year !== until.year)} – ${format(until)}`;
        }

        return from ? `From ${format(from)}` : until ? `Through ${format(until)}` : "Published date";
    });

    const problem = createMemo(() => validation(props.from, props.until));

    const value = createMemo(() => {
        const from = date(props.from);
        const until = date(props.until);

        return from ? (until && !problem() ? [from, until] : [from]) : [];
    });

    return (
        <DatePicker.Root
            class="min-w-0"
            numOfMonths={months()}
            locale="en-CA"
            selectionMode="range"
            value={value()}
            disabled={props.disabled}
            invalid={!!problem()}
            format={(value) => value.toString()}
            parse={date}
            onValueChange={(details) => {
                if (!typing) {
                    props.change(details.value[0]?.toString() ?? "", details.value[1]?.toString() ?? "");
                }
            }}
            positioning={{ placement: "bottom-end", fitViewport: true }}
        >
            <DatePicker.Control>
                <DatePicker.Trigger
                    class="action max-w-full rounded-full border border-border text-sm hover:bg-surface-muted"
                    aria-label={`Publication dates: ${compact()}`}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        class="size-4 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                    >
                        <rect x="3" y="5" width="18" height="16" rx="2" />
                        <path d="M16 3v4M8 3v4M3 11h18" />
                    </svg>
                    <span class="min-w-0 break-words">{compact()}</span>
                </DatePicker.Trigger>
            </DatePicker.Control>
            <Portal>
                <DatePicker.Positioner class="z-50">
                    <DatePicker.Content
                        class="popup max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
                        style={{ width: months() === 2 ? "44rem" : "22rem" }}
                    >
                        <For each={["day", "month", "year"] as const}>
                            {(view) => (
                                <DatePicker.View view={view}>
                                    <DatePicker.Context>
                                        {(context) => (
                                            <>
                                                <DatePicker.ViewControl class="mb-3 flex items-center justify-between gap-2">
                                                    <DatePicker.PrevTrigger
                                                        class="action hover:bg-surface-muted"
                                                        aria-label={`Previous ${view === "day" ? "month" : view === "month" ? "year" : "decade"}`}
                                                    >
                                                        <svg
                                                            aria-hidden="true"
                                                            class="size-4"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.5"
                                                        >
                                                            <path d="m15 18-6-6 6-6" />
                                                        </svg>
                                                    </DatePicker.PrevTrigger>
                                                    <DatePicker.ViewTrigger class="action flex-1 text-sm font-semibold hover:bg-surface-muted">
                                                        <DatePicker.RangeText />
                                                    </DatePicker.ViewTrigger>
                                                    <DatePicker.NextTrigger
                                                        class="action hover:bg-surface-muted"
                                                        aria-label={`Next ${view === "day" ? "month" : view === "month" ? "year" : "decade"}`}
                                                    >
                                                        <svg
                                                            aria-hidden="true"
                                                            class="size-4"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="1.5"
                                                        >
                                                            <path d="m9 18 6-6-6-6" />
                                                        </svg>
                                                    </DatePicker.NextTrigger>
                                                </DatePicker.ViewControl>
                                                <div class="flex gap-4">
                                                    <For
                                                        each={Array.from(
                                                            { length: view === "day" ? months() : 1 },
                                                            (_, index) => index,
                                                        )}
                                                    >
                                                        {(offset) => {
                                                            const calendar = () =>
                                                                context().getOffset({ months: offset });
                                                            return (
                                                                <div class="min-w-0 flex-1">
                                                                    <Show when={view === "day" && months() > 1}>
                                                                        <p class="mb-2 text-center text-sm font-semibold">
                                                                            {calendar().visibleRangeText.start}
                                                                        </p>
                                                                    </Show>
                                                                    <DatePicker.Table class="w-full border-separate border-spacing-1">
                                                                        <Show when={view === "day"}>
                                                                            <DatePicker.TableHead>
                                                                                <DatePicker.TableRow>
                                                                                    <For each={context().weekDays}>
                                                                                        {(day) => (
                                                                                            <DatePicker.TableHeader class="pb-2 text-xs font-normal text-muted">
                                                                                                {day.short}
                                                                                            </DatePicker.TableHeader>
                                                                                        )}
                                                                                    </For>
                                                                                </DatePicker.TableRow>
                                                                            </DatePicker.TableHead>
                                                                        </Show>
                                                                        <DatePicker.TableBody>
                                                                            <Show
                                                                                when={view === "day"}
                                                                                fallback={
                                                                                    <For
                                                                                        each={
                                                                                            view === "month"
                                                                                                ? context().getMonthsGrid(
                                                                                                      {
                                                                                                          columns: 4,
                                                                                                          format: "short",
                                                                                                      },
                                                                                                  )
                                                                                                : context().getYearsGrid(
                                                                                                      { columns: 4 },
                                                                                                  )
                                                                                        }
                                                                                    >
                                                                                        {(row) => (
                                                                                            <DatePicker.TableRow>
                                                                                                <For each={row}>
                                                                                                    {(cell) => (
                                                                                                        <DatePicker.TableCell
                                                                                                            value={
                                                                                                                cell.value
                                                                                                            }
                                                                                                        >
                                                                                                            <DatePicker.TableCellTrigger class="flex min-h-11 cursor-pointer items-center justify-center rounded-sm px-2 text-sm hover:bg-surface-muted data-selected:bg-accent data-selected:text-accent-foreground data-disabled:cursor-not-allowed data-disabled:opacity-40 data-in-range:bg-accent/15">
                                                                                                                {
                                                                                                                    cell.label
                                                                                                                }
                                                                                                            </DatePicker.TableCellTrigger>
                                                                                                        </DatePicker.TableCell>
                                                                                                    )}
                                                                                                </For>
                                                                                            </DatePicker.TableRow>
                                                                                        )}
                                                                                    </For>
                                                                                }
                                                                            >
                                                                                <For each={calendar().weeks}>
                                                                                    {(week) => (
                                                                                        <DatePicker.TableRow>
                                                                                            <For each={week}>
                                                                                                {(day) => (
                                                                                                    <DatePicker.TableCell
                                                                                                        value={day}
                                                                                                        visibleRange={
                                                                                                            calendar()
                                                                                                                .visibleRange
                                                                                                        }
                                                                                                    >
                                                                                                        <DatePicker.TableCellTrigger class="flex min-h-11 cursor-pointer items-center justify-center rounded-sm text-sm tabular-nums hover:bg-surface-muted data-selected:bg-accent data-selected:text-accent-foreground data-disabled:cursor-not-allowed data-disabled:opacity-40 data-in-range:bg-accent/15 data-outside-range:text-muted data-today:underline">
                                                                                                            {day.day}
                                                                                                        </DatePicker.TableCellTrigger>
                                                                                                    </DatePicker.TableCell>
                                                                                                )}
                                                                                            </For>
                                                                                        </DatePicker.TableRow>
                                                                                    )}
                                                                                </For>
                                                                            </Show>
                                                                        </DatePicker.TableBody>
                                                                    </DatePicker.Table>
                                                                </div>
                                                            );
                                                        }}
                                                    </For>
                                                </div>
                                            </>
                                        )}
                                    </DatePicker.Context>
                                </DatePicker.View>
                            )}
                        </For>
                        <div class="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                            <label class="grid min-w-0 gap-2 text-sm" for="research-from">
                                <span>Published from</span>
                                <DatePicker.Input
                                    index={0}
                                    fixOnBlur={false}
                                    class="field min-h-11 w-full min-w-0 text-sm"
                                    id="research-from"
                                    type="text"
                                    inputmode="numeric"
                                    placeholder="YYYY-MM-DD"
                                    maxlength={10}
                                    value={props.from}
                                    disabled={props.disabled}
                                    aria-invalid={!!problem()}
                                    aria-describedby="date-help"
                                    onInput={(event) => {
                                        typing = true;
                                        props.change(event.currentTarget.value, props.until);
                                        queueMicrotask(() => {
                                            typing = false;
                                        });
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                        }
                                    }}
                                    onCompositionStart={() => props.composition?.(true)}
                                    onCompositionEnd={(event) => {
                                        props.change(event.currentTarget.value, props.until);
                                        props.composition?.(false);
                                    }}
                                />
                            </label>
                            <label class="grid min-w-0 gap-2 text-sm" for="research-until">
                                <span>Published through</span>
                                <DatePicker.Input
                                    index={1}
                                    fixOnBlur={false}
                                    class="field min-h-11 w-full min-w-0 text-sm"
                                    id="research-until"
                                    type="text"
                                    inputmode="numeric"
                                    placeholder="YYYY-MM-DD"
                                    maxlength={10}
                                    value={props.until}
                                    disabled={props.disabled}
                                    aria-invalid={!!problem()}
                                    aria-describedby="date-help"
                                    onInput={(event) => {
                                        typing = true;
                                        props.change(props.from, event.currentTarget.value);
                                        queueMicrotask(() => {
                                            typing = false;
                                        });
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                        }
                                    }}
                                    onCompositionStart={() => props.composition?.(true)}
                                    onCompositionEnd={(event) => {
                                        props.change(props.from, event.currentTarget.value);
                                        props.composition?.(false);
                                    }}
                                />
                            </label>
                        </div>
                        <div class="mt-3 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                class="action text-sm hover:bg-surface-muted"
                                disabled={props.disabled || (!props.from && !props.until)}
                                onClick={() => props.change("", "")}
                            >
                                Clear dates
                            </button>
                            <p
                                id="date-help"
                                class={`text-sm ${problem() ? "text-danger" : "text-muted"}`}
                                aria-live="polite"
                            >
                                {problem() ||
                                    (props.from || props.until
                                        ? "Excludes undated videos. Leave either endpoint blank for an open-ended range."
                                        : "Leave either endpoint blank for an open-ended range.")}
                            </p>
                        </div>
                    </DatePicker.Content>
                </DatePicker.Positioner>
            </Portal>
        </DatePicker.Root>
    );
}
