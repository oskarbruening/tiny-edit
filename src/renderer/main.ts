// Bootstrap only.
import { boot } from "./app";

const root = document.getElementById("app");
if (root) void boot(root, window.api);
