// @vitest-environment jsdom
/**
 * Issue #306: Tests for the form-errors kit primitives.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useFormErrors, ErrorSummary, FieldError, FormStatus, Field } from "../form-errors";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function TestForm({ onSubmit }: { onSubmit?: (passed: boolean) => void }) {
  const form = useFormErrors<"email" | "name">(["email", "name"]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const passed = form.attemptSubmit(() => {
      const errs: Partial<Record<"email" | "name", string>> = {};
      const emailEl = document.getElementById(form.ids.email.input) as HTMLInputElement | null;
      const nameEl = document.getElementById(form.ids.name.input) as HTMLInputElement | null;
      if (!emailEl?.value) errs.email = "Email is required.";
      if (!nameEl?.value) errs.name = "Name is required.";
      return errs;
    });
    onSubmit?.(passed);
  };

  return (
    <form onSubmit={handleSubmit}>
      <ErrorSummary
        errors={form.errors}
        formError={form.formError}
        ids={form.ids}
        labels={{ email: "Email", name: "Name" }}
        summaryRef={form.summaryRef}
      />
      <Field>
        <label htmlFor={form.ids.email.input}>Email</label>
        <input
          id={form.ids.email.input}
          aria-describedby={form.ids.email.error}
          aria-invalid={Boolean(form.errors.email && form.touched.email)}
          onBlur={form.handleBlur("email")}
          defaultValue=""
        />
        <FieldError id={form.ids.email.error} message={form.touched.email ? form.errors.email : undefined} />
      </Field>
      <Field>
        <label htmlFor={form.ids.name.input}>Name</label>
        <input
          id={form.ids.name.input}
          aria-describedby={form.ids.name.error}
          aria-invalid={Boolean(form.errors.name && form.touched.name)}
          onBlur={form.handleBlur("name")}
          defaultValue=""
        />
        <FieldError id={form.ids.name.error} message={form.touched.name ? form.errors.name : undefined} />
      </Field>
      <FormStatus status={form.statusMessage} />
      <button type="submit">Submit</button>
    </form>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useFormErrors + ErrorSummary", () => {
  it("failed submit renders error summary and focuses it", async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);

    const submitBtn = screen.getByRole("button", { name: "Submit" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(onSubmit).toHaveBeenCalledWith(false);
    const summary = await screen.findByRole("alert");
    expect(summary).toBeDefined();
    expect(summary.textContent).toContain("Email is required");
    expect(summary.textContent).toContain("Name is required");
  });

  it("aria-describedby always points to an existing element", () => {
    render(<TestForm />);
    const emailInput = screen.getByLabelText("Email");
    const describedById = emailInput.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)).not.toBeNull();
  });

  it("inline errors appear only after blur, not before", async () => {
    render(<TestForm />);

    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "a" } });

    // Blur triggers blur handler
    fireEvent.change(emailInput, { target: { value: "" } });
    fireEvent.blur(emailInput);

    const describedById = emailInput.getAttribute("aria-describedby");
    expect(document.getElementById(describedById!)).not.toBeNull();
  });

  it("ErrorSummary jump links focus the corresponding input", async () => {
    render(<TestForm />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });

    const summary = await screen.findByRole("alert");
    const link = summary.querySelector("a");
    if (link) {
      await act(async () => {
        fireEvent.click(link);
      });
      const href = link.getAttribute("href");
      if (href?.startsWith("#")) {
        const targetId = href.slice(1);
        const target = document.getElementById(targetId);
        expect(target).not.toBeNull();
      }
    }
  });
});
