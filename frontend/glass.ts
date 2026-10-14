import { mountGlass } from "@liquidglassjs/core";
import "@liquidglassjs/core/css";
import { onCleanup, onMount } from "solid-js";

export default function glass(element: HTMLElement): void {
    onMount(() => {
        const radius =
            (element.getBoundingClientRect().height || parseFloat(getComputedStyle(element).minHeight) || 48) / 2;

        const instance = mountGlass(element, { radius });

        const pointer = window.matchMedia(
            "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
        );

        let frame = 0;
        let horizontal = 0;
        let vertical = 0;

        const leave = () => {
            cancelAnimationFrame(frame);
            frame = 0;
            delete element.dataset.glassHover;
        };

        const move = (event: PointerEvent) => {
            if (
                !pointer.matches ||
                event.pointerType !== "mouse" ||
                element.matches(':disabled, [aria-disabled="true"], [data-disabled]')
            ) {
                leave();

                return;
            }

            horizontal = event.clientX;
            vertical = event.clientY;

            if (frame) {
                return;
            }

            frame = requestAnimationFrame(() => {
                frame = 0;
                const bounds = element.getBoundingClientRect();
                element.style.setProperty("--glass-pointer-x", `${horizontal - bounds.left}px`);
                element.style.setProperty("--glass-pointer-y", `${vertical - bounds.top}px`);
                element.dataset.glassHover = "";
            });
        };

        element.addEventListener("pointerenter", move);
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerleave", leave);
        element.addEventListener("pointercancel", leave);
        pointer.addEventListener("change", leave);

        onCleanup(() => {
            leave();
            element.removeEventListener("pointerenter", move);
            element.removeEventListener("pointermove", move);
            element.removeEventListener("pointerleave", leave);
            element.removeEventListener("pointercancel", leave);
            pointer.removeEventListener("change", leave);
            instance.dispose();
        });
    });
}
