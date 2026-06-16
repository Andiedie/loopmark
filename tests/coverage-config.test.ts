import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("coverage gate configuration", () => {
  it("counts core production areas instead of only protocol helpers", async () => {
    const configText = await readFile("vitest.config.ts", "utf8");

    expect(configText).toContain("\"src/shared/**/*.ts\"");
    expect(configText).toContain("\"src/server/**/*.ts\"");
    expect(configText).toContain("\"src/cli/**/*.ts\"");
    expect(configText).toContain("\"src/ui/**/*.tsx\"");
  });
});
