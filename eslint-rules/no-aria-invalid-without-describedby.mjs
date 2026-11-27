/**
 * ESLint Rule: no-aria-invalid-without-describedby (Issue #306)
 *
 * Enforces WCAG 2.2 / ARIA: every interactive JSX element with aria-invalid="true"
 * or aria-invalid={true} must also carry an aria-describedby attribute pointing
 * to an error container, so screen-reader users hear the error message when
 * the field receives focus.
 *
 * Add `// aria-invalid-ok` or `{/* aria-invalid-ok *\/}` on the line or element
 * if intentionally omitted.
 */

/** @type {import("eslint").Rule.RuleModule} */
export const noAriaInvalidWithoutDescribedbyRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require aria-describedby on every JSX element with aria-invalid set to true",
      category: "Accessibility",
    },
    schema: [],
    messages: {
      missingDescribedby:
        "aria-invalid on an interactive element must be paired with aria-describedby pointing to an error container. Add // aria-invalid-ok if intentionally omitted.",
    },
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        const attrs = node.attributes;
        if (!attrs || !Array.isArray(attrs)) return;

        // Find aria-invalid attribute set to a truthy value
        const ariaInvalid = attrs.find((attr) => {
          if (attr.type !== "JSXAttribute") return false;
          if (!attr.name || attr.name.name !== "aria-invalid") return false;
          if (!attr.value) return false;
          if (attr.value.type === "Literal") {
            return attr.value.value === "true" || attr.value.value === true;
          }
          if (attr.value.type === "JSXExpressionContainer") {
            const expr = attr.value.expression;
            if (expr.type === "Literal") return expr.value === true || expr.value === "true";
            // If it's a dynamic boolean expression (e.g. Boolean(err)), it may evaluate to true
            return true;
          }
          return false;
        });

        if (!ariaInvalid) return;

        // Check source for opt-out comment
        const sourceCode = context.sourceCode ?? (context.getSourceCode ? context.getSourceCode() : null);
        const comments = [
          ...(sourceCode?.getCommentsBefore ? sourceCode.getCommentsBefore(node) : []),
          ...(sourceCode?.getCommentsAfter ? sourceCode.getCommentsAfter(node) : []),
        ];
        const line = node.loc?.start.line;
        const lineText = line && sourceCode?.lines ? sourceCode.lines[line - 1] ?? "" : "";

        if (
          lineText.includes("aria-invalid-ok") ||
          comments.some((c) => c.value.includes("aria-invalid-ok"))
        ) {
          return;
        }

        // Check for aria-describedby sibling attribute
        const hasDescribedby = attrs.some(
          (attr) => attr.type === "JSXAttribute" && attr.name?.name === "aria-describedby",
        );

        if (!hasDescribedby) {
          context.report({
            node: ariaInvalid,
            messageId: "missingDescribedby",
          });
        }
      },
    };
  },
};

export default noAriaInvalidWithoutDescribedbyRule;
