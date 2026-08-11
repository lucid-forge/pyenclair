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

  const example = `clients_fideles = {"Alice", "Chloé"}
commandes = [
    {"client": "Alice", "montant": 120, "livree": True},
    {"client": "Brice", "montant": 80, "livree": True},
    {"client": "Chloé", "montant": 170, "livree": False},
]

def calculer_remise(client, montant):
    if client in clients_fideles and montant >= 100:
        return montant * 0.10
    if montant >= 150:
        return montant * 0.05
    return 0

def preparer_bilan(commandes):
    total = 0
    livrees = []
    for commande in commandes:
        if not commande["livree"]:
            continue
        remise = calculer_remise(commande["client"], commande["montant"])
        net = commande["montant"] - remise
        total += net
        livrees.append(net)
    moyenne = total / len(livrees) if livrees else 0
    return total, moyenne, livrees

total, moyenne, livrees = preparer_bilan(commandes)
print(f"Total : {total:.2f} €")
print(f"{len(livrees)} commandes, moyenne : {moyenne:.2f} €")`;

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
      } else if (["matplotlib.pyplot.axes", "matplotlib.pyplot.gca", "matplotlib.pyplot.subplot"].includes(creator)) {
        symbols[match[1]] = "matplotlib.axes.Axes";
      } else if ([
        "matplotlib.figure.Figure.add_subplot", "matplotlib.figure.Figure.add_axes", "matplotlib.figure.Figure.subplots",
        "matplotlib.axes.Axes.twinx", "matplotlib.axes.Axes.twiny", "matplotlib.axes.Axes.secondary_xaxis", "matplotlib.axes.Axes.secondary_yaxis",
        "matplotlib.pyplot.twinx", "matplotlib.pyplot.twiny"
      ].includes(creator)) {
        symbols[match[1]] = "matplotlib.axes.Axes";
      } else if (["matplotlib.pyplot.colorbar", "matplotlib.figure.Figure.colorbar"].includes(creator)) {
        symbols[match[1]] = "matplotlib.colorbar.Colorbar";
      } else if (creator === "matplotlib.lines.Line2D") {
        symbols[match[1]] = "matplotlib.lines.Line2D";
      } else if ([
        "matplotlib.pyplot.scatter", "matplotlib.axes.Axes.scatter", "matplotlib.pyplot.imshow", "matplotlib.axes.Axes.imshow",
        "matplotlib.pyplot.text", "matplotlib.axes.Axes.text", "matplotlib.pyplot.annotate", "matplotlib.axes.Axes.annotate",
        "matplotlib.patches.Rectangle", "matplotlib.patches.Circle", "matplotlib.patches.Ellipse", "matplotlib.patches.Polygon",
        "matplotlib.patches.FancyArrow", "matplotlib.patches.FancyBboxPatch", "matplotlib.patches.Arc", "matplotlib.patches.Wedge",
        "matplotlib.text.Text", "matplotlib.text.Annotation", "matplotlib.collections.LineCollection",
        "matplotlib.collections.PatchCollection", "matplotlib.collections.PolyCollection"
      ].includes(creator)) {
        symbols[match[1]] = "matplotlib.artist.Artist";
      } else if (["matplotlib.animation.FuncAnimation", "matplotlib.animation.ArtistAnimation"].includes(creator)) {
        symbols[match[1]] = "matplotlib.animation.Animation";
      } else if (["matplotlib.get_cmap", "matplotlib.pyplot.get_cmap", "matplotlib.colors.ListedColormap", "matplotlib.colors.LinearSegmentedColormap.from_list"].includes(creator)) {
        symbols[match[1]] = "matplotlib.colors.Colormap";
      } else if ([
        "matplotlib.colors.Normalize", "matplotlib.colors.LogNorm", "matplotlib.colors.SymLogNorm", "matplotlib.colors.PowerNorm",
        "matplotlib.colors.BoundaryNorm", "matplotlib.colors.TwoSlopeNorm", "matplotlib.colors.CenteredNorm", "matplotlib.colors.NoNorm"
      ].includes(creator)) {
        symbols[match[1]] = "matplotlib.colors.Normalize";
      } else if (creator === "matplotlib.transforms.Affine2D") {
        symbols[match[1]] = "matplotlib.transforms.Affine2D";
      } else if (creator === "matplotlib.path.Path") {
        symbols[match[1]] = "matplotlib.path.Path";
      } else if (["seaborn.relplot", "seaborn.displot", "seaborn.catplot", "seaborn.FacetGrid"].includes(creator)) {
        symbols[match[1]] = "seaborn.FacetGrid";
      } else if (["seaborn.pairplot", "seaborn.PairGrid"].includes(creator)) {
        symbols[match[1]] = "seaborn.PairGrid";
      } else if (["seaborn.jointplot", "seaborn.JointGrid"].includes(creator)) {
        symbols[match[1]] = "seaborn.JointGrid";
      } else if (creator === "seaborn.clustermap") {
        symbols[match[1]] = "seaborn.ClusterGrid";
      } else if ([
        "seaborn.scatterplot", "seaborn.lineplot", "seaborn.histplot", "seaborn.kdeplot", "seaborn.ecdfplot", "seaborn.rugplot",
        "seaborn.stripplot", "seaborn.swarmplot", "seaborn.boxplot", "seaborn.violinplot", "seaborn.boxenplot", "seaborn.pointplot",
        "seaborn.barplot", "seaborn.countplot", "seaborn.regplot", "seaborn.residplot", "seaborn.heatmap"
      ].includes(creator)) {
        symbols[match[1]] = "matplotlib.axes.Axes";
      } else if (creator === "seaborn.objects.Plot" || /^seaborn\.objects\.Plot\.(?:add|scale|facet|pair|label|limit|share|theme|layout)$/.test(creator)) {
        symbols[match[1]] = "seaborn.objects.Plot";
      } else if (["statsmodels.tsa.api.STL", "statsmodels.tsa.api.MSTL"].includes(creator)) {
        symbols[match[1]] = "statsmodels.Decomposition";
      } else if (/^statsmodels\.(?:api|formula\.api|tsa\.api)\./.test(creator) && !/\.(?:acf|acovf|pacf|ccf|adfuller|kpss|coint|q_stat|arma_order_select_ic|arma_generate_sample|add_constant|qqplot|qqplot_2samples)$/.test(creator)) {
        symbols[match[1]] = "statsmodels.Model";
      } else if (/^statsmodels\.Model\.(?:fit|fit_regularized)$/.test(creator)) {
        symbols[match[1]] = "statsmodels.Results";
      } else if (/^statsmodels\.Results\.(?:get_prediction|get_forecast)$/.test(creator)) {
        symbols[match[1]] = "statsmodels.PredictionResults";
      } else if (/^plotly\.express\./.test(creator) || ["plotly.graph_objects.Figure", "plotly.graph_objects.FigureWidget", "plotly.subplots.make_subplots", "plotly.io.from_json", "plotly.io.read_json"].includes(creator)) {
        symbols[match[1]] = "plotly.graph_objects.Figure";
      } else if (/^plotly\.graph_objects\.(?:Figure\.)?(?:add_trace|add_traces|add_scatter|add_bar|add_annotation|add_shape|add_vline|add_hline|add_vrect|add_hrect|update_layout|update_traces|update_xaxes|update_yaxes|update_annotations|update_shapes)$/.test(creator)) {
        symbols[match[1]] = "plotly.graph_objects.Figure";
      } else if (/^plotly\.graph_objects\.(?:Scatter|Scattergl|Bar|Pie|Histogram|Box|Violin|Heatmap|Contour|Surface|Scatter3d|Mesh3d|Candlestick|Ohlc|Waterfall|Funnel|Indicator|Table|Choropleth|Scattergeo|Scattermap)$/.test(creator)) {
        symbols[match[1]] = "plotly.graph_objects.Trace";
      } else if (creator.startsWith("sklearn.")) {
        symbols[match[1]] = inferExpressionType(inferredAssignment[2]) || creator;
      } else if (creator === "requests.Session") {
        symbols[match[1]] = "requests.Session";
      } else if (creator === "requests.Request") {
        symbols[match[1]] = "requests.Request";
      } else if (creator === "requests.Request.prepare" || creator === "requests.Session.prepare_request") {
        symbols[match[1]] = "requests.PreparedRequest";
      } else if (creator === "requests.PreparedRequest.copy") {
        symbols[match[1]] = "requests.PreparedRequest";
      } else if (creator === "requests.cookies.cookiejar_from_dict" || creator === "requests.cookies.RequestsCookieJar.copy") {
        symbols[match[1]] = "requests.cookies.RequestsCookieJar";
      } else if (creator === "requests.adapters.HTTPAdapter") {
        symbols[match[1]] = "requests.adapters.HTTPAdapter";
      } else if (["requests.auth.HTTPBasicAuth", "requests.auth.HTTPDigestAuth"].includes(creator)) {
        symbols[match[1]] = creator;
      } else if ([
        "requests.request", "requests.get", "requests.post", "requests.put", "requests.patch", "requests.delete", "requests.head", "requests.options",
        "requests.Session.request", "requests.Session.get", "requests.Session.post", "requests.Session.put", "requests.Session.patch", "requests.Session.delete", "requests.Session.head", "requests.Session.options", "requests.Session.send"
      ].includes(creator)) {
        symbols[match[1]] = "requests.Response";
      } else if ([
        "scipy.optimize.minimize", "scipy.optimize.minimize_scalar", "scipy.optimize.root", "scipy.optimize.root_scalar",
        "scipy.optimize.least_squares", "scipy.optimize.curve_fit", "scipy.optimize.linprog", "scipy.optimize.milp",
        "scipy.optimize.differential_evolution", "scipy.optimize.basinhopping", "scipy.optimize.shgo",
        "scipy.optimize.dual_annealing", "scipy.optimize.lsq_linear", "scipy.optimize.isotonic_regression"
      ].includes(creator)) {
        symbols[match[1]] = "scipy.optimize.OptimizeResult";
      } else if (creator === "scipy.integrate.solve_ivp") {
        symbols[match[1]] = "scipy.integrate.OdeResult";
      } else if (["scipy.integrate.RK23", "scipy.integrate.RK45", "scipy.integrate.DOP853", "scipy.integrate.BDF", "scipy.integrate.Radau", "scipy.integrate.LSODA"].includes(creator)) {
        symbols[match[1]] = "scipy.integrate.OdeSolver";
      } else if (["scipy.spatial.KDTree", "scipy.spatial.cKDTree"].includes(creator)) {
        symbols[match[1]] = "scipy.spatial.KDTree";
      } else if (["scipy.spatial.transform.Rotation.from_euler", "scipy.spatial.transform.Rotation.from_matrix", "scipy.spatial.transform.Rotation.from_rotvec"].includes(creator)) {
        symbols[match[1]] = "scipy.spatial.transform.Rotation";
      } else if (["scipy.interpolate.BSpline", "scipy.interpolate.CubicSpline", "scipy.interpolate.PchipInterpolator", "scipy.interpolate.RBFInterpolator"].includes(creator)) {
        symbols[match[1]] = creator;
      } else if (creator === "scipy.stats.gaussian_kde") {
        symbols[match[1]] = "scipy.stats.gaussian_kde";
      } else if (creator === "scipy.stats.qmc.Sobol") {
        symbols[match[1]] = "scipy.stats.qmc.Sobol";
      } else if (["scipy.stats.qmc.Halton", "scipy.stats.qmc.LatinHypercube"].includes(creator)) {
        symbols[match[1]] = "scipy.stats.qmc.QMCEngine";
      } else if ([
        "scipy.stats.pearsonr", "scipy.stats.spearmanr", "scipy.stats.kendalltau", "scipy.stats.ttest_1samp",
        "scipy.stats.ttest_ind", "scipy.stats.ttest_rel", "scipy.stats.mannwhitneyu", "scipy.stats.wilcoxon",
        "scipy.stats.shapiro", "scipy.stats.normaltest", "scipy.stats.ks_1samp", "scipy.stats.ks_2samp",
        "scipy.stats.pointbiserialr"
      ].includes(creator)) {
        symbols[match[1]] = "scipy.stats.SignificanceResult";
      } else if ([
        "scipy.sparse.csr_matrix", "scipy.sparse.csc_matrix", "scipy.sparse.coo_matrix", "scipy.sparse.lil_matrix",
        "scipy.sparse.dok_matrix", "scipy.sparse.bsr_matrix", "scipy.sparse.dia_matrix", "scipy.sparse.csr_array",
        "scipy.sparse.csc_array", "scipy.sparse.coo_array", "scipy.sparse.diags", "scipy.sparse.eye",
        "scipy.sparse.load_npz"
      ].includes(creator)) {
        symbols[match[1]] = "scipy.sparse.spmatrix";
      } else if (["scipy.sparse.linalg.LinearOperator", "scipy.sparse.linalg.aslinearoperator"].includes(creator)) {
        symbols[match[1]] = "scipy.sparse.linalg.LinearOperator";
      } else if (creator === "scipy.odr.ODR") {
        symbols[match[1]] = "scipy.odr.ODR";
      } else if (creator === "scipy.io.FortranFile") {
        symbols[match[1]] = "scipy.io.FortranFile";
      } else {
        const standardCreatorTypes = {
          "datetime.date.today": "datetime.date",
          "datetime.date.fromisoformat": "datetime.date",
          "datetime.date.fromordinal": "datetime.date",
          "datetime.datetime.now": "datetime.datetime",
          "datetime.datetime.fromisoformat": "datetime.datetime",
          "datetime.datetime.fromtimestamp": "datetime.datetime",
          "datetime.datetime.strptime": "datetime.datetime",
          "datetime.datetime.combine": "datetime.datetime",
          "datetime.time.fromisoformat": "datetime.time",
          "datetime.timedelta": "datetime.timedelta",
          "pathlib.Path": "pathlib.Path",
          "pathlib.PurePath": "pathlib.PurePath",
          "csv.DictWriter": "csv.DictWriter",
          "csv.writer": "csv.writer",
          "random.Random": "random.Random",
          "re.compile": "re.Pattern",
          "collections.Counter": "collections.Counter",
          "collections.deque": "collections.deque",
          "collections.ChainMap": "collections.ChainMap",
          "collections.OrderedDict": "collections.OrderedDict",
          "io.StringIO": "io.StringIO",
          "io.BytesIO": "io.BytesIO",
          "queue.Queue": "queue.Queue",
          "asyncio.Queue": "asyncio.Queue",
          "asyncio.Event": "asyncio.Event",
          "threading.Event": "threading.Event",
          "concurrent.futures.Future": "concurrent.futures.Future",
          "concurrent.futures.ThreadPoolExecutor": "concurrent.futures.ThreadPoolExecutor",
          "sqlite3.connect": "sqlite3.Connection",
          "traceback.TracebackException.from_exception": "traceback.TracebackException",
          "email.message.EmailMessage": "email.message.EmailMessage",
          "configparser.ConfigParser": "configparser.ConfigParser"
        };
        const numpyArrayCreators = new Set([
          "numpy.array", "numpy.asarray", "numpy.asanyarray", "numpy.arange", "numpy.linspace", "numpy.logspace", "numpy.geomspace",
          "numpy.zeros", "numpy.ones", "numpy.empty", "numpy.full", "numpy.copy", "numpy.reshape", "numpy.ravel", "numpy.transpose",
          "numpy.asfortranarray", "numpy.ascontiguousarray", "numpy.require", "numpy.from_dlpack", "numpy.matrix"
        ]);
        if (creator === "numpy.vectorize") symbols[match[1]] = "numpy.vectorized";
        else if (creator === "numpy.frompyfunc") symbols[match[1]] = "numpy.ufunc";
        else if (numpyArrayCreators.has(creator)) symbols[match[1]] = "numpy.ndarray";
        else if (creator === "numpy.random.default_rng") symbols[match[1]] = "numpy.random.Generator";
        else if (creator === "numpy.random.SeedSequence") symbols[match[1]] = "numpy.random.SeedSequence";
        else if (["numpy.lib.npyio.DataSource", "numpy.DataSource"].includes(creator)) symbols[match[1]] = creator;
        else if (creator === "numpy.memmap") symbols[match[1]] = "numpy.memmap";
        else if (["numpy.ma.array", "numpy.ma.masked_invalid"].includes(creator)) symbols[match[1]] = "numpy.ma.MaskedArray";
        else if (standardCreatorTypes[creator]) symbols[match[1]] = standardCreatorTypes[creator];
        else if (/^(?:str|bytes|bytearray)\./.test(creator)) symbols[match[1]] = creator.split(".")[0];
        else if (/^(?:list|tuple|set|frozenset|dict)\./.test(creator)) symbols[match[1]] = creator.split(".")[0];
        else if (/^hashlib\.[A-Za-z0-9_]+$/.test(creator)) symbols[match[1]] = "hashlib.Hash";
        else if (creator === "statistics.NormalDist.from_samples") symbols[match[1]] = "statistics.NormalDist";
        else if (creator === "contextvars.ContextVar") symbols[match[1]] = "contextvars.ContextVar";
        else if (["asyncio.Lock", "threading.Lock"].includes(creator)) symbols[match[1]] = creator;
        else if (creator === "logging.getLogger") symbols[match[1]] = "logging.Logger";
        else if (creator === "unittest.TestCase") symbols[match[1]] = "unittest.TestCase";
      }
    }
    Object.defineProperties(symbols, {
      __knownTypeNames: { value: new Set(knownTypeNames), enumerable: false },
      __knownFunctionNames: { value: new Set(knownFunctionNames), enumerable: false },
      __knownMethodNames: { value: new Set(knownMethodNames), enumerable: false },
      __knownFunctionReturnTypes: { value: new Map(knownFunctionReturnTypes), enumerable: false },
      __knownAttributeTypes: { value: new Map(knownAttributeTypes), enumerable: false }
    });
    return symbols;
  }

  function buildScopedSymbolTables(rows) {
    const rootLines = rows.filter(row => row.depth === 0).map(row => row.raw);
    const globalTable = buildSymbolTable(rootLines);
    activateSymbolTable(globalTable);
    rows.forEach((row, classIndex) => {
      if (row.nodeType !== "ClassDefinition") return;
      const declaration = row.raw.trim().match(/^class\s+([A-Za-z_]\w*)/);
      if (!declaration) return;
      for (let index = classIndex + 1; index < rows.length && rows[index].depth > row.depth; index += 1) {
        if (rows[index].depth !== row.depth + 1) continue;
        const field = rows[index].raw.trim().match(/^([A-Za-z_]\w*)\s*:\s*([^=]+?)(?:\s*=.*)?$/);
        if (!field) continue;
        const baseType = field[2].trim().replace(/^['"]|['"]$/g, "").split("|")[0].trim().split("[")[0].trim();
        globalTable.__knownAttributeTypes.set(`${declaration[1]}.${field[1]}`, normalizeName(baseType));
      }
    });
    knownAttributeTypes = new Map(globalTable.__knownAttributeTypes);
    const tables = Array.from({ length: rows.length }, () => globalTable);
    const scopes = [];
    rows.forEach((row, start) => {
      if (row.nodeType !== "FunctionDefinition") return;
      let end = start + 1;
      while (end < rows.length && rows[end].depth > row.depth) end += 1;
      const parent = [...scopes].reverse().find(scope => start > scope.start && end <= scope.end);
      const table = buildSymbolTable(rows.slice(start, end).map(item => item.raw), parent?.table || globalTable);
      scopes.push({ start, end, table });
      for (let index = start; index < end; index += 1) tables[index] = table;
    });
    return tables;
  }

  function activateSymbolTable(table) {
    symbolTable = table;
    knownTypeNames = new Set(table.__knownTypeNames || []);
    knownFunctionNames = new Set(table.__knownFunctionNames || []);
    knownMethodNames = new Set(table.__knownMethodNames || []);
    knownFunctionReturnTypes = new Map(table.__knownFunctionReturnTypes || []);
    knownAttributeTypes = new Map(table.__knownAttributeTypes || []);
  }

  function normalizeName(name) {
    const parts = name.split(".");
    if (symbolTable[parts[0]]) parts.splice(0, 1, ...symbolTable[parts[0]].split("."));
    return parts.join(".");
  }

  function inferExpressionType(expression) {
    const raw = stripOuterParentheses(expression.trim());
    if (raw === "True" || raw === "False" || /^not\s+/.test(raw)) return "bool";
    if (/^(?:[rRuU])?["']/.test(raw)) return "str";
    if (/^\[.*\]$/.test(raw)) return "list";
    if (/^\{.*\}$/.test(raw)) return raw.includes(":") ? "dict" : "set";
    if (/^-?\d+$/.test(raw)) return "int";
    if (/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(raw)) return "float";
    if (/^[A-Za-z_]\w*$/.test(raw)) return symbolTable[raw] || null;
    if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(raw)) {
      const lastPart = raw.split(".").pop();
      if (symbolTable[lastPart]) return symbolTable[lastPart];
    }
    const booleanOperator = topLevelOperator(raw, ["or", "and", "not in", "is not", "==", "!=", "<=", ">=", "<", ">", "in", "is"]);
    if (booleanOperator) return "bool";
    const binary = topLevelOperator(raw, [" or ", " and ", "|", "&", "^", "+", "-", "*", "/", "//", "%"]);
    if (binary) {
      const leftType = inferExpressionType(raw.slice(0, binary.index));
      const rightType = inferExpressionType(raw.slice(binary.index + binary.operator.length));
      const candidates = [leftType, rightType];
      if (candidates.includes("pandas.Series")) return "pandas.Series";
      if (candidates.includes("pandas.DataFrame")) return "pandas.DataFrame";
      if (candidates.includes("numpy.ndarray")) return "numpy.ndarray";
      if (binary.operator === "/" && ["pathlib.Path", "pathlib.PurePath"].includes(leftType)) return leftType;
    }
    const attribute = attributeParts(raw);
    if (attribute) {
      const ownerType = inferExpressionType(attribute.owner);
      const declaredType = ownerType && knownAttributeTypes.get(`${ownerType}.${attribute.name}`);
      if (declaredType) return declaredType;
      if (ownerType === "pathlib.Path" && attribute.name === "parent") return "pathlib.Path";
      if (ownerType === "pathlib.Path" && ["name", "stem", "suffix"].includes(attribute.name)) return "str";
      if (["pandas.Series", "pandas.Index"].includes(ownerType) && attribute.name === "str") return "pandas.Series.str";
      if (ownerType === "statsmodels.Results" && ["params", "pvalues", "tvalues", "bse", "fittedvalues", "resid"].includes(attribute.name)) return "pandas.Series";
      if (ownerType === "pandas.DataFrame" && attribute.name === "columns") return "pandas.Index";
      if (ownerType === "matplotlib.axes.Axes" && ["xaxis", "yaxis"].includes(attribute.name)) return "matplotlib.axis.Axis";
      if (attribute.name === "columns") return "pandas.Index";
      if (["xaxis", "yaxis"].includes(attribute.name)) return "matplotlib.axis.Axis";
    }
    const indexed = indexedParts(raw);
    if (indexed) {
      const loc = indexed.owner.match(/^(.+)\.(loc|iloc)$/);
      const ownerType = inferExpressionType(loc ? loc[1] : indexed.owner);
      if (ownerType === "pandas.DataFrame") {
        const keys = splitArgs(indexed.key);
        if (loc && keys.length > 1 && !/^\[/.test(keys[1].trim())) return "pandas.Series";
        return /^\[/.test(indexed.key.trim()) || indexed.key.includes(":") ? "pandas.DataFrame" : "pandas.Series";
      }
      if (ownerType === "pandas.Series") return "pandas.Series";
      if (ownerType === "pandas.core.groupby.GroupBy") return "pandas.core.groupby.GroupBy";
      if (ownerType === "numpy.ndarray") return "numpy.ndarray";
      if (ownerType === "matplotlib.axes.Axes") return "matplotlib.axes.Axes";
      if (ownerType === "matplotlib.axes.AxesMap") return "matplotlib.axes.Axes";
    }
    const call = callParts(raw);
    if (!call) return null;
    let normalized = normalizeName(call.name);
    if (call.ownerExpression) {
      const ownerType = inferExpressionType(call.ownerExpression);
      if (ownerType) normalized = `${ownerType}.${call.methodName}`;
    }
    if (!call.ownerExpression && knownTypeNames.has(call.name)) return call.name;
    if (!call.ownerExpression && knownFunctionReturnTypes.has(call.name)) return knownFunctionReturnTypes.get(call.name);
    if (["pathlib.Path", "pathlib.PurePath", "pathlib.PurePosixPath", "pathlib.PureWindowsPath"].includes(normalized)) return normalized === "pathlib.Path" ? normalized : "pathlib.PurePath";
    if (normalized === "fractions.Fraction") return "fractions.Fraction";
    if (["pathlib.Path.open", "gzip.open"].includes(normalized)) return "io.IOBase";
    if (["xml.etree.ElementTree.Element", "xml.etree.ElementTree.SubElement"].includes(normalized)) return "xml.etree.ElementTree.Element";
    if (["xml.etree.ElementTree.ElementTree", "xml.etree.ElementTree.parse"].includes(normalized)) return "xml.etree.ElementTree.ElementTree";
    if (normalized === "xml.etree.ElementTree.ElementTree.getroot") return "xml.etree.ElementTree.Element";
    if (normalized === "sqlite3.Connection.execute") return "sqlite3.Cursor";
    if (normalized === "concurrent.futures.ThreadPoolExecutor") return "concurrent.futures.ThreadPoolExecutor";
    if (/^pathlib\.Path\.(?:cwd|home|absolute|resolve|with_name|with_suffix|relative_to)$/.test(normalized)) return "pathlib.Path";
    if (["bool", "all", "any", "hasattr", "isinstance", "issubclass", "callable"].includes(normalized)) return "bool";
    if (normalized === "pandas.DataFrame") return "pandas.DataFrame";
    if (normalized === "pandas.Series") return "pandas.Series";
    if (["pandas.Timestamp", "pandas.Timestamp.now", "pandas.Timestamp.floor"].includes(normalized)) return "pandas.Timestamp";
    if (normalized === "pandas.json_normalize") return "pandas.DataFrame";
    if (["pandas.cut", "pandas.qcut"].includes(normalized)) return "pandas.Series";
    if (normalized === "pandas.crosstab") return "pandas.DataFrame";
    if (normalized === "pandas.Index.to_flat_index") return "pandas.Index";
    if (["pandas.DataFrame.groupby", "pandas.Series.groupby"].includes(normalized)) return "pandas.core.groupby.GroupBy";
    if (["pandas.DataFrame.rolling", "pandas.Series.rolling", "pandas.core.groupby.GroupBy.rolling"].includes(normalized)) return "pandas.core.window.Rolling";
    if (["pandas.DataFrame.expanding", "pandas.Series.expanding"].includes(normalized)) return "pandas.core.window.Expanding";
    if (["pandas.DataFrame.ewm", "pandas.Series.ewm"].includes(normalized)) return "pandas.core.window.ExponentialMovingWindow";
    if (["pandas.DataFrame.resample", "pandas.Series.resample", "pandas.core.groupby.GroupBy.resample"].includes(normalized)) return "pandas.core.resample.Resampler";
    if (normalized === "pandas.Series.to_frame") return "pandas.DataFrame";
    if (normalized === "pandas.Series.reset_index") return "pandas.DataFrame";
    if (["pandas.Series.rank", "pandas.Series.value_counts"].includes(normalized)) return "pandas.Series";
    if (/^pandas\.DataFrame\./.test(normalized)) return "pandas.DataFrame";
    if (/^pandas\.Series\.(?:astype|fillna|ffill|bfill|dropna|notna|isna|replace|interpolate|sort_values|sort_index|shift|diff|pct_change|abs|round|clip|add|sub|mul|div|floordiv|mod|pow|eq|ne|lt|le|gt|ge|set_axis)$/.test(normalized)) return "pandas.Series";
    if (/^pandas\.DataFrame\.(?:astype|fillna|ffill|bfill|dropna|replace|interpolate|sort_values|sort_index|set_index|reset_index|rename|assign|pivot_table|clip|set_axis)$/.test(normalized)) return "pandas.DataFrame";
    if (/^pandas\.(?:Series|DataFrame)\.to_numpy$/.test(normalized)) return "numpy.ndarray";
    if (/^(?:str|bytes|bytearray)\./.test(normalized)) return normalized.split(".")[0];
    if (/^pandas\.(?:concat|merge|pivot|pivot_table|crosstab|melt|wide_to_long)$/.test(normalized)) return "pandas.DataFrame";
    if (/^pandas\.core\.groupby\.GroupBy\.(?:agg|aggregate|sum|mean|median|min|max|count|size|first|last)$/.test(normalized)) return "pandas.DataFrame";
    if (/^pandas\.core\.(?:groupby|window|resample)\./.test(normalized)) return "pandas.Series";
    if (/^pandas\.Series\.str\.(?:strip|lstrip|rstrip|lower|upper|title|capitalize|casefold|replace|slice|normalize)$/.test(normalized)) return "pandas.Series";
    if (normalized === "scipy.stats.gaussian_kde") return "scipy.stats.gaussian_kde";
    if (["seaborn.relplot", "seaborn.displot", "seaborn.catplot", "seaborn.FacetGrid"].includes(normalized)) return "seaborn.FacetGrid";
    if (["seaborn.pairplot", "seaborn.PairGrid"].includes(normalized)) return "seaborn.PairGrid";
    if (["seaborn.jointplot", "seaborn.JointGrid"].includes(normalized)) return "seaborn.JointGrid";
    if (normalized === "seaborn.clustermap") return "seaborn.ClusterGrid";
    if (/^seaborn\.objects\.Plot(?:\.(?:add|scale|facet|pair|label|limit|share|theme|layout))?$/.test(normalized)) return "seaborn.objects.Plot";
    if (["statsmodels.tsa.api.STL", "statsmodels.tsa.api.MSTL"].includes(normalized)) return "statsmodels.Decomposition";
    if (/^statsmodels\.(?:api|formula\.api|tsa\.api)\./.test(normalized) && !/\.(?:acf|acovf|pacf|ccf|adfuller|kpss|coint|q_stat|arma_order_select_ic|arma_generate_sample|add_constant|qqplot|qqplot_2samples)$/.test(normalized)) return "statsmodels.Model";
    if (/^statsmodels\.Model\.(?:fit|fit_regularized)$/.test(normalized)) return "statsmodels.Results";
    if (/^statsmodels\.Results\.(?:get_prediction|get_forecast)$/.test(normalized)) return "statsmodels.PredictionResults";
    if (/^plotly\.express\./.test(normalized) || ["plotly.graph_objects.Figure", "plotly.graph_objects.FigureWidget", "plotly.subplots.make_subplots", "plotly.io.from_json", "plotly.io.read_json"].includes(normalized)) return "plotly.graph_objects.Figure";
    if (/^plotly\.graph_objects\.Figure\.(?:add_trace|add_traces|add_scatter|add_bar|add_annotation|add_shape|add_vline|add_hline|add_vrect|add_hrect|update_layout|update_traces|update_xaxes|update_yaxes|update_annotations|update_shapes)$/.test(normalized)) return "plotly.graph_objects.Figure";
    if (/^plotly\.graph_objects\.(?:Scatter|Scattergl|Bar|Pie|Histogram|Box|Violin|Heatmap|Contour|Surface|Scatter3d|Mesh3d|Candlestick|Ohlc|Waterfall|Funnel|Indicator|Table|Choropleth|Scattergeo|Scattermap)$/.test(normalized)) return "plotly.graph_objects.Trace";
    if (normalized === "requests.Session") return "requests.Session";
    if (normalized === "requests.Request") return "requests.Request";
    if (["requests.Request.prepare", "requests.Session.prepare_request", "requests.PreparedRequest.copy"].includes(normalized)) return "requests.PreparedRequest";
    if (/^requests\.(?:request|get|post|put|patch|delete|head|options|Session\.(?:request|get|post|put|patch|delete|head|options|send)|adapters\.HTTPAdapter\.send)$/.test(normalized)) return "requests.Response";
    if (["requests.cookies.cookiejar_from_dict", "requests.cookies.RequestsCookieJar.copy"].includes(normalized)) return "requests.cookies.RequestsCookieJar";
    if (/^sklearn\..+\.[A-Z][A-Za-z0-9_]*$/.test(normalized)) return normalized;
    if (/^sklearn\..+\.(?:fit|partial_fit|set_params|set_output)$/.test(normalized)) return normalized.replace(/\.[^.]+$/, "");
    if (/^sklearn\..+\.(?:predict|predict_proba|predict_log_proba|decision_function|transform|fit_transform|inverse_transform|fit_predict|score_samples|kneighbors|radius_neighbors|apply)$/.test(normalized)) return "numpy.ndarray";
    if (/^(?:numpy\.|scipy\.).+/.test(normalized)) return "numpy.ndarray";
    return null;
  }

  function describeCallable(argument, parameterType = null) {
    const raw = argument.trim();
    const lambda = raw.match(/^lambda\s*(.*?)\s*:\s*(.+)$/);
    if (lambda) {
      const savedTypes = new Map();
      if (parameterType) {
        for (const parameter of splitArgs(lambda[1])) {
          const name = parameter.trim();
          savedTypes.set(name, symbolTable[name]);
          symbolTable[name] = parameterType;
        }
      }
      const body = explainExpression(lambda[2]);
      for (const [name, saved] of savedTypes) {
        if (saved === undefined) delete symbolTable[name];
        else symbolTable[name] = saved;
      }
      return {
        text: t("values", "lambdaFunction", {
          parameters: splitArgs(lambda[1]).filter(Boolean).map(parameter => `« ${parameter.trim()} »`).join(" et ") || t("values", "noParameters"),
          result: body.boolean ? conditionText(body, lambda[2]) : valueText(body, lambda[2])
        }),
        exact: body.exact
      };
    }
    if (knownTypeNames.has(raw)) return { text: t("values", "typeConversionFunction", { value: raw }), exact: true };
    if (/^[A-Za-z_]\w*$/.test(raw)) return { text: t("values", "functionReference", { value: raw }), exact: true };
    const method = raw.match(/^(.+)\.([A-Za-z_]\w*)$/);
    if (method) return { text: t("values", "methodReference", { owner: method[1], value: method[2] }), exact: true };
    const explained = explainExpression(raw);
    return { text: valueText(explained, raw), exact: explained.exact };
  }

  function knownFunctionText(name, args) {
    let normalized = normalizeName(name);
    if (normalized === "sklearn.cluster.dbscan") normalized = "sklearn.cluster.dbscan_function";
    const conventionalAliasName = name
      .replace(/^sns\./, "seaborn.")
      .replace(/^so\./, "seaborn.objects.");
    const callableObjectType = inferExpressionType(name);
    if (callableObjectType && (translations.callables?.[callableObjectType] || translations.callableValues?.[callableObjectType])) {
      normalized = callableObjectType;
    }
    const expressionMethod = name.match(/^(.+)\.([A-Za-z_]\w*)$/);
    if (expressionMethod) {
      const ownerType = inferExpressionType(expressionMethod[1]);
      if (ownerType) normalized = `${ownerType}.${expressionMethod[2]}`;
    }
    if (normalized === "random.Random") normalized = "random.RandomGenerator";
    if (normalized === "range") return explainRangeResult(args);
    const template = translations.functions[normalized] || translations.functions[conventionalAliasName] || translations.functions[name];
    const callableTemplate = translations.callables?.[normalized] || translations.callables?.[name];
    const methodName = normalized.split(".").pop();
    const inheritedMethodRules = [
      ["scipy.stats.qmc.Sobol.", "scipy.stats.qmc.QMCEngine."],
      ["matplotlib.lines.Line2D.", "matplotlib.artist.Artist."],
      ["matplotlib.axes.Axes.", "matplotlib.artist.Artist."],
      ["matplotlib.figure.Figure.", "matplotlib.artist.Artist."],
      ["matplotlib.transforms.Affine2D.", "matplotlib.transforms.Transform."]
    ];
    const inheritedRule = inheritedMethodRules.find(([derived]) => normalized.startsWith(derived));
    const inheritedMethod = inheritedRule ? normalized.replace(inheritedRule[0], inheritedRule[1]) : null;
    const methodTemplate = translations.methods && (translations.methods[normalized] || (inheritedMethod && translations.methods[inheritedMethod]) || translations.methods[methodName]);
    const sklearnTemplate = normalized.startsWith("sklearn.") && translations.sklearnMethods?.[methodName];
    const resolvedCallableObject = normalized !== name && Boolean(callableTemplate);
    const selected = (resolvedCallableObject ? callableTemplate : template) || callableTemplate || sklearnTemplate || methodTemplate;
    if (!selected) return null;
    const rawOwner = resolvedCallableObject ? name : (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name);
    const ownerNeedsExplanation = resolvedCallableObject || (name.includes(".") && !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(rawOwner));
    const explainedOwner = ownerNeedsExplanation ? explainExpression(rawOwner) : null;
    let owner = explainedOwner
      ? comparisonOperand(valueText(explainedOwner, rawOwner)).replace(/^«\s*([\s\S]*?)\s*»$/, "$1")
      : rawOwner;
    if (/^pathlib\.Path\./.test(normalized) && !explainedOwner) owner = `« ${rawOwner} »`;
    const parsed = args.map(raw => ({ raw, ...splitKeywordArgument(raw) }));
    const callableFirstArgument = new Set([
      "map", "filter", "iter", "functools.reduce", "numpy.fromfunction", "numpy.vectorize", "numpy.frompyfunc", "numpy.apply_along_axis", "numpy.apply_over_axes",
      "scipy.optimize.minimize", "scipy.optimize.minimize_scalar", "scipy.optimize.root", "scipy.optimize.root_scalar",
      "scipy.optimize.brentq", "scipy.optimize.newton", "scipy.optimize.bisect", "scipy.optimize.brenth", "scipy.optimize.ridder",
      "scipy.optimize.fsolve", "scipy.optimize.fixed_point", "scipy.optimize.brent", "scipy.optimize.golden",
      "scipy.optimize.least_squares", "scipy.optimize.curve_fit", "scipy.optimize.differential_evolution",
      "scipy.optimize.basinhopping", "scipy.optimize.shgo", "scipy.optimize.dual_annealing",
      "scipy.integrate.quad", "scipy.integrate.quad_vec", "scipy.integrate.dblquad", "scipy.integrate.tplquad",
      "scipy.integrate.nquad", "scipy.integrate.fixed_quad", "scipy.integrate.qmc_quad", "scipy.integrate.tanhsinh",
      "scipy.integrate.cubature", "scipy.integrate.solve_ivp", "scipy.integrate.solve_bvp", "scipy.integrate.odeint",
      "scipy.differentiate.derivative", "scipy.differentiate.jacobian", "scipy.differentiate.hessian",
      "scipy.ndimage.generic_filter", "scipy.stats.permutation_test", "scipy.stats.monte_carlo_test", "scipy.odr.Model"
      , "pandas.DataFrame.apply", "pandas.DataFrame.map", "pandas.DataFrame.agg", "pandas.DataFrame.transform",
      "pandas.Series.apply", "pandas.Series.map", "pandas.Series.agg", "pandas.Series.transform",
      "pandas.core.groupby.GroupBy.agg", "pandas.core.groupby.GroupBy.aggregate", "pandas.core.groupby.GroupBy.apply",
      "pandas.core.groupby.GroupBy.transform", "pandas.core.groupby.GroupBy.filter",
      "pandas.core.window.Rolling.agg", "pandas.core.window.Rolling.aggregate", "pandas.core.window.Rolling.apply",
      "pandas.core.window.Expanding.agg", "pandas.core.window.Expanding.aggregate", "pandas.core.window.Expanding.apply",
      "pandas.core.window.ExponentialMovingWindow.agg", "pandas.core.window.ExponentialMovingWindow.aggregate",
      "pandas.core.resample.Resampler.agg", "pandas.core.resample.Resampler.aggregate", "pandas.core.resample.Resampler.apply", "pandas.core.resample.Resampler.transform"
    ]);
    const callablePositions = {
      "scipy.stats.permutation_test": [1],
      "scipy.stats.monte_carlo_test": [1, 2],
      "scipy.ndimage.generic_filter": [1],
      "scipy.integrate.solve_bvp": [0, 1]
    };
    const callableIndexes = new Set(callablePositions[normalized] || (callableFirstArgument.has(normalized) ? [0] : []));
    const described = parsed.map((argument, index) => {
      const pandasCallableParameter = /^pandas\.(?:DataFrame|Series|core\.)/.test(normalized) ? "pandas.Series" : null;
      const result = callableIndexes.has(index) || ["key", "matvec", "rmatvec", "matmat", "statistic", "rvs"].includes(argument.name)
        ? describeCallable(argument.value, pandasCallableParameter)
        : (() => {
            const explained = explainExpression(argument.value);
            return { text: valueText(explained, argument.value), exact: explained.exact };
          })();
      return { ...argument, description: result.text, exact: result.exact };
    });
    const positional = described.filter(argument => !argument.name);
    const keywords = Object.fromEntries(described.filter(argument => argument.name).map(argument => [argument.name, argument]));
    const argumentText = described.map(argument => argument.name
      ? t("functionClauses", "namedArgument", { name: argument.name, value: argument.description })
      : argument.description);
    const values = {
      args: argumentText.join(argumentText.length === 2 ? " et " : ", "),
      owner,
      precisionClause: "",
      keyClause: "",
      defaultClause: "",
      startClause: "",
      reverseClause: "",
      optionsClause: "",
      contextClause: "",
      typeClause: "",
      dictionary: t("values", "emptyDictionary")
    };
    described.forEach((argument, index) => { values[index] = argument.description; });

    const optionalValue = (keyword, position) => keywords[keyword] || positional[position];
    if (normalized === "round") {
      const precision = optionalValue("ndigits", 1);
      if (precision) values.precisionClause = t("functionClauses", "precision", { value: comparisonOperand(precision.description) });
    }
    if (["min", "max", "sorted"].includes(normalized)) {
      const criterion = keywords.key;
      if (criterion) values.keyClause = t("functionClauses", "key", { value: describeCallable(criterion.value).text });
      if (keywords.default) values.defaultClause = t("functionClauses", "default", { value: keywords.default.description });
      if (keywords.reverse) values.reverseClause = t("functionClauses", "reverse", { value: keywords.reverse.description });
    }
    if (normalized === "next" && positional[1]) values.defaultClause = t("functionClauses", "default", { value: positional[1].description });
    if (normalized === "getattr" && positional[2]) values.defaultClause = t("functionClauses", "default", { value: positional[2].description });
    if (methodName === "get" && positional[1]) values.defaultClause = t("functionClauses", "default", { value: positional[1].description });
    if (normalized === "enumerate") {
      const start = optionalValue("start", 1);
      if (start) values.startClause = t("functionClauses", "start", { value: comparisonOperand(start.description) });
    }
    if (normalized === "isinstance" && positional[1]) {
      const typeSource = stripOuterParentheses(positional[1].value);
      values.typeClause = splitArgs(typeSource).length > 1
        ? t("functionClauses", "multipleTypes", { value: positional[1].description })
        : t("functionClauses", "singleType", { value: positional[1].description });
    }
    if (normalized === "dict") {
      const entries = described.filter(argument => argument.name).map(argument => t("values", "dictionaryEntry", { key: `« ${argument.name} »`, value: argument.description }));
      if (positional[0] && entries.length) values.dictionary = t("values", "dictionaryFromAndEntries", { source: positional[0].description, entries: entries.join(", ") });
      else if (positional[0]) values.dictionary = t("values", "dictionaryFrom", { source: positional[0].description });
      else if (entries.length) values.dictionary = t("values", "dictionaryEntries", { entries: entries.join(", ") });
    }
    if (["pandas.DataFrame", "pandas.Series"].includes(normalized)) {
      values[0] = positional[0]?.description || t("values", "emptyList");
      const constructorOptions = described.filter(argument => argument.name).map(argument =>
        t("functionClauses", "namedArgument", { name: argument.name, value: argument.description }));
      values.optionsClause = constructorOptions.length
        ? t("functionClauses", "additionalArguments", { value: constructorOptions.join(constructorOptions.length === 2 ? " et " : ", ") })
        : "";
    }
    if (normalized === "compile" && described.length > 3) {
      values.optionsClause = t("functionClauses", "compileOptions", { value: described.slice(3).map(argument => argumentText[described.indexOf(argument)]).join(", ") });
    }
    if (normalized === "compile") {
      if (values[1]) values[1] = comparisonOperand(values[1]);
      if (values[2]) values[2] = comparisonOperand(values[2]);
    }
    if (["eval", "exec"].includes(normalized) && positional[1]) {
      values.contextClause = positional[2]
        ? t("functionClauses", "contexts", { globals: positional[1].description, locals: positional[2].description })
        : t("functionClauses", "globalsContext", { globals: positional[1].description });
    }

    const nominalTemplate = (resolvedCallableObject && (translations.callableValues?.[normalized] || translations.callableValues?.[name]))
      || translations.functionValues?.[normalized]
      || translations.functionValues?.[name]
      || translations.callableValues?.[normalized]
      || translations.callableValues?.[name]
      || translations.methodValues?.[normalized]
      || translations.methodValues?.[methodName];
    const conditionTemplate = translations.functionConditions?.[normalized] || translations.functionConditions?.[name];
    const numericPlaceholders = new Set(Array.from(selected.matchAll(/\{(\d+)\}/g), match => Number(match[1])));
    const explicitlyHandled = new Set(["round", "min", "max", "sorted", "next", "getattr", "enumerate", "dict", "compile", "eval", "exec", "isinstance", "map", "filter", "zip", "reversed", "slice", "pandas.DataFrame", "pandas.Series"]);
    const speciallyRepresented = explicitlyHandled.has(normalized) || methodName === "get";
    const unrepresented = selected.includes("{args}") || speciallyRepresented
      ? []
      : described.filter((argument, index) => !numericPlaceholders.has(index));
    const additionalArguments = unrepresented.length
      ? t("functionClauses", "additionalArguments", {
          value: unrepresented.map(argument => argument.name
            ? t("functionClauses", "namedArgument", { name: argument.name, value: argument.description })
            : argument.description).join(unrepresented.length === 2 ? " et " : ", ")
        })
      : "";
    const allRepresented = selected.includes("{args}")
      || explicitlyHandled.has(normalized)
      || methodName === "get"
      || described.every((argument, index) => numericPlaceholders.has(index))
      || Boolean(additionalArguments);
    const text = `${format(selected, values)}${additionalArguments}`;
    const sklearnEstimatorNominal = /^sklearn\..+\.[A-Z][A-Za-z0-9_]*$/.test(normalized) && translations.sklearnEstimatorValue
      ? format(translations.sklearnEstimatorValue, { name: methodName, args: values.args })
      : "";
    const nominal = nominalTemplate
      ? `${format(nominalTemplate, values)}${additionalArguments}`
      : sklearnEstimatorNominal
        ? `${sklearnEstimatorNominal}${additionalArguments}`
      : (/^(Je |J’)/.test(text) ? t("values", "resultOf", { value: `${name}(${args.join(", ")})` }) : text);
    const actionExact = described.every(argument => argument.exact) && allRepresented && (!explainedOwner || explainedOwner.exact);
    const hasPreciseValue = Boolean(nominalTemplate) || Boolean(sklearnEstimatorNominal) || !/^(Je |J’)/.test(text);
    return {
      text,
      valueText: nominal,
      conditionText: conditionTemplate ? format(conditionTemplate, values) : undefined,
      boolean: Boolean(conditionTemplate),
      exact: actionExact && hasPreciseValue,
      actionExact
    };
  }

  function describeArgument(argument) {
    const parsed = splitKeywordArgument(argument);
    const explained = explainExpression(parsed.value);
    return valueText(explained, parsed.value);
  }

  function stripOuterParentheses(text) {
    let value = text.trim();
    let changed = true;
    while (changed && value.startsWith("(") && value.endsWith(")")) {
      changed = false;
      let depth = 0, quote = null, escaped = false;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (escaped) { escaped = false; continue; }
        if (char === "\\" && quote) { escaped = true; continue; }
        if (quote) { if (char === quote) quote = null; continue; }
        if (char === "'" || char === '"') { quote = char; continue; }
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        if (depth === 0 && index < value.length - 1) break;
        if (index === value.length - 1 && depth === 0) {
          value = value.slice(1, -1).trim();
          changed = true;
        }
      }
    }
    return value;
  }

  function indexedParts(text) {
    const value = text.trim();
    if (!value.endsWith("]")) return null;
    let depth = 0, quote = null, escaped = false;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const char = value[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\" && quote) { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "]") { depth += 1; continue; }
      if (char !== "[") continue;
      depth -= 1;
      if (depth === 0) {
        const owner = value.slice(0, index).trim();
        return owner ? { owner, key: value.slice(index + 1, -1).trim() } : null;
      }
    }
    return null;
  }

  function explainIndex(source) {
    const parts = splitArgs(source);
    const described = parts.map(part => {
      const value = part.trim();
      if (value === "...") return { text: t("values", "ellipsis"), exact: true, slice: true };
      if (value === ":" || topLevelOperator(value, [":"])) return { text: t("values", "slice", { value }), exact: true, slice: true };
      const explained = explainExpression(value);
      return { text: valueText(explained, value), exact: explained.exact, slice: /^slice\s*\(/.test(value) };
    });
    if (described.length === 1) return described[0];
    const text = t("values", "tuple", { value: described.map(item => item.text).join(", ") });
    return { text, exact: described.every(item => item.exact), slice: described.some(item => item.slice) };
  }

  function topLevelOperator(text, operators, fromRight = false) {
    const matches = [];
    let depth = 0, quote = null, escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\" && quote) { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if ("([{ ".includes(char) && char !== " ") { depth += 1; continue; }
      if (")] }".replace(/ /g, "").includes(char)) { depth -= 1; continue; }
      if (depth !== 0) continue;
      for (const operator of operators) {
        if (!text.startsWith(operator, index)) continue;
        const isWord = /^[a-z]/i.test(operator);
        const before = text[index - 1] || " ";
        const after = text[index + operator.length] || " ";
        if (isWord && (/\w/.test(before) || /\w/.test(after))) continue;
        if ((operator === "<" && (before === "<" || after === "<")) || (operator === ">" && (before === ">" || after === ">"))) continue;
        if ((operator === "*" && (before === "*" || after === "*")) || (operator === "/" && (before === "/" || after === "/"))) continue;
        if ((operator === "+" || operator === "-") && /[eE]/.test(before) && /\d/.test(after)) continue;
        if ((operator === "+" || operator === "-") && (!text.slice(0, index).trim() || /[+\-*/%<(=,:]$/.test(text.slice(0, index).trim()))) continue;
        matches.push({ index, operator });
      }
    }
    return fromRight ? matches[matches.length - 1] : matches[0];
  }

  function comparisonOperand(text) {
    return text
      .replace(/^la valeur de la variable /, "")
      .replace(/^la valeur de l’attribut /, "")
      .replace(/^le nombre entier /, "")
      .replace(/^le nombre décimal /, "")
      .replace(/^le texte /, "");
  }

  function expressionResult(key, left, right) {
    const booleanKeys = new Set([
      "not", "equal", "notEqual", "less", "lessOrEqual", "greater",
      "greaterOrEqual", "in", "notIn", "is", "isNot"
    ]);
    const isBoolean = booleanKeys.has(key);
    const isLogical = key === "and" || key === "or" || key === "not";
    const logicalBoolean = isLogical && left.boolean && (!right || right.boolean);
    const leftValue = isLogical ? conditionText(left) : valueText(left);
    const rightValue = right ? (isLogical ? conditionText(right) : valueText(right)) : undefined;
    const text = t("expressions", key, {
      left: isBoolean || isLogical ? comparisonOperand(leftValue) : leftValue,
      right: right ? (isBoolean || isLogical ? comparisonOperand(rightValue) : rightValue) : undefined
    });
    const logicalValueText = key === "or"
      ? t("expressions", "orValue", { left: valueText(left), right: valueText(right) })
      : key === "and"
        ? t("expressions", "andValue", { left: valueText(left), right: valueText(right) })
        : text;
    return {
      text,
      valueText: logicalValueText,
      conditionText: isBoolean || isLogical ? text : undefined,
      exact: left.exact && (right ? right.exact : true),
      boolean: isBoolean || logicalBoolean
    };
  }

  function explainComprehension(content, kind) {
    const forOperator = topLevelOperator(content, ["for"]);
    if (!forOperator) return null;
    const resultSource = content.slice(0, forOperator.index).trim();
    const afterFor = content.slice(forOperator.index + 3).trim();
    const inOperator = topLevelOperator(afterFor, ["in"]);
    if (!resultSource || !inOperator) return null;
    const target = afterFor.slice(0, inOperator.index).trim();
    const afterIn = afterFor.slice(inOperator.index + 2).trim();
    const nestedFor = topLevelOperator(afterIn, ["for"]);
    if (nestedFor) {
      const firstIterableSource = afterIn.slice(0, nestedFor.index).trim();
      const nestedClause = afterIn.slice(nestedFor.index + 3).trim();
      const nestedIn = topLevelOperator(nestedClause, ["in"]);
      if (!nestedIn) return null;
      const nestedTarget = nestedClause.slice(0, nestedIn.index).trim();
      const nestedAfterIn = nestedClause.slice(nestedIn.index + 2).trim();
      const nestedConditionOperator = topLevelOperator(nestedAfterIn, ["if"]);
      const nestedIterableSource = (nestedConditionOperator ? nestedAfterIn.slice(0, nestedConditionOperator.index) : nestedAfterIn).trim();
      const nestedConditionSource = nestedConditionOperator ? nestedAfterIn.slice(nestedConditionOperator.index + 2).trim() : "";
      const result = explainExpression(resultSource);
      const firstIterable = explainExpression(firstIterableSource);
      const nestedIterable = explainExpression(nestedIterableSource);
      const nestedCondition = nestedConditionSource ? explainExpression(nestedConditionSource) : null;
      const text = t("values", "nestedGeneratorComprehension", {
        result: valueText(result, resultSource), target, iterable: valueText(firstIterable, firstIterableSource),
        nestedTarget, nestedIterable: valueText(nestedIterable, nestedIterableSource),
        conditionClause: nestedCondition
          ? t("functionClauses", "comprehensionCondition", { condition: conditionText(nestedCondition, nestedConditionSource) })
          : ""
      });
      return { text, valueText: text, exact: result.exact && firstIterable.exact && nestedIterable.exact && (!nestedCondition || nestedCondition.exact) };
    }
    const conditionOperator = topLevelOperator(afterIn, ["if"]);
    const iterableSource = (conditionOperator ? afterIn.slice(0, conditionOperator.index) : afterIn).trim();
    const conditionSource = conditionOperator ? afterIn.slice(conditionOperator.index + 2).trim() : "";
    if (!target || !iterableSource || topLevelOperator(iterableSource, ["for"])) return null;

    const iterable = explainExpression(iterableSource);
    const savedTargetTypes = new Map();
    if (inferExpressionType(iterableSource) === "pandas.core.groupby.GroupBy") {
      const targetNames = target.replace(/[()]/g, "").split(",").map(name => name.trim()).filter(Boolean);
      const groupName = targetNames[targetNames.length - 1];
      if (groupName) {
        savedTargetTypes.set(groupName, symbolTable[groupName]);
        symbolTable[groupName] = "pandas.DataFrame";
      }
    }
    const condition = conditionSource ? explainExpression(conditionSource) : null;
    const values = {
      target,
      iterable: valueText(iterable, iterableSource),
      conditionClause: condition
        ? t("functionClauses", "comprehensionCondition", { condition: conditionText(condition, conditionSource) })
        : ""
    };
    let resultExact = true;
    const targetPattern = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const targetIsCalled = new RegExp(`^${targetPattern}\\s*\\(`).test(resultSource);
    const targetWasKnownFunction = knownFunctionNames.has(target);
    if (targetIsCalled) knownFunctionNames.add(target);
    if (kind === "dictionary") {
      const separator = topLevelOperator(resultSource, [":"]);
      if (!separator) return null;
      const keySource = resultSource.slice(0, separator.index).trim();
      const valueSource = resultSource.slice(separator.index + 1).trim();
      const key = explainExpression(keySource);
      const result = explainExpression(valueSource);
      values.key = comparisonOperand(valueText(key, keySource));
      values.result = valueText(result, valueSource);
      resultExact = key.exact && result.exact;
    } else {
      const result = explainExpression(resultSource);
      values.result = valueText(result, resultSource);
      resultExact = result.exact;
    }
    for (const [name, saved] of savedTargetTypes) {
      if (saved === undefined) delete symbolTable[name];
      else symbolTable[name] = saved;
    }
    if (targetIsCalled && !targetWasKnownFunction) knownFunctionNames.delete(target);
    const templateKeys = {
      list: "listComprehensionExplained",
      set: "setComprehensionExplained",
      dictionary: "dictionaryComprehensionExplained",
      generator: "generatorComprehensionExplained"
    };
    const text = t("values", templateKeys[kind], values);
    return {
      text,
      valueText: text,
      exact: resultExact && iterable.exact && (!condition || condition.exact)
    };
  }

  function explainFormattedText(expression) {
    const match = expression.match(/^(?:f|fr|rf)(["'])([\s\S]*)\1$/i);
    if (!match) return null;
    const content = match[2];
    const parts = [];
    let literal = "";
    let exact = true;
    const pushLiteral = () => {
      if (!literal) return;
      parts.push(t("values", "formattedTextLiteral", { value: literal }));
      literal = "";
    };
    for (let index = 0; index < content.length; index += 1) {
      const char = content[index];
      if (char === "{" && content[index + 1] === "{") { literal += "{"; index += 1; continue; }
      if (char === "}" && content[index + 1] === "}") { literal += "}"; index += 1; continue; }
      if (char !== "{") { literal += char; continue; }
      pushLiteral();
      let depth = 1, quote = null, escaped = false, end = -1;
      for (let cursor = index + 1; cursor < content.length; cursor += 1) {
        const inner = content[cursor];
        if (escaped) { escaped = false; continue; }
        if (inner === "\\" && quote) { escaped = true; continue; }
        if (quote) { if (inner === quote) quote = null; continue; }
        if (inner === "'" || inner === '"') { quote = inner; continue; }
        if (inner === "{") depth += 1;
        if (inner === "}") depth -= 1;
        if (depth === 0) { end = cursor; break; }
      }
      if (end < 0) { exact = false; literal += content.slice(index); break; }
      let field = content.slice(index + 1, end).trim();
      const formatSeparator = topLevelOperator(field, [":"]);
      const formatValue = formatSeparator ? field.slice(formatSeparator.index + 1).trim() : "";
      if (formatSeparator) field = field.slice(0, formatSeparator.index).trim();
      const conversion = field.match(/^(.*)![rsa]$/);
      if (conversion) field = conversion[1].trim();
      if (field.endsWith("=")) field = field.slice(0, -1).trim();
      const explained = explainExpression(field);
      parts.push(t("values", "formattedValue", {
        value: valueText(explained, field),
        formatClause: formatValue ? t("functionClauses", "formatSpecification", { value: formatValue }) : ""
      }));
      exact = exact && Boolean(field) && explained.exact;
      index = end;
    }
    pushLiteral();
    const text = t("values", "formattedTextExplained", { parts: parts.join(parts.length === 2 ? " et " : ", ") });
    return { text, valueText: text, exact };
  }

  function explainPercentFormattedText(expression) {
    const operator = topLevelOperator(expression, ["%"], true);
    if (!operator) return null;
    const templateSource = expression.slice(0, operator.index).trim();
    const valuesSource = expression.slice(operator.index + 1).trim();
    const literal = templateSource.match(/^(?:[rRuU])?(["'])([\s\S]*)\1$/);
    if (!literal || !valuesSource) return null;
    const tokenPattern = /%(?:\([^)]+\))?[#0\- +]*\d*(?:\.\d+)?[diouxXeEfFgGcrsa%]/g;
    const tokens = Array.from(literal[2].matchAll(tokenPattern)).filter(match => match[0] !== "%%");
    if (!tokens.length) return null;
    const unwrapped = stripOuterParentheses(valuesSource);
    const valueSources = tokens.length > 1 ? splitArgs(unwrapped) : [valuesSource];
    if (valueSources.length < tokens.length) return null;
    const explained = valueSources.slice(0, tokens.length).map(source => explainExpression(source));
    const formattedValues = tokens.map((token, index) => {
      const fixed = token[0].match(/\.(\d+)[fF]$/);
      const formatClause = fixed
        ? t("functionClauses", "fixedDecimalPlaces", { count: fixed[1] })
        : /[diouxX]$/.test(token[0]) ? t("functionClauses", "integerFormat") : "";
      return { text: valueText(explained[index], valueSources[index]), formatClause };
    });
    let text;
    if (tokens.length === 1) {
      const token = tokens[0];
      const prefix = literal[2].slice(0, token.index).replace(/%%/g, "%").trimEnd();
      const suffix = literal[2].slice(token.index + token[0].length).replace(/%%/g, "%").trim();
      if (prefix && !suffix) {
        text = t("values", "percentFormattedWithPrefix", {
          prefix,
          value: formattedValues[0].text,
          formatClause: formattedValues[0].formatClause
        });
      }
    }
    if (!text) {
      const values = formattedValues.map(value => `${value.text}${value.formatClause}`);
      text = t("values", "percentFormattedText", {
        template: literal[2].replace(/%%/g, "%"),
        values: values.join(values.length === 2 ? " et " : ", ")
      });
    }
    return { text, valueText: text, exact: explained.every(item => item.exact) && valueSources.length === tokens.length };
  }

  function explainExpression(expression) {
    const exp = stripOuterParentheses(expression);
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)[eE][+\-]?\d+$/.test(exp)) return { text: displayArg(exp), exact: true };
    if (/^lambda\b/.test(exp)) {
      const described = describeCallable(exp);
      return { text: described.text, valueText: described.text, exact: described.exact };
    }
    const joinedAndStripped = exp.match(/^((?:[rRuU])?["'][\s\S]*["'])\.join\(([\s\S]+)\)\.strip\(\)$/);
    if (joinedAndStripped) {
      const separator = explainExpression(joinedAndStripped[1]);
      const items = explainExpression(joinedAndStripped[2]);
      const joined = format(translations.methodValues.join, {
        owner: valueText(separator, joinedAndStripped[1]),
        0: valueText(items, joinedAndStripped[2])
      });
      const text = format(translations.methodValues.strip, { owner: joined });
      return { text, valueText: text, exact: separator.exact && items.exact };
    }
    const comprehension = explainComprehension(exp, "generator");
    if (comprehension) return comprehension;
    const formattedText = explainFormattedText(exp);
    if (formattedText) return formattedText;
    const percentFormattedText = explainPercentFormattedText(exp);
    if (percentFormattedText) return percentFormattedText;
    const tripleText = exp.match(/^(?:[rRuU])?(?:"""([\s\S]*)"""|'''([\s\S]*)''')$/);
    if (tripleText) return { text: t("values", "text", { value: (tripleText[1] ?? tripleText[2]).replace(/\\n/g, "\n") }), exact: true };
    const rawText = exp.match(/^[rRuU](["'])([\s\S]*)\1$/);
    if (rawText) return { text: t("values", "text", { value: rawText[2] }), exact: true };
    if (/^await\s+/.test(exp)) {
      const source = exp.replace(/^await\s+/, "");
      const explained = explainExpression(source);
      const text = t("values", "awaited", { value: valueText(explained, source) });
      return { text, valueText: text, exact: explained.exact };
    }
    if (/^\*\*/.test(exp)) {
      const source = exp.slice(2).trim();
      const explained = explainExpression(source);
      const text = t("values", "unpackedMapping", { value: valueText(explained, source) });
      return { text, valueText: text, exact: explained.exact };
    }
    if (/^\*/.test(exp)) {
      const source = exp.slice(1).trim();
      const explained = explainExpression(source);
      const text = t("values", "unpackedIterable", { value: valueText(explained, source) });
      return { text, valueText: text, exact: explained.exact };
    }
    const namedExpression = topLevelOperator(exp, [":="]);
    if (namedExpression) {
      const target = exp.slice(0, namedExpression.index).trim();
      const source = exp.slice(namedExpression.index + 2).trim();
      if (/^[A-Za-z_]\w*$/.test(target) && source) {
        const explained = explainExpression(source);
        const text = t("values", "namedExpression", { target, value: valueText(explained, source) });
        return { text, valueText: text, exact: explained.exact };
      }
    }
    const conditionalIf = topLevelOperator(exp, ["if"]);
    const conditionalElse = topLevelOperator(exp, ["else"]);
    if (conditionalIf && conditionalElse && conditionalIf.index < conditionalElse.index) {
      const whenTrue = explainExpression(exp.slice(0, conditionalIf.index));
      const condition = explainExpression(exp.slice(conditionalIf.index + 2, conditionalElse.index));
      const whenFalse = explainExpression(exp.slice(conditionalElse.index + 4));
      const conditionalText = t("expressions", "conditional", {
        condition: conditionText(condition, exp.slice(conditionalIf.index + 2, conditionalElse.index)),
        whenTrue: valueText(whenTrue, exp.slice(0, conditionalIf.index)),
        whenFalse: valueText(whenFalse, exp.slice(conditionalElse.index + 4))
      });
      return {
        text: conditionalText,
        valueText: conditionalText,
        exact: condition.exact && whenTrue.exact && whenFalse.exact,
        conditional: { condition, whenTrue, whenFalse }
      };
    }

    const comparisonOperators = ["not in", "is not", "==", "!=", "<=", ">=", "<", ">", "in", "is"];
    const comparisonKeys = {
      "not in": "notIn", "is not": "isNot", "==": "equal", "!=": "notEqual", "<=": "lessOrEqual",
      ">=": "greaterOrEqual", "<": "less", ">": "greater", in: "in", is: "is"
    };
    const firstComparison = topLevelOperator(exp, comparisonOperators);
    if (firstComparison) {
      const afterFirst = exp.slice(firstComparison.index + firstComparison.operator.length).trim();
      const secondComparison = topLevelOperator(afterFirst, comparisonOperators);
      const logicalBetweenComparisons = topLevelOperator(afterFirst, ["or", "and"]);
      if (secondComparison && !logicalBetweenComparisons) {
        const leftSource = exp.slice(0, firstComparison.index).trim();
        const middleSource = afterFirst.slice(0, secondComparison.index).trim();
        const rightSource = afterFirst.slice(secondComparison.index + secondComparison.operator.length).trim();
        if (leftSource && middleSource && rightSource) {
          const first = expressionResult(comparisonKeys[firstComparison.operator], explainExpression(leftSource), explainExpression(middleSource));
          const second = expressionResult(comparisonKeys[secondComparison.operator], explainExpression(middleSource), explainExpression(rightSource));
          return expressionResult("and", first, second);
        }
      }
    }

    const precedence = [
      { operators: ["or"], keys: { or: "or" } },
      { operators: ["and"], keys: { and: "and" } },
      { operators: ["not in", "is not", "==", "!=", "<=", ">=", "<", ">", "in", "is"], keys: {
        "not in": "notIn", "is not": "isNot", "==": "equal", "!=": "notEqual", "<=": "lessOrEqual",
        ">=": "greaterOrEqual", "<": "less", ">": "greater", in: "in", is: "is"
      } },
      { operators: ["|"], keys: { "|": "bitOr" } },
      { operators: ["^"], keys: { "^": "bitXor" } },
      { operators: ["&"], keys: { "&": "bitAnd" } },
      { operators: ["<<", ">>"], keys: { "<<": "leftShift", ">>": "rightShift" } },
      { operators: ["+", "-"], keys: { "+": "add", "-": "subtract" }, fromRight: true },
      { operators: ["//", "*", "/", "%", "@"], keys: { "//": "floorDivide", "*": "multiply", "/": "divide", "%": "modulo", "@": "matrixMultiply" }, fromRight: true },
      { operators: ["**"], keys: { "**": "power" } }
    ];
    for (const level of precedence) {
      const found = topLevelOperator(exp, level.operators, level.fromRight);
      if (!found) continue;
      const leftText = exp.slice(0, found.index).trim();
      const rightText = exp.slice(found.index + found.operator.length).trim();
      if (!leftText || !rightText) continue;
      let key = level.keys[found.operator];
      if (found.operator === "/" && ["pathlib.Path", "pathlib.PurePath"].includes(inferExpressionType(leftText))) key = "pathJoin";
      return expressionResult(key, explainExpression(leftText), explainExpression(rightText));
    }
    if (/^not\s+/.test(exp)) return expressionResult("not", explainExpression(exp.replace(/^not\s+/, "")));
    if (/^~\s*.+/.test(exp)) return expressionResult("bitNot", explainExpression(exp.slice(1)));
    if (/^[-+]\s*.+/.test(exp) && !/^[+-]?\d/.test(exp)) {
      return expressionResult(exp[0] === "-" ? "negative" : "positive", explainExpression(exp.slice(1)));
    }
    if (exp.endsWith(",")) {
      const sources = splitArgs(exp.slice(0, -1));
      const items = sources.map(item => explainExpression(item));
      const text = t("values", "tuple", { value: items.map((item, index) => valueText(item, sources[index])).join(", ") });
      return { text, valueText: text, exact: items.every(item => item.exact) };
    }
    if (splitArgs(exp).length > 1) {
      const sources = splitArgs(exp);
      const items = sources.map(item => explainExpression(item));
      const text = t("values", "tuple", { value: items.map((item, index) => valueText(item, sources[index])).join(", ") });
      return { text, valueText: text, exact: items.every(item => item.exact) };
    }
    const call = callParts(exp);
    if (call) {
      const known = knownFunctionText(call.name, call.args);
      if (known) return known;
      const isLocalType = !call.ownerExpression && knownTypeNames.has(call.name);
      const isLocalFunction = !call.ownerExpression && knownFunctionNames.has(call.name);
      if (isLocalType || isLocalFunction) {
        const explainedArguments = call.args.map(argument => {
          const parsed = splitKeywordArgument(argument);
          const explained = explainExpression(parsed.value);
          return {
            text: parsed.name
              ? t("functionClauses", "namedArgument", { name: parsed.name, value: valueText(explained, parsed.value) })
              : valueText(explained, parsed.value),
            exact: explained.exact
          };
        });
        const argumentsText = explainedArguments.length
          ? t("syntax", "withArguments", { args: explainedArguments.map(item => item.text).join(explainedArguments.length === 2 ? " et " : ", ") })
          : t("syntax", "withoutArguments");
        const text = t("syntax", isLocalType ? "localConstructor" : "localFunction", { name: call.name, arguments: argumentsText });
        const nominal = t("values", isLocalType ? "localObject" : "localFunctionResult", { name: call.name, arguments: argumentsText });
        return { text, valueText: nominal, exact: explainedArguments.every(item => item.exact), actionExact: true };
      }
      const method = call.methodName || call.name.split(".").pop();
      const ownerSource = call.ownerExpression || (call.name.includes(".") ? call.name.slice(0, call.name.lastIndexOf(".")) : null);
      const ownerExplanation = ownerSource ? explainExpression(ownerSource) : null;
      const owner = ownerExplanation ? comparisonOperand(valueText(ownerExplanation, ownerSource)) : null;
      const explainedArguments = call.args.map(argument => {
        const parsed = splitKeywordArgument(argument);
        const explained = explainExpression(parsed.value);
        return parsed.name
          ? t("functionClauses", "namedArgument", { name: parsed.name, value: valueText(explained, parsed.value) })
          : valueText(explained, parsed.value);
      });
      const argumentsText = explainedArguments.length
        ? t("syntax", "withArguments", { args: explainedArguments.join(explainedArguments.length === 2 ? " et " : ", ") })
        : t("syntax", "withoutArguments");
      const localOwnerType = ownerSource ? inferExpressionType(ownerSource) : null;
      if (owner && (knownMethodNames.has(method) || (localOwnerType && knownTypeNames.has(localOwnerType)))) {
        return {
          text: t("syntax", "localMethod", { name: method, owner, arguments: argumentsText }),
          valueText: t("values", "localMethodResult", { name: method, owner, arguments: argumentsText }),
          exact: true,
          actionExact: true
        };
      }
      return {
        text: owner
          ? t("syntax", "genericMethod", { name: method, owner, arguments: argumentsText })
          : t("syntax", "genericFunction", { name: method, arguments: argumentsText }),
        valueText: t("values", owner ? "methodCallResult" : "functionCallResult", { name: method, owner, arguments: argumentsText }),
        exact: false
      };
    }
    const byteText = exp.match(/^[bB](["'])([\s\S]*)\1$/);
    if (byteText) return { text: t("values", "bytes", { value: byteText[2] }), exact: true };
    if (/^["'].*["']$/.test(exp)) return { text: displayArg(exp), exact: true };
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(exp)) return { text: displayArg(exp), exact: true };
    if (exp === "True" || exp === "False" || exp === "None") return { text: displayArg(exp), exact: true };
    if (/^[fF]["'].*["']$/.test(exp)) return { text: t("values", "formattedText", { value: exp.slice(2, -1) }), exact: true };
    if (/^\[.*\]$/.test(exp)) {
      const content = exp.slice(1, -1).trim();
      if (!content) return { text: t("values", "emptyList"), exact: true };
      if (topLevelOperator(content, ["for"])) {
        return explainComprehension(content, "list") || { text: t("values", "listComprehension", { value: content }), exact: false };
      }
      const items = splitArgs(content).map(item => explainExpression(item));
      const sources = splitArgs(content);
      const text = t("values", "list", { value: items.map((item, index) => valueText(item, sources[index])).join(", ") });
      return { text, valueText: text, exact: items.every(item => item.exact) };
    }
    if (/^\{.*\}$/.test(exp)) {
      const content = exp.slice(1, -1).trim();
      if (!content) return { text: t("values", "emptyDictionary"), exact: true };
      if (topLevelOperator(content, ["for"])) {
        const kind = content.includes(":") ? "dictionary" : "set";
        return explainComprehension(content, kind) || { text: t("values", "comprehension", { value: content }), exact: false };
      }
      if (content.includes(":")) {
        const entries = splitArgs(content).map(entry => {
          if (/^\*\*/.test(entry.trim())) {
            const unpacked = explainExpression(entry.trim());
            return { text: valueText(unpacked, entry), exact: unpacked.exact };
          }
          const separator = topLevelOperator(entry, [":"]);
          if (!separator) return { text: entry, exact: false };
          const keySource = entry.slice(0, separator.index);
          const valueSource = entry.slice(separator.index + 1);
          const key = explainExpression(keySource);
          const value = explainExpression(valueSource);
          return {
            text: t("values", "dictionaryEntry", { key: comparisonOperand(valueText(key, keySource)), value: valueText(value, valueSource) }),
            exact: key.exact && value.exact
          };
        });
        const text = t("values", "dictionaryEntries", { entries: entries.map(entry => entry.text).join(", ") });
        return { text, valueText: text, exact: entries.every(entry => entry.exact) };
      }
      const sources = splitArgs(content);
      const items = sources.map(item => explainExpression(item));
      const text = t("values", "set", { value: items.map((item, index) => valueText(item, sources[index])).join(", ") });
      return { text, valueText: text, exact: items.every(item => item.exact) };
    }
    const indexed = indexedParts(exp);
    if (indexed) {
      const owner = explainExpression(indexed.owner);
      const key = explainIndex(indexed.key);
      const text = t("values", key.slice ? "sliced" : "indexed", { owner: valueText(owner, indexed.owner), key: key.text });
      return { text, valueText: text, exact: owner.exact && key.exact };
    }
    const attribute = attributeParts(exp);
    if (attribute) {
      const ownerType = inferExpressionType(attribute.owner);
      const normalized = ownerType ? `${ownerType}.${attribute.name}` : normalizeName(exp);
      const attributeTemplate = translations.attributes?.[normalized] || translations.attributes?.[attribute.name];
      if (attributeTemplate) {
        const owner = explainExpression(attribute.owner);
        const text = format(attributeTemplate, { owner: comparisonOperand(valueText(owner, attribute.owner)) });
        return { text, valueText: text, exact: owner.exact };
      }
    }
    if (/^[A-Za-z_]\w*$/.test(exp) && knownTypeNames.has(exp)) {
      const text = t("values", "type", { value: exp });
      return { text, valueText: text, exact: true };
    }
    if (/^[A-Za-z_]\w*$/.test(exp) && knownFunctionNames.has(exp)) {
      const text = t("values", "function", { value: exp });
      return { text, valueText: text, exact: true };
    }
    if (/^[A-Za-z_]\w*$/.test(exp)) {
      const text = t("values", "variable", { value: exp });
      if (symbolTable[exp] === "bool") {
        return {
          text,
          valueText: text,
          conditionText: t("expressions", "booleanVariableTrue", { left: comparisonOperand(text) }),
          exact: true,
          boolean: true
        };
      }
      if (["str", "list", "dict", "set", "tuple", "bytes", "bytearray", "frozenset"].includes(symbolTable[exp])) {
        return {
          text,
          valueText: text,
          conditionText: t("expressions", "nonEmpty", { left: comparisonOperand(text) }),
          exact: true,
          boolean: false
        };
      }
      return { text, valueText: text, exact: true };
    }
    if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(exp)) {
      const normalized = normalizeName(exp);
      const attributeName = normalized.split(".").pop();
      const attributeTemplate = translations.attributes?.[normalized] || translations.attributes?.[attributeName];
      if (attributeTemplate) {
        const owner = exp.slice(0, exp.lastIndexOf("."));
        return { text: format(attributeTemplate, { owner }), exact: true };
      }
      return { text: t("values", "attribute", { value: exp }), exact: true };
    }
    return { text: t("values", "expression", { value: exp }), exact: false };
  }

  function explainLine(raw) {
    const line = raw.trim();
    if (!line) return null;
    if (line.startsWith("#")) {
      const content = line.slice(1).trim();
      return { text: content ? t("syntax", "comment", { content }) : t("syntax", "emptyComment"), exact: true, kind: "comment" };
    }

    let m;
    if ((m = line.match(/^import\s+(.+)$/))) {
      const imports = splitArgs(m[1]).map(item => item.match(/^([\w.]+)(?:\s+as\s+(\w+))?$/));
      if (imports.length && imports.every(Boolean)) {
        const libraries = imports.map(parts => libraryInfo(parts[1]));
        return {
          text: imports.map(parts => t("syntax", parts[2] ? "importAlias" : "import", { module: parts[1], alias: parts[2] })).join(" "),
          exact: true,
          library: libraries[0],
          libraries
        };
      }
    }
    if ((m = line.match(/^from\s+([\w.]+)\s+import\s+(.+)$/))) return { text: t("syntax", "fromImport", { module: m[1], names: m[2] }), exact: true, library: libraryInfo(m[1]) };
    if ((m = line.match(/^print\s*\((.*)\)$/))) {
      const sources = splitArgs(m[1]);
      const explained = sources.map(source => explainExpression(source));
      return {
        text: t("syntax", "print", { args: explained.map((item, index) => valueText(item, sources[index])).join(sources.length === 2 ? " et " : ", ") }),
        exact: explained.every(item => item.exact)
      };
    }
    if ((m = line.match(/^(async\s+)?def\s+(\w+)\s*\((.*)\)\s*(?:->\s*(.+?))?\s*:/))) {
      const args = splitArgs(m[3]);
      const key = m[4] ? (args.length ? "functionReturn" : "functionNoArgsReturn") : (args.length ? "function" : "functionNoArgs");
      let text = t("syntax", key, { name: m[2], args: joinArgs(args), returnType: m[4]?.trim() });
      if (m[1]) text = text.replace("fonction «", "fonction asynchrone «");
      return { text, exact: true, kind: "block function-block" };
    }
    if ((m = line.match(/^class\s+(\w+)(?:\((.*?)\))?\s*:/))) return { text: t("syntax", m[2] ? "classParent" : "class", { name: m[1], parent: m[2] }), exact: true, kind: "block class-block" };
    if ((m = line.match(/^if\s+(.+)\s*:/))) {
      const condition = explainExpression(m[1]);
      return { text: t("syntax", "if", { condition: conditionText(condition, m[1]) }), exact: condition.exact, kind: "block condition-block" };
    }
    if ((m = line.match(/^elif\s+(.+)\s*:/))) {
      const condition = explainExpression(m[1]);
      return { text: t("syntax", "elif", { condition: conditionText(condition, m[1]) }), exact: condition.exact, kind: "block condition-block" };
    }
    if (/^else\s*:/.test(line)) return { text: t("syntax", "else"), exact: true, kind: "block condition-block" };
    if ((m = line.match(/^for\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s+in\s+enumerate\s*\((.*)\)\s*:/))) {
      const enumerateArgs = splitArgs(m[3]);
      const iterableExplanation = explainExpression(enumerateArgs[0] || "?");
      const iterable = comparisonOperand(valueText(iterableExplanation, enumerateArgs[0] || "?"));
      const explicitStart = enumerateArgs[1]?.replace(/^start\s*=\s*/, "");
      const startExplanation = explicitStart ? explainExpression(explicitStart) : null;
      return {
        text: t("syntax", explicitStart ? "forEnumerateFrom" : "forEnumerate", {
          iterable,
          position: m[1],
          value: m[2],
          start: explicitStart ? comparisonOperand(valueText(startExplanation, explicitStart)) : "0"
        }),
        exact: iterableExplanation.exact && (!startExplanation || startExplanation.exact),
        kind: "block loop-block"
      };
    }
    if ((m = line.match(/^for\s+(.+?)\s+in\s+(.+)\s*:/))) {
      const iterable = explainExpression(m[2]);
      return { text: t("syntax", "for", { iterable: valueText(iterable, m[2]), variable: m[1] }), exact: iterable.exact, kind: "block loop-block" };
    }
    if ((m = line.match(/^while\s+(.+)\s*:/))) {
      const condition = explainExpression(m[1]);
      return { text: t("syntax", "while", { condition: conditionText(condition, m[1]) }), exact: condition.exact, kind: "block loop-block" };
    }
    if ((m = line.match(/^yield\s+from\s+(.+)$/))) {
      const explained = explainExpression(m[1]);
      return { text: t("syntax", "yieldFrom", { value: valueText(explained, m[1]) }), exact: explained.exact };
    }
    if ((m = line.match(/^yield(?:\s+(.+))?$/))) {
      if (!m[1]) return { text: t("syntax", "yieldEmpty"), exact: true };
      const explained = explainExpression(m[1]);
      return { text: t("syntax", "yield", { value: valueText(explained, m[1]) }), exact: explained.exact };
    }
    if ((m = line.match(/^global\s+(.+)$/))) return { text: t("syntax", "global", { names: m[1] }), exact: true };
    if ((m = line.match(/^nonlocal\s+(.+)$/))) return { text: t("syntax", "nonlocal", { names: m[1] }), exact: true };
    if ((m = line.match(/^return(?:\s+(.+))?$/))) {
      if (!m[1]) return { text: t("syntax", "returnEmpty"), exact: true };
      const explained = explainExpression(m[1]);
      return { text: t("syntax", "return", { value: valueText(explained, m[1]) }), exact: explained.exact };
    }
    if (/^break$/.test(line)) return { text: t("syntax", "break"), exact: true };
    if (/^continue$/.test(line)) return { text: t("syntax", "continue"), exact: true };
    if (/^pass$/.test(line)) return { text: t("syntax", "pass"), exact: true };
    if ((m = line.match(/^([\w.\[\]"']+)\s*([+\-*/])=\s*(.+)$/))) {
      const keys = { "+": "addAssign", "-": "subtractAssign", "*": "multiplyAssign", "/": "divideAssign" };
      const explained = explainExpression(m[3]);
      return { text: t("syntax", keys[m[2]], { value: valueText(explained, m[3]), target: m[1] }), exact: explained.exact };
    }
    if ((m = line.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*:\s*([^=]+?)\s*=\s*(.+)$/))) {
      const ownerSource = m[1].slice(0, m[1].lastIndexOf("."));
      const attribute = m[1].slice(m[1].lastIndexOf(".") + 1);
      const owner = explainExpression(ownerSource);
      const assigned = explainExpression(m[3]);
      return {
        text: t("syntax", "typedAttributeAssign", { owner: comparisonOperand(valueText(owner, ownerSource)), attribute, type: m[2].trim(), value: valueText(assigned, m[3]) }),
        exact: owner.exact && assigned.exact
      };
    }
    if ((m = line.match(/^(.+\])\s*=\s*(.+)$/)) && indexedParts(m[1]) && !indexedParts(m[1]).owner.includes(":")) {
      const indexed = indexedParts(m[1]);
      const owner = explainExpression(indexed.owner);
      const key = explainIndex(indexed.key);
      const assigned = explainExpression(m[2]);
      return {
        text: t("syntax", "assignIndexed", {
          owner: comparisonOperand(valueText(owner, indexed.owner)),
          key: comparisonOperand(key.text),
          value: valueText(assigned, m[2])
        }),
        exact: owner.exact && key.exact && assigned.exact
      };
    }
    const attributeAssignment = assignmentExpressionParts(line);
    const attributeTarget = attributeAssignment?.mode === "assign"
      ? attributeAssignment.target.match(/^(.+)\.([A-Za-z_]\w*)$/)
      : null;
    if (attributeTarget) {
      const owner = explainExpression(attributeTarget[1]);
      const assigned = explainExpression(attributeAssignment.expression);
      return {
        text: t("syntax", "assignAttribute", {
          owner: comparisonOperand(valueText(owner, attributeTarget[1])),
          attribute: attributeTarget[2],
          value: valueText(assigned, attributeAssignment.expression)
        }),
        exact: owner.exact && assigned.exact
      };
    }
    if ((m = line.match(/^([A-Za-z_]\w*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/))) {
      if (!m[3]) return { text: t("syntax", "typeDeclaration", { target: m[1], type: m[2].trim() }), exact: true };
      const explained = explainExpression(m[3]);
      return { text: t("syntax", "typedAssign", { target: m[1], type: m[2].trim(), value: valueText(explained, m[3]) }), exact: explained.exact };
    }
    if ((m = line.match(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*(.+)$/))) {
      const explained = explainExpression(m[3]);
      const targets = [`« ${m[1]} »`, ...m[2].split(",").map(name => `« ${name.trim()} »`)];
      return {
        text: t("syntax", "assignMultiple", { value: valueText(explained, m[3]), targets: targets.join(", ") }),
        exact: explained.exact
      };
    }
    if ((m = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=\s*(.+)$/))) {
      const explained = explainExpression(m[2]);
      const action = explained.text;
      if (explained.conditional) {
        return {
          text: t("syntax", "assignConditional", {
            whenTrue: valueText(explained.conditional.whenTrue),
            target: m[1],
            condition: conditionText(explained.conditional.condition),
            whenFalse: valueText(explained.conditional.whenFalse)
          }),
          exact: explained.exact
        };
      }
      if (explained.boolean) {
        return { text: t("syntax", "assignBoolean", { condition: conditionText(explained, m[2]), target: m[1] }), exact: explained.exact };
      }
      const isAction = /^(Je |J’)/.test(action);
      return {
        text: isAction
          ? t("syntax", "assignResult", { action, target: m[1] })
          : t("syntax", "assignValue", { value: valueText(explained, m[2]), target: m[1] }),
        exact: isAction ? (explained.actionExact ?? explained.exact) : explained.exact
      };
    }

    const expression = explainExpression(line);
    return { text: `${expression.text}.`, exact: expression.actionExact ?? expression.exact };
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  const pythonKeywords = new Set([
    "and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del", "elif", "else",
    "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "match", "nonlocal", "not",
    "or", "pass", "raise", "return", "try", "while", "with", "yield"
  ]);

  function pythonSyntaxHtml(source) {
    let html = "";
    let index = 0;
    const append = (kind, text) => { html += kind ? `<span class="syntax-${kind}">${escapeHtml(text)}</span>` : escapeHtml(text); };
    while (index < source.length) {
      const rest = source.slice(index);
      if (source[index] === "#") {
        const end = source.indexOf("\n", index);
        const limit = end < 0 ? source.length : end;
        append("comment", source.slice(index, limit));
        index = limit;
        continue;
      }
      const stringStart = rest.match(/^(?:[rRuUbBfF]{1,2})?(?:"""|'''|"|')/);
      if (stringStart) {
        const token = stringStart[0];
        const quote = token.endsWith('"""') ? '"""' : token.endsWith("'''") ? "'''" : token.endsWith('"') ? '"' : "'";
        const triple = quote.length === 3;
        let cursor = index + token.length;
        let escaped = false;
        while (cursor < source.length) {
          if (!triple && escaped) { escaped = false; cursor += 1; continue; }
          if (!triple && source[cursor] === "\\") { escaped = true; cursor += 1; continue; }
          if (source.startsWith(quote, cursor)) { cursor += quote.length; break; }
          cursor += 1;
        }
        append("string", source.slice(index, cursor));
        index = cursor;
        continue;
      }
      const number = rest.match(/^(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:\d(?:_?\d)*)?(?:\.\d(?:_?\d)*)|\d(?:_?\d)*(?:\.\d(?:_?\d)*)?)(?:[eE][+-]?\d(?:_?\d)*)?j?/);
      if (number && number[0]) { append("number", number[0]); index += number[0].length; continue; }
      const identifier = rest.match(/^[A-Za-z_]\w*/);
      if (identifier) {
        const name = identifier[0];
        const after = source.slice(index + name.length);
        const kind = pythonKeywords.has(name) ? "keyword"
          : ["True", "False", "None", "Ellipsis", "NotImplemented"].includes(name) ? "literal"
            : /^\s*\(/.test(after) ? "function" : "variable";
        append(kind, name);
        index += name.length;
        continue;
      }
      if (/^[+\-*/%@&|^~:<>=!]+/.test(rest)) {
        const operator = rest.match(/^[+\-*/%@&|^~:<>=!]+/)[0];
        append("operator", operator);
        index += operator.length;
        continue;
      }
      append(null, source[index]);
      index += 1;
    }
    return html;
  }

  function syntaxValuesFromCode(code) {
    const strings = new Set();
    const numbers = new Set();
    const functions = new Set();
    for (const match of code.matchAll(/(?:[rRuUbBfF]{0,2})(["'])([\s\S]*?)\1/g)) strings.add(match[2]);
    for (const match of code.replace(/(?:[rRuUbBfF]{0,2})(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, "").matchAll(/\b\d+(?:\.\d+)?\b/g)) numbers.add(match[0]);
    for (const match of code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) functions.add(match[1]);
    return { strings, numbers, functions };
  }

  function updateSyntaxHighlight() {
    const enabled = Boolean(syntaxColoring?.checked);
    input.parentElement?.classList.toggle("syntax-enabled", enabled);
    if (!codeHighlight) return;
    codeHighlight.innerHTML = enabled ? `${pythonSyntaxHtml(input.value)}\n` : "";
    codeHighlight.scrollTop = input.scrollTop;
    codeHighlight.scrollLeft = input.scrollLeft;
  }

  const nonVariableNames = new Set([
    "and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "match", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield",
    "bool", "bytes", "dict", "float", "frozenset", "int", "list", "object", "set", "str", "tuple", "type"
  ]);

  function variableNamesFromCode(code) {
    const withoutStrings = code
      .replace(/(?:[rubf]{0,2})(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi, "")
      .replace(/#.*/, "");
    if (/^\s*(?:from|import)\b/.test(withoutStrings)) {
      return new Set(Array.from(withoutStrings.matchAll(/\bas\s+([A-Za-z_]\w*)/g), match => match[1]));
    }
    const variables = new Set();
    for (const match of withoutStrings.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      const name = match[0];
      const before = withoutStrings.slice(0, match.index);
      const after = withoutStrings.slice(match.index + name.length);
      if (nonVariableNames.has(name) || knownTypeNames.has(name) || knownFunctionNames.has(name) || /(?:\.|\bexcept|\bclass)\s*$/.test(before) || /^\s*\(/.test(after)) continue;
      variables.add(name);
    }
    return variables;
  }

  function variableRole(name, code) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^\\s*(?:${escapedName}\\s*=|${escapedName}\\s*[+\\-*/%]=)`).test(code)) {
      return "Cette ligne lui attribue une valeur ou met sa valeur à jour.";
    }
    const enumerateLoop = code.match(/^\s*for\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s+in\s+enumerate\b/);
    if (enumerateLoop?.[1] === name) {
      return "Variable d’itération : elle reçoit le numéro de position de l’élément courant.";
    }
    if (enumerateLoop?.[2] === name) {
      return "Variable d’itération : elle reçoit la valeur de l’élément courant.";
    }
    if (new RegExp(`^\\s*for\\s+${escapedName}\\b`).test(code)) {
      return "Variable d’itération : elle reçoit successivement chaque élément parcouru.";
    }
    if (new RegExp(`\\bas\\s+${escapedName}\\b`).test(code)) {
      return "Nom abrégé créé dans cette ligne pour réutiliser l’élément importé.";
    }
    return "Sa valeur est consultée dans cette ligne.";
  }

  function variableHtml(name, code) {
    const role = variableRole(name, code);
    const displayed = `"${name}"`;
    return `<span class="variable-term code-term syntax-variable" tabindex="0" aria-label="Variable ${escapeHtml(name)} : ${escapeHtml(role)}">${escapeHtml(displayed)}<span class="variable-tooltip" role="tooltip"><strong>Variable "${escapeHtml(name)}"</strong><span>${escapeHtml(role)}</span></span></span>`;
  }

  function libraryHtml(library) {
    const displayed = `"${library.term}"`;
    return `<span class="library-term code-term syntax-variable" tabindex="0" aria-label="${escapeHtml(library.name)} : ${escapeHtml(library.description)}">${escapeHtml(displayed)}<span class="library-tooltip" role="tooltip"><strong>${escapeHtml(library.name)}</strong><span>${escapeHtml(library.description)}</span></span></span>`;
  }

  function formatStructures(value, variables = new Set(), code = "", libraries = []) {
    const hasAlternative = /\bsi\b/i.test(value) && /\bsinon\b/i.test(value);
    const structures = new Set((hasAlternative ? ["sinon", "si", "et", "ou"] : ["sinon", "si"]));
    const syntaxValues = syntaxValuesFromCode(code);
    const plainHtml = part => part.split(/(\b(?:sinon|si|et|ou|True|False|None)\b|\b\d+(?:\.\d+)?\b)/gi).map(token => {
      const lower = token.toLowerCase();
      if (structures.has(lower)) return `<strong class="structure-keyword syntax-keyword">${escapeHtml(token)}</strong>`;
      if (["True", "False", "None"].includes(token) && code.includes(token)) return `<span class="syntax-literal">${escapeHtml(token)}</span>`;
      if (syntaxValues.numbers.has(token)) return `<span class="syntax-number">${escapeHtml(token)}</span>`;
      return escapeHtml(token);
    }).join("");
    return value
      .split(/(«[^»]*»)/g)
      .map(part => {
        const quotedName = part.match(/^«\s*([A-Za-z_]\w*)\s*»$/);
        if (quotedName && variables.has(quotedName[1])) {
          return variableHtml(quotedName[1], code);
        }
        if (part.startsWith("«")) {
          const content = part.slice(1, -1).trim();
          const library = libraries.find(item => item.term === content);
          if (library) return libraryHtml(library);
          const displayed = `"${content}"`;
          if (syntaxValues.strings.has(content)) return `<strong class="code-term syntax-string">${escapeHtml(displayed)}</strong>`;
          if (syntaxValues.functions.has(content)) return `<strong class="code-term syntax-function">${escapeHtml(displayed)}</strong>`;
          const isCodeName = new RegExp(`(?:^|[^A-Za-z0-9_])${content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^A-Za-z0-9_])`).test(code);
          return `<strong class="code-term${isCodeName ? " syntax-variable" : ""}">${escapeHtml(displayed)}</strong>`;
        }
        return plainHtml(part);
      })
      .join("");
  }

  function explanationHtml(result, code = "") {
    const variables = variableNamesFromCode(code);
    const libraries = result.libraries || (result.library ? [result.library] : []);
    return formatStructures(result.text, variables, code, libraries);
  }

  function assignmentExpressionParts(code) {
    const raw = code.trim();
    if (/^return\s+/.test(raw)) return { mode: "return", target: "", expression: raw.replace(/^return\s+/, "") };
    let round = 0, square = 0, curly = 0, quote = null, escaped = false;
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\" && quote) { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") round += 1;
      else if (char === ")") round -= 1;
      else if (char === "[") square += 1;
      else if (char === "]") square -= 1;
      else if (char === "{") curly += 1;
      else if (char === "}") curly -= 1;
      else if (char === "=" && round === 0 && square === 0 && curly === 0) {
        const before = raw[index - 1] || "";
        const after = raw[index + 1] || "";
        if ("=!<>:+-*/%@&|^".includes(before) || after === "=") continue;
        const target = raw.slice(0, index).trim().replace(/\s*:\s*.+$/, "");
        if (!target) return null;
        return { mode: "assign", target, expression: raw.slice(index + 1).trim() };
      }
    }
    return { mode: "expression", target: "", expression: raw };
  }

  function nestedCallDepth(source) {
    const call = callParts(source);
    if (!call) return 0;
    const childDepth = call.args.reduce((maximum, argument) => {
      const parsed = splitKeywordArgument(argument);
      return Math.max(maximum, nestedCallDepth(parsed.value));
    }, 0);
    const ownerDepth = call.ownerExpression ? nestedCallDepth(call.ownerExpression) : 0;
    return 1 + Math.max(childDepth, ownerDepth);
  }

  function statementSummary(parts, action) {
    const cleanAction = String(action || "").replace(/[.\s]+$/, "");
    if (parts.mode === "return") return `${cleanAction}, puis je renvoie le résultat :`;
    if (parts.mode === "assign") return `${cleanAction}, puis je stocke le résultat dans « ${parts.target} » :`;
    return `${cleanAction} :`;
  }

  function dictionaryPresentation(parts) {
    const expression = stripOuterParentheses(parts.expression);
    if (!/^\{[\s\S]*\}$/.test(expression)) return null;
    const content = expression.slice(1, -1).trim();
    if (!content || topLevelOperator(content, ["for"])) return null;
    const sources = splitArgs(content);
    if (sources.length < 3) return null;
    const items = [];
    for (const entry of sources) {
      if (/^\*\*/.test(entry.trim())) {
        const explained = explainExpression(entry.trim());
        items.push({ label: "Données ajoutées", text: valueText(explained, entry) });
        continue;
      }
      const separator = topLevelOperator(entry, [":"]);
      if (!separator) return null;
      const keySource = entry.slice(0, separator.index).trim();
      const valueSource = entry.slice(separator.index + 1).trim();
      const key = explainExpression(keySource);
      const value = explainExpression(valueSource);
      items.push({ label: comparisonOperand(valueText(key, keySource)), text: valueText(value, valueSource) });
    }
    const summary = parts.mode === "return"
      ? "Je renvoie un dictionnaire contenant :"
      : parts.mode === "assign"
        ? `J’affecte à « ${parts.target} » un dictionnaire contenant :`
        : "Je construis un dictionnaire contenant :";
    return { kind: "dictionary", summary, items };
  }

  function callPresentation(parts) {
    const call = callParts(stripOuterParentheses(parts.expression));
    if (!call) return null;
    const depth = nestedCallDepth(parts.expression);
    if (call.args.length < 2 && depth < 2) return null;
    const shortExplanation = knownFunctionText(call.name, []);
    const methodName = call.methodName || call.name.split(".").pop();
    let action = shortExplanation?.text || `J’appelle « ${methodName} »`;
    if (action.length > 170 || /valeur fournie|argument fourni|liste vide/.test(action)) action = `J’appelle « ${methodName} »`;
    action = action.replace(/\b(?:avec|selon)\s*$/i, "").trim();
    const items = call.args.map((argument, index) => {
      const parsed = splitKeywordArgument(argument);
      const explained = explainExpression(parsed.value);
      return {
        label: parsed.name ? `Option « ${parsed.name} »` : `Argument ${index + 1}`,
        text: valueText(explained, parsed.value)
      };
    });
    return { kind: "call", summary: statementSummary(parts, action), items };
  }

  function booleanPresentation(parts) {
    if (parts.mode !== "assign") return null;
    const expression = stripOuterParentheses(parts.expression);
    const operator = topLevelOperator(expression, ["or", "and"]);
    if (!operator) return null;
    const sources = [expression.slice(0, operator.index).trim(), expression.slice(operator.index + operator.operator.length).trim()];
    const items = sources.map((source, index) => {
      const explained = explainExpression(source);
      return { label: `Condition ${index + 1}`, text: conditionText(explained, source) };
    });
    return {
      kind: "condition",
      summary: `Je vérifie les conditions suivantes, puis je place le résultat — True ou False — dans « ${parts.target} » :`,
      items
    };
  }

  function generatorPresentation(parts) {
    const expression = parts.expression.trim();
    const wrapped = expression.match(/^\(\*\(([\s\S]+)\),\)$/);
    if (!wrapped) return null;
    const generator = wrapped[1].trim();
    const forOperator = topLevelOperator(generator, ["for"]);
    if (!forOperator) return null;
    const producedSource = generator.slice(0, forOperator.index).trim();
    const remaining = generator.slice(forOperator.index + forOperator.operator.length).trim();
    const inOperator = topLevelOperator(remaining, ["in"]);
    if (!inOperator) return null;
    const target = remaining.slice(0, inOperator.index).trim();
    const iterableSource = remaining.slice(inOperator.index + inOperator.operator.length).trim();
    const produced = explainExpression(producedSource);
    const iterable = explainExpression(iterableSource);
    const summary = parts.mode === "return"
      ? "Je construis un tuple à partir d’un parcours, puis je le renvoie :"
      : "Je construis un tuple à partir d’un parcours :";
    return {
      kind: "generator",
      summary,
      items: [
        { label: "Élément courant", text: `« ${target} »` },
        { label: "Source parcourue", text: valueText(iterable, iterableSource) },
        { label: "Valeur produite", text: valueText(produced, producedSource) }
      ]
    };
  }

  function stylisticPresentation(result, code) {
    if (!result?.exact || result.text.length <= 260) return null;
    const parts = assignmentExpressionParts(code);
    if (!parts) return null;
    return dictionaryPresentation(parts) || booleanPresentation(parts) || generatorPresentation(parts) || callPresentation(parts);
  }

  function explanationBlockHtml(result, code = "") {
    if (!result.presentation) return `<p class="explanation">${explanationHtml(result, code)}</p>`;
    const variables = variableNamesFromCode(code);
    const libraries = result.libraries || (result.library ? [result.library] : []);
    const styled = value => formatStructures(value, variables, code, libraries);
    const items = result.presentation.items.map(item => `
      <li><span class="explanation-detail-label">${styled(item.label)}</span><span class="explanation-detail-text">${styled(item.text)}</span></li>`).join("");
    return `<div class="explanation explanation-structured" data-style-kind="${escapeHtml(result.presentation.kind)}">
      <p class="explanation-summary">${styled(result.presentation.summary)}</p>
      <ul class="explanation-details">${items}</ul>
    </div>`;
  }

  const structuralTypes = new Set([
    "FunctionDefinition", "ClassDefinition", "MatchClause", "Decorator"
  ]);
  const bodyTypes = new Set(["Body", "MatchBody"]);
  const clauseTypes = new Set(["elif", "else", "except", "finally"]);

  function isStatementNode(node) {
    if (node.type === "DecoratedStatement") return false;
    return node.type.endsWith("Statement") || structuralTypes.has(node.type);
  }

  function lineStarts(source) {
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "\n") starts.push(index + 1);
    }
    return starts;
  }

  function lineAtOffset(starts, offset) {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) low = middle + 1;
      else high = middle - 1;
    }
    return high + 1;
  }

  const compoundStatementTypes = new Set([
    "FunctionDefinition", "ClassDefinition", "IfStatement", "ForStatement", "WhileStatement",
    "WithStatement", "TryStatement", "MatchStatement", "MatchClause"
  ]);

  function logicalSource(text) {
    let result = "";
    let quote = null;
    let triple = false;
    let escaped = false;
    let pendingSpace = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) {
          if (char !== "\r" && char !== "\n") result += char;
          escaped = false;
          continue;
        }
        if (char === "\\") { result += char; escaped = true; continue; }
        if (triple && text.slice(index, index + 3) === quote.repeat(3)) {
          result += quote.repeat(3); index += 2; quote = null; triple = false; continue;
        }
        if (!triple && char === quote) { result += char; quote = null; continue; }
        if (char === "\r" || char === "\n") {
          if (char === "\r" && text[index + 1] === "\n") index += 1;
          if (triple) result += "\\n";
          continue;
        }
        result += char;
        continue;
      }
      if (char === "#") {
        while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index += 1;
        pendingSpace = true;
        continue;
      }
      if (char === "\\" && /[\r\n]/.test(text[index + 1] || "")) {
        if (text[index + 1] === "\r" && text[index + 2] === "\n") index += 2;
        else index += 1;
        pendingSpace = true;
        continue;
      }
      if (/\s/.test(char)) { pendingSpace = true; continue; }
      if (pendingSpace && result && !/[([{.,:]$/.test(result) && !/^[)\]},.:]/.test(char)) result += " ";
      pendingSpace = false;
      if (char === "'" || char === '"') {
        triple = text.slice(index, index + 3) === char.repeat(3);
        quote = char;
        result += triple ? char.repeat(3) : char;
        if (triple) index += 2;
        continue;
      }
      result += char;
    }
    return result.trim();
  }

  function statementSource(text) {
    return /[\r\n]/.test(text) ? logicalSource(text) : text.trim();
  }

  function syntaxRows(source) {
    if (!window.PySyntax || typeof window.PySyntax.parse !== "function") {
      throw new Error("Analyseur syntaxique absent");
    }
    const tree = window.PySyntax.parse(source);
    const starts = lineStarts(source);
    const rows = [];

    function add(node, depth, options = {}) {
      const nodeSource = node.text || source.slice(node.from, node.to);
      const nodeType = options.nodeType || node.type;
      const body = compoundStatementTypes.has(nodeType) ? (node.children || []).find(child => bodyTypes.has(child.type)) : null;
      const rowEndOffset = options.endOffset ?? (body ? Math.min(source.length, body.from + 1) : node.to);
      const headerSource = body ? source.slice(node.from, rowEndOffset) : nodeSource;
      const raw = options.raw ?? (compoundStatementTypes.has(nodeType) ? statementSource(headerSource) : statementSource(nodeSource));
      rows.push({
        raw: raw || source.slice(node.from, node.to).trim() || "?",
        index: lineAtOffset(starts, node.from),
        endIndex: lineAtOffset(starts, Math.max(node.from, rowEndOffset - 1)),
        depth: Math.min(8, depth),
        nodeType,
        error: options.error ?? node.error
      });
    }

    function visitContainer(node, depth) {
      for (const child of node.children) visit(child, depth);
    }

    function visitStatementChildren(node, depth) {
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child.error) {
          add(child, depth + 1, { error: true });
          continue;
        }
        if (bodyTypes.has(child.type)) {
          visitContainer(child, depth + 1);
          continue;
        }
        if (clauseTypes.has(child.type)) {
          const ownBody = (child.children || []).find(candidate => bodyTypes.has(candidate.type));
          const nextBody = node.children.slice(index + 1).find(candidate => bodyTypes.has(candidate.type));
          const body = ownBody || nextBody;
          const end = body ? Math.min(source.length, body.from + 1) : child.to;
          add(child, depth, {
            nodeType: `Clause:${child.type}`,
            raw: statementSource(source.slice(child.from, end)),
            endOffset: end
          });
          continue;
        }
        if (isStatementNode(child) || child.type === "DecoratedStatement") visit(child, depth);
        else {
          for (const descendant of child.children || []) {
            if (descendant.error) add(descendant, depth, { error: true });
          }
        }
      }
    }

    function visit(node, depth) {
      if (node.error) {
        add(node, depth, { error: true });
        return;
      }
      if (node.type === "Comment") {
        add(node, depth);
        return;
      }
      if (node.type === "DecoratedStatement") {
        visitContainer(node, depth);
        return;
      }
      if (isStatementNode(node)) {
        add(node, depth);
        visitStatementChildren(node, depth);
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
      results.innerHTML = '<div class="empty-state"><div class="empty-mark">!</div><p>L’analyseur syntaxique ne peut pas être chargé.</p></div>';
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
      const ignoreCommentsPreference = localStorage.getItem("python-en-clair-v3.ignoreComments");
      const explanationsOnlyPreference = localStorage.getItem("python-en-clair-v3.explanationsOnly");
      const syntaxColoringPreference = localStorage.getItem("python-en-clair-v3.syntaxColoring");
      ignoreComments.checked = ignoreCommentsPreference === null || ignoreCommentsPreference === "true";
      explanationsOnly.checked = explanationsOnlyPreference === null || explanationsOnlyPreference === "true";
      if (syntaxColoring) syntaxColoring.checked = syntaxColoringPreference === null || syntaxColoringPreference === "true";
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
