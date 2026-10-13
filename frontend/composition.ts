export default function composition() {
    let active = false;
    let ended = -Infinity;

    return {
        start() {
            active = true;
            ended = -Infinity;
        },

        end() {
            active = false;
            ended = performance.now();
        },

        release() {
            ended = -Infinity;
        },

        blocked(event?: KeyboardEvent) {
            return active || event?.isComposing === true || performance.now() - ended < 50;
        },
    };
}
