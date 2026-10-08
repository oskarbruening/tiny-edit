import welcome from "./welcome.md?raw";
import whatsNew from "./whats-new.md?raw";

/** Read-only Markdown shown in the editor when no file is open. Bundled at build time; never written to disk. */
export const WELCOME_PAGE: string = welcome;
/** Help → What's New. Updated with every user-facing change (see CLAUDE.md). */
export const WHATS_NEW_PAGE: string = whatsNew;
