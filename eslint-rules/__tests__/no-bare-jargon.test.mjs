import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import noBareJargonRule from "../no-bare-jargon.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

describe("ESLint Rule: no-bare-jargon (Issue #305)", () => {
  it("flags bare jargon in JSX text and allows wrapped or annotated jargon", () => {
    ruleTester.run("no-bare-jargon", noBareJargonRule, {
      valid: [
        {
          code: "<p>This is standard non-jargon text.</p>",
        },
        {
          code: "<p>We have a <Term id=\"trustline\">trustline</Term> enabled.</p>",
        },
        {
          code: "<p>Max <Term id=\"slippage\">slippage</Term> is 1%.</p>",
        },
        {
          code: "<p>Locks one base reserve</p> // bare-jargon-ok",
        },
        {
          code: "<div>{/* bare-jargon-ok */}<p>A bare trustline here</p></div>",
        },
      ],
      invalid: [
        {
          code: "<p>This creates a trustline on your account.</p>",
          errors: [
            {
              message:
                "Bare protocol jargon 'trustline' detected. Wrap in <Term id=\"trustline\">trustline</Term> or add // bare-jargon-ok if non-user-facing.",
            },
          ],
        },
        {
          code: "<span>Estimated slippage is high.</span>",
          errors: [
            {
              message:
                "Bare protocol jargon 'slippage' detected. Wrap in <Term id=\"slippage\">slippage</Term> or add // bare-jargon-ok if non-user-facing.",
            },
          ],
        },
        {
          code: "<p>Requires one base reserve (0.5 XLM)</p>",
          errors: [
            {
              message:
                "Bare protocol jargon 'base reserve' detected. Wrap in <Term id=\"base-reserve\">base reserve</Term> or add // bare-jargon-ok if non-user-facing.",
            },
          ],
        },
      ],
    });
  });
});
