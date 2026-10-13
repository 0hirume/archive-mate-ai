import { render } from "solid-js/web";

import Application from "./application";
import "./style.css";

const root = document.getElementById("root");

if (!root) {
    throw new Error("Application root is missing.");
}

render(() => <Application />, root);
