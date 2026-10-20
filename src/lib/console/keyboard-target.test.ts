import { describe, expect, test } from "bun:test";
import { classifyKeyTarget } from "@/lib/console/keyboard-target";

describe("classifyKeyTarget", () => {
  test("treats the replay scrubber, a range input, as a slider and not as a text field", () => {
    expect(classifyKeyTarget({ tagName: "INPUT", inputType: "range", isContentEditable: false })).toBe("slider");
  });

  test("keeps every key for fields a reader types into", () => {
    expect(classifyKeyTarget({ tagName: "INPUT", inputType: "search", isContentEditable: false })).toBe("text-entry");
    expect(classifyKeyTarget({ tagName: "INPUT", inputType: null, isContentEditable: false })).toBe("text-entry");
    expect(classifyKeyTarget({ tagName: "TEXTAREA", inputType: null, isContentEditable: false })).toBe("text-entry");
    expect(classifyKeyTarget({ tagName: "DIV", inputType: null, isContentEditable: true })).toBe("text-entry");
  });

  test("lets shortcuts through on buttons, checkboxes and the page", () => {
    expect(classifyKeyTarget({ tagName: "INPUT", inputType: "checkbox", isContentEditable: false })).toBe("other");
    expect(classifyKeyTarget({ tagName: "BUTTON", inputType: null, isContentEditable: false })).toBe("other");
    expect(classifyKeyTarget({ tagName: "BODY", inputType: null, isContentEditable: false })).toBe("other");
  });
});
