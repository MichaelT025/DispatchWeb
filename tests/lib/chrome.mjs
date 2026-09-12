/** Use the browser revision belonging to installed playwright-core. */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const candidates = [
	chromium.executablePath(),
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
];
export const CHROME_PATH = process.env.PI_WEB_CHROME || candidates.find((path) => existsSync(path)) || "";
