import { describe, expect, it } from "vitest";
import { patchExtensionCacheSource } from "../../server/patch-extension-cache.js";

/** The SDK fragments the patch targets (dist/core/extensions/loader.js). */
const PRISTINE = `let extensionCacheCwd;
let extensionCacheGeneration = 0;
const extensionCache = new Map();
export function clearExtensionCache() {
    extensionCache.clear();
    extensionCacheCwd = undefined;
    extensionCacheGeneration++;
}
function useExtensionCacheCwd(cwd) {
    const resolvedCwd = resolvePath(cwd);
    if (extensionCacheCwd !== undefined && extensionCacheCwd !== resolvedCwd) {
        clearExtensionCache();
    }
    extensionCacheCwd = resolvedCwd;
    return { cwd: resolvedCwd, generation: extensionCacheGeneration };
}
function isCurrentCacheToken(cacheToken) {
    return (cacheToken !== undefined &&
        extensionCacheCwd === cacheToken.cwd &&
        extensionCacheGeneration === cacheToken.generation);
}
async function loadExtensionModule(extensionPath, cacheToken) {
    if (isCurrentCacheToken(cacheToken)) {
        const cachedFactory = extensionCache.get(extensionPath);
        if (cachedFactory) {
            return cachedFactory;
        }
    }
    const factory = await load();
    if (isCurrentCacheToken(cacheToken)) {
        extensionCache.set(extensionPath, factory);
    }
    return factory;
}
`;

describe("patchExtensionCacheSource", () => {
	it("keys the cache by extension path and stops evicting on cwd change", () => {
		const out = patchExtensionCacheSource(PRISTINE);
		expect(out).not.toBeNull();
		expect(out).not.toContain("extensionCacheCwd !== resolvedCwd");
		expect(out).not.toContain("extensionCacheCwd === cacheToken.cwd");
		expect(out).toContain("extensionCache.get(extensionCacheKey(cacheToken, extensionPath))");
		expect(out).toContain("extensionCache.set(extensionCacheKey(cacheToken, extensionPath), factory)");
		expect(out).toContain("function extensionCacheKey(cacheToken, extensionPath) {\n    return extensionPath;");
		// explicit /reload still drops everything
		expect(out).toContain("extensionCache.clear();");
	});

	it("is idempotent and refuses unrecognised sources", () => {
		const once = patchExtensionCacheSource(PRISTINE)!;
		expect(patchExtensionCacheSource(once)).toBeNull();
		expect(patchExtensionCacheSource("function useExtensionCacheCwd(cwd) { return cwd; }")).toBeNull();
	});
});
