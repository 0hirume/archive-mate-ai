import { createHash } from "node:crypto";

import type { Video } from "../shared/metadata.ts";
import type { Tokenizer } from "./model.ts";

export const preparationRevision = 2;

const promotionalTags: Record<string, true> = Object.fromEntries(
    "#abscbnnews #latestnews #tvpatrol #anc #ancnews #teleradyo #anclive #kapamilya"
        .split(" ")
        .map((tag) => [tag, true]),
);

export interface Passage {
    field: "title" | "description";
    start: number;
    finish: number;
    excerpt: string;
    fingerprint: string;
    content: string;
}

export type Evidence = Pick<Passage, "field" | "start" | "finish" | "excerpt">;

export function fingerprint(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function sourceFingerprint(video: Pick<Video, "title" | "description" | "memberships">): string {
    const categories = [...new Set(video.memberships.map((membership) => membership.category))].sort();

    return fingerprint(JSON.stringify([preparationRevision, video.title, video.description, categories]));
}

function promotional(value: string): boolean {
    return (
        /^(?:subscribe(?:\s+(?:now|to|for))?|please subscribe|like(?:,|\s+and)\s*(?:share|subscribe)|follow\s+(?:us|our)|visit\s+(?:us|our|https?:\/\/|www\.)|watch\s+(?:more|our videos|(?:the\s+)?full episodes)|download\s+(?:the|our)\s+app|connect\s+with\s+us|for\s+business\s+(?:inquiries|enquiries)|all rights reserved|copyright\s*[©\d]|mag-subscribe|mag subscribe|i-follow\s+(?:kami|ang)|sundan\s+(?:kami|ang aming)|stay updated by visiting|get access to the latest and breaking news from)\b/iu.test(
            value,
        ) ||
        /^(?:for more|to watch|check out).*(?:click the link|videos.*link|episodes.*link)/iu.test(value) ||
        /^catch up with the latest news on\s*:/iu.test(value) ||
        /^TV Patrol is the (?:flagship|primetime) newscast of ABS-CBN\./u.test(value) ||
        /^(?:https?:\/\/\S+|www\.\S+|(?:facebook|instagram|twitter|tiktok|youtube)\s*:\s*https?:\/\/\S+)$/iu.test(
            value,
        ) ||
        value
            .toLocaleLowerCase("en")
            .split(/\s+/)
            .every((tag) => promotionalTags[tag])
    );
}

export function preparePassages(
    video: Pick<Video, "title" | "description" | "memberships">,
    tokenizer?: Tokenizer,
): Passage[] {
    const passages: Passage[] = [];
    const categories = [...new Set(video.memberships.map((membership) => membership.category))].sort();
    const context = categories.length ? `\nSource categories: ${categories.join("; ")}` : "";
    let title = video.title;

    while (tokenizer && tokenizer.encode(title).length > 128) {
        title = title.slice(0, Math.floor(title.length / 2));

        if (/[\uD800-\uDBFF]$/u.test(title)) {
            title = title.slice(0, -1);
        }
    }

    function append(field: Passage["field"], beginning: number, finish: number): void {
        const original = video[field];
        const prefix = `passage: ${field === "description" && title ? `Title: ${title}\n` : ""}`;
        let start = beginning;

        while (start < finish) {
            let end = Math.min(start + 1800, finish);

            if (tokenizer && tokenizer.encode(`${prefix}${original.slice(start, end)}${context}`).length > 512) {
                let lower = start + 1;
                let upper = end;
                end = start;

                while (lower <= upper) {
                    const middle = Math.floor((lower + upper) / 2);

                    if (tokenizer.encode(`${prefix}${original.slice(start, middle)}${context}`).length <= 512) {
                        end = middle;
                        lower = middle + 1;
                    } else {
                        upper = middle - 1;
                    }
                }

                if (end === start) {
                    throw new Error("Source context exceeds the local embedding token budget.");
                }
            }

            if (end < finish) {
                const boundary = original.lastIndexOf(" ", end);

                if (boundary > start + (end - start) / 2) {
                    end = boundary;
                }

                if (/^[\uDC00-\uDFFF]$/.test(original[end] || "")) {
                    end--;
                }
            }

            let excerpt = original.slice(start, end);
            let content = `${prefix}${excerpt}${context}`;

            while (tokenizer && tokenizer.encode(content).length > 512 && end > start) {
                end--;

                if (/^[\uDC00-\uDFFF]$/.test(original[end] || "")) {
                    end--;
                }

                excerpt = original.slice(start, end);
                content = `${prefix}${excerpt}${context}`;
            }

            if (end <= start) {
                throw new Error("Cannot prepare an intact source passage within the local token budget.");
            }

            if (excerpt.trim()) {
                passages.push({ field, start, finish: end, excerpt, content, fingerprint: fingerprint(content) });
            }

            if (end === finish) {
                break;
            }

            let next = Math.max(start + 1, end - Math.min(200, Math.floor((end - start) / 5)));
            const boundary = original.indexOf(" ", next);

            if (boundary >= next && boundary < end) {
                next = boundary + 1;
            }

            if (/^[\uDC00-\uDFFF]$/.test(original[next] || "")) {
                next++;
            }

            start = next;
        }
    }

    append("title", 0, video.title.length);
    const description = video.description;
    let beginning: number | null = null;
    let finish = 0;

    function flush(): void {
        if (beginning === null) {
            return;
        }

        append("description", beginning, finish);
        beginning = null;
    }

    for (const match of description.matchAll(/[^\r\n]+/g)) {
        const line = match[0];
        const trimmed = line.trim();

        if (!trimmed || promotional(trimmed)) {
            flush();
            continue;
        }

        if (beginning === null) {
            beginning = match.index + line.indexOf(trimmed);
        }

        finish = match.index + line.lastIndexOf(trimmed) + trimmed.length;
    }

    flush();

    return passages;
}
