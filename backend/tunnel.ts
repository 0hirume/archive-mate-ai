import { spawn, type ChildProcess } from "node:child_process";

const port = process.env.PORT || "3001";
const address = `http://127.0.0.1:${port}`;
const children: ChildProcess[] = [];
let application: ChildProcess | undefined;
let output = "";
let stopping = false;

const timeout = setTimeout(() => {
    console.error("Timed out waiting for the tunnel URL.");
    stop(1);
}, 60000);

function stop(code: number): void {
    if (stopping) {
        return;
    }

    stopping = true;
    clearTimeout(timeout);

    for (const child of children) {
        child.kill();
    }

    process.exitCode = code;
}

function supervise(child: ChildProcess): ChildProcess {
    children.push(child);

    child.on("error", (error) => {
        console.error(error.message);
        stop(1);
    });

    child.on("exit", (code) => stop(code ?? 1));

    return child;
}

function receive(chunk: Buffer): void {
    process.stderr.write(chunk);
    output = (output + chunk.toString()).slice(-8192);
    const origin = output.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/)?.[0];

    if (!origin || application || stopping) {
        return;
    }

    clearTimeout(timeout);

    application = supervise(
        spawn(process.execPath, ["dist/backend/server.js"], {
            stdio: "inherit",

            env: {
                ...process.env,
                HOST: "127.0.0.1",
                PUBLIC_ORIGINS: [process.env.PUBLIC_ORIGINS, address, origin].filter(Boolean).join(","),
            },
        }),
    );

    console.log(`\nDemo: ${origin}\nAnyone with this URL can use the app and its Gemini quota.\n`);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const tunnel = supervise(
    spawn("cloudflared", ["tunnel", "--url", address], {
        stdio: ["ignore", "pipe", "pipe"],
    }),
);

tunnel.stdout?.on("data", receive);
tunnel.stderr?.on("data", receive);
