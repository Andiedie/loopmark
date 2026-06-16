import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatPath, zodIssueToAgentError } from "../src/shared/errors";

describe("agent-readable validation errors", () => {
  it("formats empty, nested, and symbol paths", () => {
    expect(formatPath([])).toBe("$");
    expect(formatPath(["groups", 0, "fields", 1])).toBe("groups[0].fields[1]");
    expect(formatPath([Symbol.for("x")])).toBe("Symbol(x)");
  });

  it("maps zod issue classes into fixable errors", () => {
    const strictResult = z.object({ title: z.string() }).strict().safeParse({ title: "x", nope: true });
    expect(strictResult.success).toBe(false);
    if (!strictResult.success) {
      expect(zodIssueToAgentError(strictResult.error.issues[0])).toMatchObject({
        code: "unknown_key",
        fix: expect.stringContaining("Remove")
      });
    }

    const typeResult = z.object({ fields: z.array(z.string()) }).safeParse({ fields: "bad" });
    expect(typeResult.success).toBe(false);
    if (!typeResult.success) {
      expect(zodIssueToAgentError(typeResult.error.issues[0])).toMatchObject({
        code: "invalid_type",
        example: []
      });
    }

    const enumResult = z.enum(["text"]).safeParse("choice");
    expect(enumResult.success).toBe(false);
    if (!enumResult.success) {
      expect(zodIssueToAgentError(enumResult.error.issues[0]).why).toContain("vocabulary");
    }
  });
});
