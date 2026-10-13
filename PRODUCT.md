# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Newsroom researchers working from a specific lead: a person, event, date, or remembered phrase.

## Product Purpose

Find candidate broadcast footage, compare sources, and verify the original video. Success is reaching a relevant, checkable source without losing the research context.

## Operating Context

Direct retrieval leads the workflow. The assistant helps refine a lead through conversation alongside the matching footage. It must read and behave as a chatbot, not as a form or a separate search screen.

## Capabilities and Constraints

The existing SolidJS application searches collected video metadata and offers optional AI assistance. Titles, descriptions, publication dates, categories, duration, availability, playlist membership, and source-provided chapters are available with varying completeness. Metadata search does not establish what a video actually depicts. Publication dates need not be filming dates. Original YouTube sources are the verification destination.

Keep search, filters, pagination, source inspection, conversation, retry, and collection diagnostics available. Preserve validation, error handling, keyboard operation, native affordances, and honest unknown states. AI unavailability must not disable direct search.

## Brand Commitments

ArchiveMateAI is the existing product name; Archie is its assistant. SolidJS, Ark UI, and Tailwind form the implementation stack. The user rejects generic component-showcase composition, repeated administrative UI, and a chatbot presented as a form. The current layout is not a design constraint.

## Evidence on Hand

Real catalog content is provided by the running backend. The metadata contract is shared/metadata.ts; search and assistant behavior are implemented in backend/search.ts and backend/assistant.ts. Do not invent transcripts, footage verification, or scene-level search capabilities.

## Product Principles

- A concrete lead starts with direct search.
- Conversation refines the same research context rather than creating another destination.
- Compare candidates before opening and verifying a source.
- Show decision-relevant metadata first and expose full provenance on demand.
- Keep operational diagnostics separate from everyday research while making failures actionable.
