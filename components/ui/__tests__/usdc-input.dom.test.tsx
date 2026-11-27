// @vitest-environment jsdom
/**
 * Issue #306: UsdcInput DOM accessibility tests
 */

import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsdcInput } from "../usdc-input";

function Wrapper({ initialValue = "", error }: { initialValue?: string; error?: string }) {
  const [val, setVal] = useState(initialValue);
  return (
    <UsdcInput
      id="test-usdc"
      label="Amount (USDC)"
      value={val}
      error={error}
      onValueChange={(_raw, text) => setVal(text)}
    />
  );
}

describe("UsdcInput accessibility (Issue #306)", () => {
  it("associates label correctly with input", () => {
    render(<Wrapper />);
    const input = screen.getByLabelText("Amount (USDC)");
    expect(input).toBeDefined();
    expect(input.id).toBe("test-usdc");
  });

  it("sets aria-invalid and links error via aria-describedby on parse error", () => {
    render(<Wrapper initialValue="not-a-number" />);
    const input = screen.getByLabelText("Amount (USDC)");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(describedBy).toContain("test-usdc-error");

    const errorEl = document.getElementById("test-usdc-error");
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain("Enter a USDC amount with up to 7 decimal places");
  });

  it("links external error via aria-describedby", () => {
    render(<Wrapper initialValue="10" error="Insufficient balance" />);
    const input = screen.getByLabelText("Amount (USDC)");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    const errorEl = document.getElementById("test-usdc-error");
    expect(errorEl?.textContent).toContain("Insufficient balance");
  });

  it("has aria-invalid=false when input is valid and has no error", () => {
    render(<Wrapper initialValue="10.5" />);
    const input = screen.getByLabelText("Amount (USDC)");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
});
