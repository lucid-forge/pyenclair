(function (global) {
  "use strict";

  function stripOuterParentheses(value) {
    let text = String(value || "").trim();
    let changed = true;
    while (changed && text.startsWith("(") && text.endsWith(")")) {
      changed = false;
      let depth = 0;
      let quote = null;
      let escaped = false;
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) { escaped = false; continue; }
        if (char === "\\" && quote) { escaped = true; continue; }
        if (quote) { if (char === quote) quote = null; continue; }
        if (char === "'" || char === '"') { quote = char; continue; }
        if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
        if (depth === 0 && index < text.length - 1) return text;
      }
      if (depth === 0) {
        text = text.slice(1, -1).trim();
        changed = true;
      }
    }
    return text;
  }

  function canonical(value) {
    const text = stripOuterParentheses(value);
    let result = "";
    let quote = null;
    let escaped = false;
    for (const char of text) {
      if (escaped) { result += char; escaped = false; continue; }
      if (char === "\\" && quote) { result += char; escaped = true; continue; }
      if (quote) {
        result += char;
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; result += char; continue; }
      if (!/\s/.test(char)) result += char;
    }
    return result;
  }

  function findTopLevelOperator(value, operator, fromRight = false) {
    const text = stripOuterParentheses(value);
    const matches = [];
    let round = 0;
    let square = 0;
    let curly = 0;
    let quote = null;
    let escaped = false;
    for (let index = 0; index <= text.length - operator.length; index += 1) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\" && quote) { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") { round += 1; continue; }
      if (char === ")") { round -= 1; continue; }
      if (char === "[") { square += 1; continue; }
      if (char === "]") { square -= 1; continue; }
      if (char === "{") { curly += 1; continue; }
      if (char === "}") { curly -= 1; continue; }
      if (round || square || curly || text.slice(index, index + operator.length) !== operator) continue;
      if (operator === "*" && (text[index - 1] === "*" || text[index + 1] === "*")) continue;
      matches.push(index);
    }
    if (!matches.length) return null;
    const index = fromRight ? matches[matches.length - 1] : matches[0];
    return {
      left: text.slice(0, index).trim(),
      right: text.slice(index + operator.length).trim()
    };
  }

  function splitArgs(value) {
    const parts = [];
    let current = "";
    let round = 0;
    let square = 0;
    let curly = 0;
    let quote = null;
    let escaped = false;
    for (const char of value) {
      if (escaped) { current += char; escaped = false; continue; }
      if (char === "\\" && quote) { current += char; escaped = true; continue; }
      if (quote) {
        current += char;
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; current += char; continue; }
      if (char === "(") round += 1;
      else if (char === ")") round -= 1;
      else if (char === "[") square += 1;
      else if (char === "]") square -= 1;
      else if (char === "{") curly += 1;
      else if (char === "}") curly -= 1;
      if (char === "," && !round && !square && !curly) {
        parts.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function parseCall(value) {
    const text = stripOuterParentheses(value);
    const match = text.match(/^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/);
    if (!match) return null;
    return { name: match[1], args: splitArgs(match[2]) };
  }

  function part(source, mode = "value") {
    return { source: stripOuterParentheses(source), mode };
  }

  function isNumericLiteral(value) {
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(canonical(value));
  }

  function builtinsAvailable(api, names) {
    return names.every(name => api?.isBuiltinAvailable?.(name) !== false);
  }

  const rules = [
    {
      id: "arithmeticMean",
      detect(expression, api) {
        if (!builtinsAvailable(api, ["sum", "len"])) return null;
        const division = findTopLevelOperator(expression, "/");
        if (!division) return null;
        const sum = parseCall(division.left);
        const length = parseCall(division.right);
        const neutralStart = sum?.args.length === 2 && canonical(sum.args[1]) === "0";
        if (sum?.name !== "sum" || length?.name !== "len" || (!neutralStart && sum.args.length !== 1) || length.args.length !== 1) return null;
        if (canonical(sum.args[0]) !== canonical(length.args[0])) return null;
        return { id: this.id, params: { collection: part(sum.args[0]) }, exact: true };
      }
    },
    {
      id: "clamp",
      detect(expression, api) {
        if (!builtinsAvailable(api, ["min", "max"])) return null;
        const outer = parseCall(expression);
        if (!outer || outer.args.length !== 2 || !["min", "max"].includes(outer.name)) return null;
        const expectedInner = outer.name === "min" ? "max" : "min";
        const innerIndex = outer.args.findIndex(argument => parseCall(argument)?.name === expectedInner);
        if (innerIndex < 0) return null;
        const inner = parseCall(outer.args[innerIndex]);
        if (!inner || inner.args.length !== 2) return null;
        const outerBound = outer.args[1 - innerIndex];
        if (innerIndex === 1 && !isNumericLiteral(outerBound)) return null;
        let value = inner.args[0];
        let innerBound = inner.args[1];
        if (isNumericLiteral(value) && !isNumericLiteral(innerBound)) [value, innerBound] = [innerBound, value];
        if (outer.name === "min") {
          return { id: this.id, params: { value: part(value), lower: part(innerBound), upper: part(outerBound) }, exact: true };
        }
        if (outer.name === "max") {
          return { id: this.id, params: { value: part(value), lower: part(outerBound), upper: part(innerBound) }, exact: true };
        }
        return null;
      }
    },
    {
      id: "normalizationZeroOne",
      detect(expression) {
        const division = findTopLevelOperator(expression, "/");
        if (!division) return null;
        const numerator = findTopLevelOperator(division.left, "-", true);
        const denominator = findTopLevelOperator(division.right, "-", true);
        if (!numerator || !denominator || canonical(numerator.right) !== canonical(denominator.right)) return null;
        return {
          id: this.id,
          params: { value: part(numerator.left), minimum: part(numerator.right), maximum: part(denominator.left) },
          exact: true
        };
      }
    },
    {
      id: "percentage",
      detect(expression) {
        const multiplication = findTopLevelOperator(expression, "*", true);
        if (multiplication) {
          const leftIsHundred = canonical(multiplication.left) === "100";
          const rightIsHundred = canonical(multiplication.right) === "100";
          if (leftIsHundred || rightIsHundred) {
            const ratio = findTopLevelOperator(leftIsHundred ? multiplication.right : multiplication.left, "/");
            if (ratio?.left && ratio?.right) {
              return { id: this.id, params: { part: part(ratio.left), total: part(ratio.right) }, exact: true };
            }
          }
        }
        const division = findTopLevelOperator(expression, "/");
        if (!division) return null;
        const scaledPart = findTopLevelOperator(division.left, "*", true);
        if (!scaledPart) return null;
        const leftIsHundred = canonical(scaledPart.left) === "100";
        const rightIsHundred = canonical(scaledPart.right) === "100";
        if (!leftIsHundred && !rightIsHundred) return null;
        return {
          id: this.id,
          params: { part: part(leftIsHundred ? scaledPart.right : scaledPart.left), total: part(division.right) },
          exact: true
        };
      }
    },
    {
      id: "sumOfSquares",
      detect(expression, api) {
        if (!builtinsAvailable(api, ["sum"])) return null;
        const text = stripOuterParentheses(expression);
        const match = text.match(/^sum\(\s*(?:([A-Za-z_]\w*)\s*(?:\*\s*\1|\*\*\s*2)|pow\(\s*([A-Za-z_]\w*)\s*,\s*2\s*\))\s+for\s+([A-Za-z_]\w*)\s+in\s+([\s\S]+)\)$/);
        const target = match?.[1] || match?.[2];
        if (match?.[2] && !builtinsAvailable(api, ["pow"])) return null;
        if (!match || target !== match[3] || /\s+(?:for|if)\s+/.test(match[4])) return null;
        return { id: this.id, params: { collection: part(match[4]) }, exact: true };
      }
    },
    {
      id: "conditionalCount",
      detect(expression, api) {
        const text = stripOuterParentheses(expression);
        const match = text.match(/^sum\(\s*1\s+for\s+([A-Za-z_]\w*)\s+in\s+([\s\S]+?)\s+if\s+([\s\S]+)\)$/);
        const listMatch = text.match(/^len\(\s*\[\s*([A-Za-z_]\w*)\s+for\s+\1\s+in\s+([\s\S]+?)\s+if\s+([\s\S]+)\s*\]\s*\)$/);
        const selected = match || listMatch;
        if (!selected) return null;
        if (match && !builtinsAvailable(api, ["sum"])) return null;
        if (listMatch && !builtinsAvailable(api, ["len"])) return null;
        if (/\s+for\s+/.test(selected[2])) return null;
        return {
          id: this.id,
          params: { collection: part(selected[2]), condition: part(selected[3], "condition") },
          exact: true
        };
      }
    }
  ];

  global.PYTHON_EN_CLAIR_SEMANTIC_RULES = {
    version: 1,
    rules: rules.map(rule => rule.id),
    detect(expression, api = {}) {
      for (const rule of rules) {
        const result = rule.detect(expression, api);
        if (result) return result;
      }
      return null;
    }
  };
})(window);
