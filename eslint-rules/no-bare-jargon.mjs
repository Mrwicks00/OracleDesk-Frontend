/**
 * ESLint Rule: no-bare-jargon
 * Enforces plain-language accessibility (WCAG 2.2 AAA 3.1.3/3.1.4) by detecting
 * bare prediction-market and Stellar protocol jargon in user-facing JSX text
 * unless wrapped in `<Term>` or annotated with `// bare-jargon-ok`.
 */

export const BARE_JARGON_TERMS = [
  { pattern: /\btrustlines?\b/i, id: "trustline", term: "trustline" },
  { pattern: /\bslippage\b/i, id: "slippage", term: "slippage" },
  { pattern: /\bbase\s+reserves?\b/i, id: "base-reserve", term: "base reserve" },
  { pattern: /\bclaimable\s+balances?\b/i, id: "claimable-balance", term: "claimable balance" },
  { pattern: /\bmin_shares_out\b/i, id: "limit-price", term: "min_shares_out" },
  { pattern: /\bmax_shares_in\b/i, id: "limit-price", term: "max_shares_in" },
  { pattern: /\brestore\s+footprints?\b/i, id: "restore-footprint", term: "restore footprint" },
];

export const noBareJargonRule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow bare prediction-market and Stellar jargon in user-facing JSX without <Term>",
      category: "Accessibility",
    },
    schema: [],
    messages: {
      bareJargon:
        "Bare protocol jargon '{{jargon}}' detected. Wrap in <Term id=\"{{id}}\">{{jargon}}</Term> or add // bare-jargon-ok if non-user-facing.",
    },
  },
  create(context) {
    function isInsideTerm(node) {
      let current = node.parent;
      while (current) {
        if (current.type === "JSXElement") {
          const name = current.openingElement?.name?.name;
          if (name === "Term") return true;
        }
        current = current.parent;
      }
      return false;
    }

    function checkString(node, text) {
      if (!text || typeof text !== "string") return;
      if (isInsideTerm(node)) return;

      const sourceCode = context.sourceCode;
      const comments = [
        ...(sourceCode?.getCommentsBefore ? sourceCode.getCommentsBefore(node) : []),
        ...(sourceCode?.getCommentsAfter ? sourceCode.getCommentsAfter(node) : []),
      ];
      const line = node.loc?.start.line;
      const lineText = line && sourceCode?.lines ? sourceCode.lines[line - 1] ?? "" : "";
      if (lineText.includes("bare-jargon-ok") || comments.some((c) => c.value.includes("bare-jargon-ok"))) {
        return;
      }

      for (const item of BARE_JARGON_TERMS) {
        if (item.pattern.test(text)) {
          context.report({
            node,
            messageId: "bareJargon",
            data: {
              jargon: item.term,
              id: item.id,
            },
          });
          break;
        }
      }
    }

    return {
      JSXText(node) {
        checkString(node, node.value);
      },
      Literal(node) {
        if (node.parent?.type === "JSXElement") {
          checkString(node, String(node.value));
        }
      },
    };
  },
};

export default noBareJargonRule;
