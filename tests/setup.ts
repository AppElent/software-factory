import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The whole service runs in-process, so a full run on a busy machine is slower than the default second.
configure({ asyncUtilTimeout: 5000 });

afterEach(cleanup);

// jsdom lacks what cmdk and Radix measure with.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
