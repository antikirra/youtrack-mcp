import { describe, expect, it } from "vitest";
import * as F from "../fields.js";

describe("field projections", () => {
  it("all exported constants are non-empty strings", () => {
    const exports = Object.entries(F);
    expect(exports.length).toBeGreaterThan(10);
    for (const [, value] of exports) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("LIST projections are subsets of DETAIL projections for entities with both", () => {
    // ISSUE_LIST fields should all appear in ISSUE_DETAIL
    // This prevents the case where a LIST field was removed from DETAIL by mistake
    const listFields = extractTopLevelFields(F.ISSUE_LIST);
    const detailFields = extractTopLevelFields(F.ISSUE_DETAIL);
    for (const field of listFields) {
      expect(detailFields).toContain(field);
    }
  });

  it("PROJECT_LIST fields appear in PROJECT_DETAIL", () => {
    const listFields = extractTopLevelFields(F.PROJECT_LIST);
    const detailFields = extractTopLevelFields(F.PROJECT_DETAIL);
    for (const field of listFields) {
      expect(detailFields).toContain(field);
    }
  });

  it("ISSUE_LIST includes customFields projection for polymorphic values", () => {
    // customFields is critical — without it, priority/state/assignee are invisible
    expect(F.ISSUE_LIST).toContain("customFields(");
    expect(F.ISSUE_LIST).toContain("value(");
  });

  it("ISSUE_DETAIL includes description for full analysis", () => {
    expect(F.ISSUE_DETAIL).toContain("description");
  });

  it("IMAGE_ATTACHMENT_THUMB includes thumbnailURL but not base64Content", () => {
    expect(F.IMAGE_ATTACHMENT_THUMB).toContain("thumbnailURL");
    expect(F.IMAGE_ATTACHMENT_THUMB).not.toContain("base64Content");
  });

  it("IMAGE_ATTACHMENT_FULL includes base64Content but not thumbnailURL", () => {
    expect(F.IMAGE_ATTACHMENT_FULL).toContain("base64Content");
    expect(F.IMAGE_ATTACHMENT_FULL).not.toContain("thumbnailURL");
  });

  it("no field projection contains trailing comma or leading comma", () => {
    for (const [name, value] of Object.entries(F)) {
      expect(value).not.toMatch(/^,/);
      expect(value).not.toMatch(/,$/);
      // No double commas (missing field) — strip whitespace to handle multi-line projections
      const collapsed = value.replace(/\s+/g, "");
      expect(collapsed, `${name} has double comma`).not.toMatch(/,,/);
    }
  });

  it("all projections have balanced parentheses", () => {
    for (const [name, value] of Object.entries(F)) {
      const opens = (value.match(/\(/g) || []).length;
      const closes = (value.match(/\)/g) || []).length;
      expect(opens, `${name}: unbalanced parens`).toBe(closes);
    }
  });
});

/** Extract top-level field names (before parens or commas) from a projection string. */
function extractTopLevelFields(projection: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of projection) {
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth > 0) continue;
    if (ch === ",") {
      const field = current.trim();
      if (field) fields.push(field);
      current = "";
    } else {
      current += ch;
    }
  }
  const last = current.trim();
  if (last) fields.push(last);
  return fields;
}
