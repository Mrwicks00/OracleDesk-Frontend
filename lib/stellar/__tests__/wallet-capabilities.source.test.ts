import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATIC_CAPS, type Cap } from "../wallet-capabilities";

/**
 * Keeps the static table honest against the installed kit. Runs only when the
 * kit is installed (`npm ci`), and fails if a "no" entry has no matching
 * "does not support" throw in that module's source.
 */
const MODULES_DIR = join(process.cwd(), "node_modules/@creit.tech/stellar-wallets-kit/esm/sdk/modules");
const METHOD_FOR_CAP: Partial<Record<Cap, string>> = {
  signAuthEntry: "signAuthEntry",
  getNetwork: "getNetwork",
  signMessage: "signMessage",
};

describe.skipIf(!existsSync(MODULES_DIR))("kit source agrees with the capability table", () => {
  it("every 'no' entry matches a kit module that throws for that method", () => {
    const files = readdirSync(MODULES_DIR).filter((name) => name.endsWith(".module.js"));
    for (const [id, caps] of Object.entries(STATIC_CAPS)) {
      const file = files.find((name) => name.toLowerCase().startsWith(id));
      expect(file, `no kit module file for ${id}`).toBeDefined();
      const source = readFileSync(join(MODULES_DIR, file!), "utf8");
      for (const [cap, value] of Object.entries(caps) as [Cap, string][]) {
        const method = METHOD_FOR_CAP[cap];
        if (!method || value !== "no") continue;
        expect(source, `${id} should not support ${method}`).toMatch(new RegExp(`do(?:es)? not support the "${method}"`));
      }
    }
  });
});
