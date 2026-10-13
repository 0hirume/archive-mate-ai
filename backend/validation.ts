export class Failure extends Error {
    status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Failure("Invalid object.");
    }

    return value as Record<string, unknown>;
}

export function text(value: unknown, maximum = 2000): string {
    if (typeof value !== "string" || value.length > maximum) {
        throw new Failure("Invalid or oversized text.");
    }

    return value;
}

export function list(value: unknown, maximum = 1000000): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) {
        throw new Failure("Invalid or oversized list.");
    }

    return value;
}

export function integer(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Failure("Invalid count.");
    }

    return value;
}

export function nullableText(value: unknown, maximum = 2000): string | null {
    return value === null ? null : text(value, maximum);
}

export function date(value: unknown): string {
    const result = text(value, 10);

    if (
        result &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(result) ||
            !Number.isFinite(Date.parse(result)) ||
            new Date(result).toISOString().slice(0, 10) !== result)
    ) {
        throw new Failure("Publication dates must be valid YYYY-MM-DD dates.");
    }

    return result;
}

export function instant(value: unknown): string | null {
    if (value === null) {
        return null;
    }

    const result = text(value, 40);

    if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) {
        throw new Failure("Invalid metadata date.");
    }

    return result;
}

export function choice<const T extends string>(value: unknown, options: readonly T[]): T {
    if (typeof value !== "string" || !options.includes(value as T)) {
        throw new Failure("Invalid selection.");
    }

    return value as T;
}
