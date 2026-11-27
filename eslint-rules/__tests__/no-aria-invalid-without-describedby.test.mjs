import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import noAriaInvalidWithoutDescribedbyRule from "../no-aria-invalid-without-describedby.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

describe("ESLint Rule: no-aria-invalid-without-describedby (Issue #306)", () => {
  it("enforces aria-describedby when aria-invalid is present", () => {
    ruleTester.run("no-aria-invalid-without-describedby", noAriaInvalidWithoutDescribedbyRule, {
      valid: [
        {
          code: '<input id="test" aria-invalid={true} aria-describedby="test-error" />',
        },
        {
          code: '<input id="test" aria-invalid="true" aria-describedby="test-error" />',
        },
        {
          code: '<input id="test" aria-invalid={Boolean(error)} aria-describedby="test-error" />',
        },
        {
          code: '<input id="test" aria-invalid="false" />',
        },
        {
          code: '<input id="test" aria-invalid={false} />',
        },
        {
          code: '<input id="test" aria-invalid={true} /> // aria-invalid-ok',
        },
        {
          code: '<div>{/* aria-invalid-ok */}<input aria-invalid={true} /></div>',
        },
      ],
      invalid: [
        {
          code: '<input id="test" aria-invalid={true} />',
          errors: [
            {
              message:
                "aria-invalid on an interactive element must be paired with aria-describedby pointing to an error container. Add // aria-invalid-ok if intentionally omitted.",
            },
          ],
        },
        {
          code: '<input id="test" aria-invalid="true" />',
          errors: [
            {
              message:
                "aria-invalid on an interactive element must be paired with aria-describedby pointing to an error container. Add // aria-invalid-ok if intentionally omitted.",
            },
          ],
        },
        {
          code: '<textarea aria-invalid={Boolean(err)}></textarea>',
          errors: [
            {
              message:
                "aria-invalid on an interactive element must be paired with aria-describedby pointing to an error container. Add // aria-invalid-ok if intentionally omitted.",
            },
          ],
        },
      ],
    });
  });
});
