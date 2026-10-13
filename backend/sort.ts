export function durationSeconds(duration: string | null): number | null {
    const match = duration?.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);

    if (!match) {
        return null;
    }

    return (
        Number(match[1] || 0) * 86400 +
        Number(match[2] || 0) * 3600 +
        Number(match[3] || 0) * 60 +
        Number(match[4] || 0)
    );
}

export function titleKey(title: string): Buffer {
    return Buffer.from(title.toLocaleLowerCase("en"), "utf16le").swap16();
}
