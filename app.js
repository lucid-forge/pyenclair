(function () {
  "use strict";

  const input = document.getElementById("codeInput");
  const results = document.getElementById("results");
  const lineNumbers = document.getElementById("lineNumbers");
  const lineCount = document.getElementById("lineCount");
  const analysisSummary = document.getElementById("analysisSummary");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const exampleBtn = document.getElementById("exampleBtn");
  const ignoreComments = document.getElementById("ignoreComments");
  const explanationsOnly = document.getElementById("explanationsOnly");
  const syntaxColoring = document.getElementById("syntaxColoring");
  const codeHighlight = document.getElementById("codeHighlight");
  const workspace = document.getElementById("workspace");
  const panelDivider = document.getElementById("panelDivider");
  const heightDivider = document.getElementById("heightDivider");
  let translations = null;
  let symbolTable = {};
  let activeSourceLine = null;
  let knownTypeNames = new Set(["bool", "bytes", "bytearray", "complex", "dict", "float", "frozenset", "int", "list", "memoryview", "object", "set", "str", "tuple", "type"]);
  let knownFunctionNames = new Set();
  let knownMethodNames = new Set();
  let knownFunctionReturnTypes = new Map();
  let knownAttributeTypes = new Map();

  const example = `noms = ["Alice", "Brice", "Chloé"]
age = 20
majeur = age >= 18

if majeur and "Brice" in noms:
    message = f"Bienvenue, {noms[1]} !"
    print(message)
else:
    print("Accès refusé")

for position, nom in enumerate(noms):
    print(position, nom)`;

  function contractFrench(text) {
    let depth = 0;
    let outside = "";
    let result = "";
    const flush = () => {
      result += outside
        .replace(/\bde un(?=\s|$)/g, "d’un")
        .replace(/\bde une(?=\s|$)/g, "d’une")
        .replace(/\bde le(?=\s|$)/g, "du")
        .replace(/\bde les(?=\s|$)/g, "des")
        .replace(/\bà le(?=\s|$)/g, "au")
        .replace(/\bà les(?=\s|$)/g, "aux");
      outside = "";
    };
    for (const char of text) {
      if (char === "«") {
        if (depth === 0) flush();
        depth += 1;
        result += char;
      } else if (char === "»" && depth > 0) {
        depth -= 1;
        result += char;
      } else if (depth > 0) {
        result += char;
      } else {
        outside += char;
      }
    }
    flush();
    return result;
  }

  function format(template, values = {}) {
    const rendered = template.replace(/\{([^}]+)\}/g, (_, key) => {
      if (values[key] !== undefined) return values[key];
      if (/^\d+$/.test(key)) return translations?.values?.provided || "la valeur fournie";
      return `{${key}}`;
    });
    return contractFrench(rendered);
  }

  function t(section, key, values) {
    return format(translations[section][key], values);
  }

  function mergeTranslations(base, overrides) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return overrides ?? base;
    const merged = { ...(base || {}) };
    for (const [key, value] of Object.entries(overrides)) {
      merged[key] = value && typeof value === "object" && !Array.isArray(value)
        ? mergeTranslations(base?.[key], value)
        : value;
    }
    return merged;
  }

  function libraryInfo(moduleName) {
    const rootName = moduleName.split(".")[0];
    const description = translations.libraries?.[moduleName]
      || translations.libraries?.[rootName]
      || format(translations.libraries?._default || "Bibliothèque Python « {module} ».", { module: moduleName });
    return { term: moduleName, name: rootName, description };
  }

  function splitArgs(text) {
    if (!text.trim()) return [];
    const parts = [];
    let current = "", depth = 0, quote = null, escaped = false, lambdaState = 0;
    for (const char of text) {
      if (escaped) { current += char; escaped = false; continue; }
      if (char === "\\" && quote) { current += char; escaped = true; continue; }
      if (quote) { current += char; if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; current += char; continue; }
      if ("([{ ".includes(char) && char !== " ") depth += 1;
      if (")]}".includes(char)) depth -= 1;
      if (depth === 0 && lambdaState === 0 && /^\s*lambda\b/.test(current)) lambdaState = 1;
      if (char === ":" && depth === 0 && lambdaState === 1) lambdaState = 2;
      if (char === "," && depth === 0 && lambdaState !== 1) { parts.push(current.trim()); current = ""; lambdaState = 0; }
      else current += char;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function splitKeywordArgument(text) {
    let depth = 0, quote = null, escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\" && quote) { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if ("([{ ".includes(char) && char !== " ") { depth += 1; continue; }
      if (")]}".includes(char)) { depth -= 1; continue; }
      if (char !== "=" || depth !== 0) continue;
      if (text[index - 1] === ":" || "=!<>".includes(text[index - 1] || "") || text[index + 1] === "=") continue;
      const name = text.slice(0, index).trim();
      if (/^[A-Za-z_]\w*$/.test(name)) return { name, value: text.slice(index + 1).trim() };
    }
    return { name: null, value: text.trim() };
  }

  function valueText(explained, source = "") {
    if (explained.valueText) return explained.valueText;
    if (!/^(Je |J’)/.test(explained.text)) return explained.text;
    return t("values", "resultOf", { value: source.trim() });
  }

  function conditionText(explained, source = "") {
    return explained.conditionText || valueText(explained, source);
  }

  function displayArg(value) {
    if (value === undefined || value === "") return t("values", "provided");
    const v = value.trim();
    if (/^["'].*["']$/.test(v)) return t("values", "text", { value: v.slice(1, -1) });
    if (/^-?\d+$/.test(v)) return t("values", "integer", { value: v });
    if (/^-?\d+\.\d+$/.test(v)) return t("values", "decimal", { value: v });
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)[eE][+\-]?\d+$/.test(v)) return t("values", "decimal", { value: v });
    if (v === "True") return t("values", "true");
    if (v === "False") return t("values", "false");
    if (v === "None") return t("values", "none");
    if (/^[A-Za-z_]\w*$/.test(v) && knownTypeNames.has(v)) return t("values", "type", { value: v });
    if (/^[A-Za-z_]\w*$/.test(v) && knownFunctionNames.has(v)) return t("values", "function", { value: v });
    if (/^[A-Za-z_]\w*$/.test(v)) return t("values", "variable", { value: v });
    return t("values", "named", { value: v });
  }

  function joinArgs(args) {
    if (!args.length) return t("values", "provided");
    return args.map(displayArg).join(args.length === 2 ? " et " : ", ");
  }

  function explainRangeResult(args) {
    const described = args.map(argument => valueText(explainExpression(argument), argument));
    let key = "rangeEmpty";
    let values = {};
    if (described.length === 1) { key = "rangeOne"; values = { end: comparisonOperand(described[0]) }; }
    if (described.length === 2) { key = "rangeTwo"; values = { start: comparisonOperand(described[0]), end: comparisonOperand(described[1]) }; }
    if (described.length >= 3) { key = "rangeStep"; values = { start: comparisonOperand(described[0]), end: comparisonOperand(described[1]), step: comparisonOperand(described[2]) }; }
    return {
      text: t("syntax", key, values),
      valueText: t("values", key, values),
      exact: args.length <= 3 && args.every((argument, index) => explainExpression(argument).exact)
    };
  }

  function callParts(expression) {
    const value = expression.trim();
    if (!value.endsWith(")")) return null;
    let depth = 0, quote = null, opening = -1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const char = value[index];
      if (quote) {
        if (char === quote) {
          let backslashes = 0;
          for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
          if (backslashes % 2 === 0) quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === ")") { depth += 1; continue; }
      if (char === "(") {
        depth -= 1;
        if (depth === 0) { opening = index; break; }
      }
    }
    if (opening <= 0) return null;
    const name = value.slice(0, opening).trim();
    if (!/^(?:[A-Za-z_]\w*|[rubfRUBF]*["']|[\[(])/.test(name)) return null;
    const method = name.match(/^(.+)\.([A-Za-z_]\w*)$/);
    const argumentsSource = value.slice(opening + 1, -1);
    const generatorArgument = topLevelOperator(argumentsSource, ["for"]);
    return {
      name,
      args: generatorArgument ? [argumentsSource.trim()] : splitArgs(argumentsSource),
      ownerExpression: method ? method[1].trim() : null,
      methodName: method ? method[2] : null
    };
  }

  function attributeParts(expression) {
    const value = expression.trim();
    let round = 0, square = 0, curly = 0, quote = null;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const char = value[index];
      if (quote) {
        if (char === quote) {
          let backslashes = 0;
          for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
          if (backslashes % 2 === 0) quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === ")") round += 1;
      else if (char === "(") round -= 1;
      else if (char === "]") square += 1;
      else if (char === "[") square -= 1;
      else if (char === "}") curly += 1;
      else if (char === "{") curly -= 1;
      else if (char === "." && round === 0 && square === 0 && curly === 0) {
        const owner = value.slice(0, index).trim();
        const name = value.slice(index + 1).trim();
        if (owner && /^[A-Za-z_]\w*$/.test(name)) return { owner, name };
      }
    }
    return null;
  }

  function buildSymbolTable(lines, inheritedTable = null) {
    const symbols = inheritedTable ? { ...inheritedTable } : {};
    const builtInTypes = ["bool", "bytes", "bytearray", "complex", "dict", "float", "frozenset", "int", "list", "memoryview", "object", "set", "str", "tuple", "type"];
    knownTypeNames = new Set([...(inheritedTable?.__knownTypeNames || []), ...builtInTypes]);
    knownFunctionNames = new Set(inheritedTable?.__knownFunctionNames || []);
    knownMethodNames = new Set(inheritedTable?.__knownMethodNames || []);
    knownFunctionReturnTypes = new Map(inheritedTable?.__knownFunctionReturnTypes || []);
    knownAttributeTypes = new Map(inheritedTable?.__knownAttributeTypes || []);
    for (const raw of lines) {
      const line = raw.trim();
      let declaration = line.match(/^class\s+([A-Za-z_]\w*)/);
      if (declaration) knownTypeNames.add(declaration[1]);
      declaration = line.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/);
      if (declaration) knownFunctionNames.add(declaration[1]);
      const methodDeclaration = raw.match(/^\s+(?:async\s+)?def\s+([A-Za-z_]\w*)/);
      if (methodDeclaration) knownMethodNames.add(methodDeclaration[1]);
      let match = line.match(/^import\s+(.+)$/);
      if (match) {
        for (const imported of splitArgs(match[1])) {
          const parts = imported.match(/^([\w.]+)(?:\s+as\s+(\w+))?$/);
          if (parts) symbols[parts[2] || parts[1].split(".")[0]] = parts[1];
        }
        continue;
      }
      match = line.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
      if (match) {
        for (const imported of splitArgs(match[2])) {
          const parts = imported.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (parts) symbols[parts[2] || parts[1]] = `${match[1]}.${parts[1]}`;
        }
      }
    }
    const normalizeLocal = name => {
      const parts = name.split(".");
      if (symbols[parts[0]]) parts.splice(0, 1, ...symbols[parts[0]].split("."));
      return parts.join(".");
    };
    const annotationType = annotation => {
      let base = annotation.trim().replace(/^['"]|['"]$/g, "");
      base = base.split("|")[0].trim();
      base = base.replace(/^(?:typing\.)?(?:Optional|Annotated)\[(.+)\]$/, "$1");
      const wrapped = base.match(/^(?:typing\.)?(?:Iterator|Iterable|Generator|ContextManager|AsyncIterator|AsyncGenerator)\[(.+)\]$/);
      if (wrapped) base = splitArgs(wrapped[1])[0].trim();
      base = base.split("[")[0].trim();
      return normalizeLocal(base);
    };
    for (const raw of lines) {
      const declaration = raw.trim().match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*->\s*([^:]+)\s*:/);
      if (declaration) knownFunctionReturnTypes.set(declaration[1], annotationType(declaration[2]));
    }
    symbolTable = symbols;
    for (const raw of lines) {
      const line = raw.trim();
      let typedFunction = line.match(/^(?:async\s+)?def\s+\w+\s*\((.*)\)\s*(?:->\s*.+?)?\s*:/);
      if (typedFunction) {
        for (const parameter of splitArgs(typedFunction[1])) {
          const typed = parameter.match(/^([A-Za-z_]\w*)\s*:\s*([^=]+?)(?:\s*=.*)?$/);
          if (!typed) continue;
          const annotation = annotationType(typed[2]);
          if (knownTypeNames.has(annotation) || annotation.includes(".") || ["pandas.DataFrame", "pandas.Series", "pandas.Index", "pandas.DatetimeIndex", "pandas.TimedeltaIndex", "matplotlib.axes.Axes", "matplotlib.figure.Figure", "numpy.ndarray", "pathlib.Path", "sqlite3.Connection", "concurrent.futures.Future"].includes(annotation)) {
            symbols[typed[1]] = annotation;
          }
        }
      }
      const typedVariable = line.match(/^([A-Za-z_]\w*)\s*:\s*([^=]+?)(?:\s*=.*)?$/);
      if (typedVariable) {
        const annotation = annotationType(typedVariable[2]);
        if (knownTypeNames.has(annotation) || annotation.includes(".") || ["pandas.DataFrame", "pandas.Series", "pandas.Index", "pandas.DatetimeIndex", "pandas.TimedeltaIndex", "matplotlib.axes.Axes", "matplotlib.figure.Figure", "numpy.ndarray", "pathlib.Path", "sqlite3.Connection", "concurrent.futures.Future"].includes(annotation)) {
          symbols[typedVariable[1]] = annotation;
        }
      }
      const contextVariable = line.match(/^(?:async\s+)?with\s+(.+?)\s+as\s+([A-Za-z_]\w*)\s*:/);
      if (contextVariable) {
        const contextType = inferExpressionType(contextVariable[1]);
        if (contextType) symbols[contextVariable[2]] = contextType;
      }
      const groupLoop = line.match(/^for\s+(.+?)\s+in\s+(.+?)\s*:\s*$/);
      if (groupLoop && inferExpressionType(groupLoop[2]) === "pandas.core.groupby.GroupBy") {
        const targets = groupLoop[1].replace(/[()]/g, "").split(",").map(name => name.trim()).filter(Boolean);
        const groupName = targets[targets.length - 1];
        if (groupName) symbols[groupName] = "pandas.DataFrame";
      }
      let match = line.match(/^(\w+)\s*,\s*(\w+)\s*=\s*([\w.]+)\s*\(/);
      if (match && ["matplotlib.pyplot.subplots", "matplotlib.pyplot.subplot_mosaic"].includes(normalizeLocal(match[3]))) {
        symbols[match[1]] = "matplotlib.figure.Figure";
        symbols[match[2]] = normalizeLocal(match[3]) === "matplotlib.pyplot.subplot_mosaic" ? "matplotlib.axes.AxesMap" : "matplotlib.axes.Axes";
        continue;
      }
      match = line.match(/^(\w+)\s*=\s*([\w.]+)\.(xaxis|yaxis)$/);
      if (match && normalizeLocal(match[2]) === "matplotlib.axes.Axes") {
        symbols[match[1]] = "matplotlib.axis.Axis";
        continue;
      }
      match = line.match(/^(\w+)\s*=\s*([\w.]+)\s*\[([\s\S]+)\]$/);
      if (match) {
        const sourceType = normalizeLocal(match[2]);
        if (sourceType === "pandas.DataFrame") {
          symbols[match[1]] = match[3].trim().startsWith("[") ? "pandas.DataFrame" : "pandas.Series";
          continue;
        }
        if (sourceType === "pandas.Series") {
          symbols[match[1]] = "pandas.Series";
          continue;
        }
      }
      match = line.match(/^(\w+)\s*=\s*([\w.]+)\.(loc|iloc)\s*\[([\s\S]+)\]$/);
      if (match && normalizeLocal(match[2]) === "pandas.DataFrame") {
        const keys = splitArgs(match[4]);
        symbols[match[1]] = keys.length > 1 && !/^\[/.test(keys[1].trim()) ? "pandas.Series" : "pandas.DataFrame";
        continue;
      }
      match = line.match(/^(\w+)\s*=\s*([\w.]+)\.([A-Za-z_]\w*)$/);
      if (match && normalizeLocal(match[2]) === "pandas.DataFrame") {
        symbols[match[1]] = "pandas.Series";
        continue;
      }
      const inferredAssignment = line.match(/^(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(.+)$/);
      if (inferredAssignment) {
        const inferredType = inferExpressionType(inferredAssignment[2]);
        if (inferredType) symbols[inferredAssignment[1]] = inferredType;
      }
      const assignedCall = inferredAssignment ? callParts(inferredAssignment[2]) : null;
      if (!inferredAssignment || !assignedCall) continue;
      match = [null, inferredAssignment[1], assignedCall.name];
      let creator = normalizeLocal(assignedCall.name);
      if (assignedCall.ownerExpression) {
        const ownerType = inferExpressionType(assignedCall.ownerExpression);
        if (ownerType) creator = `${ownerType}.${assignedCall.methodName}`;
      }
      if (["numpy.vectorize", "numpy.frompyfunc"].includes(creator)) knownFunctionNames.add(match[1]);
      if (creator === "functools.partial") knownFunctionNames.add(match[1]);
      const pandasDataFrameCreators = [
        "pandas.DataFrame", "pandas.read_csv", "pandas.read_table", "pandas.read_fwf", "pandas.read_excel",
        "pandas.read_json", "pandas.read_xml", "pandas.read_sql", "pandas.read_sql_query", "pandas.read_parquet",
        "pandas.read_feather", "pandas.read_orc", "pandas.read_hdf"
      ];
      if (["pandas.DataFrame.groupby", "pandas.Series.groupby"].includes(creator)) {
        symbols[match[1]] = "pandas.core.groupby.GroupBy";
      } else if (["pandas.DataFrame.rolling", "pandas.Series.rolling", "pandas.core.groupby.GroupBy.rolling"].includes(creator)) {
        symbols[match[1]] = "pandas.core.window.Rolling";
      } else if (["pandas.DataFrame.expanding", "pandas.Series.expanding"].includes(creator)) {
        symbols[match[1]] = "pandas.core.window.Expanding";
      } else if (["pandas.DataFrame.ewm", "pandas.Series.ewm"].includes(creator)) {
        symbols[match[1]] = "pandas.core.window.ExponentialMovingWindow";
      } else if (["pandas.DataFrame.resample", "pandas.Series.resample", "pandas.core.groupby.GroupBy.resample"].includes(creator)) {
        symbols[match[1]] = "pandas.core.resample.Resampler";
      } else if (["pandas.Index", "pandas.RangeIndex", "pandas.DatetimeIndex", "pandas.TimedeltaIndex", "pandas.date_range", "pandas.bdate_range", "pandas.period_range", "pandas.MultiIndex.from_arrays", "pandas.MultiIndex.from_tuples", "pandas.MultiIndex.from_product", "pandas.IntervalIndex.from_breaks"].includes(creator)) {
        symbols[match[1]] = "pandas.Index";
      } else if (["pandas.Series.to_frame"].includes(creator)) {
        symbols[match[1]] = "pandas.DataFrame";
      } else if (pandasDataFrameCreators.includes(creator) || /^pandas\.DataFrame\./.test(creator)) {
        symbols[match[1]] = "pandas.DataFrame";
      } else if (["pandas.Series", "pandas.to_datetime", "pandas.to_numeric", "pandas.to_timedelta"].includes(creator) || /^pandas\.Series\./.test(creator)) {
        symbols[match[1]] = "pandas.Series";
      } else if (["matplotlib.pyplot.figure", "matplotlib.pyplot.gcf"].includes(creator)) {
        symbols[match[1]] = "matplotlib.figure.Figure";
      } else if (["matplotlib.pyplot.axes", "matp…27409 tokens truncated…atementChildren(node, depth);
        return;
      }
      visitContainer(node, depth);
    }

    visitContainer(tree, 0);
    return rows;
  }

  function explainSyntaxRow(row) {
    const raw = row.raw.trim();
    if (row.error) return { text: t("parser", "syntaxError"), exact: false, kind: "syntax-error" };
    if (row.nodeType === "TryStatement") return { text: t("parser", "try"), exact: true, kind: "block condition-block" };
    if (row.nodeType === "WithStatement") {
      const contextSource = raw.replace(/^(?:async\s+)?with\s+/, "").replace(/:\s*$/, "");
      const asMatch = contextSource.match(/^(.+?)\s+as\s+([A-Za-z_]\w*)$/);
      const source = asMatch ? asMatch[1].trim() : contextSource;
      const explained = explainExpression(source);
      return {
        text: t("parser", asMatch ? "withAs" : "with", {
          context: valueText(explained, source),
          variable: asMatch?.[2]
        }),
        exact: explained.exact,
        kind: "block function-block"
      };
    }
    if (row.nodeType === "MatchStatement") {
      const subject = raw.replace(/^match\s+/, "").replace(/:\s*$/, "");
      return { text: t("parser", "match", { subject }), exact: true, kind: "block condition-block" };
    }
    if (row.nodeType === "MatchClause") {
      const pattern = raw.replace(/^case\s+/, "").replace(/:\s*$/, "");
      if (pattern === "_") return { text: t("parser", "caseDefault"), exact: true, kind: "block condition-block" };
      const simpleValue = /^(?:None|True|False|-?\d+(?:\.\d+)?|["'][\s\S]*["'])$/.test(pattern);
      if (simpleValue) {
        const explained = explainExpression(pattern);
        return { text: t("parser", "caseValue", { value: valueText(explained, pattern) }), exact: explained.exact, kind: "block condition-block" };
      }
      const typePattern = pattern.match(/^([A-Za-z_]\w*)\(\)\s+as\s+([A-Za-z_]\w*)(?:\s+if\s+(.+))?$/);
      if (typePattern) {
        const guard = typePattern[3] ? explainExpression(typePattern[3]) : null;
        return {
          text: t("parser", guard ? "caseTypeGuard" : "caseType", {
            type: typePattern[1],
            variable: typePattern[2],
            condition: guard ? conditionText(guard, typePattern[3]) : ""
          }),
          exact: !guard || guard.exact,
          kind: "block condition-block"
        };
      }
      return { text: t("parser", "case", { pattern }), exact: false, kind: "block condition-block" };
    }
    if (row.nodeType === "RaiseStatement") {
      const value = raw.replace(/^raise\s*/, "") || "l’erreur courante";
      const systemExit = callParts(value);
      if (systemExit && normalizeName(systemExit.name) === "SystemExit") {
        const source = systemExit.args[0] || "0";
        const explained = explainExpression(source);
        return { text: t("parser", "systemExit", { value: valueText(explained, source) }), exact: explained.exact };
      }
      return { text: t("parser", "raise", { value }), exact: true };
    }
    if (row.nodeType === "AssertStatement") {
      const sources = splitArgs(raw.replace(/^assert\s+/, ""));
      const conditionSource = sources[0] || "";
      const condition = explainExpression(conditionSource);
      const message = sources[1] ? explainExpression(sources[1]) : null;
      return {
        text: t("parser", message ? "assertMessage" : "assert", {
          condition: conditionText(condition, conditionSource),
          message: message ? valueText(message, sources[1]) : ""
        }),
        exact: condition.exact && (!message || message.exact)
      };
    }
    if (row.nodeType === "DeleteStatement") return { text: t("parser", "delete", { target: raw.replace(/^del\s+/, "") }), exact: true };
    if (row.nodeType === "Decorator") return { text: t("parser", "decorator", { value: raw.replace(/^@/, "") }), exact: true };
    if (row.nodeType === "Clause:except") {
      const detail = raw.replace(/^except\s*/, "").replace(/:\s*$/, "").trim();
      if (!detail) return { text: t("parser", "exceptAny"), exact: true, kind: "block condition-block" };
      const parts = detail.match(/^(.+?)\s+as\s+(\w+)$/);
      return {
        text: parts ? t("parser", "exceptAs", { error: parts[1], variable: parts[2] }) : t("parser", "except", { error: detail }),
        exact: true,
        kind: "block condition-block"
      };
    }
    if (row.nodeType === "Clause:finally") return { text: t("parser", "finally"), exact: true, kind: "block condition-block" };
    if (/^async\s+for\s+/.test(raw)) {
      const iterable = raw.replace(/^async\s+for\s+.+?\s+in\s+/, "").replace(/:\s*$/, "");
      return { text: t("parser", "asyncFor", { iterable }), exact: true, kind: "block loop-block" };
    }
    const explained = explainLine(raw);
    if (explained) return explained;
    return { text: t("parser", "unknown", { type: row.nodeType }), exact: false };
  }

  function analyze() {
    if (!translations) return;
    const lines = input.value.split("\n");
    let parsed;
    try {
      parsed = syntaxRows(input.value);
    } catch (error) {
      results.innerHTML = '<div class="empty-state"><div class="empty-mark">!</div><p>L’analyseur syntaxique V3 ne peut pas être chargé.</p></div>';
      analysisSummary.hidden = true;
      return;
    }
    const scopedSymbolTables = buildScopedSymbolTables(parsed);
    const translated = parsed
      .map((row, index) => {
        activateSymbolTable(scopedSymbolTables[index]);
        const result = explainSyntaxRow(row);
        if (result) result.presentation = stylisticPresentation(result, row.raw);
        return { ...row, result };
      })
      .filter(item => item.result && !(ignoreComments.checked && item.nodeType === "Comment"));
    results.classList.add("compact");
    results.classList.toggle("explanations-only", explanationsOnly.checked);
    results.classList.toggle("syntax-enabled", Boolean(syntaxColoring?.checked));
    if (!translated.length) {
      results.innerHTML = '<div class="empty-state"><div class="empty-mark">→</div><p>Ajoutez au moins une instruction Python.</p></div>';
      analysisSummary.hidden = true;
      return;
    }
    results.innerHTML = translated.map(({ raw, index, endIndex, depth, nodeType, result }) => {
      const endLine = endIndex ?? index;
      return `
      <article class="translation ${depth ? "nested" : ""} ${result.kind || ""}" data-line="${index}" data-end-line="${endLine}" data-node-type="${escapeHtml(nodeType)}" style="--depth: ${depth}; --indent: ${depth * 28}px; --indent-mobile: ${depth * 20}px">
        <div class="translation-number">${index}</div>
        <div class="translation-body">
          <div class="depth-guides" aria-hidden="true">${Array.from({ length: depth }, () => "<span></span>").join("")}</div>
          <div class="source">${pythonSyntaxHtml(raw.trim())}</div>
          ${explanationBlockHtml(result, raw)}
          <span class="confidence ${result.exact ? "exact" : "generic"}">${escapeHtml(translations.confidence[result.exact ? "exact" : "generic"])}</span>
        </div>
      </article>`;
    }).join("");

    const exactCount = translated.filter(item => item.result.exact).length;
    const genericCount = translated.length - exactCount;
    const exactLabel = translations.summary[exactCount === 1 ? "exactSingular" : "exactPlural"];
    const genericLabel = translations.summary[genericCount === 1 ? "genericSingular" : "genericPlural"];
    analysisSummary.innerHTML = `
      <span class="summary-title">${escapeHtml(translations.summary.title)}</span>
      <span class="summary-item"><span class="dot exact"></span><strong>${exactCount}</strong> ${escapeHtml(exactLabel)}</span>
      <span class="summary-item"><span class="dot generic"></span><strong>${genericCount}</strong> ${escapeHtml(genericLabel)}</span>`;
    analysisSummary.hidden = false;
  }

  function updateEditorMeta() {
    const count = input.value.split("\n").length;
    lineNumbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
    lineCount.textContent = `${count} ligne${count > 1 ? "s" : ""}`;
    lineNumbers.scrollTop = input.scrollTop;
    updateSyntaxHighlight();
  }

  function selectedSourceLine() {
    return input.value.slice(0, input.selectionStart).split("\n").length;
  }

  function highlightTranslationForLine(lineNumber) {
    activeSourceLine = lineNumber;
    updateSourceLineHighlight();
    const translationsForLines = Array.from(results.querySelectorAll(".translation[data-line]"));
    const target = translationsForLines.find(item => {
      const start = Number(item.dataset.line);
      const end = Number(item.dataset.endLine || start);
      return lineNumber >= start && lineNumber <= end;
    });
    translationsForLines.forEach(item => {
      item.classList.remove("is-source-target");
      item.removeAttribute("aria-current");
    });
    if (!target) return;
    target.classList.add("is-source-target");
    target.setAttribute("aria-current", "true");
    const resultsBounds = results.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const centeredTop = results.scrollTop + targetBounds.top - resultsBounds.top - (results.clientHeight - targetBounds.height) / 2;
    results.scrollTo({ top: Math.max(0, centeredTop), behavior: "smooth" });
  }

  function updateSourceLineHighlight() {
    const editorWrap = input.parentElement;
    if (!editorWrap || activeSourceLine === null) {
      editorWrap?.classList.remove("has-source-highlight");
      return;
    }
    const styles = getComputedStyle(input);
    const lineHeight = parseFloat(styles.lineHeight) || 24.5;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const top = paddingTop + (activeSourceLine - 1) * lineHeight - input.scrollTop;
    editorWrap.style.setProperty("--source-highlight-top", `${top}px`);
    editorWrap.style.setProperty("--source-highlight-height", `${lineHeight}px`);
    editorWrap.classList.toggle("has-source-highlight", top + lineHeight > 0 && top < editorWrap.clientHeight);
  }

  function selectSourceLine(lineNumber) {
    const lines = input.value.split("\n");
    const boundedLine = Math.max(1, Math.min(lines.length, lineNumber));
    let position = 0;
    for (let index = 1; index < boundedLine; index += 1) position += lines[index - 1].length + 1;
    input.focus();
    input.selectionStart = input.selectionEnd = position;
    highlightTranslationForLine(boundedLine);
  }

  function setPanelSplit(value, persist = false) {
    const percent = Math.max(25, Math.min(75, Number(value) || 50));
    workspace.style.setProperty("--left-pane", `${percent}%`);
    panelDivider.setAttribute("aria-valuenow", String(Math.round(percent)));
    if (persist) {
      try { localStorage.setItem("python-en-clair-v3.panelSplit", String(percent)); }
      catch (error) { /* La largeur reste active pour cette session. */ }
    }
  }

  function splitFromPointer(event) {
    const bounds = workspace.getBoundingClientRect();
    if (!bounds.width) return;
    setPanelSplit(((event.clientX - bounds.left) / bounds.width) * 100);
  }

  function setWorkspaceHeight(value, persist = false) {
    const height = Math.max(360, Math.min(1200, Number(value) || 560));
    workspace.style.setProperty("--workspace-height", `${height}px`);
    heightDivider.setAttribute("aria-valuenow", String(Math.round(height)));
    if (persist) {
      try { localStorage.setItem("python-en-clair-v3.workspaceHeight", String(height)); }
      catch (error) { /* La hauteur reste active pour cette session. */ }
    }
  }

  function heightFromPointer(event) {
    const bounds = workspace.getBoundingClientRect();
    setWorkspaceHeight(event.clientY - bounds.top);
  }

  function loadPreferences() {
    try {
      ignoreComments.checked = localStorage.getItem("python-en-clair-v3.ignoreComments") === "true";
      explanationsOnly.checked = localStorage.getItem("python-en-clair-v3.explanationsOnly") === "true";
      if (syntaxColoring) syntaxColoring.checked = localStorage.getItem("python-en-clair-v3.syntaxColoring") === "true";
      setPanelSplit(localStorage.getItem("python-en-clair-v3.panelSplit") || 50);
      setWorkspaceHeight(localStorage.getItem("python-en-clair-v3.workspaceHeight") || 560);
    } catch (error) {
      // Le stockage local peut être désactivé par le navigateur.
      setPanelSplit(50);
      setWorkspaceHeight(560);
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem("python-en-clair-v3.ignoreComments", String(ignoreComments.checked));
      localStorage.setItem("python-en-clair-v3.explanationsOnly", String(explanationsOnly.checked));
      if (syntaxColoring) localStorage.setItem("python-en-clair-v3.syntaxColoring", String(syntaxColoring.checked));
    } catch (error) {
      // Les options restent actives pour la session en cours.
    }
    analyze();
  }

  async function loadTranslations() {
    if (window.PYTHON_EN_CLAIR_TRANSLATIONS) {
      translations = [
        window.PYTHON_EN_CLAIR_NUMPY_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_MATPLOTLIB_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_PANDAS_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_SCIPY_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_SEABORN_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_SKLEARN_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_REQUESTS_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_STATSMODELS_TRANSLATIONS,
        window.PYTHON_EN_CLAIR_PLOTLY_TRANSLATIONS
      ].reduce((merged, dictionary) => mergeTranslations(merged, dictionary || {}), window.PYTHON_EN_CLAIR_TRANSLATIONS);
      analyzeBtn.disabled = false;
      return;
    }
    try {
      const [baseResponse, numpyResponse, matplotlibResponse, pandasResponse, scipyResponse, seabornResponse, sklearnResponse, requestsResponse, statsmodelsResponse, plotlyResponse] = await Promise.all([
        fetch("traductions/traductions.json", { cache: "no-store" }),
        fetch("traductions/traductions.numpy.json", { cache: "no-store" }),
        fetch("traductions/traductions.matplotlib.json", { cache: "no-store" }),
        fetch("traductions/traductions.pandas.json", { cache: "no-store" }),
        fetch("traductions/traductions.scipy.json", { cache: "no-store" }),
        fetch("traductions/traductions.seaborn.json", { cache: "no-store" }),
        fetch("traductions/traductions.sklearn.json", { cache: "no-store" }),
        fetch("traductions/traductions.requests.json", { cache: "no-store" }),
        fetch("traductions/traductions.statsmodels.json", { cache: "no-store" }),
        fetch("traductions/traductions.plotly.json", { cache: "no-store" })
      ]);
      if (![baseResponse, numpyResponse, matplotlibResponse, pandasResponse, scipyResponse, seabornResponse, sklearnResponse, requestsResponse, statsmodelsResponse, plotlyResponse].every(response => response.ok)) throw new Error("Traductions absentes");
      translations = [await numpyResponse.json(), await matplotlibResponse.json(), await pandasResponse.json(), await scipyResponse.json(), await seabornResponse.json(), await sklearnResponse.json(), await requestsResponse.json(), await statsmodelsResponse.json(), await plotlyResponse.json()]
        .reduce((merged, dictionary) => mergeTranslations(merged, dictionary), await baseResponse.json());
      analyzeBtn.disabled = false;
    } catch (error) {
      analyzeBtn.disabled = true;
      results.innerHTML = '<div class="empty-state"><div class="empty-mark">!</div><p>Les traductions locales sont absentes.<br>Lancez <strong>DEMARRER.cmd</strong> pour les régénérer.</p></div>';
    }
  }

  input.addEventListener("input", updateEditorMeta);
  input.addEventListener("scroll", () => {
    lineNumbers.scrollTop = input.scrollTop;
    if (codeHighlight) {
      codeHighlight.scrollTop = input.scrollTop;
      codeHighlight.scrollLeft = input.scrollLeft;
    }
    updateSourceLineHighlight();
  });
  input.addEventListener("click", () => highlightTranslationForLine(selectedSourceLine()));
  lineNumbers.addEventListener("click", event => {
    const bounds = lineNumbers.getBoundingClientRect();
    const styles = getComputedStyle(input);
    const lineHeight = parseFloat(styles.lineHeight) || 24.5;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const clickedLine = Math.floor((event.clientY - bounds.top - paddingTop + input.scrollTop) / lineHeight) + 1;
    selectSourceLine(clickedLine);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = input.selectionStart;
      input.value = input.value.slice(0, start) + "    " + input.value.slice(input.selectionEnd);
      input.selectionStart = input.selectionEnd = start + 4;
      updateEditorMeta();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") analyze();
  });
  analyzeBtn.addEventListener("click", analyze);
  exampleBtn.addEventListener("click", () => { input.value = example; updateEditorMeta(); analyze(); input.focus(); });
  ignoreComments.addEventListener("change", savePreferences);
  explanationsOnly.addEventListener("change", savePreferences);
  syntaxColoring?.addEventListener("change", () => { updateSyntaxHighlight(); savePreferences(); });
  panelDivider.addEventListener("pointerdown", event => {
    panelDivider.setPointerCapture?.(event.pointerId);
    workspace.classList.add("resizing");
    splitFromPointer(event);
  });
  panelDivider.addEventListener("pointermove", event => {
    if (!workspace.classList.contains("resizing")) return;
    splitFromPointer(event);
  });
  panelDivider.addEventListener("pointerup", event => {
    if (!workspace.classList.contains("resizing")) return;
    splitFromPointer(event);
    workspace.classList.remove("resizing");
    panelDivider.releasePointerCapture?.(event.pointerId);
    const current = Number(panelDivider.getAttribute("aria-valuenow"));
    setPanelSplit(current, true);
  });
  panelDivider.addEventListener("pointercancel", () => workspace.classList.remove("resizing"));
  panelDivider.addEventListener("keydown", event => {
    const current = Number(panelDivider.getAttribute("aria-valuenow")) || 50;
    if (event.key === "ArrowLeft") { event.preventDefault(); setPanelSplit(current - 2, true); }
    if (event.key === "ArrowRight") { event.preventDefault(); setPanelSplit(current + 2, true); }
    if (event.key === "Home") { event.preventDefault(); setPanelSplit(50, true); }
  });
  heightDivider.addEventListener("pointerdown", event => {
    heightDivider.setPointerCapture?.(event.pointerId);
    heightDivider.classList.add("resizing");
    workspace.classList.add("height-resizing");
    heightFromPointer(event);
  });
  heightDivider.addEventListener("pointermove", event => {
    if (!heightDivider.classList.contains("resizing")) return;
    heightFromPointer(event);
  });
  heightDivider.addEventListener("pointerup", event => {
    if (!heightDivider.classList.contains("resizing")) return;
    heightFromPointer(event);
    heightDivider.classList.remove("resizing");
    workspace.classList.remove("height-resizing");
    heightDivider.releasePointerCapture?.(event.pointerId);
    setWorkspaceHeight(Number(heightDivider.getAttribute("aria-valuenow")), true);
  });
  heightDivider.addEventListener("pointercancel", () => {
    heightDivider.classList.remove("resizing");
    workspace.classList.remove("height-resizing");
  });
  heightDivider.addEventListener("keydown", event => {
    const current = Number(heightDivider.getAttribute("aria-valuenow")) || 560;
    if (event.key === "ArrowUp") { event.preventDefault(); setWorkspaceHeight(current - 40, true); }
    if (event.key === "ArrowDown") { event.preventDefault(); setWorkspaceHeight(current + 40, true); }
    if (event.key === "Home") { event.preventDefault(); setWorkspaceHeight(560, true); }
  });
  analyzeBtn.disabled = true;
  loadPreferences();
  updateEditorMeta();
  loadTranslations();
})();

