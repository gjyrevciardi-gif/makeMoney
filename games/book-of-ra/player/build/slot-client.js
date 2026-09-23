class Ge {
  constructor(t = "", e = {}) {
    this.baseUrl = t, this.mutatingHeaders = e;
  }
  baseUrl;
  mutatingHeaders;
  async #t(t, e) {
    const a = await fetch(`${this.baseUrl}${t}`, e), s = await a.json();
    if (!a.ok) throw new Error("message" in s ? s.message ?? `Request failed with ${a.status}` : `Request failed with ${a.status}`);
    return s;
  }
  spin(t) {
    return this.#t("/v1/spins", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": t.idempotencyKey, ...this.mutatingHeaders }, body: JSON.stringify(t) });
  }
  action(t) {
    return this.#t(`/v1/rounds/${encodeURIComponent(t.roundId)}/actions`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": t.idempotencyKey, ...this.mutatingHeaders }, body: JSON.stringify(t) });
  }
  round(t) {
    return this.#t(`/v1/rounds/${encodeURIComponent(t)}`);
  }
  async currentState(t, e) {
    const a = await fetch(`/v1/state/${encodeURIComponent(t)}?gameId=${encodeURIComponent(e)}`);
    if (!a.ok) throw new Error(`State request failed with ${a.status}`);
    return await a.json();
  }
}
var Ot = function(o, t) {
  return Ot = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(e, a) {
    e.__proto__ = a;
  } || function(e, a) {
    for (var s in a) Object.prototype.hasOwnProperty.call(a, s) && (e[s] = a[s]);
  }, Ot(o, t);
};
function vt(o, t) {
  if (typeof t != "function" && t !== null)
    throw new TypeError("Class extends value " + String(t) + " is not a constructor or null");
  Ot(o, t);
  function e() {
    this.constructor = o;
  }
  o.prototype = t === null ? Object.create(t) : (e.prototype = t.prototype, new e());
}
var G = function() {
  return G = Object.assign || function(t) {
    for (var e, a = 1, s = arguments.length; a < s; a++) {
      e = arguments[a];
      for (var i in e) Object.prototype.hasOwnProperty.call(e, i) && (t[i] = e[i]);
    }
    return t;
  }, G.apply(this, arguments);
};
function _e(o, t) {
  var e = {};
  for (var a in o) Object.prototype.hasOwnProperty.call(o, a) && t.indexOf(a) < 0 && (e[a] = o[a]);
  if (o != null && typeof Object.getOwnPropertySymbols == "function")
    for (var s = 0, a = Object.getOwnPropertySymbols(o); s < a.length; s++)
      t.indexOf(a[s]) < 0 && Object.prototype.propertyIsEnumerable.call(o, a[s]) && (e[a[s]] = o[a[s]]);
  return e;
}
function Ct(o, t, e) {
  if (e || arguments.length === 2) for (var a = 0, s = t.length, i; a < s; a++)
    (i || !(a in t)) && (i || (i = Array.prototype.slice.call(t, 0, a)), i[a] = t[a]);
  return o.concat(i || Array.prototype.slice.call(t));
}
function Pt(o, t) {
  var e = t && t.cache ? t.cache : De, a = t && t.serializer ? t.serializer : Ue, s = t && t.strategy ? t.strategy : qe;
  return s(o, {
    cache: e,
    serializer: a
  });
}
function $e(o) {
  return o == null || typeof o == "number" || typeof o == "boolean";
}
function We(o, t, e, a) {
  var s = $e(a) ? a : e(a), i = t.get(s);
  return typeof i > "u" && (i = o.call(this, a), t.set(s, i)), i;
}
function me(o, t, e) {
  var a = Array.prototype.slice.call(arguments, 3), s = e(a), i = t.get(s);
  return typeof i > "u" && (i = o.apply(this, a), t.set(s, i)), i;
}
function ye(o, t, e, a, s) {
  return e.bind(t, o, a, s);
}
function qe(o, t) {
  var e = o.length === 1 ? We : me;
  return ye(o, this, e, t.cache.create(), t.serializer);
}
function ze(o, t) {
  return ye(o, this, me, t.cache.create(), t.serializer);
}
var Ue = function() {
  return JSON.stringify(arguments);
}, Fe = (
  /** @class */
  (function() {
    function o() {
      this.cache = /* @__PURE__ */ Object.create(null);
    }
    return o.prototype.get = function(t) {
      return this.cache[t];
    }, o.prototype.set = function(t, e) {
      this.cache[t] = e;
    }, o;
  })()
), De = {
  create: function() {
    return new Fe();
  }
}, Rt = {
  variadic: ze
}, H;
(function(o) {
  o[o.EXPECT_ARGUMENT_CLOSING_BRACE = 1] = "EXPECT_ARGUMENT_CLOSING_BRACE", o[o.EMPTY_ARGUMENT = 2] = "EMPTY_ARGUMENT", o[o.MALFORMED_ARGUMENT = 3] = "MALFORMED_ARGUMENT", o[o.EXPECT_ARGUMENT_TYPE = 4] = "EXPECT_ARGUMENT_TYPE", o[o.INVALID_ARGUMENT_TYPE = 5] = "INVALID_ARGUMENT_TYPE", o[o.EXPECT_ARGUMENT_STYLE = 6] = "EXPECT_ARGUMENT_STYLE", o[o.INVALID_NUMBER_SKELETON = 7] = "INVALID_NUMBER_SKELETON", o[o.INVALID_DATE_TIME_SKELETON = 8] = "INVALID_DATE_TIME_SKELETON", o[o.EXPECT_NUMBER_SKELETON = 9] = "EXPECT_NUMBER_SKELETON", o[o.EXPECT_DATE_TIME_SKELETON = 10] = "EXPECT_DATE_TIME_SKELETON", o[o.UNCLOSED_QUOTE_IN_ARGUMENT_STYLE = 11] = "UNCLOSED_QUOTE_IN_ARGUMENT_STYLE", o[o.EXPECT_SELECT_ARGUMENT_OPTIONS = 12] = "EXPECT_SELECT_ARGUMENT_OPTIONS", o[o.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE = 13] = "EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE", o[o.INVALID_PLURAL_ARGUMENT_OFFSET_VALUE = 14] = "INVALID_PLURAL_ARGUMENT_OFFSET_VALUE", o[o.EXPECT_SELECT_ARGUMENT_SELECTOR = 15] = "EXPECT_SELECT_ARGUMENT_SELECTOR", o[o.EXPECT_PLURAL_ARGUMENT_SELECTOR = 16] = "EXPECT_PLURAL_ARGUMENT_SELECTOR", o[o.EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT = 17] = "EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT", o[o.EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT = 18] = "EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT", o[o.INVALID_PLURAL_ARGUMENT_SELECTOR = 19] = "INVALID_PLURAL_ARGUMENT_SELECTOR", o[o.DUPLICATE_PLURAL_ARGUMENT_SELECTOR = 20] = "DUPLICATE_PLURAL_ARGUMENT_SELECTOR", o[o.DUPLICATE_SELECT_ARGUMENT_SELECTOR = 21] = "DUPLICATE_SELECT_ARGUMENT_SELECTOR", o[o.MISSING_OTHER_CLAUSE = 22] = "MISSING_OTHER_CLAUSE", o[o.INVALID_TAG = 23] = "INVALID_TAG", o[o.INVALID_TAG_NAME = 25] = "INVALID_TAG_NAME", o[o.UNMATCHED_CLOSING_TAG = 26] = "UNMATCHED_CLOSING_TAG", o[o.UNCLOSED_TAG = 27] = "UNCLOSED_TAG";
})(H || (H = {}));
var W;
(function(o) {
  o[o.literal = 0] = "literal", o[o.argument = 1] = "argument", o[o.number = 2] = "number", o[o.date = 3] = "date", o[o.time = 4] = "time", o[o.select = 5] = "select", o[o.plural = 6] = "plural", o[o.pound = 7] = "pound", o[o.tag = 8] = "tag";
})(W || (W = {}));
var ft;
(function(o) {
  o[o.number = 0] = "number", o[o.dateTime = 1] = "dateTime";
})(ft || (ft = {}));
function Vt(o) {
  return o.type === W.literal;
}
function Xe(o) {
  return o.type === W.argument;
}
function we(o) {
  return o.type === W.number;
}
function xe(o) {
  return o.type === W.date;
}
function Se(o) {
  return o.type === W.time;
}
function ve(o) {
  return o.type === W.select;
}
function Me(o) {
  return o.type === W.plural;
}
function Ye(o) {
  return o.type === W.pound;
}
function ke(o) {
  return o.type === W.tag;
}
function Ce(o) {
  return !!(o && typeof o == "object" && o.type === ft.number);
}
function Gt(o) {
  return !!(o && typeof o == "object" && o.type === ft.dateTime);
}
var Pe = /[ \xA0\u1680\u2000-\u200A\u202F\u205F\u3000]/, je = /(?:[Eec]{1,6}|G{1,5}|[Qq]{1,5}|(?:[yYur]+|U{1,5})|[ML]{1,5}|d{1,2}|D{1,3}|F{1}|[abB]{1,5}|[hkHK]{1,2}|w{1,2}|W{1}|m{1,2}|s{1,2}|[zZOvVxX]{1,4})(?=([^']*'[^']*')*[^']*$)/g;
function Ve(o) {
  var t = {};
  return o.replace(je, function(e) {
    var a = e.length;
    switch (e[0]) {
      // Era
      case "G":
        t.era = a === 4 ? "long" : a === 5 ? "narrow" : "short";
        break;
      // Year
      case "y":
        t.year = a === 2 ? "2-digit" : "numeric";
        break;
      case "Y":
      case "u":
      case "U":
      case "r":
        throw new RangeError("`Y/u/U/r` (year) patterns are not supported, use `y` instead");
      // Quarter
      case "q":
      case "Q":
        throw new RangeError("`q/Q` (quarter) patterns are not supported");
      // Month
      case "M":
      case "L":
        t.month = ["numeric", "2-digit", "short", "long", "narrow"][a - 1];
        break;
      // Week
      case "w":
      case "W":
        throw new RangeError("`w/W` (week) patterns are not supported");
      case "d":
        t.day = ["numeric", "2-digit"][a - 1];
        break;
      case "D":
      case "F":
      case "g":
        throw new RangeError("`D/F/g` (day) patterns are not supported, use `d` instead");
      // Weekday
      case "E":
        t.weekday = a === 4 ? "long" : a === 5 ? "narrow" : "short";
        break;
      case "e":
        if (a < 4)
          throw new RangeError("`e..eee` (weekday) patterns are not supported");
        t.weekday = ["short", "long", "narrow", "short"][a - 4];
        break;
      case "c":
        if (a < 4)
          throw new RangeError("`c..ccc` (weekday) patterns are not supported");
        t.weekday = ["short", "long", "narrow", "short"][a - 4];
        break;
      // Period
      case "a":
        t.hour12 = !0;
        break;
      case "b":
      // am, pm, noon, midnight
      case "B":
        throw new RangeError("`b/B` (period) patterns are not supported, use `a` instead");
      // Hour
      case "h":
        t.hourCycle = "h12", t.hour = ["numeric", "2-digit"][a - 1];
        break;
      case "H":
        t.hourCycle = "h23", t.hour = ["numeric", "2-digit"][a - 1];
        break;
      case "K":
        t.hourCycle = "h11", t.hour = ["numeric", "2-digit"][a - 1];
        break;
      case "k":
        t.hourCycle = "h24", t.hour = ["numeric", "2-digit"][a - 1];
        break;
      case "j":
      case "J":
      case "C":
        throw new RangeError("`j/J/C` (hour) patterns are not supported, use `h/H/K/k` instead");
      // Minute
      case "m":
        t.minute = ["numeric", "2-digit"][a - 1];
        break;
      // Second
      case "s":
        t.second = ["numeric", "2-digit"][a - 1];
        break;
      case "S":
      case "A":
        throw new RangeError("`S/A` (second) patterns are not supported, use `s` instead");
      // Zone
      case "z":
        t.timeZoneName = a < 4 ? "short" : "long";
        break;
      case "Z":
      // 1..3, 4, 5: The ISO8601 varios formats
      case "O":
      // 1, 4: milliseconds in day short, long
      case "v":
      // 1, 4: generic non-location format
      case "V":
      // 1, 2, 3, 4: time zone ID or city
      case "X":
      // 1, 2, 3, 4: The ISO8601 varios formats
      case "x":
        throw new RangeError("`Z/O/v/V/X/x` (timeZone) patterns are not supported, use `z` instead");
    }
    return "";
  }), t;
}
var Je = /[\t-\r \x85\u200E\u200F\u2028\u2029]/i;
function Ze(o) {
  if (o.length === 0)
    throw new Error("Number skeleton cannot be empty");
  for (var t = o.split(Je).filter(function(u) {
    return u.length > 0;
  }), e = [], a = 0, s = t; a < s.length; a++) {
    var i = s[a], l = i.split("/");
    if (l.length === 0)
      throw new Error("Invalid number skeleton");
    for (var r = l[0], c = l.slice(1), n = 0, h = c; n < h.length; n++) {
      var f = h[n];
      if (f.length === 0)
        throw new Error("Invalid number skeleton");
    }
    e.push({ stem: r, options: c });
  }
  return e;
}
function Qe(o) {
  return o.replace(/^(.*?)-/, "");
}
var Jt = /^\.(?:(0+)(\*)?|(#+)|(0+)(#+))$/g, Re = /^(@+)?(\+|#+)?[rs]?$/g, Ke = /(\*)(0+)|(#+)(0+)|(0+)/g, Ie = /^(0+)$/;
function Zt(o) {
  var t = {};
  return o[o.length - 1] === "r" ? t.roundingPriority = "morePrecision" : o[o.length - 1] === "s" && (t.roundingPriority = "lessPrecision"), o.replace(Re, function(e, a, s) {
    return typeof s != "string" ? (t.minimumSignificantDigits = a.length, t.maximumSignificantDigits = a.length) : s === "+" ? t.minimumSignificantDigits = a.length : a[0] === "#" ? t.maximumSignificantDigits = a.length : (t.minimumSignificantDigits = a.length, t.maximumSignificantDigits = a.length + (typeof s == "string" ? s.length : 0)), "";
  }), t;
}
function Ee(o) {
  switch (o) {
    case "sign-auto":
      return {
        signDisplay: "auto"
      };
    case "sign-accounting":
    case "()":
      return {
        currencySign: "accounting"
      };
    case "sign-always":
    case "+!":
      return {
        signDisplay: "always"
      };
    case "sign-accounting-always":
    case "()!":
      return {
        signDisplay: "always",
        currencySign: "accounting"
      };
    case "sign-except-zero":
    case "+?":
      return {
        signDisplay: "exceptZero"
      };
    case "sign-accounting-except-zero":
    case "()?":
      return {
        signDisplay: "exceptZero",
        currencySign: "accounting"
      };
    case "sign-never":
    case "+_":
      return {
        signDisplay: "never"
      };
  }
}
function ta(o) {
  var t;
  if (o[0] === "E" && o[1] === "E" ? (t = {
    notation: "engineering"
  }, o = o.slice(2)) : o[0] === "E" && (t = {
    notation: "scientific"
  }, o = o.slice(1)), t) {
    var e = o.slice(0, 2);
    if (e === "+!" ? (t.signDisplay = "always", o = o.slice(2)) : e === "+?" && (t.signDisplay = "exceptZero", o = o.slice(2)), !Ie.test(o))
      throw new Error("Malformed concise eng/scientific notation");
    t.minimumIntegerDigits = o.length;
  }
  return t;
}
function Qt(o) {
  var t = {}, e = Ee(o);
  return e || t;
}
function ea(o) {
  for (var t = {}, e = 0, a = o; e < a.length; e++) {
    var s = a[e];
    switch (s.stem) {
      case "percent":
      case "%":
        t.style = "percent";
        continue;
      case "%x100":
        t.style = "percent", t.scale = 100;
        continue;
      case "currency":
        t.style = "currency", t.currency = s.options[0];
        continue;
      case "group-off":
      case ",_":
        t.useGrouping = !1;
        continue;
      case "precision-integer":
      case ".":
        t.maximumFractionDigits = 0;
        continue;
      case "measure-unit":
      case "unit":
        t.style = "unit", t.unit = Qe(s.options[0]);
        continue;
      case "compact-short":
      case "K":
        t.notation = "compact", t.compactDisplay = "short";
        continue;
      case "compact-long":
      case "KK":
        t.notation = "compact", t.compactDisplay = "long";
        continue;
      case "scientific":
        t = G(G(G({}, t), { notation: "scientific" }), s.options.reduce(function(c, n) {
          return G(G({}, c), Qt(n));
        }, {}));
        continue;
      case "engineering":
        t = G(G(G({}, t), { notation: "engineering" }), s.options.reduce(function(c, n) {
          return G(G({}, c), Qt(n));
        }, {}));
        continue;
      case "notation-simple":
        t.notation = "standard";
        continue;
      // https://github.com/unicode-org/icu/blob/master/icu4c/source/i18n/unicode/unumberformatter.h
      case "unit-width-narrow":
        t.currencyDisplay = "narrowSymbol", t.unitDisplay = "narrow";
        continue;
      case "unit-width-short":
        t.currencyDisplay = "code", t.unitDisplay = "short";
        continue;
      case "unit-width-full-name":
        t.currencyDisplay = "name", t.unitDisplay = "long";
        continue;
      case "unit-width-iso-code":
        t.currencyDisplay = "symbol";
        continue;
      case "scale":
        t.scale = parseFloat(s.options[0]);
        continue;
      case "rounding-mode-floor":
        t.roundingMode = "floor";
        continue;
      case "rounding-mode-ceiling":
        t.roundingMode = "ceil";
        continue;
      case "rounding-mode-down":
        t.roundingMode = "trunc";
        continue;
      case "rounding-mode-up":
        t.roundingMode = "expand";
        continue;
      case "rounding-mode-half-even":
        t.roundingMode = "halfEven";
        continue;
      case "rounding-mode-half-down":
        t.roundingMode = "halfTrunc";
        continue;
      case "rounding-mode-half-up":
        t.roundingMode = "halfExpand";
        continue;
      // https://unicode-org.github.io/icu/userguide/format_parse/numbers/skeletons.html#integer-width
      case "integer-width":
        if (s.options.length > 1)
          throw new RangeError("integer-width stems only accept a single optional option");
        s.options[0].replace(Ke, function(c, n, h, f, u, d) {
          if (n)
            t.minimumIntegerDigits = h.length;
          else {
            if (f && u)
              throw new Error("We currently do not support maximum integer digits");
            if (d)
              throw new Error("We currently do not support exact integer digits");
          }
          return "";
        });
        continue;
    }
    if (Ie.test(s.stem)) {
      t.minimumIntegerDigits = s.stem.length;
      continue;
    }
    if (Jt.test(s.stem)) {
      if (s.options.length > 1)
        throw new RangeError("Fraction-precision stems only accept a single optional option");
      s.stem.replace(Jt, function(c, n, h, f, u, d) {
        return h === "*" ? t.minimumFractionDigits = n.length : f && f[0] === "#" ? t.maximumFractionDigits = f.length : u && d ? (t.minimumFractionDigits = u.length, t.maximumFractionDigits = u.length + d.length) : (t.minimumFractionDigits = n.length, t.maximumFractionDigits = n.length), "";
      });
      var i = s.options[0];
      i === "w" ? t = G(G({}, t), { trailingZeroDisplay: "stripIfInteger" }) : i && (t = G(G({}, t), Zt(i)));
      continue;
    }
    if (Re.test(s.stem)) {
      t = G(G({}, t), Zt(s.stem));
      continue;
    }
    var l = Ee(s.stem);
    l && (t = G(G({}, t), l));
    var r = ta(s.stem);
    r && (t = G(G({}, t), r));
  }
  return t;
}
var yt = {
  "001": [
    "H",
    "h"
  ],
  419: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  AC: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  AD: [
    "H",
    "hB"
  ],
  AE: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  AF: [
    "H",
    "hb",
    "hB",
    "h"
  ],
  AG: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  AI: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  AL: [
    "h",
    "H",
    "hB"
  ],
  AM: [
    "H",
    "hB"
  ],
  AO: [
    "H",
    "hB"
  ],
  AR: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  AS: [
    "h",
    "H"
  ],
  AT: [
    "H",
    "hB"
  ],
  AU: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  AW: [
    "H",
    "hB"
  ],
  AX: [
    "H"
  ],
  AZ: [
    "H",
    "hB",
    "h"
  ],
  BA: [
    "H",
    "hB",
    "h"
  ],
  BB: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  BD: [
    "h",
    "hB",
    "H"
  ],
  BE: [
    "H",
    "hB"
  ],
  BF: [
    "H",
    "hB"
  ],
  BG: [
    "H",
    "hB",
    "h"
  ],
  BH: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  BI: [
    "H",
    "h"
  ],
  BJ: [
    "H",
    "hB"
  ],
  BL: [
    "H",
    "hB"
  ],
  BM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  BN: [
    "hb",
    "hB",
    "h",
    "H"
  ],
  BO: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  BQ: [
    "H"
  ],
  BR: [
    "H",
    "hB"
  ],
  BS: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  BT: [
    "h",
    "H"
  ],
  BW: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  BY: [
    "H",
    "h"
  ],
  BZ: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  CA: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  CC: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  CD: [
    "hB",
    "H"
  ],
  CF: [
    "H",
    "h",
    "hB"
  ],
  CG: [
    "H",
    "hB"
  ],
  CH: [
    "H",
    "hB",
    "h"
  ],
  CI: [
    "H",
    "hB"
  ],
  CK: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  CL: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  CM: [
    "H",
    "h",
    "hB"
  ],
  CN: [
    "H",
    "hB",
    "hb",
    "h"
  ],
  CO: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  CP: [
    "H"
  ],
  CR: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  CU: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  CV: [
    "H",
    "hB"
  ],
  CW: [
    "H",
    "hB"
  ],
  CX: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  CY: [
    "h",
    "H",
    "hb",
    "hB"
  ],
  CZ: [
    "H"
  ],
  DE: [
    "H",
    "hB"
  ],
  DG: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  DJ: [
    "h",
    "H"
  ],
  DK: [
    "H"
  ],
  DM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  DO: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  DZ: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  EA: [
    "H",
    "h",
    "hB",
    "hb"
  ],
  EC: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  EE: [
    "H",
    "hB"
  ],
  EG: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  EH: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  ER: [
    "h",
    "H"
  ],
  ES: [
    "H",
    "hB",
    "h",
    "hb"
  ],
  ET: [
    "hB",
    "hb",
    "h",
    "H"
  ],
  FI: [
    "H"
  ],
  FJ: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  FK: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  FM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  FO: [
    "H",
    "h"
  ],
  FR: [
    "H",
    "hB"
  ],
  GA: [
    "H",
    "hB"
  ],
  GB: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  GD: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  GE: [
    "H",
    "hB",
    "h"
  ],
  GF: [
    "H",
    "hB"
  ],
  GG: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  GH: [
    "h",
    "H"
  ],
  GI: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  GL: [
    "H",
    "h"
  ],
  GM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  GN: [
    "H",
    "hB"
  ],
  GP: [
    "H",
    "hB"
  ],
  GQ: [
    "H",
    "hB",
    "h",
    "hb"
  ],
  GR: [
    "h",
    "H",
    "hb",
    "hB"
  ],
  GT: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  GU: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  GW: [
    "H",
    "hB"
  ],
  GY: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  HK: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  HN: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  HR: [
    "H",
    "hB"
  ],
  HU: [
    "H",
    "h"
  ],
  IC: [
    "H",
    "h",
    "hB",
    "hb"
  ],
  ID: [
    "H"
  ],
  IE: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  IL: [
    "H",
    "hB"
  ],
  IM: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  IN: [
    "h",
    "H"
  ],
  IO: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  IQ: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  IR: [
    "hB",
    "H"
  ],
  IS: [
    "H"
  ],
  IT: [
    "H",
    "hB"
  ],
  JE: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  JM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  JO: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  JP: [
    "H",
    "K",
    "h"
  ],
  KE: [
    "hB",
    "hb",
    "H",
    "h"
  ],
  KG: [
    "H",
    "h",
    "hB",
    "hb"
  ],
  KH: [
    "hB",
    "h",
    "H",
    "hb"
  ],
  KI: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  KM: [
    "H",
    "h",
    "hB",
    "hb"
  ],
  KN: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  KP: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  KR: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  KW: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  KY: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  KZ: [
    "H",
    "hB"
  ],
  LA: [
    "H",
    "hb",
    "hB",
    "h"
  ],
  LB: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  LC: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  LI: [
    "H",
    "hB",
    "h"
  ],
  LK: [
    "H",
    "h",
    "hB",
    "hb"
  ],
  LR: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  LS: [
    "h",
    "H"
  ],
  LT: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  LU: [
    "H",
    "h",
    "hB"
  ],
  LV: [
    "H",
    "hB",
    "hb",
    "h"
  ],
  LY: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  MA: [
    "H",
    "h",
    "hB",
    "hb"
  ],
  MC: [
    "H",
    "hB"
  ],
  MD: [
    "H",
    "hB"
  ],
  ME: [
    "H",
    "hB",
    "h"
  ],
  MF: [
    "H",
    "hB"
  ],
  MG: [
    "H",
    "h"
  ],
  MH: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  MK: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  ML: [
    "H"
  ],
  MM: [
    "hB",
    "hb",
    "H",
    "h"
  ],
  MN: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  MO: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  MP: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  MQ: [
    "H",
    "hB"
  ],
  MR: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  MS: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  MT: [
    "H",
    "h"
  ],
  MU: [
    "H",
    "h"
  ],
  MV: [
    "H",
    "h"
  ],
  MW: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  MX: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  MY: [
    "hb",
    "hB",
    "h",
    "H"
  ],
  MZ: [
    "H",
    "hB"
  ],
  NA: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  NC: [
    "H",
    "hB"
  ],
  NE: [
    "H"
  ],
  NF: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  NG: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  NI: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  NL: [
    "H",
    "hB"
  ],
  NO: [
    "H",
    "h"
  ],
  NP: [
    "H",
    "h",
    "hB"
  ],
  NR: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  NU: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  NZ: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  OM: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  PA: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  PE: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  PF: [
    "H",
    "h",
    "hB"
  ],
  PG: [
    "h",
    "H"
  ],
  PH: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  PK: [
    "h",
    "hB",
    "H"
  ],
  PL: [
    "H",
    "h"
  ],
  PM: [
    "H",
    "hB"
  ],
  PN: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  PR: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  PS: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  PT: [
    "H",
    "hB"
  ],
  PW: [
    "h",
    "H"
  ],
  PY: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  QA: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  RE: [
    "H",
    "hB"
  ],
  RO: [
    "H",
    "hB"
  ],
  RS: [
    "H",
    "hB",
    "h"
  ],
  RU: [
    "H"
  ],
  RW: [
    "H",
    "h"
  ],
  SA: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  SB: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  SC: [
    "H",
    "h",
    "hB"
  ],
  SD: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  SE: [
    "H"
  ],
  SG: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  SH: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  SI: [
    "H",
    "hB"
  ],
  SJ: [
    "H"
  ],
  SK: [
    "H"
  ],
  SL: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  SM: [
    "H",
    "h",
    "hB"
  ],
  SN: [
    "H",
    "h",
    "hB"
  ],
  SO: [
    "h",
    "H"
  ],
  SR: [
    "H",
    "hB"
  ],
  SS: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  ST: [
    "H",
    "hB"
  ],
  SV: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  SX: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  SY: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  SZ: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  TA: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  TC: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  TD: [
    "h",
    "H",
    "hB"
  ],
  TF: [
    "H",
    "h",
    "hB"
  ],
  TG: [
    "H",
    "hB"
  ],
  TH: [
    "H",
    "h"
  ],
  TJ: [
    "H",
    "h"
  ],
  TL: [
    "H",
    "hB",
    "hb",
    "h"
  ],
  TM: [
    "H",
    "h"
  ],
  TN: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  TO: [
    "h",
    "H"
  ],
  TR: [
    "H",
    "hB"
  ],
  TT: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  TW: [
    "hB",
    "hb",
    "h",
    "H"
  ],
  TZ: [
    "hB",
    "hb",
    "H",
    "h"
  ],
  UA: [
    "H",
    "hB",
    "h"
  ],
  UG: [
    "hB",
    "hb",
    "H",
    "h"
  ],
  UM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  US: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  UY: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  UZ: [
    "H",
    "hB",
    "h"
  ],
  VA: [
    "H",
    "h",
    "hB"
  ],
  VC: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  VE: [
    "h",
    "H",
    "hB",
    "hb"
  ],
  VG: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  VI: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  VN: [
    "H",
    "h"
  ],
  VU: [
    "h",
    "H"
  ],
  WF: [
    "H",
    "hB"
  ],
  WS: [
    "h",
    "H"
  ],
  XK: [
    "H",
    "hB",
    "h"
  ],
  YE: [
    "h",
    "hB",
    "hb",
    "H"
  ],
  YT: [
    "H",
    "hB"
  ],
  ZA: [
    "H",
    "h",
    "hb",
    "hB"
  ],
  ZM: [
    "h",
    "hb",
    "H",
    "hB"
  ],
  ZW: [
    "H",
    "h"
  ],
  "af-ZA": [
    "H",
    "h",
    "hB",
    "hb"
  ],
  "ar-001": [
    "h",
    "hB",
    "hb",
    "H"
  ],
  "ca-ES": [
    "H",
    "h",
    "hB"
  ],
  "en-001": [
    "h",
    "hb",
    "H",
    "hB"
  ],
  "en-HK": [
    "h",
    "hb",
    "H",
    "hB"
  ],
  "en-IL": [
    "H",
    "h",
    "hb",
    "hB"
  ],
  "en-MY": [
    "h",
    "hb",
    "H",
    "hB"
  ],
  "es-BR": [
    "H",
    "h",
    "hB",
    "hb"
  ],
  "es-ES": [
    "H",
    "h",
    "hB",
    "hb"
  ],
  "es-GQ": [
    "H",
    "h",
    "hB",
    "hb"
  ],
  "fr-CA": [
    "H",
    "h",
    "hB"
  ],
  "gl-ES": [
    "H",
    "h",
    "hB"
  ],
  "gu-IN": [
    "hB",
    "hb",
    "h",
    "H"
  ],
  "hi-IN": [
    "hB",
    "h",
    "H"
  ],
  "it-CH": [
    "H",
    "h",
    "hB"
  ],
  "it-IT": [
    "H",
    "h",
    "hB"
  ],
  "kn-IN": [
    "hB",
    "h",
    "H"
  ],
  "ml-IN": [
    "hB",
    "h",
    "H"
  ],
  "mr-IN": [
    "hB",
    "hb",
    "h",
    "H"
  ],
  "pa-IN": [
    "hB",
    "hb",
    "h",
    "H"
  ],
  "ta-IN": [
    "hB",
    "h",
    "hb",
    "H"
  ],
  "te-IN": [
    "hB",
    "h",
    "H"
  ],
  "zu-ZA": [
    "H",
    "hB",
    "hb",
    "h"
  ]
};
function aa(o, t) {
  for (var e = "", a = 0; a < o.length; a++) {
    var s = o.charAt(a);
    if (s === "j") {
      for (var i = 0; a + 1 < o.length && o.charAt(a + 1) === s; )
        i++, a++;
      var l = 1 + (i & 1), r = i < 2 ? 1 : 3 + (i >> 1), c = "a", n = oa(t);
      for ((n == "H" || n == "k") && (r = 0); r-- > 0; )
        e += c;
      for (; l-- > 0; )
        e = n + e;
    } else s === "J" ? e += "H" : e += s;
  }
  return e;
}
function oa(o) {
  var t = o.hourCycle;
  if (t === void 0 && // @ts-ignore hourCycle(s) is not identified yet
  o.hourCycles && // @ts-ignore
  o.hourCycles.length && (t = o.hourCycles[0]), t)
    switch (t) {
      case "h24":
        return "k";
      case "h23":
        return "H";
      case "h12":
        return "h";
      case "h11":
        return "K";
      default:
        throw new Error("Invalid hourCycle");
    }
  var e = o.language, a;
  e !== "root" && (a = o.maximize().region);
  var s = yt[a || ""] || yt[e || ""] || yt["".concat(e, "-001")] || yt["001"];
  return s[0];
}
var It, sa = new RegExp("^".concat(Pe.source, "*")), ia = new RegExp("".concat(Pe.source, "*$"));
function O(o, t) {
  return { start: o, end: t };
}
var na = !!String.prototype.startsWith && "_a".startsWith("a", 1), ra = !!String.fromCodePoint, la = !!Object.fromEntries, ca = !!String.prototype.codePointAt, ha = !!String.prototype.trimStart, da = !!String.prototype.trimEnd, fa = !!Number.isSafeInteger, pa = fa ? Number.isSafeInteger : function(o) {
  return typeof o == "number" && isFinite(o) && Math.floor(o) === o && Math.abs(o) <= 9007199254740991;
}, _t = !0;
try {
  var ua = Te("([^\\p{White_Space}\\p{Pattern_Syntax}]*)", "yu");
  _t = ((It = ua.exec("a")) === null || It === void 0 ? void 0 : It[0]) === "a";
} catch {
  _t = !1;
}
var Kt = na ? (
  // Native
  function(t, e, a) {
    return t.startsWith(e, a);
  }
) : (
  // For IE11
  function(t, e, a) {
    return t.slice(a, a + e.length) === e;
  }
), $t = ra ? String.fromCodePoint : (
  // IE11
  function() {
    for (var t = [], e = 0; e < arguments.length; e++)
      t[e] = arguments[e];
    for (var a = "", s = t.length, i = 0, l; s > i; ) {
      if (l = t[i++], l > 1114111)
        throw RangeError(l + " is not a valid code point");
      a += l < 65536 ? String.fromCharCode(l) : String.fromCharCode(((l -= 65536) >> 10) + 55296, l % 1024 + 56320);
    }
    return a;
  }
), te = (
  // native
  la ? Object.fromEntries : (
    // Ponyfill
    function(t) {
      for (var e = {}, a = 0, s = t; a < s.length; a++) {
        var i = s[a], l = i[0], r = i[1];
        e[l] = r;
      }
      return e;
    }
  )
), Ae = ca ? (
  // Native
  function(t, e) {
    return t.codePointAt(e);
  }
) : (
  // IE 11
  function(t, e) {
    var a = t.length;
    if (!(e < 0 || e >= a)) {
      var s = t.charCodeAt(e), i;
      return s < 55296 || s > 56319 || e + 1 === a || (i = t.charCodeAt(e + 1)) < 56320 || i > 57343 ? s : (s - 55296 << 10) + (i - 56320) + 65536;
    }
  }
), ga = ha ? (
  // Native
  function(t) {
    return t.trimStart();
  }
) : (
  // Ponyfill
  function(t) {
    return t.replace(sa, "");
  }
), ba = da ? (
  // Native
  function(t) {
    return t.trimEnd();
  }
) : (
  // Ponyfill
  function(t) {
    return t.replace(ia, "");
  }
);
function Te(o, t) {
  return new RegExp(o, t);
}
var Wt;
if (_t) {
  var ee = Te("([^\\p{White_Space}\\p{Pattern_Syntax}]*)", "yu");
  Wt = function(t, e) {
    var a;
    ee.lastIndex = e;
    var s = ee.exec(t);
    return (a = s[1]) !== null && a !== void 0 ? a : "";
  };
} else
  Wt = function(t, e) {
    for (var a = []; ; ) {
      var s = Ae(t, e);
      if (s === void 0 || Ne(s) || xa(s))
        break;
      a.push(s), e += s >= 65536 ? 2 : 1;
    }
    return $t.apply(void 0, a);
  };
var ma = (
  /** @class */
  (function() {
    function o(t, e) {
      e === void 0 && (e = {}), this.message = t, this.position = { offset: 0, line: 1, column: 1 }, this.ignoreTag = !!e.ignoreTag, this.locale = e.locale, this.requiresOtherClause = !!e.requiresOtherClause, this.shouldParseSkeletons = !!e.shouldParseSkeletons;
    }
    return o.prototype.parse = function() {
      if (this.offset() !== 0)
        throw Error("parser can only be used once");
      return this.parseMessage(0, "", !1);
    }, o.prototype.parseMessage = function(t, e, a) {
      for (var s = []; !this.isEOF(); ) {
        var i = this.char();
        if (i === 123) {
          var l = this.parseArgument(t, a);
          if (l.err)
            return l;
          s.push(l.val);
        } else {
          if (i === 125 && t > 0)
            break;
          if (i === 35 && (e === "plural" || e === "selectordinal")) {
            var r = this.clonePosition();
            this.bump(), s.push({
              type: W.pound,
              location: O(r, this.clonePosition())
            });
          } else if (i === 60 && !this.ignoreTag && this.peek() === 47) {
            if (a)
              break;
            return this.error(H.UNMATCHED_CLOSING_TAG, O(this.clonePosition(), this.clonePosition()));
          } else if (i === 60 && !this.ignoreTag && qt(this.peek() || 0)) {
            var l = this.parseTag(t, e);
            if (l.err)
              return l;
            s.push(l.val);
          } else {
            var l = this.parseLiteral(t, e);
            if (l.err)
              return l;
            s.push(l.val);
          }
        }
      }
      return { val: s, err: null };
    }, o.prototype.parseTag = function(t, e) {
      var a = this.clonePosition();
      this.bump();
      var s = this.parseTagName();
      if (this.bumpSpace(), this.bumpIf("/>"))
        return {
          val: {
            type: W.literal,
            value: "<".concat(s, "/>"),
            location: O(a, this.clonePosition())
          },
          err: null
        };
      if (this.bumpIf(">")) {
        var i = this.parseMessage(t + 1, e, !0);
        if (i.err)
          return i;
        var l = i.val, r = this.clonePosition();
        if (this.bumpIf("</")) {
          if (this.isEOF() || !qt(this.char()))
            return this.error(H.INVALID_TAG, O(r, this.clonePosition()));
          var c = this.clonePosition(), n = this.parseTagName();
          return s !== n ? this.error(H.UNMATCHED_CLOSING_TAG, O(c, this.clonePosition())) : (this.bumpSpace(), this.bumpIf(">") ? {
            val: {
              type: W.tag,
              value: s,
              children: l,
              location: O(a, this.clonePosition())
            },
            err: null
          } : this.error(H.INVALID_TAG, O(r, this.clonePosition())));
        } else
          return this.error(H.UNCLOSED_TAG, O(a, this.clonePosition()));
      } else
        return this.error(H.INVALID_TAG, O(a, this.clonePosition()));
    }, o.prototype.parseTagName = function() {
      var t = this.offset();
      for (this.bump(); !this.isEOF() && wa(this.char()); )
        this.bump();
      return this.message.slice(t, this.offset());
    }, o.prototype.parseLiteral = function(t, e) {
      for (var a = this.clonePosition(), s = ""; ; ) {
        var i = this.tryParseQuote(e);
        if (i) {
          s += i;
          continue;
        }
        var l = this.tryParseUnquoted(t, e);
        if (l) {
          s += l;
          continue;
        }
        var r = this.tryParseLeftAngleBracket();
        if (r) {
          s += r;
          continue;
        }
        break;
      }
      var c = O(a, this.clonePosition());
      return {
        val: { type: W.literal, value: s, location: c },
        err: null
      };
    }, o.prototype.tryParseLeftAngleBracket = function() {
      return !this.isEOF() && this.char() === 60 && (this.ignoreTag || // If at the opening tag or closing tag position, bail.
      !ya(this.peek() || 0)) ? (this.bump(), "<") : null;
    }, o.prototype.tryParseQuote = function(t) {
      if (this.isEOF() || this.char() !== 39)
        return null;
      switch (this.peek()) {
        case 39:
          return this.bump(), this.bump(), "'";
        // '{', '<', '>', '}'
        case 123:
        case 60:
        case 62:
        case 125:
          break;
        case 35:
          if (t === "plural" || t === "selectordinal")
            break;
          return null;
        default:
          return null;
      }
      this.bump();
      var e = [this.char()];
      for (this.bump(); !this.isEOF(); ) {
        var a = this.char();
        if (a === 39)
          if (this.peek() === 39)
            e.push(39), this.bump();
          else {
            this.bump();
            break;
          }
        else
          e.push(a);
        this.bump();
      }
      return $t.apply(void 0, e);
    }, o.prototype.tryParseUnquoted = function(t, e) {
      if (this.isEOF())
        return null;
      var a = this.char();
      return a === 60 || a === 123 || a === 35 && (e === "plural" || e === "selectordinal") || a === 125 && t > 0 ? null : (this.bump(), $t(a));
    }, o.prototype.parseArgument = function(t, e) {
      var a = this.clonePosition();
      if (this.bump(), this.bumpSpace(), this.isEOF())
        return this.error(H.EXPECT_ARGUMENT_CLOSING_BRACE, O(a, this.clonePosition()));
      if (this.char() === 125)
        return this.bump(), this.error(H.EMPTY_ARGUMENT, O(a, this.clonePosition()));
      var s = this.parseIdentifierIfPossible().value;
      if (!s)
        return this.error(H.MALFORMED_ARGUMENT, O(a, this.clonePosition()));
      if (this.bumpSpace(), this.isEOF())
        return this.error(H.EXPECT_ARGUMENT_CLOSING_BRACE, O(a, this.clonePosition()));
      switch (this.char()) {
        // Simple argument: `{name}`
        case 125:
          return this.bump(), {
            val: {
              type: W.argument,
              // value does not include the opening and closing braces.
              value: s,
              location: O(a, this.clonePosition())
            },
            err: null
          };
        // Argument with options: `{name, format, ...}`
        case 44:
          return this.bump(), this.bumpSpace(), this.isEOF() ? this.error(H.EXPECT_ARGUMENT_CLOSING_BRACE, O(a, this.clonePosition())) : this.parseArgumentOptions(t, e, s, a);
        default:
          return this.error(H.MALFORMED_ARGUMENT, O(a, this.clonePosition()));
      }
    }, o.prototype.parseIdentifierIfPossible = function() {
      var t = this.clonePosition(), e = this.offset(), a = Wt(this.message, e), s = e + a.length;
      this.bumpTo(s);
      var i = this.clonePosition(), l = O(t, i);
      return { value: a, location: l };
    }, o.prototype.parseArgumentOptions = function(t, e, a, s) {
      var i, l = this.clonePosition(), r = this.parseIdentifierIfPossible().value, c = this.clonePosition();
      switch (r) {
        case "":
          return this.error(H.EXPECT_ARGUMENT_TYPE, O(l, c));
        case "number":
        case "date":
        case "time": {
          this.bumpSpace();
          var n = null;
          if (this.bumpIf(",")) {
            this.bumpSpace();
            var h = this.clonePosition(), f = this.parseSimpleArgStyleIfPossible();
            if (f.err)
              return f;
            var u = ba(f.val);
            if (u.length === 0)
              return this.error(H.EXPECT_ARGUMENT_STYLE, O(this.clonePosition(), this.clonePosition()));
            var d = O(h, this.clonePosition());
            n = { style: u, styleLocation: d };
          }
          var p = this.tryParseArgumentClose(s);
          if (p.err)
            return p;
          var b = O(s, this.clonePosition());
          if (n && Kt(n?.style, "::", 0)) {
            var m = ga(n.style.slice(2));
            if (r === "number") {
              var f = this.parseNumberSkeletonFromString(m, n.styleLocation);
              return f.err ? f : {
                val: { type: W.number, value: a, location: b, style: f.val },
                err: null
              };
            } else {
              if (m.length === 0)
                return this.error(H.EXPECT_DATE_TIME_SKELETON, b);
              var g = m;
              this.locale && (g = aa(m, this.locale));
              var u = {
                type: ft.dateTime,
                pattern: g,
                location: n.styleLocation,
                parsedOptions: this.shouldParseSkeletons ? Ve(g) : {}
              }, y = r === "date" ? W.date : W.time;
              return {
                val: { type: y, value: a, location: b, style: u },
                err: null
              };
            }
          }
          return {
            val: {
              type: r === "number" ? W.number : r === "date" ? W.date : W.time,
              value: a,
              location: b,
              style: (i = n?.style) !== null && i !== void 0 ? i : null
            },
            err: null
          };
        }
        case "plural":
        case "selectordinal":
        case "select": {
          var w = this.clonePosition();
          if (this.bumpSpace(), !this.bumpIf(","))
            return this.error(H.EXPECT_SELECT_ARGUMENT_OPTIONS, O(w, G({}, w)));
          this.bumpSpace();
          var S = this.parseIdentifierIfPossible(), x = 0;
          if (r !== "select" && S.value === "offset") {
            if (!this.bumpIf(":"))
              return this.error(H.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE, O(this.clonePosition(), this.clonePosition()));
            this.bumpSpace();
            var f = this.tryParseDecimalInteger(H.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE, H.INVALID_PLURAL_ARGUMENT_OFFSET_VALUE);
            if (f.err)
              return f;
            this.bumpSpace(), S = this.parseIdentifierIfPossible(), x = f.val;
          }
          var v = this.tryParsePluralOrSelectOptions(t, r, e, S);
          if (v.err)
            return v;
          var p = this.tryParseArgumentClose(s);
          if (p.err)
            return p;
          var M = O(s, this.clonePosition());
          return r === "select" ? {
            val: {
              type: W.select,
              value: a,
              options: te(v.val),
              location: M
            },
            err: null
          } : {
            val: {
              type: W.plural,
              value: a,
              options: te(v.val),
              offset: x,
              pluralType: r === "plural" ? "cardinal" : "ordinal",
              location: M
            },
            err: null
          };
        }
        default:
          return this.error(H.INVALID_ARGUMENT_TYPE, O(l, c));
      }
    }, o.prototype.tryParseArgumentClose = function(t) {
      return this.isEOF() || this.char() !== 125 ? this.error(H.EXPECT_ARGUMENT_CLOSING_BRACE, O(t, this.clonePosition())) : (this.bump(), { val: !0, err: null });
    }, o.prototype.parseSimpleArgStyleIfPossible = function() {
      for (var t = 0, e = this.clonePosition(); !this.isEOF(); ) {
        var a = this.char();
        switch (a) {
          case 39: {
            this.bump();
            var s = this.clonePosition();
            if (!this.bumpUntil("'"))
              return this.error(H.UNCLOSED_QUOTE_IN_ARGUMENT_STYLE, O(s, this.clonePosition()));
            this.bump();
            break;
          }
          case 123: {
            t += 1, this.bump();
            break;
          }
          case 125: {
            if (t > 0)
              t -= 1;
            else
              return {
                val: this.message.slice(e.offset, this.offset()),
                err: null
              };
            break;
          }
          default:
            this.bump();
            break;
        }
      }
      return {
        val: this.message.slice(e.offset, this.offset()),
        err: null
      };
    }, o.prototype.parseNumberSkeletonFromString = function(t, e) {
      var a = [];
      try {
        a = Ze(t);
      } catch {
        return this.error(H.INVALID_NUMBER_SKELETON, e);
      }
      return {
        val: {
          type: ft.number,
          tokens: a,
          location: e,
          parsedOptions: this.shouldParseSkeletons ? ea(a) : {}
        },
        err: null
      };
    }, o.prototype.tryParsePluralOrSelectOptions = function(t, e, a, s) {
      for (var i, l = !1, r = [], c = /* @__PURE__ */ new Set(), n = s.value, h = s.location; ; ) {
        if (n.length === 0) {
          var f = this.clonePosition();
          if (e !== "select" && this.bumpIf("=")) {
            var u = this.tryParseDecimalInteger(H.EXPECT_PLURAL_ARGUMENT_SELECTOR, H.INVALID_PLURAL_ARGUMENT_SELECTOR);
            if (u.err)
              return u;
            h = O(f, this.clonePosition()), n = this.message.slice(f.offset, this.offset());
          } else
            break;
        }
        if (c.has(n))
          return this.error(e === "select" ? H.DUPLICATE_SELECT_ARGUMENT_SELECTOR : H.DUPLICATE_PLURAL_ARGUMENT_SELECTOR, h);
        n === "other" && (l = !0), this.bumpSpace();
        var d = this.clonePosition();
        if (!this.bumpIf("{"))
          return this.error(e === "select" ? H.EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT : H.EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT, O(this.clonePosition(), this.clonePosition()));
        var p = this.parseMessage(t + 1, e, a);
        if (p.err)
          return p;
        var b = this.tryParseArgumentClose(d);
        if (b.err)
          return b;
        r.push([
          n,
          {
            value: p.val,
            location: O(d, this.clonePosition())
          }
        ]), c.add(n), this.bumpSpace(), i = this.parseIdentifierIfPossible(), n = i.value, h = i.location;
      }
      return r.length === 0 ? this.error(e === "select" ? H.EXPECT_SELECT_ARGUMENT_SELECTOR : H.EXPECT_PLURAL_ARGUMENT_SELECTOR, O(this.clonePosition(), this.clonePosition())) : this.requiresOtherClause && !l ? this.error(H.MISSING_OTHER_CLAUSE, O(this.clonePosition(), this.clonePosition())) : { val: r, err: null };
    }, o.prototype.tryParseDecimalInteger = function(t, e) {
      var a = 1, s = this.clonePosition();
      this.bumpIf("+") || this.bumpIf("-") && (a = -1);
      for (var i = !1, l = 0; !this.isEOF(); ) {
        var r = this.char();
        if (r >= 48 && r <= 57)
          i = !0, l = l * 10 + (r - 48), this.bump();
        else
          break;
      }
      var c = O(s, this.clonePosition());
      return i ? (l *= a, pa(l) ? { val: l, err: null } : this.error(e, c)) : this.error(t, c);
    }, o.prototype.offset = function() {
      return this.position.offset;
    }, o.prototype.isEOF = function() {
      return this.offset() === this.message.length;
    }, o.prototype.clonePosition = function() {
      return {
        offset: this.position.offset,
        line: this.position.line,
        column: this.position.column
      };
    }, o.prototype.char = function() {
      var t = this.position.offset;
      if (t >= this.message.length)
        throw Error("out of bound");
      var e = Ae(this.message, t);
      if (e === void 0)
        throw Error("Offset ".concat(t, " is at invalid UTF-16 code unit boundary"));
      return e;
    }, o.prototype.error = function(t, e) {
      return {
        val: null,
        err: {
          kind: t,
          message: this.message,
          location: e
        }
      };
    }, o.prototype.bump = function() {
      if (!this.isEOF()) {
        var t = this.char();
        t === 10 ? (this.position.line += 1, this.position.column = 1, this.position.offset += 1) : (this.position.column += 1, this.position.offset += t < 65536 ? 1 : 2);
      }
    }, o.prototype.bumpIf = function(t) {
      if (Kt(this.message, t, this.offset())) {
        for (var e = 0; e < t.length; e++)
          this.bump();
        return !0;
      }
      return !1;
    }, o.prototype.bumpUntil = function(t) {
      var e = this.offset(), a = this.message.indexOf(t, e);
      return a >= 0 ? (this.bumpTo(a), !0) : (this.bumpTo(this.message.length), !1);
    }, o.prototype.bumpTo = function(t) {
      if (this.offset() > t)
        throw Error("targetOffset ".concat(t, " must be greater than or equal to the current offset ").concat(this.offset()));
      for (t = Math.min(t, this.message.length); ; ) {
        var e = this.offset();
        if (e === t)
          break;
        if (e > t)
          throw Error("targetOffset ".concat(t, " is at invalid UTF-16 code unit boundary"));
        if (this.bump(), this.isEOF())
          break;
      }
    }, o.prototype.bumpSpace = function() {
      for (; !this.isEOF() && Ne(this.char()); )
        this.bump();
    }, o.prototype.peek = function() {
      if (this.isEOF())
        return null;
      var t = this.char(), e = this.offset(), a = this.message.charCodeAt(e + (t >= 65536 ? 2 : 1));
      return a ?? null;
    }, o;
  })()
);
function qt(o) {
  return o >= 97 && o <= 122 || o >= 65 && o <= 90;
}
function ya(o) {
  return qt(o) || o === 47;
}
function wa(o) {
  return o === 45 || o === 46 || o >= 48 && o <= 57 || o === 95 || o >= 97 && o <= 122 || o >= 65 && o <= 90 || o == 183 || o >= 192 && o <= 214 || o >= 216 && o <= 246 || o >= 248 && o <= 893 || o >= 895 && o <= 8191 || o >= 8204 && o <= 8205 || o >= 8255 && o <= 8256 || o >= 8304 && o <= 8591 || o >= 11264 && o <= 12271 || o >= 12289 && o <= 55295 || o >= 63744 && o <= 64975 || o >= 65008 && o <= 65533 || o >= 65536 && o <= 983039;
}
function Ne(o) {
  return o >= 9 && o <= 13 || o === 32 || o === 133 || o >= 8206 && o <= 8207 || o === 8232 || o === 8233;
}
function xa(o) {
  return o >= 33 && o <= 35 || o === 36 || o >= 37 && o <= 39 || o === 40 || o === 41 || o === 42 || o === 43 || o === 44 || o === 45 || o >= 46 && o <= 47 || o >= 58 && o <= 59 || o >= 60 && o <= 62 || o >= 63 && o <= 64 || o === 91 || o === 92 || o === 93 || o === 94 || o === 96 || o === 123 || o === 124 || o === 125 || o === 126 || o === 161 || o >= 162 && o <= 165 || o === 166 || o === 167 || o === 169 || o === 171 || o === 172 || o === 174 || o === 176 || o === 177 || o === 182 || o === 187 || o === 191 || o === 215 || o === 247 || o >= 8208 && o <= 8213 || o >= 8214 && o <= 8215 || o === 8216 || o === 8217 || o === 8218 || o >= 8219 && o <= 8220 || o === 8221 || o === 8222 || o === 8223 || o >= 8224 && o <= 8231 || o >= 8240 && o <= 8248 || o === 8249 || o === 8250 || o >= 8251 && o <= 8254 || o >= 8257 && o <= 8259 || o === 8260 || o === 8261 || o === 8262 || o >= 8263 && o <= 8273 || o === 8274 || o === 8275 || o >= 8277 && o <= 8286 || o >= 8592 && o <= 8596 || o >= 8597 && o <= 8601 || o >= 8602 && o <= 8603 || o >= 8604 && o <= 8607 || o === 8608 || o >= 8609 && o <= 8610 || o === 8611 || o >= 8612 && o <= 8613 || o === 8614 || o >= 8615 && o <= 8621 || o === 8622 || o >= 8623 && o <= 8653 || o >= 8654 && o <= 8655 || o >= 8656 && o <= 8657 || o === 8658 || o === 8659 || o === 8660 || o >= 8661 && o <= 8691 || o >= 8692 && o <= 8959 || o >= 8960 && o <= 8967 || o === 8968 || o === 8969 || o === 8970 || o === 8971 || o >= 8972 && o <= 8991 || o >= 8992 && o <= 8993 || o >= 8994 && o <= 9e3 || o === 9001 || o === 9002 || o >= 9003 && o <= 9083 || o === 9084 || o >= 9085 && o <= 9114 || o >= 9115 && o <= 9139 || o >= 9140 && o <= 9179 || o >= 9180 && o <= 9185 || o >= 9186 && o <= 9254 || o >= 9255 && o <= 9279 || o >= 9280 && o <= 9290 || o >= 9291 && o <= 9311 || o >= 9472 && o <= 9654 || o === 9655 || o >= 9656 && o <= 9664 || o === 9665 || o >= 9666 && o <= 9719 || o >= 9720 && o <= 9727 || o >= 9728 && o <= 9838 || o === 9839 || o >= 9840 && o <= 10087 || o === 10088 || o === 10089 || o === 10090 || o === 10091 || o === 10092 || o === 10093 || o === 10094 || o === 10095 || o === 10096 || o === 10097 || o === 10098 || o === 10099 || o === 10100 || o === 10101 || o >= 10132 && o <= 10175 || o >= 10176 && o <= 10180 || o === 10181 || o === 10182 || o >= 10183 && o <= 10213 || o === 10214 || o === 10215 || o === 10216 || o === 10217 || o === 10218 || o === 10219 || o === 10220 || o === 10221 || o === 10222 || o === 10223 || o >= 10224 && o <= 10239 || o >= 10240 && o <= 10495 || o >= 10496 && o <= 10626 || o === 10627 || o === 10628 || o === 10629 || o === 10630 || o === 10631 || o === 10632 || o === 10633 || o === 10634 || o === 10635 || o === 10636 || o === 10637 || o === 10638 || o === 10639 || o === 10640 || o === 10641 || o === 10642 || o === 10643 || o === 10644 || o === 10645 || o === 10646 || o === 10647 || o === 10648 || o >= 10649 && o <= 10711 || o === 10712 || o === 10713 || o === 10714 || o === 10715 || o >= 10716 && o <= 10747 || o === 10748 || o === 10749 || o >= 10750 && o <= 11007 || o >= 11008 && o <= 11055 || o >= 11056 && o <= 11076 || o >= 11077 && o <= 11078 || o >= 11079 && o <= 11084 || o >= 11085 && o <= 11123 || o >= 11124 && o <= 11125 || o >= 11126 && o <= 11157 || o === 11158 || o >= 11159 && o <= 11263 || o >= 11776 && o <= 11777 || o === 11778 || o === 11779 || o === 11780 || o === 11781 || o >= 11782 && o <= 11784 || o === 11785 || o === 11786 || o === 11787 || o === 11788 || o === 11789 || o >= 11790 && o <= 11798 || o === 11799 || o >= 11800 && o <= 11801 || o === 11802 || o === 11803 || o === 11804 || o === 11805 || o >= 11806 && o <= 11807 || o === 11808 || o === 11809 || o === 11810 || o === 11811 || o === 11812 || o === 11813 || o === 11814 || o === 11815 || o === 11816 || o === 11817 || o >= 11818 && o <= 11822 || o === 11823 || o >= 11824 && o <= 11833 || o >= 11834 && o <= 11835 || o >= 11836 && o <= 11839 || o === 11840 || o === 11841 || o === 11842 || o >= 11843 && o <= 11855 || o >= 11856 && o <= 11857 || o === 11858 || o >= 11859 && o <= 11903 || o >= 12289 && o <= 12291 || o === 12296 || o === 12297 || o === 12298 || o === 12299 || o === 12300 || o === 12301 || o === 12302 || o === 12303 || o === 12304 || o === 12305 || o >= 12306 && o <= 12307 || o === 12308 || o === 12309 || o === 12310 || o === 12311 || o === 12312 || o === 12313 || o === 12314 || o === 12315 || o === 12316 || o === 12317 || o >= 12318 && o <= 12319 || o === 12320 || o === 12336 || o === 64830 || o === 64831 || o >= 65093 && o <= 65094;
}
function zt(o) {
  o.forEach(function(t) {
    if (delete t.location, ve(t) || Me(t))
      for (var e in t.options)
        delete t.options[e].location, zt(t.options[e].value);
    else we(t) && Ce(t.style) || (xe(t) || Se(t)) && Gt(t.style) ? delete t.style.location : ke(t) && zt(t.children);
  });
}
function Sa(o, t) {
  t === void 0 && (t = {}), t = G({ shouldParseSkeletons: !0, requiresOtherClause: !0 }, t);
  var e = new ma(o, t).parse();
  if (e.err) {
    var a = SyntaxError(H[e.err.kind]);
    throw a.location = e.err.location, a.originalMessage = e.err.message, a;
  }
  return t?.captureLocation || zt(e.val), e.val;
}
var pt;
(function(o) {
  o.MISSING_VALUE = "MISSING_VALUE", o.INVALID_VALUE = "INVALID_VALUE", o.MISSING_INTL_API = "MISSING_INTL_API";
})(pt || (pt = {}));
var Mt = (
  /** @class */
  (function(o) {
    vt(t, o);
    function t(e, a, s) {
      var i = o.call(this, e) || this;
      return i.code = a, i.originalMessage = s, i;
    }
    return t.prototype.toString = function() {
      return "[formatjs Error: ".concat(this.code, "] ").concat(this.message);
    }, t;
  })(Error)
), ae = (
  /** @class */
  (function(o) {
    vt(t, o);
    function t(e, a, s, i) {
      return o.call(this, 'Invalid values for "'.concat(e, '": "').concat(a, '". Options are "').concat(Object.keys(s).join('", "'), '"'), pt.INVALID_VALUE, i) || this;
    }
    return t;
  })(Mt)
), va = (
  /** @class */
  (function(o) {
    vt(t, o);
    function t(e, a, s) {
      return o.call(this, 'Value for "'.concat(e, '" must be of type ').concat(a), pt.INVALID_VALUE, s) || this;
    }
    return t;
  })(Mt)
), Ma = (
  /** @class */
  (function(o) {
    vt(t, o);
    function t(e, a) {
      return o.call(this, 'The intl string context variable "'.concat(e, '" was not provided to the string "').concat(a, '"'), pt.MISSING_VALUE, a) || this;
    }
    return t;
  })(Mt)
), D;
(function(o) {
  o[o.literal = 0] = "literal", o[o.object = 1] = "object";
})(D || (D = {}));
function ka(o) {
  return o.length < 2 ? o : o.reduce(function(t, e) {
    var a = t[t.length - 1];
    return !a || a.type !== D.literal || e.type !== D.literal ? t.push(e) : a.value += e.value, t;
  }, []);
}
function Ca(o) {
  return typeof o == "function";
}
function xt(o, t, e, a, s, i, l) {
  if (o.length === 1 && Vt(o[0]))
    return [
      {
        type: D.literal,
        value: o[0].value
      }
    ];
  for (var r = [], c = 0, n = o; c < n.length; c++) {
    var h = n[c];
    if (Vt(h)) {
      r.push({
        type: D.literal,
        value: h.value
      });
      continue;
    }
    if (Ye(h)) {
      typeof i == "number" && r.push({
        type: D.literal,
        value: e.getNumberFormat(t).format(i)
      });
      continue;
    }
    var f = h.value;
    if (!(s && f in s))
      throw new Ma(f, l);
    var u = s[f];
    if (Xe(h)) {
      (!u || typeof u == "string" || typeof u == "number") && (u = typeof u == "string" || typeof u == "number" ? String(u) : ""), r.push({
        type: typeof u == "string" ? D.literal : D.object,
        value: u
      });
      continue;
    }
    if (xe(h)) {
      var d = typeof h.style == "string" ? a.date[h.style] : Gt(h.style) ? h.style.parsedOptions : void 0;
      r.push({
        type: D.literal,
        value: e.getDateTimeFormat(t, d).format(u)
      });
      continue;
    }
    if (Se(h)) {
      var d = typeof h.style == "string" ? a.time[h.style] : Gt(h.style) ? h.style.parsedOptions : a.time.medium;
      r.push({
        type: D.literal,
        value: e.getDateTimeFormat(t, d).format(u)
      });
      continue;
    }
    if (we(h)) {
      var d = typeof h.style == "string" ? a.number[h.style] : Ce(h.style) ? h.style.parsedOptions : void 0;
      d && d.scale && (u = u * (d.scale || 1)), r.push({
        type: D.literal,
        value: e.getNumberFormat(t, d).format(u)
      });
      continue;
    }
    if (ke(h)) {
      var p = h.children, b = h.value, m = s[b];
      if (!Ca(m))
        throw new va(b, "function", l);
      var g = xt(p, t, e, a, s, i), y = m(g.map(function(x) {
        return x.value;
      }));
      Array.isArray(y) || (y = [y]), r.push.apply(r, y.map(function(x) {
        return {
          type: typeof x == "string" ? D.literal : D.object,
          value: x
        };
      }));
    }
    if (ve(h)) {
      var w = h.options[u] || h.options.other;
      if (!w)
        throw new ae(h.value, u, Object.keys(h.options), l);
      r.push.apply(r, xt(w.value, t, e, a, s));
      continue;
    }
    if (Me(h)) {
      var w = h.options["=".concat(u)];
      if (!w) {
        if (!Intl.PluralRules)
          throw new Mt(`Intl.PluralRules is not available in this environment.
Try polyfilling it using "@formatjs/intl-pluralrules"
`, pt.MISSING_INTL_API, l);
        var S = e.getPluralRules(t, { type: h.pluralType }).select(u - (h.offset || 0));
        w = h.options[S] || h.options.other;
      }
      if (!w)
        throw new ae(h.value, u, Object.keys(h.options), l);
      r.push.apply(r, xt(w.value, t, e, a, s, u - (h.offset || 0)));
      continue;
    }
  }
  return ka(r);
}
function Pa(o, t) {
  return t ? G(G(G({}, o || {}), t || {}), Object.keys(o).reduce(function(e, a) {
    return e[a] = G(G({}, o[a]), t[a] || {}), e;
  }, {})) : o;
}
function Ra(o, t) {
  return t ? Object.keys(o).reduce(function(e, a) {
    return e[a] = Pa(o[a], t[a]), e;
  }, G({}, o)) : o;
}
function Et(o) {
  return {
    create: function() {
      return {
        get: function(t) {
          return o[t];
        },
        set: function(t, e) {
          o[t] = e;
        }
      };
    }
  };
}
function Ia(o) {
  return o === void 0 && (o = {
    number: {},
    dateTime: {},
    pluralRules: {}
  }), {
    getNumberFormat: Pt(function() {
      for (var t, e = [], a = 0; a < arguments.length; a++)
        e[a] = arguments[a];
      return new ((t = Intl.NumberFormat).bind.apply(t, Ct([void 0], e, !1)))();
    }, {
      cache: Et(o.number),
      strategy: Rt.variadic
    }),
    getDateTimeFormat: Pt(function() {
      for (var t, e = [], a = 0; a < arguments.length; a++)
        e[a] = arguments[a];
      return new ((t = Intl.DateTimeFormat).bind.apply(t, Ct([void 0], e, !1)))();
    }, {
      cache: Et(o.dateTime),
      strategy: Rt.variadic
    }),
    getPluralRules: Pt(function() {
      for (var t, e = [], a = 0; a < arguments.length; a++)
        e[a] = arguments[a];
      return new ((t = Intl.PluralRules).bind.apply(t, Ct([void 0], e, !1)))();
    }, {
      cache: Et(o.pluralRules),
      strategy: Rt.variadic
    })
  };
}
var Ea = (
  /** @class */
  (function() {
    function o(t, e, a, s) {
      e === void 0 && (e = o.defaultLocale);
      var i = this;
      if (this.formatterCache = {
        number: {},
        dateTime: {},
        pluralRules: {}
      }, this.format = function(c) {
        var n = i.formatToParts(c);
        if (n.length === 1)
          return n[0].value;
        var h = n.reduce(function(f, u) {
          return !f.length || u.type !== D.literal || typeof f[f.length - 1] != "string" ? f.push(u.value) : f[f.length - 1] += u.value, f;
        }, []);
        return h.length <= 1 ? h[0] || "" : h;
      }, this.formatToParts = function(c) {
        return xt(i.ast, i.locales, i.formatters, i.formats, c, void 0, i.message);
      }, this.resolvedOptions = function() {
        var c;
        return {
          locale: ((c = i.resolvedLocale) === null || c === void 0 ? void 0 : c.toString()) || Intl.NumberFormat.supportedLocalesOf(i.locales)[0]
        };
      }, this.getAst = function() {
        return i.ast;
      }, this.locales = e, this.resolvedLocale = o.resolveLocale(e), typeof t == "string") {
        if (this.message = t, !o.__parse)
          throw new TypeError("IntlMessageFormat.__parse must be set to process `message` of type `string`");
        var l = s || {};
        l.formatters;
        var r = _e(l, ["formatters"]);
        this.ast = o.__parse(t, G(G({}, r), { locale: this.resolvedLocale }));
      } else
        this.ast = t;
      if (!Array.isArray(this.ast))
        throw new TypeError("A message must be provided as a String or AST.");
      this.formats = Ra(o.formats, a), this.formatters = s && s.formatters || Ia(this.formatterCache);
    }
    return Object.defineProperty(o, "defaultLocale", {
      get: function() {
        return o.memoizedDefaultLocale || (o.memoizedDefaultLocale = new Intl.NumberFormat().resolvedOptions().locale), o.memoizedDefaultLocale;
      },
      enumerable: !1,
      configurable: !0
    }), o.memoizedDefaultLocale = null, o.resolveLocale = function(t) {
      if (!(typeof Intl.Locale > "u")) {
        var e = Intl.NumberFormat.supportedLocalesOf(t);
        return e.length > 0 ? new Intl.Locale(e[0]) : new Intl.Locale(typeof t == "string" ? t : t[0]);
      }
    }, o.__parse = Sa, o.formats = {
      number: {
        integer: {
          maximumFractionDigits: 0
        },
        currency: {
          style: "currency"
        },
        percent: {
          style: "percent"
        }
      },
      date: {
        short: {
          month: "numeric",
          day: "numeric",
          year: "2-digit"
        },
        medium: {
          month: "short",
          day: "numeric",
          year: "numeric"
        },
        long: {
          month: "long",
          day: "numeric",
          year: "numeric"
        },
        full: {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric"
        }
      },
      time: {
        short: {
          hour: "numeric",
          minute: "numeric"
        },
        medium: {
          hour: "numeric",
          minute: "numeric",
          second: "numeric"
        },
        long: {
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          timeZoneName: "short"
        },
        full: {
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          timeZoneName: "short"
        }
      }
    }, o;
  })()
);
class Aa {
  locale;
  fallbackLocale;
  messages;
  fallback;
  constructor(t, e, a = "en", s = {}) {
    this.locale = t, this.messages = e, this.fallbackLocale = a, this.fallback = s;
  }
  format(t, e = {}) {
    const a = this.messages[t] ?? this.fallback[t] ?? t, s = this.messages[t] ? this.locale : this.fallbackLocale;
    return String(new Ea(a, s).format(e));
  }
  money(t, e = "GBP") {
    return new Intl.NumberFormat(this.locale, { style: "currency", currency: e }).format(Number(BigInt(t)) / 100);
  }
}
function Ta(o) {
  const t = new Map(o.symbols.map((e) => [e.id, e.name]));
  return o.math.paytable.map((e) => ({ ...e, symbolName: t.get(e.symbolId) ?? e.symbolId }));
}
function oe(o, t, e) {
  return e.presentation.celebrateReturnAtOrBelowStake ? BigInt(t) > 0n : BigInt(t) > BigInt(o);
}
function Na(o, t) {
  const e = o.animationDurationMs;
  return typeof e == "number" && Number.isFinite(e) && e > 0 ? e : t;
}
function Ba(o, t, e) {
  return o && o !== "idle" ? Math.max(0, t - e) : 0;
}
function La(o, t) {
  const e = BigInt(o), a = BigInt(t);
  if (!(a <= 0n || e <= 0n))
    return a >= e * 250n ? "epic" : a >= e * 100n ? "mega" : a >= e * 25n ? "big" : a >= e * 10n ? "nice" : "small";
}
function Ha(o, t) {
  const e = o.presentation.characterAnimationMappings?.filter((a) => a.trigger.type === t.type && (t.type === "win-size" ? a.trigger.type === "win-size" && a.trigger.size === t.size : a.trigger.type === "feature-start" && a.trigger.featureId === t.featureId)) ?? [];
  return e.length ? e[Math.floor(Math.random() * e.length)].animationId : void 0;
}
const Oa = {
  durationMs: 800,
  loop: !1,
  intensity: 1,
  zIndex: 0,
  seed: 1
};
function Be(o) {
  let t = (Math.floor(o) || 1) >>> 0;
  return () => {
    t = t + 1831565813 >>> 0;
    let e = t;
    return e = Math.imul(e ^ e >>> 15, e | 1), e ^= e + Math.imul(e ^ e >>> 7, e | 61), ((e ^ e >>> 14) >>> 0) / 4294967296;
  };
}
const N = (o) => 1 - Math.pow(1 - o, 3), U = (o) => o * o * o, F = (o) => o < 0.5 ? 4 * o * o * o : 1 - Math.pow(-2 * o + 2, 3) / 2, kt = (o) => 1 + 2.70158 * Math.pow(o - 1, 3) + 1.70158 * Math.pow(o - 1, 2), I = (o) => Math.min(1, Math.max(0, o)), Dt = (o) => 1 - Math.abs(2 * I(o) - 1);
function Ga(o) {
  const t = /^#?([0-9a-f]{6})$/i.exec(o.trim());
  if (t) {
    const a = parseInt(t[1], 16);
    return [a >> 16 & 255, a >> 8 & 255, a & 255];
  }
  const e = /^#?([0-9a-f]{3})$/i.exec(o.trim());
  if (e) {
    const [a, s, i] = e[1].split("");
    return [parseInt(`${a}${a}`, 16), parseInt(`${s}${s}`, 16), parseInt(`${i}${i}`, 16)];
  }
  return [255, 211, 79];
}
function _a(o, t) {
  const e = o.palette?.length ? o.palette : t;
  return {
    color: (a = 0) => e[a % e.length] ?? t[0],
    alpha: (a, s = 0) => {
      const [i, l, r] = Ga(e[s % e.length] ?? t[0]);
      return `rgba(${i},${l},${r},${I(a)})`;
    }
  };
}
class $a {
  metadata;
  target;
  options;
  #t;
  #n = 0;
  #d = 0;
  #r = !1;
  constructor(t, e, a, s = {}) {
    this.#t = t, this.metadata = e, this.target = a, this.options = {
      ...Oa,
      ...s,
      parameters: Wa(t.parameters ?? [], s.parameters)
    };
  }
  start(t) {
    this.#n = t, this.#d = 0, this.#r = !1;
  }
  update(t, e) {
    this.#d = Math.max(0, t - this.#n), !this.options.loop && this.#d >= this.options.durationMs && (this.#r = !0);
  }
  render(t) {
    const e = _a(t.options, this.#t.palette ?? ["#ffd34f", "#ff8a3c", "#fff7c4"]), a = { frame: t, random: Be(this.options.seed), paint: e };
    if (t.reducedMotion) {
      if (this.#t.renderReducedMotion)
        this.#t.renderReducedMotion(a);
      else {
        const { x: s, y: i, width: l, height: r } = t.target.bounds();
        t.ctx.globalAlpha = 0.35 * t.options.intensity;
        const c = t.ctx.createRadialGradient(s + l / 2, i + r / 2, 0, s + l / 2, i + r / 2, Math.max(l, r) / 2);
        c.addColorStop(0, e.alpha(0.6)), c.addColorStop(1, e.alpha(0)), t.ctx.fillStyle = c, t.ctx.fillRect(s, i, l, r);
      }
      return;
    }
    this.#t.render(a);
  }
  stop() {
    this.#r = !0;
  }
  destroy() {
    this.#r = !0;
  }
  isComplete() {
    return this.#r;
  }
  elapsedMs() {
    return this.#d;
  }
}
function P(o) {
  const t = Object.freeze({
    ...o.metadata,
    status: "implemented",
    defaultPalette: Object.freeze([...o.palette ?? ["#ffd34f", "#ff8a3c", "#fff7c4"]]),
    parameters: Object.freeze([...o.parameters ?? []])
  });
  return Object.freeze({
    metadata: t,
    create(e, a) {
      return new $a(o, t, e, a);
    }
  });
}
function Wa(o, t) {
  const e = { ...t };
  for (const a of o) {
    const s = t?.[a.key];
    if (a.kind === "number") {
      const i = typeof s == "number" && Number.isFinite(s) ? s : a.defaultValue;
      e[a.key] = Math.min(a.max, Math.max(a.min, i));
    } else if (a.kind === "boolean")
      e[a.key] = typeof s == "boolean" ? s : a.defaultValue;
    else {
      const i = typeof s == "string" && a.choices.some((l) => l.value === s) ? s : a.defaultValue;
      e[a.key] = i;
    }
  }
  return Object.freeze(e);
}
const K = Object.freeze([
  { key: "density", label: "Density", description: "Number of layered smoke volumes.", kind: "number", defaultValue: 1, min: 0.4, max: 2, step: 0.1 },
  { key: "turbulence", label: "Turbulence", description: "Internal billow and motion irregularity.", kind: "number", defaultValue: 1, min: 0, max: 2, step: 0.1 },
  { key: "wind", label: "Wind", description: "Horizontal drift; negative values blow left.", kind: "number", defaultValue: 0, min: -1, max: 1, step: 0.05 },
  { key: "softness", label: "Softness", description: "Edge diffusion for each smoke volume.", kind: "number", defaultValue: 1, min: 0.25, max: 2, step: 0.05 },
  { key: "volume", label: "Volume", description: "Optical thickness without changing overall intensity.", kind: "number", defaultValue: 1, min: 0.45, max: 1.5, step: 0.05 }
]);
function tt(o) {
  const t = o.parameters ?? {};
  return {
    density: gt(t.density, 1),
    turbulence: gt(t.turbulence, 1),
    wind: gt(t.wind, 0),
    softness: gt(t.softness, 1),
    volume: gt(t.volume, 1)
  };
}
function et(o, t) {
  return Math.max(4, Math.round(o * t.density));
}
function Z(o, t, e, a, s, i, l, r, c, n, h) {
  if (l <= 4e-3 || s <= 0 || i <= 0)
    return;
  const f = Math.min(1, l * n.volume), u = (c - 0.5) * 0.5 * n.turbulence;
  o.save();
  try {
    o.translate(e, a), o.rotate(u), o.scale(s, i);
    const d = o.createRadialGradient(-0.16, -0.18, 0.04, 0, 0, 1);
    d.addColorStop(0, t.alpha(f * 0.92, r === 1 ? 0 : 2)), d.addColorStop(0.32, t.alpha(f * 0.76, r)), d.addColorStop(0.68, t.alpha(f * 0.34, r === 2 ? 0 : 1)), d.addColorStop(0.9, t.alpha(f * 0.08, 1)), d.addColorStop(1, t.alpha(0, 1)), o.fillStyle = d, o.beginPath(), o.arc(0, 0, 1, 0, Math.PI * 2), o.fill();
    const p = Math.max(0, n.turbulence);
    for (let b = 0; b < 2; b += 1) {
      const m = c * 19.17 + b * 2.31, g = Math.sin(m) * (0.18 + p * 0.05), y = Math.cos(m * 1.37) * (0.16 + p * 0.04) - 0.08, w = (0.48 + 0.1 * Math.sin(m * 0.83 + 1.1)) * n.softness, S = o.createRadialGradient(g - w * 0.18, y - w * 0.2, 0, g, y, w);
      S.addColorStop(0, t.alpha(f * (0.13 + p * 0.055), b === 0 ? 2 : r)), S.addColorStop(0.7, t.alpha(f * 0.035, r)), S.addColorStop(1, t.alpha(0, r)), o.fillStyle = S, o.beginPath(), o.arc(g, y, w, 0, Math.PI * 2), o.fill();
    }
  } finally {
    o.restore();
  }
}
function gt(o, t) {
  return typeof o == "number" && Number.isFinite(o) ? o : t;
}
const qa = P({
  metadata: {
    id: "smoke-puff",
    displayName: "Smoke Puff",
    description: "A soft ball of smoke that pops from the centre, billows outward, and gently dissipates.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.min(n, h), p = tt(i), b = Array.from({ length: et(13, p) }, () => ({
      angle: t() * Math.PI * 2,
      dist: 0.1 + t() * 0.32,
      size: 0.16 + t() * 0.2,
      spin: (t() - 0.5) * 0.4,
      tone: t()
    })), m = N(s), g = 1 - U(s);
    for (const y of b) {
      const w = y.angle + y.spin * m, S = f + Math.cos(w) * d * y.dist * m + p.wind * d * 0.2 * m, x = u + Math.sin(w) * d * y.dist * m - d * 0.08 * m, v = Math.max(1, d * y.size * (0.5 + m * 0.9)), M = g * (0.2 + 0.25 * y.tone) * i.intensity;
      if (M <= 0.01)
        continue;
      const k = y.tone > 0.72 ? 2 : y.tone > 0.3 ? 0 : 1;
      Z(a, e, S, x, v * 1.14, v, M, k, y.tone + y.angle, p);
    }
  }
}), za = P({
  metadata: {
    id: "smoke-trail",
    displayName: "Smoke Trail",
    description: "A wisp of smoke gliding across the target, leaving a widening, softly fading wake behind it.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = c + h / 2, u = Math.sin(Math.PI * s), d = r + n * s, p = Math.max(2, Math.min(n, h) * 0.12), b = tt(i), m = Array.from({ length: et(20, b) }, () => ({
      lag: 0.03 + t() * 0.45,
      bob: t() * Math.PI * 2,
      size: 0.5 + t() * 0.7,
      tone: t()
    }));
    Z(a, e, d, f, p * 1.7, p * 1.35, 0.5 * u * i.intensity, 2, s, b);
    for (const g of m) {
      const y = d - g.lag * n;
      if (y < r)
        continue;
      const w = I(g.lag / 0.45), S = f + Math.sin(g.bob + s * Math.PI * 6 * b.turbulence) * h * 0.2 * w, x = u * (1 - w * 0.8) * (0.18 + 0.2 * g.tone) * i.intensity;
      if (x <= 0.01)
        continue;
      const v = Math.max(1, p * g.size * (0.7 + w * 1.5)), M = g.tone > 0.66 ? 0 : 1;
      Z(a, e, y + b.wind * n * w * 0.12, S, v * (1.25 + w * 0.35), v, x, M, g.tone + g.bob, b);
    }
  }
}), Ua = P({
  metadata: {
    id: "smoke-ring",
    displayName: "Smoke Ring",
    description: "A hollow ring of smoke blown outward from the centre that widens, thins, and melts away.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.min(n, h) * 0.42, p = N(s), b = d * (0.15 + 0.85 * p), m = 1 - U(s), g = tt(i), y = Array.from({ length: et(20, g) }, () => ({
      angle: t() * Math.PI * 2,
      jitter: (t() - 0.5) * 0.12,
      size: 0.6 + t() * 0.6,
      tone: t()
    })), w = d * (0.14 + 0.16 * p);
    for (const S of y) {
      const x = b * (1 + S.jitter), v = f + Math.cos(S.angle) * x + g.wind * d * 0.22 * p, M = u + Math.sin(S.angle) * x - d * 0.12 * p, k = m * (0.2 + 0.25 * S.tone) * i.intensity;
      if (k <= 0.01)
        continue;
      const C = Math.max(1, w * S.size), R = S.tone > 0.72 ? 2 : S.tone > 0.3 ? 0 : 1;
      Z(a, e, v, M, C * 1.2, C, k, R, S.tone + S.angle, g);
    }
  }
}), Fa = P({
  metadata: {
    id: "smoke-burst",
    displayName: "Smoke Burst",
    description: "An energetic eruption of smoke that scatters dense plumes in all directions before thinning out.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.55, p = tt(i), b = Array.from({ length: et(18, p) }, () => ({
      angle: t() * Math.PI * 2,
      dist: 0.35 + t() * 0.6,
      size: 0.1 + t() * 0.14,
      spin: (t() - 0.5) * 0.7,
      tone: t()
    })), m = N(s), g = 1 - U(s), y = I(1 - s * 2.2) * 0.45 * i.intensity;
    if (y > 0.01) {
      const w = a.createRadialGradient(f, u, 0, f, u, d * 0.4);
      w.addColorStop(0, e.alpha(y, 2)), w.addColorStop(1, e.alpha(0, 0)), a.fillStyle = w, a.fillRect(r, c, n, h);
    }
    for (const w of b) {
      const S = w.angle + w.spin * m, x = f + Math.cos(S) * d * w.dist * m + p.wind * d * 0.28 * m, v = u + Math.sin(S) * d * w.dist * m - d * 0.1 * m, M = g * (0.2 + 0.3 * w.tone) * i.intensity;
      if (M <= 0.01)
        continue;
      const k = Math.max(1, d * w.size * (0.5 + m * 1.4)), C = w.tone > 0.7 ? 2 : w.tone > 0.3 ? 0 : 1;
      Z(a, e, x, v, k * 1.18, k, M, C, w.tone + w.angle, p);
    }
  }
}), Da = P({
  metadata: {
    id: "smoke-column",
    displayName: "Smoke Column",
    description: "A steady column of smoke rising from the target's base, widening and thinning as it climbs.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h * 0.96, d = Math.min(n, h), p = tt(i), b = Array.from({ length: et(19, p) }, () => ({
      phase: t(),
      sway: t() * Math.PI * 2,
      swayAmp: 0.03 + t() * 0.05,
      size: 0.5 + t() * 0.6,
      tone: t()
    }));
    for (const m of b) {
      const g = (s + m.phase) % 1, w = Math.sin(Math.PI * g) * (0.16 + 0.22 * m.tone) * i.intensity;
      if (w <= 0.01)
        continue;
      const S = f + Math.sin(m.sway + g * Math.PI * 3 * p.turbulence) * n * m.swayAmp * (0.4 + g * 2) + p.wind * n * 0.2 * g, x = u - g * h * 0.9, v = Math.max(1, d * 0.11 * m.size * (0.5 + g * 1.4)), M = m.tone > 0.7 ? 2 : m.tone > 0.3 ? 0 : 1;
      Z(a, e, S, x, v * (1.05 + g * 0.3), v, w, M, m.tone + m.sway, p);
    }
  }
}), Xa = P({
  metadata: {
    id: "smoke-floor-fog",
    displayName: "Smoke Floor Fog",
    description: "A low blanket of fog rolling gently along the bottom edge of the target.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = c + h, u = h * 0.32, d = s * Math.PI * 2, p = tt(i), b = Array.from({ length: et(14, p) }, () => ({
      xf: t(),
      roll: t() * Math.PI * 2,
      speed: 1 + Math.floor(t() * 2),
      size: 0.6 + t() * 0.7,
      lift: t() * 0.5,
      tone: t()
    })), m = a.createLinearGradient(r, f, r, f - u);
    m.addColorStop(0, e.alpha(0.32 * i.intensity, 0)), m.addColorStop(0.6, e.alpha(0.14 * i.intensity, 1)), m.addColorStop(1, e.alpha(0, 1)), a.fillStyle = m, a.fillRect(r, f - u, n, u);
    for (const g of b) {
      const y = Math.sin(g.roll + d * g.speed), w = r + g.xf * n + y * n * 0.06 * p.turbulence + p.wind * n * s * 0.18, S = f - u * (0.18 + g.lift * 0.5 + 0.08 * Math.sin(g.roll * 2 + d * g.speed)), x = (0.14 + 0.16 * g.tone) * i.intensity, v = Math.max(2, n * 0.16 * g.size), M = Math.max(1, u * 0.42 * g.size), k = g.tone > 0.7 ? 2 : 0;
      Z(a, e, w, S, v, M, x, k, g.tone + g.roll, p);
    }
  }
}), Ya = P({
  metadata: {
    id: "smoke-drift",
    displayName: "Smoke Drift",
    description: "Loose wisps of smoke drifting lazily sideways across the target at varying heights.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = Math.min(n, h), u = tt(i), d = Array.from({ length: et(15, u) }, () => ({
      offset: t(),
      yf: 0.12 + t() * 0.76,
      bob: t() * Math.PI * 2,
      size: 0.5 + t() * 0.8,
      stretch: 1.4 + t(),
      tone: t()
    }));
    for (const p of d) {
      const b = (s + p.offset) % 1, g = Math.sin(Math.PI * b) * (0.12 + 0.18 * p.tone) * i.intensity;
      if (g <= 0.01)
        continue;
      const y = u.wind < 0 ? 1 - b : b, w = r + y * n + u.wind * n * 0.08 * Math.sin(Math.PI * b), S = c + p.yf * h + Math.sin(p.bob + b * Math.PI * 2 * u.turbulence) * h * 0.04, x = Math.max(2, f * 0.14 * p.size * p.stretch), v = Math.max(1, f * 0.07 * p.size), M = p.tone > 0.7 ? 2 : p.tone > 0.3 ? 0 : 1;
      Z(a, e, w, S, x, v, g, M, p.tone + p.bob, u);
    }
  }
}), ja = P({
  metadata: {
    id: "smoke-vortex",
    displayName: "Smoke Vortex",
    description: "A slow whirlpool of smoke spiralling around the target's centre with a hazy core.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.min(n, h), p = tt(i), b = Array.from({ length: et(24, p) }, () => ({
      angle: t() * Math.PI * 2,
      orbit: 0.12 + t() * 0.34,
      turns: 1 + Math.floor(t() * 2),
      wobble: t() * Math.PI * 2,
      size: 0.4 + t() * 0.6,
      tone: t()
    })), m = a.createRadialGradient(f, u, 0, f, u, d * 0.4);
    m.addColorStop(0, e.alpha(0.2 * i.intensity, 1)), m.addColorStop(1, e.alpha(0, 1)), a.fillStyle = m, a.fillRect(r, c, n, h), a.save();
    try {
      a.globalCompositeOperation = "source-over", a.filter = `blur(${Math.max(4, d * 0.025 * p.softness)}px)`, a.lineCap = "round";
      for (let g = 0; g < 3; g += 1) {
        const y = d * (0.18 + g * 0.105);
        a.strokeStyle = e.alpha((0.055 + g * 0.025) * i.intensity * p.volume, g === 1 ? 2 : 0), a.lineWidth = d * (0.075 + g * 0.018), a.beginPath(), a.ellipse(f + p.wind * d * 0.05, u, y * 1.18, y * 0.82, s * 0.35 + g * 0.22, 0, Math.PI * 2), a.stroke();
      }
    } finally {
      a.restore();
    }
    for (const g of b) {
      const y = g.angle + s * Math.PI * 2 * g.turns * Math.max(0.15, p.turbulence), w = d * g.orbit * (1 + 0.1 * Math.sin(g.wobble + s * Math.PI * 2)), S = f + Math.cos(y) * w + p.wind * d * 0.1 * Math.sin(Math.PI * s), x = u + Math.sin(y) * w * 0.82, v = (0.1 + 0.14 * g.tone) * i.intensity, M = Math.max(1, d * 0.165 * g.size * (0.72 + g.orbit)), k = g.tone > 0.72 ? 2 : g.tone > 0.3 ? 0 : 1;
      Z(a, e, S, x, M * 1.4, M, v, k, g.tone + g.wobble, p);
    }
  }
}), Va = P({
  metadata: {
    id: "smoke-impact",
    displayName: "Smoke Impact",
    description: "A ground-slam dust cloud that kicks out sideways in a flattened ring and settles into thin haze.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h * 0.78, d = Math.max(n, h) * 0.5, p = tt(i), b = Array.from({ length: et(18, p) }, () => ({
      angle: t() * Math.PI * 2,
      dist: 0.4 + t() * 0.55,
      size: 0.12 + t() * 0.14,
      rise: t() * 0.25,
      tone: t()
    })), m = N(s), g = 1 - U(s), y = I(1 - s * 2.4) * 0.5 * i.intensity;
    if (y > 0.01) {
      const w = a.createRadialGradient(f, u, 0, f, u, d * 0.35);
      w.addColorStop(0, e.alpha(y, 2)), w.addColorStop(1, e.alpha(0, 0)), a.fillStyle = w, a.fillRect(r, c, n, h);
    }
    for (const w of b) {
      const S = f + Math.cos(w.angle) * d * w.dist * m + p.wind * d * 0.2 * m, x = u + Math.sin(w.angle) * d * w.dist * m * 0.28 - h * w.rise * m, v = g * (0.2 + 0.28 * w.tone) * i.intensity;
      if (v <= 0.01)
        continue;
      const M = Math.max(1, d * w.size * (0.5 + m * 1.3)), k = w.tone > 0.7 ? 2 : w.tone > 0.3 ? 0 : 1;
      Z(a, e, S, x, M * 1.38, M * 0.82, v, k, w.tone + w.angle, p);
    }
  }
}), Ja = P({
  metadata: {
    id: "smoke-reveal",
    displayName: "Smoke Reveal",
    description: "A dense shroud of smoke covering the target that parts and thins until the target is fully revealed.",
    category: "smoke",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: K,
  palette: ["#cfd6e4", "#8a93a6", "#f4f6fb"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h), p = tt(i), b = Array.from({ length: et(22, p) }, () => ({
      xf: t(),
      yf: t(),
      size: 0.16 + t() * 0.18,
      drift: t() * Math.PI * 2,
      tone: t()
    })), m = F(s), g = I(1 - m);
    if (g > 0.01) {
      const y = a.createRadialGradient(f, u, 0, f, u, d * 0.7);
      y.addColorStop(0, e.alpha(0.5 * g * i.intensity, 0)), y.addColorStop(1, e.alpha(0.3 * g * i.intensity, 1)), a.fillStyle = y, a.fillRect(r, c, n, h);
    }
    for (const y of b) {
      const w = r + y.xf * n, S = c + y.yf * h, x = Math.cos(y.drift) * d * 0.5 * m + p.wind * d * 0.18 * m, v = Math.sin(y.drift) * d * 0.5 * m - d * 0.1 * m, M = g * (0.3 + 0.3 * y.tone) * i.intensity;
      if (M <= 0.01)
        continue;
      const k = Math.max(1, d * y.size * (1 + m * 0.6)), C = y.tone > 0.7 ? 2 : y.tone > 0.3 ? 0 : 1;
      Z(a, e, w + x, S + v, k * 1.12, k, M, C, y.tone + y.drift, p);
    }
  },
  renderReducedMotion({ frame: o, paint: t }) {
    const { ctx: e, options: a } = o, { x: s, y: i, width: l, height: r } = o.target.bounds(), c = e.createRadialGradient(s + l / 2, i + r / 2, 0, s + l / 2, i + r / 2, Math.max(l, r) / 2);
    c.addColorStop(0, t.alpha(0.18 * a.intensity, 0)), c.addColorStop(1, t.alpha(0.06 * a.intensity, 1)), e.fillStyle = c, e.fillRect(s, i, l, r);
  }
}), at = Object.freeze([
  { key: "density", label: "Detail density", description: "Flame tongues and live particles.", kind: "number", defaultValue: 1, min: 0.4, max: 2, step: 0.1 },
  { key: "turbulence", label: "Turbulence", description: "Flicker, curl, and breakup in the flame front.", kind: "number", defaultValue: 1, min: 0.2, max: 2, step: 0.1 },
  { key: "wind", label: "Wind", description: "Horizontal lean; negative values push left.", kind: "number", defaultValue: 0, min: -1, max: 1, step: 0.05 },
  { key: "flameHeight", label: "Flame height", description: "Vertical reach of the hot flame body.", kind: "number", defaultValue: 1, min: 0.5, max: 1.4, step: 0.05 },
  { key: "embers", label: "Embers", description: "Amount and brightness of flying embers.", kind: "number", defaultValue: 1, min: 0, max: 2, step: 0.1 },
  { key: "smoke", label: "Smoke", description: "Dark smoke carried above and behind the flames.", kind: "number", defaultValue: 1, min: 0, max: 2, step: 0.1 },
  { key: "bloom", label: "Heat bloom", description: "Additive glow surrounding the hottest regions.", kind: "number", defaultValue: 1, min: 0.25, max: 1.75, step: 0.05 }
]);
function ot(o) {
  const t = o.parameters ?? {};
  return {
    density: ct(t.density, 1),
    turbulence: ct(t.turbulence, 1),
    wind: ct(t.wind, 0),
    flameHeight: ct(t.flameHeight, 1),
    embers: ct(t.embers, 1),
    smoke: ct(t.smoke, 1),
    bloom: ct(t.bloom, 1)
  };
}
function j(o, t, e = 1) {
  return Math.max(3, Math.round(o * t.density * e));
}
function ct(o, t) {
  return typeof o == "number" && Number.isFinite(o) ? o : t;
}
const Za = P({
  metadata: {
    id: "fire-flame",
    displayName: "Fire Flame",
    description: "A cluster of licking flame tongues that sway and flicker upward from the base of the target.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n * 0.98, u = s * Math.PI * 2, d = ot(i), p = j(9, d), b = Array.from({ length: p }, (g, y) => ({
      offset: (y - (p - 1) / 2) / Math.max(1, (p - 1) / 2),
      sway: t() * Math.PI * 2,
      speed: 1 + Math.floor(t() * 3),
      scale: 0.55 + t() * 0.45
    })), m = [
      { reach: 1, spread: 1, tone: 1, alpha: 0.38 },
      { reach: 0.72, spread: 0.7, tone: 0, alpha: 0.5 },
      { reach: 0.42, spread: 0.42, tone: 2, alpha: 0.62 }
    ];
    a.globalCompositeOperation = "lighter";
    for (const g of m)
      for (const y of b) {
        const w = u * y.speed * d.turbulence + y.sway, S = 0.78 + 0.22 * Math.sin(w), x = n * 0.8 * g.reach * y.scale * S * d.flameHeight, v = h + y.offset * c * 0.24 * g.spread + Math.sin(w) * c * 0.04 + d.wind * x * 0.13, M = f - x * 0.45, k = a.createRadialGradient(v, M, 0, v, M, Math.max(1, x * 0.62));
        k.addColorStop(0, e.alpha(g.alpha * i.intensity * d.bloom, g.tone)), k.addColorStop(1, e.alpha(0, g.tone)), a.fillStyle = k, a.beginPath(), a.ellipse(v, M, Math.max(1, c * 0.17 * g.spread * y.scale), Math.max(1, x * 0.55), 0, 0, Math.PI * 2), a.fill();
      }
  }
}), Qa = P({
  metadata: {
    id: "fire-burst",
    displayName: "Fire Burst",
    description: "A radial burst of embers and flame licks that flares fast and decays into drifting sparks.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.55, p = ot(i), b = Array.from({ length: j(30, p) }, () => ({
      angle: t() * Math.PI * 2,
      speed: 0.45 + t() * 0.55,
      size: 1.5 + t() * 3,
      wobble: t() * Math.PI * 2,
      tone: t()
    })), m = N(I(s * 2.4)), g = I(1 - s);
    a.globalCompositeOperation = "lighter";
    const y = a.createRadialGradient(f, u, 0, f, u, Math.max(1, d * (0.25 + m * 0.35)));
    y.addColorStop(0, e.alpha(0.85 * g * i.intensity * p.bloom, 2)), y.addColorStop(0.5, e.alpha(0.5 * g * i.intensity * p.bloom, 0)), y.addColorStop(1, e.alpha(0, 1)), a.fillStyle = y, a.fillRect(r, c, n, h);
    for (const w of b) {
      const S = N(s) * w.speed, x = Math.sin(w.wobble + s * 6 * p.turbulence) * d * 0.06, v = f + Math.cos(w.angle) * d * S + x + p.wind * d * s * 0.2, M = u + Math.sin(w.angle) * d * S - s * h * 0.18, k = g * (0.5 + 0.5 * w.tone) * i.intensity * p.embers;
      if (k <= 0.01)
        continue;
      const C = w.size * (1 - s * 0.6) * l;
      a.fillStyle = e.alpha(k, w.tone > 0.7 ? 2 : w.tone > 0.35 ? 0 : 1), a.beginPath(), a.arc(v, M, Math.max(0.5, C), 0, Math.PI * 2), a.fill();
    }
  }
}), Ka = P({
  metadata: {
    id: "fire-trail",
    displayName: "Fire Trail",
    description: "A blazing comet head that streaks across the target leaving a tapering wake of embers.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = c + h / 2, u = Math.sin(Math.PI * s), d = r + n * s, p = Math.max(2, Math.min(n, h) * 0.14), b = ot(i), m = Array.from({ length: j(28, b) }, () => ({
      lag: 0.03 + t() * 0.42,
      bob: t() * Math.PI * 2,
      size: 0.35 + t() * 0.65,
      tone: t()
    }));
    a.globalCompositeOperation = "lighter";
    const g = a.createRadialGradient(d, f, 0, d, f, p * 2.2);
    g.addColorStop(0, e.alpha(0.9 * u * i.intensity * b.bloom, 2)), g.addColorStop(0.4, e.alpha(0.55 * u * i.intensity * b.bloom, 0)), g.addColorStop(1, e.alpha(0, 1)), a.fillStyle = g, a.beginPath(), a.arc(d, f, p * 2.2, 0, Math.PI * 2), a.fill();
    for (const y of m) {
      const w = d - y.lag * n;
      if (w < r)
        continue;
      const S = I(1 - y.lag / 0.45), x = f + Math.sin(y.bob + s * Math.PI * 8 * b.turbulence) * h * 0.16 * y.lag, v = u * S * (0.3 + 0.5 * y.tone) * i.intensity * b.embers;
      v <= 0.01 || (a.fillStyle = e.alpha(v, y.tone > 0.66 ? 2 : y.tone > 0.33 ? 0 : 1), a.beginPath(), a.arc(w + b.wind * n * y.lag * 0.16, x, Math.max(0.5, p * y.size * S + l * 0.5), 0, Math.PI * 2), a.fill());
    }
  }
}), to = P({
  metadata: {
    id: "fire-ring",
    displayName: "Fire Ring",
    description: "An expanding circular wall of flame that races outward, licking upward before it burns out.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.55, p = d * (0.12 + 0.88 * N(s)), b = 1 - U(s), m = Math.max(2, d * (0.2 - 0.1 * s)), g = ot(i), y = Array.from({ length: j(26, g) }, () => ({
      angle: t() * Math.PI * 2,
      flick: t() * Math.PI * 2,
      speed: 1 + Math.floor(t() * 3),
      size: 0.5 + t() * 0.6,
      tone: t()
    }));
    a.globalCompositeOperation = "lighter";
    const w = Math.max(0, p - m), S = a.createRadialGradient(f, u, w, f, u, p + m);
    S.addColorStop(0, e.alpha(0, 1)), S.addColorStop(0.5, e.alpha(0.7 * b * i.intensity * g.bloom, 0)), S.addColorStop(0.72, e.alpha(0.4 * b * i.intensity * g.bloom, 2)), S.addColorStop(1, e.alpha(0, 1)), a.fillStyle = S, a.beginPath(), a.arc(f, u, p + m, 0, Math.PI * 2), a.fill();
    for (const x of y) {
      const v = 0.7 + 0.3 * Math.sin(x.flick + s * Math.PI * 2 * x.speed * g.turbulence), M = f + Math.cos(x.angle) * p + g.wind * m * v, k = u + Math.sin(x.angle) * p - m * 0.6 * v * g.flameHeight, C = b * (0.35 + 0.45 * x.tone) * i.intensity;
      if (C <= 0.01)
        continue;
      const R = Math.max(1, m * 0.55 * x.size * v + l), E = a.createRadialGradient(M, k, 0, M, k, R);
      E.addColorStop(0, e.alpha(C, x.tone > 0.6 ? 2 : 0)), E.addColorStop(1, e.alpha(0, 1)), a.fillStyle = E, a.beginPath(), a.arc(M, k, R, 0, Math.PI * 2), a.fill();
    }
  }
}), eo = P({
  metadata: {
    id: "fire-embers",
    displayName: "Fire Embers",
    description: "Glowing embers that drift upward from the base of the target, swaying and winking out near the top.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = ot(i), u = Array.from({ length: j(36, f) }, () => ({
      xf: t(),
      phase: t(),
      rise: 0.55 + t() * 0.4,
      sway: t() * Math.PI * 2,
      swayAmp: 0.02 + t() * 0.05,
      size: 1 + t() * 2.4,
      tone: t()
    }));
    a.globalCompositeOperation = "lighter";
    const d = a.createLinearGradient(r, c + h, r, c + h * 0.8);
    d.addColorStop(0, e.alpha(0.22 * i.intensity * f.bloom, 1)), d.addColorStop(1, e.alpha(0, 1)), a.fillStyle = d, a.fillRect(r, c + h * 0.8, n, h * 0.2);
    for (const p of u) {
      const b = (s + p.phase) % 1, m = Math.sin(Math.PI * b), g = m * (0.35 + 0.55 * p.tone) * i.intensity * f.embers;
      if (g <= 0.01)
        continue;
      const y = r + p.xf * n + Math.sin(p.sway + b * Math.PI * 3 * f.turbulence) * n * p.swayAmp + f.wind * n * b * 0.22, w = c + h * 0.98 - b * h * p.rise * f.flameHeight, S = Math.max(0.5, p.size * l * (0.6 + 0.4 * m)), x = a.createRadialGradient(y, w, 0, y, w, S * 3);
      x.addColorStop(0, e.alpha(g * 0.5 * f.bloom, 0)), x.addColorStop(1, e.alpha(0, 1)), a.fillStyle = x, a.beginPath(), a.arc(y, w, S * 3, 0, Math.PI * 2), a.fill(), a.fillStyle = e.alpha(g, p.tone > 0.7 ? 2 : p.tone > 0.3 ? 0 : 1), a.beginPath(), a.arc(y, w, S, 0, Math.PI * 2), a.fill();
    }
  }
}), ao = P({
  metadata: {
    id: "fire-wall",
    displayName: "Fire Wall",
    description: "A continuous wall of flame tongues blazing upward along the full width of the target's base.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = r + n, f = s * Math.PI * 2, u = ot(i), d = j(16, u), p = Array.from({ length: d }, (g, y) => ({
      xf: (y + 0.5) / d + (t() - 0.5) * 0.04,
      flick: t() * Math.PI * 2,
      speed: 1 + Math.floor(t() * 3),
      scale: 0.6 + t() * 0.4
    }));
    a.globalCompositeOperation = "lighter";
    const b = a.createLinearGradient(l, h, l, r + n * 0.55);
    b.addColorStop(0, e.alpha(0.5 * i.intensity * u.bloom, 1)), b.addColorStop(0.6, e.alpha(0.18 * i.intensity * u.bloom, 0)), b.addColorStop(1, e.alpha(0, 0)), a.fillStyle = b, a.fillRect(l, r + n * 0.55, c, n * 0.45);
    const m = [
      { reach: 0.62, tone: 1, alpha: 0.4, widthScale: 1.25 },
      { reach: 0.45, tone: 0, alpha: 0.5, widthScale: 0.95 },
      { reach: 0.26, tone: 2, alpha: 0.6, widthScale: 0.6 }
    ];
    for (const g of m)
      for (const y of p) {
        const w = y.flick + f * y.speed * u.turbulence, S = 0.75 + 0.25 * Math.sin(w), x = n * g.reach * y.scale * S * u.flameHeight, v = l + y.xf * c + Math.sin(w) * c * 0.012 + u.wind * x * 0.13, M = h - x * 0.5, k = a.createRadialGradient(v, M, 0, v, M, Math.max(1, x * 0.7));
        k.addColorStop(0, e.alpha(g.alpha * i.intensity * u.bloom, g.tone)), k.addColorStop(1, e.alpha(0, g.tone)), a.fillStyle = k, a.beginPath(), a.ellipse(v, M, Math.max(1, c / d * g.widthScale * y.scale), Math.max(1, x * 0.55), 0, 0, Math.PI * 2), a.fill();
      }
  }
}), oo = P({
  metadata: {
    id: "fire-aura",
    displayName: "Fire Aura",
    description: "A breathing rim of fiery glow hugging the target's edge with small wisps orbiting the border.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = n * 0.46, p = h * 0.46, b = 0.5 + 0.5 * Math.sin(s * Math.PI * 2), m = ot(i), g = Array.from({ length: j(18, m) }, () => ({
      angle: t() * Math.PI * 2,
      turns: 1 + Math.floor(t() * 2),
      flick: t() * Math.PI * 2,
      size: 0.5 + t() * 0.7,
      tone: t()
    }));
    a.globalCompositeOperation = "lighter";
    const y = Math.max(d, p) * (1.02 + 0.06 * b), w = a.createRadialGradient(f, u, y * 0.55, f, u, y);
    w.addColorStop(0, e.alpha(0, 1)), w.addColorStop(0.7, e.alpha((0.3 + 0.2 * b) * i.intensity * m.bloom, 0)), w.addColorStop(0.88, e.alpha((0.2 + 0.15 * b) * i.intensity * m.bloom, 2)), w.addColorStop(1, e.alpha(0, 1)), a.fillStyle = w, a.fillRect(r, c, n, h);
    for (const S of g) {
      const x = S.angle + s * Math.PI * 2 * S.turns * m.turbulence, v = 0.65 + 0.35 * Math.sin(S.flick + s * Math.PI * 4 * m.turbulence), M = f + Math.cos(x) * d * 0.94 + m.wind * n * 0.04 * Math.sin(Math.PI * s), k = u + Math.sin(x) * p * 0.94, C = v * (0.25 + 0.35 * S.tone) * i.intensity, R = Math.max(1, Math.min(n, h) * 0.06 * S.size * v + l), E = a.createRadialGradient(M, k, 0, M, k, R);
      E.addColorStop(0, e.alpha(C, S.tone > 0.6 ? 2 : 0)), E.addColorStop(1, e.alpha(0, 1)), a.fillStyle = E, a.beginPath(), a.arc(M, k, R, 0, Math.PI * 2), a.fill();
    }
  }
}), so = P({
  metadata: {
    id: "fire-impact",
    displayName: "Fire Impact",
    description: "A hard fiery hit: a hot flash, a fast expanding shockwave ring, and straight radiating sparks.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.6, p = ot(i), b = Array.from({ length: j(22, p) }, () => ({
      angle: t() * Math.PI * 2,
      reach: 0.5 + t() * 0.5,
      thickness: 0.6 + t() * 0.9,
      tone: t()
    })), m = I(1 - s);
    a.globalCompositeOperation = "lighter";
    const g = I(1 - s * 2.6) * i.intensity;
    if (g > 0.01) {
      const x = a.createRadialGradient(f, u, 0, f, u, d * 0.55);
      x.addColorStop(0, e.alpha(g * p.bloom, 2)), x.addColorStop(0.5, e.alpha(g * 0.6 * p.bloom, 0)), x.addColorStop(1, e.alpha(0, 1)), a.fillStyle = x, a.fillRect(r, c, n, h);
    }
    const y = d * N(s), w = m * 0.8 * i.intensity;
    w > 0.01 && y > 1 && (a.strokeStyle = e.alpha(w, 0), a.lineWidth = Math.max(1, d * 0.05 * m + l), a.beginPath(), a.arc(f, u, y, 0, Math.PI * 2), a.stroke()), a.lineCap = "round";
    const S = N(s);
    for (const x of b) {
      const v = m * (0.4 + 0.5 * x.tone) * i.intensity * p.embers;
      if (v <= 0.01)
        continue;
      const M = d * x.reach * S * 0.55, k = d * x.reach * (0.15 + S * 0.85);
      a.strokeStyle = e.alpha(v, x.tone > 0.6 ? 2 : 1), a.lineWidth = Math.max(0.6, x.thickness * l * (1.4 - S)), a.beginPath();
      const C = p.wind * d * s * 0.14;
      a.moveTo(f + Math.cos(x.angle) * M + C * 0.4, u + Math.sin(x.angle) * M), a.lineTo(f + Math.cos(x.angle) * k + C, u + Math.sin(x.angle) * k), a.stroke();
    }
  }
}), io = P({
  metadata: {
    id: "fire-wipe",
    displayName: "Fire Wipe",
    description: "A vertical curtain of flame that sweeps across the target from left to right, then burns away.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff9d2e", "#ff5a1f", "#ffe08a"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = F(I(s / 0.8)), u = I((1 - s) / 0.2), d = r + n * f, p = Math.max(4, n * 0.22), b = ot(i), m = Array.from({ length: j(15, b) }, () => ({
      yf: t(),
      flick: t() * Math.PI * 2,
      size: 0.5 + t() * 0.7,
      tone: t()
    }));
    a.globalCompositeOperation = "lighter";
    const g = a.createLinearGradient(Math.max(r, d - p * 2.4), c, d, c);
    g.addColorStop(0, e.alpha(0, 1)), g.addColorStop(0.65, e.alpha(0.28 * u * i.intensity * b.bloom, 1)), g.addColorStop(1, e.alpha(0.6 * u * i.intensity * b.bloom, 0)), a.fillStyle = g, a.fillRect(Math.max(r, d - p * 2.4), c, Math.min(p * 2.4, d - r), h);
    const y = a.createLinearGradient(d - p * 0.4, c, d + p * 0.5, c);
    y.addColorStop(0, e.alpha(0.5 * u * i.intensity, 0)), y.addColorStop(0.45, e.alpha(0.85 * u * i.intensity, 2)), y.addColorStop(1, e.alpha(0, 1)), a.fillStyle = y, a.fillRect(d - p * 0.4, c, p * 0.9, h);
    for (const w of m) {
      const S = 0.7 + 0.3 * Math.sin(w.flick + s * Math.PI * 6 * b.turbulence), x = d + p * 0.28 * S * w.size + b.wind * p * 0.35, v = c + w.yf * h, M = u * S * (0.35 + 0.45 * w.tone) * i.intensity;
      if (M <= 0.01)
        continue;
      const k = Math.max(1, p * 0.4 * w.size * b.flameHeight + l), C = a.createRadialGradient(x, v, 0, x, v, k);
      C.addColorStop(0, e.alpha(M, w.tone > 0.6 ? 2 : 0)), C.addColorStop(1, e.alpha(0, 1)), a.fillStyle = C, a.beginPath(), a.arc(x, v, k, 0, Math.PI * 2), a.fill();
    }
  }
}), se = /* @__PURE__ */ new WeakMap(), no = P({
  metadata: {
    id: "fire-inferno",
    displayName: "Fire Inferno",
    description: "Layered natural flames with white-hot cores, turbulent tips, smoke, heat bloom, and windblown embers.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  parameters: at,
  palette: ["#ff7a18", "#d9280b", "#fff4b0", "#ffb000"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = c + h * 1.015, u = s * Math.PI * 4, d = N(I(s / 0.1)), p = N(I((1 - s) / 0.14)), b = Math.min(d, p) * i.intensity;
    if (b <= 5e-3)
      return;
    const m = ot(i), g = j(19, m), y = Array.from({ length: g }, (k, C) => ({
      xf: I((C + 0.5) / g + (t() - 0.5) * 0.045),
      phase: t() * Math.PI * 2,
      speed: 0.75 + t() * 1.65,
      reach: 0.3 + t() * 0.43 + (C % 6 === 1 ? 0.2 : 0),
      width: 0.58 + t() * 0.68,
      lean: (t() - 0.5) * 0.11
    })), w = Array.from({ length: j(12, m) }, () => ({
      xf: 0.04 + t() * 0.92,
      phase: t(),
      sway: t() * Math.PI * 2,
      size: 0.65 + t() * 0.85,
      opacity: 0.55 + t() * 0.45
    })), S = Array.from({ length: j(42, m) }, () => ({
      xf: t(),
      phase: t(),
      sway: t() * Math.PI * 2,
      speed: 0.55 + t() * 0.75,
      size: 0.65 + t() * 1.9,
      tone: t()
    }));
    a.globalCompositeOperation = "source-over";
    for (const k of w) {
      const C = (s * 0.72 + k.phase) % 1, R = Math.sin(Math.PI * C), E = Math.max(8, Math.min(n, h) * (0.075 + C * 0.07) * k.size), T = r + k.xf * n + Math.sin(k.sway + C * Math.PI * 3 * m.turbulence) * n * 0.045 + m.wind * n * C * 0.16, A = f - h * (0.34 + C * 0.58), L = R * 0.12 * k.opacity * b * m.smoke;
      if (L <= 5e-3)
        continue;
      const B = a.createRadialGradient(T, A, 0, T, A, E);
      B.addColorStop(0, `rgba(38,31,38,${L})`), B.addColorStop(0.58, `rgba(26,22,31,${L * 0.55})`), B.addColorStop(1, "rgba(18,16,24,0)"), a.fillStyle = B, a.beginPath(), a.arc(T, A, E, 0, Math.PI * 2), a.fill();
    }
    a.globalCompositeOperation = "lighter";
    const x = a.createLinearGradient(r, f, r, c + h * 0.2);
    x.addColorStop(0, e.alpha(0.48 * b * m.bloom, 2)), x.addColorStop(0.12, e.alpha(0.34 * b * m.bloom, 3)), x.addColorStop(0.48, e.alpha(0.1 * b * m.bloom, 0)), x.addColorStop(1, e.alpha(0, 1)), a.fillStyle = x, a.fillRect(r, c, n, h);
    const v = ro(a, r, c, n, h, s, b, m), M = b * (v ? 0.1 : 1);
    for (const k of y) {
      const C = k.phase + u * k.speed * m.turbulence, R = 0.84 + Math.sin(C) * 0.1 + Math.sin(C * 2.37 + 1.4) * 0.06 * m.turbulence, E = h * k.reach * R * m.flameHeight, T = r + k.xf * n + Math.sin(C * 0.73) * n * 0.012, A = T + k.lean * n + Math.sin(C * 1.31) * n * 0.025 + m.wind * E * 0.16, L = {
        x: T,
        tipX: A,
        baseY: f,
        tipY: f - E,
        width: Math.max(7 * l, n / g * k.width)
      };
      a.save(), a.globalCompositeOperation = "lighter", a.shadowBlur = Math.max(10, L.width * 0.8) * m.bloom, a.shadowColor = e.alpha(0.52 * M * m.bloom, 0), a.fillStyle = e.alpha(0.14 * M * m.bloom, 1), At(a, L), a.fill(), a.restore(), a.globalCompositeOperation = "screen";
      const B = a.createLinearGradient(0, L.tipY, 0, f);
      B.addColorStop(0, e.alpha(0, 1)), B.addColorStop(0.12, e.alpha(0.4 * M, 1)), B.addColorStop(0.46, e.alpha(0.64 * M, 0)), B.addColorStop(0.82, e.alpha(0.74 * M, 3)), B.addColorStop(1, e.alpha(0.48 * M, 1)), a.fillStyle = B, a.filter = `blur(${Math.max(0.45, l * 0.7)}px)`, At(a, L), a.fill(), a.filter = "none";
      const _ = E * (0.35 + 0.07 * Math.sin(C + 0.8)), Y = {
        x: T + Math.sin(C * 1.7) * L.width * 0.08,
        tipX: T + (A - T) * 0.38,
        baseY: f,
        tipY: f - _,
        width: L.width * 0.38
      };
      a.globalCompositeOperation = "lighter";
      const q = a.createLinearGradient(0, Y.tipY, 0, f);
      q.addColorStop(0, e.alpha(0, 3)), q.addColorStop(0.22, e.alpha(0.48 * M, 3)), q.addColorStop(0.62, e.alpha(0.76 * M, 2)), q.addColorStop(0.9, e.alpha(0.84 * M, 2)), q.addColorStop(1, e.alpha(0.18 * M, 3)), a.fillStyle = q, At(a, Y), a.fill();
    }
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    for (const k of S) {
      const C = (s * k.speed + k.phase) % 1, R = Math.sin(Math.PI * C), E = r + k.xf * n + Math.sin(k.sway + C * Math.PI * 5 * m.turbulence) * n * 0.055 + m.wind * n * C * 0.22, T = f - C * h * 1.02, A = R * (0.32 + k.tone * 0.62) * b * m.embers;
      if (A <= 0.015)
        continue;
      const L = Math.max(2, k.size * l * (2.2 + C * 2.8));
      a.strokeStyle = e.alpha(A, k.tone > 0.66 ? 2 : 3), a.lineWidth = Math.max(0.7, k.size * l * (1 - C * 0.55)), a.shadowBlur = 5 * l, a.shadowColor = e.alpha(A * 0.8, 0), a.beginPath(), a.moveTo(E, T), a.lineTo(E - Math.sin(k.sway) * L * 0.35, T + L), a.stroke();
    }
    a.shadowBlur = 0;
  },
  renderReducedMotion({ frame: o, paint: t }) {
    const { ctx: e, options: a } = o, { x: s, y: i, width: l, height: r } = o.target.bounds(), c = e.createLinearGradient(s, i + r, s, i + r * 0.35);
    c.addColorStop(0, t.alpha(0.48 * a.intensity, 2)), c.addColorStop(0.35, t.alpha(0.22 * a.intensity, 0)), c.addColorStop(1, t.alpha(0, 1)), e.fillStyle = c, e.fillRect(s, i, l, r);
  }
});
function At(o, t) {
  const e = t.width / 2, a = t.baseY - t.tipY, s = t.tipX - t.x;
  o.beginPath(), o.moveTo(t.x - e, t.baseY), o.bezierCurveTo(t.x - e * 1.12, t.baseY - a * 0.12, t.x - e * 0.82 + s * 0.12, t.baseY - a * 0.38, t.x - e * 0.6 + s * 0.3, t.baseY - a * 0.54), o.bezierCurveTo(t.x - e * 0.34 + s * 0.58, t.baseY - a * 0.76, t.tipX - e * 0.12, t.tipY + a * 0.07, t.tipX, t.tipY), o.bezierCurveTo(t.tipX + e * 0.16, t.tipY + a * 0.09, t.x + e * 0.36 + s * 0.48, t.baseY - a * 0.72, t.x + e * 0.7 + s * 0.18, t.baseY - a * 0.46), o.bezierCurveTo(t.x + e * 1.05, t.baseY - a * 0.2, t.x + e * 1.08, t.baseY - a * 0.08, t.x + e, t.baseY), o.closePath();
}
function ro(o, t, e, a, s, i, l, r) {
  const c = Math.max(92, Math.min(180, Math.round(a / 4.5))), n = Math.max(68, Math.min(132, Math.round(s / 4.5))), h = lo(o, c, n);
  if (!h)
    return !1;
  const f = 40 + Math.floor(i * 220);
  for (f < h.step && co(h); h.step < f; )
    ho(h, r);
  const u = h.image.data;
  let d = 0;
  for (let p = 0; p < h.current.length; p += 1) {
    const b = I(h.current[p]), m = I((b - 0.18) / 0.82), [g, y, w] = fo(b);
    u[d] = g, u[d + 1] = y, u[d + 2] = w, u[d + 3] = Math.round(255 * Math.pow(m, 1.32) * Math.min(1, 0.86 * l * r.bloom)), d += 4;
  }
  return h.context.putImageData(h.image, 0, 0), o.save(), o.globalCompositeOperation = "screen", o.imageSmoothingEnabled = !0, o.filter = "blur(1.3px) saturate(1.16)", o.drawImage(h.canvas, t, e, a, s), o.restore(), !0;
}
function lo(o, t, e) {
  const a = se.get(o);
  if (a && a.width === t && a.height === e)
    return a;
  let s;
  if (typeof OffscreenCanvas < "u")
    s = new OffscreenCanvas(t, e);
  else if (typeof document < "u")
    s = document.createElement("canvas"), s.width = t, s.height = e;
  else
    return;
  const i = s.getContext("2d");
  if (!i)
    return;
  const l = {
    canvas: s,
    context: i,
    image: i.createImageData(t, e),
    current: new Float32Array(t * e),
    next: new Float32Array(t * e),
    width: t,
    height: e,
    step: 0
  };
  return se.set(o, l), l;
}
function co(o) {
  o.current.fill(0), o.next.fill(0), o.step = 0;
}
function ho(o, t) {
  const { width: e, height: a, current: s, next: i } = o;
  i.fill(0);
  const l = a - 1;
  for (let r = 0; r < e; r += 1) {
    const n = Math.sin(r * 0.19 + o.step * 0.12 * t.turbulence) + Math.sin(r * 0.071 - o.step * 0.075 * t.turbulence) * 0.58 + (ht(Math.floor(r / 2), l, o.step) - 0.5) * 0.72 * t.turbulence > 0.08 ? 0.76 + ht(r, l, o.step) * 0.24 : 0.16 + ht(r, l, o.step) * 0.3;
    s[l * e + r] = n, s[(l - 1) * e + r] = n * (0.9 + ht(r, l - 1, o.step) * 0.1);
  }
  for (let r = 0; r < a - 2; r += 1) {
    const c = 1 - r / Math.max(1, a - 1);
    for (let n = 0; n < e; n += 1) {
      const f = (ht(n + 31, r - 17, o.step) > 0.62 ? 1 : ht(n - 11, r + 23, o.step) < 0.3 ? -1 : 0) + Math.round(t.wind * 2), u = (n + f + e * 2) % e, d = (u - 1 + e) % e, p = (u + 1) % e, b = (r + 1) * e, m = (r + 2) * e, g = s[b + u] * 0.55 + s[b + d] * 0.125 + s[b + p] * 0.125 + s[m + u] * 0.2, y = (15e-4 + ht(n, r, o.step) * 8e-3 * t.turbulence) * (0.35 + c * 0.58) / t.flameHeight;
      i[r * e + n] = Math.max(0, g - y);
    }
  }
  for (let r = a - 2; r < a; r += 1) {
    const c = r * e;
    for (let n = 0; n < e; n += 1)
      i[c + n] = s[c + n];
  }
  o.current = i, o.next = s, o.step += 1;
}
function fo(o) {
  return o <= 0.02 ? [0, 0, 0] : o < 0.28 ? wt([72, 0, 4], [202, 24, 4], o / 0.28) : o < 0.56 ? wt([202, 24, 4], [255, 105, 4], (o - 0.28) / 0.28) : o < 0.82 ? wt([255, 105, 4], [255, 214, 62], (o - 0.56) / 0.26) : wt([255, 214, 62], [255, 250, 208], (o - 0.82) / 0.18);
}
function wt(o, t, e) {
  const a = I(e);
  return [
    Math.round(o[0] + (t[0] - o[0]) * a),
    Math.round(o[1] + (t[1] - o[1]) * a),
    Math.round(o[2] + (t[2] - o[2]) * a)
  ];
}
function ht(o, t, e) {
  let a = Math.imul(o + 2654435769, 2246822507) ^ Math.imul(t - e * 3, 3266489909) ^ Math.imul(e + 17, 668265261);
  return a ^= a >>> 15, a = Math.imul(a, 2246822507), a ^= a >>> 13, (a >>> 0) / 4294967295;
}
const po = P({
  metadata: {
    id: "light-point-glow",
    displayName: "Light Point Glow",
    description: "A scattering of soft light points that gently breathe brighter and dimmer across the target.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = Math.min(n, h), u = Array.from({ length: 9 }, () => ({
      px: r + n * (0.1 + t() * 0.8),
      py: c + h * (0.1 + t() * 0.8),
      size: f * (0.09 + t() * 0.13),
      phase: t() * Math.PI * 2,
      rate: 1 + Math.floor(t() * 2),
      tone: Math.floor(t() * 3)
    }));
    a.globalCompositeOperation = "lighter";
    for (const d of u) {
      const p = 0.55 + 0.45 * Math.sin(s * Math.PI * 2 * d.rate + d.phase), b = p * 0.7 * i.intensity;
      if (b <= 0.01)
        continue;
      const m = Math.max(1, d.size * (0.75 + p * 0.35) + l), g = a.createRadialGradient(d.px, d.py, 0, d.px, d.py, m);
      g.addColorStop(0, e.alpha(b, 2)), g.addColorStop(0.35, e.alpha(b * 0.55, d.tone)), g.addColorStop(1, e.alpha(0, d.tone)), a.fillStyle = g, a.fillRect(d.px - m, d.py - m, m * 2, m * 2);
    }
  }
}), uo = P({
  metadata: {
    id: "light-radial-pulse",
    displayName: "Light Radial Pulse",
    description: "Concentric rings of light that expand from the center and fade as they reach the edges.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = Math.hypot(r, c) / 2;
    e.globalCompositeOperation = "lighter";
    const u = 0.45 * Dt(a) * s.intensity, d = e.createRadialGradient(n, h, 0, n, h, f * 0.4);
    d.addColorStop(0, t.alpha(u, 2)), d.addColorStop(0.6, t.alpha(u * 0.45, 0)), d.addColorStop(1, t.alpha(0, 0)), e.fillStyle = d, e.fillRect(i, l, r, c);
    const p = f * 0.14;
    for (let b = 0; b < 3; b += 1) {
      const m = I(a * 1.3 - b * 0.15);
      if (m <= 0 || m >= 1)
        continue;
      const g = N(m), y = f * (0.1 + g * 0.9), w = (1 - g) * s.intensity, S = e.createRadialGradient(n, h, Math.max(0, y - p), n, h, y + p);
      S.addColorStop(0, t.alpha(0, 1)), S.addColorStop(0.5, t.alpha(0.5 * w, b % 3)), S.addColorStop(1, t.alpha(0, 1)), e.fillStyle = S, e.fillRect(i - p, l - p, r + p * 2, c + p * 2);
    }
  }
}), go = P({
  metadata: {
    id: "light-spotlight",
    displayName: "Light Spotlight",
    description: "A theatrical spotlight cone that sways side to side, tracking a bright elliptical hotspot.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = Math.sin(a * Math.PI * 2), h = i + r / 2 + n * r * 0.28, f = l + c * 0.62, u = Math.max(r, c) * 0.34, d = i + r / 2 + n * r * 0.08, p = l - c * 0.25;
    e.globalCompositeOperation = "lighter";
    const b = e.createLinearGradient(d, p, h, f);
    b.addColorStop(0, t.alpha(0.05 * s.intensity, 2)), b.addColorStop(0.5, t.alpha(0.16 * s.intensity, 0)), b.addColorStop(1, t.alpha(0.3 * s.intensity, 1)), e.fillStyle = b, e.beginPath(), e.moveTo(d - r * 0.05, p), e.lineTo(d + r * 0.05, p), e.lineTo(h + u * 0.9, f), e.lineTo(h - u * 0.9, f), e.closePath(), e.fill(), e.translate(h, f), e.scale(1, 0.62);
    const m = e.createRadialGradient(0, 0, 0, 0, 0, u);
    m.addColorStop(0, t.alpha(0.85 * s.intensity, 2)), m.addColorStop(0.4, t.alpha(0.45 * s.intensity, 0)), m.addColorStop(1, t.alpha(0, 1)), e.fillStyle = m, e.fillRect(-u, -u, u * 2, u * 2);
  }
}), bo = P({
  metadata: {
    id: "light-sweep",
    displayName: "Light Sweep",
    description: "A broad vertical band of warm light that sweeps once across the target from left to right.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = r * 0.42, h = F(a), f = i - n + (r + n * 2) * h;
    e.globalCompositeOperation = "lighter";
    const u = e.createLinearGradient(f - n * 1.6, 0, f + n * 1.6, 0);
    u.addColorStop(0, t.alpha(0, 1)), u.addColorStop(0.5, t.alpha(0.22 * s.intensity, 1)), u.addColorStop(1, t.alpha(0, 1)), e.fillStyle = u, e.fillRect(i, l, r, c);
    const d = e.createLinearGradient(f - n / 2, 0, f + n / 2, 0);
    d.addColorStop(0, t.alpha(0, 0)), d.addColorStop(0.45, t.alpha(0.5 * s.intensity, 0)), d.addColorStop(0.5, t.alpha(0.75 * s.intensity, 2)), d.addColorStop(0.55, t.alpha(0.5 * s.intensity, 0)), d.addColorStop(1, t.alpha(0, 0)), e.fillStyle = d, e.fillRect(i, l, r, c);
  }
}), mo = P({
  metadata: {
    id: "light-beam",
    displayName: "Light Beam",
    description: "A downward beam of light that fades in, sways gently, and fades back out.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = Math.sin(Math.PI * a) * s.intensity;
    if (n <= 0.01)
      return;
    const h = i + r / 2, f = Math.sin(a * Math.PI * 2) * r * 0.06, u = r * 0.4;
    e.globalCompositeOperation = "lighter";
    const d = e.createLinearGradient(0, l, 0, l + c);
    d.addColorStop(0, t.alpha(0.7 * n, 2)), d.addColorStop(0.45, t.alpha(0.32 * n, 0)), d.addColorStop(1, t.alpha(0.04 * n, 1)), e.fillStyle = d, e.beginPath(), e.moveTo(h - r * 0.09, l), e.lineTo(h + r * 0.09, l), e.lineTo(h + u + f, l + c), e.lineTo(h - u + f, l + c), e.closePath(), e.fill();
    const p = r * 0.24, b = e.createRadialGradient(h, l, 0, h, l, p);
    b.addColorStop(0, t.alpha(0.85 * n, 2)), b.addColorStop(0.5, t.alpha(0.35 * n, 1)), b.addColorStop(1, t.alpha(0, 1)), e.fillStyle = b, e.fillRect(h - p, l - p, p * 2, p * 2);
  }
}), yo = P({
  metadata: {
    id: "light-rays",
    displayName: "Light Rays",
    description: "Volumetric god-rays that rotate slowly around a glowing core at the center of the target.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = Math.hypot(c, n) * 0.62, d = 12, p = s * Math.PI * 2, b = Array.from({ length: d }, (g, y) => ({
      angle: y / d * Math.PI * 2 + t() * 0.25,
      halfWidth: 0.045 + t() * 0.05,
      length: u * (0.75 + t() * 0.25),
      phase: t() * Math.PI * 2,
      tone: y % 2
    }));
    a.globalCompositeOperation = "lighter";
    for (const g of b) {
      const w = 0.3 * (0.6 + 0.4 * Math.sin(s * Math.PI * 4 + g.phase)) * i.intensity, S = g.angle + p, x = a.createRadialGradient(h, f, 0, h, f, g.length);
      x.addColorStop(0, e.alpha(w, 2)), x.addColorStop(0.35, e.alpha(w * 0.7, g.tone)), x.addColorStop(1, e.alpha(0, g.tone)), a.fillStyle = x, a.beginPath(), a.moveTo(h, f), a.lineTo(h + Math.cos(S - g.halfWidth) * g.length, f + Math.sin(S - g.halfWidth) * g.length), a.lineTo(h + Math.cos(S + g.halfWidth) * g.length, f + Math.sin(S + g.halfWidth) * g.length), a.closePath(), a.fill();
    }
    const m = a.createRadialGradient(h, f, 0, h, f, u * 0.28);
    m.addColorStop(0, e.alpha(0.8 * i.intensity, 2)), m.addColorStop(0.5, e.alpha(0.3 * i.intensity, 0)), m.addColorStop(1, e.alpha(0, 0)), a.fillStyle = m, a.fillRect(l, r, c, n);
  }
}), wo = P({
  metadata: {
    id: "light-neon-flicker",
    displayName: "Light Neon Flicker",
    description: "A glowing neon tube border that buzzes and intermittently flickers like a bar sign.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.max(3 * i, Math.min(c, n) * 0.05), f = 0.78 + 0.22 * Math.sin(a * Math.PI * 2 * 7 + 1.3) * Math.sin(a * Math.PI * 2 * 13), u = 1 - 0.8 * I((Math.sin(a * Math.PI * 2 * 2 + 0.7) - 0.9) / 0.1), d = f * u * s.intensity;
    if (d <= 0.02)
      return;
    e.globalCompositeOperation = "lighter", e.lineJoin = "round";
    const p = [
      { lineWidth: 10 * i, alpha: 0.1, tone: 1 },
      { lineWidth: 5.5 * i, alpha: 0.24, tone: 1 },
      { lineWidth: 2.6 * i, alpha: 0.6, tone: 0 },
      { lineWidth: 1.2 * i, alpha: 0.95, tone: 2 }
    ];
    for (const b of p)
      e.strokeStyle = t.alpha(b.alpha * d, b.tone), e.lineWidth = b.lineWidth, e.strokeRect(l + h, r + h, c - h * 2, n - h * 2);
  }
}), xo = P({
  metadata: {
    id: "light-strobe",
    displayName: "Light Strobe",
    description: "A rapid series of full-target strobe flashes that decay in strength and end cleanly.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), h = Math.min(a, 0.999) * 4, f = Math.floor(h), u = h - f, p = Math.pow(Math.max(0, 1 - u * 2.4), 1.6) * (1 - f * 0.18) * s.intensity;
    if (p <= 0.01)
      return;
    e.globalCompositeOperation = "lighter", e.fillStyle = t.alpha(0.55 * p, 2), e.fillRect(i, l, r, c);
    const b = i + r / 2, m = l + c / 2, g = Math.hypot(r, c) / 2, y = e.createRadialGradient(b, m, 0, b, m, g);
    y.addColorStop(0, t.alpha(0.5 * p, 0)), y.addColorStop(0.6, t.alpha(0.25 * p, 1)), y.addColorStop(1, t.alpha(0, 1)), e.fillStyle = y, e.fillRect(i, l, r, c);
  }
}), So = P({
  metadata: {
    id: "light-color-wash",
    displayName: "Light Color Wash",
    description: "A soft diagonal wash of palette colors that drifts back and forth across the whole target.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = 0.5 + 0.5 * Math.sin(a * Math.PI * 2);
    e.globalCompositeOperation = "lighter";
    const h = e.createLinearGradient(i, l, i + r, l + c);
    h.addColorStop(0, t.alpha(0.24 * s.intensity, 0)), h.addColorStop(I(0.2 + n * 0.6), t.alpha(0.3 * s.intensity, 1)), h.addColorStop(1, t.alpha(0.22 * s.intensity, 2)), e.fillStyle = h, e.fillRect(i, l, r, c);
    const f = i + r * (0.5 + 0.4 * Math.cos(a * Math.PI * 2)), u = r * 0.55, d = e.createLinearGradient(f - u, 0, f + u, 0);
    d.addColorStop(0, t.alpha(0, 1)), d.addColorStop(0.5, t.alpha(0.18 * s.intensity, 1)), d.addColorStop(1, t.alpha(0, 1)), e.fillStyle = d, e.fillRect(i, l, r, c);
  }
}), vo = P({
  metadata: {
    id: "light-vignette-pulse",
    displayName: "Light Vignette Pulse",
    description: "A luminous vignette around the edges of the target that breathes brighter and softer.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = Math.hypot(r, c) / 2, d = (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(a * Math.PI * 2))) * s.intensity;
    e.globalCompositeOperation = "lighter";
    const p = e.createRadialGradient(n, h, f * 0.35, n, h, f);
    p.addColorStop(0, t.alpha(0, 0)), p.addColorStop(0.55, t.alpha(d * 0.25, 0)), p.addColorStop(0.85, t.alpha(d * 0.7, 1)), p.addColorStop(1, t.alpha(d, 2)), e.fillStyle = p, e.fillRect(i, l, r, c);
  }
}), Mo = P({
  metadata: {
    id: "light-backlight",
    displayName: "Light Backlight",
    description: "A large soft glow behind the target that slowly breathes and drifts for an ambient halo.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = 0.5 + 0.5 * Math.sin(a * Math.PI * 2);
    e.globalCompositeOperation = "lighter";
    const u = Math.max(r, c) * (0.62 + 0.08 * f), d = e.createRadialGradient(n, h, 0, n, h, u);
    d.addColorStop(0, t.alpha((0.4 + 0.2 * f) * s.intensity, 1)), d.addColorStop(0.55, t.alpha(0.2 * s.intensity, 0)), d.addColorStop(1, t.alpha(0, 0)), e.fillStyle = d, e.fillRect(i - u, l - u, r + u * 2, c + u * 2);
    const p = n + Math.cos(a * Math.PI * 2) * r * 0.07, b = h + Math.sin(a * Math.PI * 2) * c * 0.07, m = Math.min(r, c) * 0.5, g = e.createRadialGradient(p, b, 0, p, b, m);
    g.addColorStop(0, t.alpha((0.3 + 0.15 * f) * s.intensity, 2)), g.addColorStop(1, t.alpha(0, 2)), e.fillStyle = g, e.fillRect(p - m, b - m, m * 2, m * 2);
  }
}), ko = P({
  metadata: {
    id: "light-marquee",
    displayName: "Light Marquee",
    description: "Casino-sign marquee bulbs around the border with a bright chase running along the frame.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.max(4 * i, Math.min(c, n) * 0.07), f = l + h, u = r + h, d = c - h * 2, p = n - h * 2, b = 2 * (d + p), m = Math.max(12, Math.round(b / Math.max(8 * i, Math.min(d, p) * 0.22))), g = Math.max(3, Math.round(m / 3)), y = Math.max(1.5 * i, Math.min(d, p) * 0.05);
    e.globalCompositeOperation = "lighter";
    for (let w = 0; w < m; w += 1) {
      const S = w / m * b;
      let x, v;
      S < d ? (x = f + S, v = u) : S < d + p ? (x = f + d, v = u + (S - d)) : S < d * 2 + p ? (x = f + d - (S - d - p), v = u + p) : (x = f, v = u + p - (S - d * 2 - p));
      const M = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * (w / m * g - a * 2)), 3), k = (0.12 + 0.88 * M) * s.intensity, C = y * (1.6 + M * 2.2), R = e.createRadialGradient(x, v, 0, x, v, C);
      R.addColorStop(0, t.alpha(k, 2)), R.addColorStop(0.4, t.alpha(k * 0.7, M > 0.5 ? 0 : 1)), R.addColorStop(1, t.alpha(0, 1)), e.fillStyle = R, e.fillRect(x - C, v - C, C * 2, C * 2);
    }
  }
}), Co = P({
  metadata: {
    id: "shine-glint",
    displayName: "Shine Glint",
    description: "A single bright diagonal glint that streaks once across the target with a starry peak.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.hypot(c, n), f = F(a) * 1.5 - 0.25, u = l + c * f, d = r + n * f, p = h * 0.09;
    e.globalCompositeOperation = "lighter", e.translate(u, d), e.rotate(Math.atan2(n, c));
    const b = e.createLinearGradient(-p, 0, p, 0);
    b.addColorStop(0, t.alpha(0, 1)), b.addColorStop(0.45, t.alpha(0.45 * s.intensity, 1)), b.addColorStop(0.5, t.alpha(0.85 * s.intensity, 0)), b.addColorStop(0.55, t.alpha(0.45 * s.intensity, 2)), b.addColorStop(1, t.alpha(0, 2)), e.fillStyle = b, e.fillRect(-p, -h * 0.7, p * 2, h * 1.4);
    const m = Dt(a), g = h * 0.22 * m, y = Math.max(1, 1.6 * i);
    e.fillStyle = t.alpha(0.9 * m * s.intensity, 0);
    for (const w of [0, Math.PI / 2])
      e.rotate(w), e.beginPath(), e.moveTo(0, -g), e.lineTo(y, 0), e.lineTo(0, g), e.lineTo(-y, 0), e.closePath(), e.fill();
  }
}), Po = P({
  metadata: {
    id: "shine-sparkle",
    displayName: "Shine Sparkle",
    description: "Little four-point sparkles that pop into life at random spots, swell, and wink out.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = Math.min(n, h), u = Array.from({ length: 16 }, () => ({
      sx: r + n * (0.08 + t() * 0.84),
      sy: c + h * (0.08 + t() * 0.84),
      size: f * (0.05 + t() * 0.08),
      delay: t(),
      tone: Math.floor(t() * 3)
    }));
    a.globalCompositeOperation = "lighter";
    for (const d of u) {
      const b = (s - d.delay + 1) % 1 / 0.3;
      if (b > 1)
        continue;
      const m = kt(I(b / 0.5)), y = (1 - U(b)) * i.intensity;
      if (y <= 0.02)
        continue;
      const w = d.size * m, S = Math.max(0.8, d.size * 0.14 * m * l);
      a.fillStyle = e.alpha(0.9 * y, d.tone), a.beginPath(), a.moveTo(d.sx, d.sy - w), a.lineTo(d.sx + S, d.sy), a.lineTo(d.sx, d.sy + w), a.lineTo(d.sx - S, d.sy), a.closePath(), a.fill(), a.beginPath(), a.moveTo(d.sx - w, d.sy), a.lineTo(d.sx, d.sy + S), a.lineTo(d.sx + w, d.sy), a.lineTo(d.sx, d.sy - S), a.closePath(), a.fill();
      const x = a.createRadialGradient(d.sx, d.sy, 0, d.sx, d.sy, w);
      x.addColorStop(0, e.alpha(0.5 * y, 0)), x.addColorStop(1, e.alpha(0, 0)), a.fillStyle = x, a.fillRect(d.sx - w, d.sy - w, w * 2, w * 2);
    }
  }
}), Ro = P({
  metadata: {
    id: "shine-starburst",
    displayName: "Shine Starburst",
    description: "An explosive burst of tapered light spokes and a core flash that flares out and fades.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.hypot(n, h) * 0.55, p = Array.from({ length: 10 }, (v, M) => ({
      angle: M / 10 * Math.PI * 2 + t() * 0.3,
      length: d * (0.55 + t() * 0.45),
      tone: Math.floor(t() * 3)
    })), b = N(I(s * 1.5)), m = 1 - U(s);
    a.globalCompositeOperation = "lighter";
    const g = a.createRadialGradient(f, u, 0, f, u, d * (0.15 + b * 0.25));
    g.addColorStop(0, e.alpha(0.9 * m * i.intensity, 0)), g.addColorStop(0.5, e.alpha(0.4 * m * i.intensity, 1)), g.addColorStop(1, e.alpha(0, 1)), a.fillStyle = g, a.fillRect(r, c, n, h);
    for (const v of p) {
      const M = v.length * b, k = 0.75 * m * i.intensity;
      if (k <= 0.02 || M <= 1)
        continue;
      const C = Math.max(1, (2.4 - s * 1.6) * l);
      a.fillStyle = e.alpha(k, v.tone), a.translate(f, u), a.rotate(v.angle), a.beginPath(), a.moveTo(0, -C), a.lineTo(M, 0), a.lineTo(0, C), a.closePath(), a.fill(), a.rotate(-v.angle), a.translate(-f, -u);
    }
    const y = I(s * 1.2), w = d * N(y), S = d * 0.1, x = a.createRadialGradient(f, u, Math.max(0, w - S), f, u, w + S);
    x.addColorStop(0, e.alpha(0, 2)), x.addColorStop(0.5, e.alpha(0.4 * m * i.intensity, 2)), x.addColorStop(1, e.alpha(0, 2)), a.fillStyle = x, a.fillRect(r, c, n, h);
  }
}), Io = P({
  metadata: {
    id: "shine-sweep",
    displayName: "Shine Sweep",
    description: "A wide glossy sheen that glides once across the target like light over polished glass.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = Math.hypot(r, c), u = f / 2, d = f * 0.3, p = f * 0.08, b = -u - d + (f + d * 2) * F(a);
    e.globalCompositeOperation = "lighter", e.translate(n, h), e.rotate(-Math.PI / 9);
    const m = e.createLinearGradient(b - d, 0, b + d, 0);
    m.addColorStop(0, t.alpha(0, 1)), m.addColorStop(0.5, t.alpha(0.3 * s.intensity, 1)), m.addColorStop(1, t.alpha(0, 1)), e.fillStyle = m, e.fillRect(-u - d, -u - d, (u + d) * 2, (u + d) * 2);
    const g = e.createLinearGradient(b - p, 0, b + p, 0);
    g.addColorStop(0, t.alpha(0, 0)), g.addColorStop(0.5, t.alpha(0.7 * s.intensity, 0)), g.addColorStop(1, t.alpha(0, 2)), e.fillStyle = g, e.fillRect(-u - d, -u - d, (u + d) * 2, (u + d) * 2);
  }
}), Eo = P({
  metadata: {
    id: "shine-edge",
    displayName: "Shine Edge",
    description: "A bright highlight that races along the border of the target, trailing a soft glow.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.max(2 * i, Math.min(c, n) * 0.03), f = l + h, u = r + h, d = c - h * 2, p = n - h * 2, b = 2 * (d + p), m = s.loop ? 1 : Math.pow(Math.sin(Math.PI * a), 0.5);
    e.globalCompositeOperation = "lighter", e.strokeStyle = t.alpha(0.14 * m * s.intensity, 1), e.lineWidth = Math.max(1, 1.5 * i), e.strokeRect(f, u, d, p);
    const g = 56, y = Math.max(2 * i, Math.min(d, p) * 0.06);
    for (let w = 0; w < g; w += 1) {
      const S = w / g, x = Math.abs(S - a), v = Math.min(x, 1 - x), M = Math.pow(Math.max(0, 1 - v / 0.11), 2);
      if (M <= 0.02)
        continue;
      const k = S * b;
      let C, R;
      k < d ? (C = f + k, R = u) : k < d + p ? (C = f + d, R = u + (k - d)) : k < d * 2 + p ? (C = f + d - (k - d - p), R = u + p) : (C = f, R = u + p - (k - d * 2 - p));
      const E = M * m * s.intensity, T = y * (0.6 + M), A = e.createRadialGradient(C, R, 0, C, R, T);
      A.addColorStop(0, t.alpha(E, 0)), A.addColorStop(0.5, t.alpha(E * 0.5, 2)), A.addColorStop(1, t.alpha(0, 2)), e.fillStyle = A, e.fillRect(C - T, R - T, T * 2, T * 2);
    }
  }
}), Ao = P({
  metadata: {
    id: "shine-halo",
    displayName: "Shine Halo",
    description: "A luminous ring hovering around the target that breathes in radius and brightness.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = 0.5 + 0.5 * Math.sin(a * Math.PI * 2), u = Math.max(r, c) * (0.42 + 0.05 * f), d = Math.min(r, c) * 0.16;
    e.globalCompositeOperation = "lighter";
    const p = e.createRadialGradient(n, h, Math.max(0, u - d), n, h, u + d);
    p.addColorStop(0, t.alpha(0, 1)), p.addColorStop(0.45, t.alpha((0.35 + 0.25 * f) * s.intensity, 1)), p.addColorStop(0.55, t.alpha((0.45 + 0.3 * f) * s.intensity, 0)), p.addColorStop(1, t.alpha(0, 2)), e.fillStyle = p;
    const b = u + d;
    e.fillRect(n - b, h - b, b * 2, b * 2);
    const m = u * 1.3, g = d * 1.5, y = e.createRadialGradient(n, h, Math.max(0, m - g), n, h, m + g);
    y.addColorStop(0, t.alpha(0, 2)), y.addColorStop(0.5, t.alpha((0.3 - 0.18 * f) * s.intensity, 2)), y.addColorStop(1, t.alpha(0, 2)), e.fillStyle = y;
    const w = m + g;
    e.fillRect(n - w, h - w, w * 2, w * 2);
  }
}), To = P({
  metadata: {
    id: "shine-twinkle",
    displayName: "Shine Twinkle",
    description: "A constellation of tiny cross-shaped stars that twinkle softly in place.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = Math.min(n, h), u = Array.from({ length: 14 }, () => ({
      sx: r + n * (0.06 + t() * 0.88),
      sy: c + h * (0.06 + t() * 0.88),
      size: f * (0.03 + t() * 0.05),
      phase: t() * Math.PI * 2,
      rate: 1 + Math.floor(t() * 3),
      tone: Math.floor(t() * 3)
    }));
    a.globalCompositeOperation = "lighter";
    for (const d of u) {
      const p = 0.5 + 0.5 * Math.sin(s * Math.PI * 2 * d.rate + d.phase), b = p * p * i.intensity;
      if (b <= 0.02)
        continue;
      const m = d.size * (0.6 + 0.5 * p), g = Math.max(0.7, m * 0.18 * l);
      a.fillStyle = e.alpha(0.9 * b, d.tone), a.beginPath(), a.moveTo(d.sx, d.sy - m), a.lineTo(d.sx + g, d.sy), a.lineTo(d.sx, d.sy + m), a.lineTo(d.sx - g, d.sy), a.closePath(), a.fill(), a.beginPath(), a.moveTo(d.sx - m, d.sy), a.lineTo(d.sx, d.sy + g), a.lineTo(d.sx + m, d.sy), a.lineTo(d.sx, d.sy - g), a.closePath(), a.fill();
      const y = a.createRadialGradient(d.sx, d.sy, 0, d.sx, d.sy, m * 1.4);
      y.addColorStop(0, e.alpha(0.4 * b, 0)), y.addColorStop(1, e.alpha(0, 0)), a.fillStyle = y;
      const w = m * 1.4;
      a.fillRect(d.sx - w, d.sy - w, w * 2, w * 2);
    }
  }
}), No = P({
  metadata: {
    id: "shine-gem",
    displayName: "Shine Gem",
    description: "Faceted gemstone shimmer with triangular internal faces that catch and release the light.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = Math.min(c, n) * 0.46, d = 8, p = Array.from({ length: d }, (g, y) => {
      const w = y / d * Math.PI * 2 + t() * 0.5, S = u * (0.7 + t() * 0.3);
      return { px: h + Math.cos(w) * S, py: f + Math.sin(w) * S };
    }), b = Array.from({ length: d }, (g, y) => ({
      a: p[y],
      b: p[(y + 1) % d],
      phase: t() * Math.PI * 2,
      rate: 1 + Math.floor(t() * 2),
      tone: Math.floor(t() * 3)
    }));
    a.globalCompositeOperation = "lighter";
    for (const g of b) {
      const y = 0.5 + 0.5 * Math.sin(s * Math.PI * 2 * g.rate + g.phase), w = (0.08 + y * 0.3) * i.intensity;
      a.beginPath(), a.moveTo(h, f), a.lineTo(g.a.px, g.a.py), a.lineTo(g.b.px, g.b.py), a.closePath(), a.fillStyle = e.alpha(w, g.tone), a.fill();
      const S = Math.pow(y, 6);
      S > 0.05 && (a.fillStyle = e.alpha(S * 0.55 * i.intensity, 0), a.fill());
    }
    const m = a.createRadialGradient(h, f, 0, h, f, u * 0.5);
    m.addColorStop(0, e.alpha(0.5 * i.intensity, 0)), m.addColorStop(0.6, e.alpha(0.16 * i.intensity, 2)), m.addColorStop(1, e.alpha(0, 2)), a.fillStyle = m, a.fillRect(h - u, f - u, u * 2, u * 2);
  }
}), Bo = P({
  metadata: {
    id: "shine-metal",
    displayName: "Shine Metal",
    description: "A brushed-metal specular band that passes across, lighting up fine anisotropic streaks.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.hypot(n, h), p = d / 2, b = d * 0.2, m = -p - b + (d + b * 2) * F(s), g = Array.from({ length: 10 }, () => ({
      offset: (t() - 0.5) * d * 0.9,
      thickness: Math.max(0.8, (0.6 + t() * 1.2) * l),
      tone: Math.floor(t() * 3)
    }));
    a.globalCompositeOperation = "lighter", a.translate(f, u), a.rotate(-Math.PI / 12);
    const y = a.createLinearGradient(m - b, 0, m + b, 0);
    y.addColorStop(0, e.alpha(0, 1)), y.addColorStop(0.42, e.alpha(0.28 * i.intensity, 1)), y.addColorStop(0.5, e.alpha(0.6 * i.intensity, 0)), y.addColorStop(0.58, e.alpha(0.28 * i.intensity, 2)), y.addColorStop(1, e.alpha(0, 2)), a.fillStyle = y, a.fillRect(-p - b, -p, (p + b) * 2, d);
    for (const w of g) {
      const S = Math.max(0, 1 - Math.abs(w.offset - m) / (b * 2.2)), x = S * S * 0.5 * i.intensity;
      if (x <= 0.02)
        continue;
      const v = a.createLinearGradient(w.offset - b, 0, w.offset + b, 0);
      v.addColorStop(0, e.alpha(0, w.tone)), v.addColorStop(0.5, e.alpha(x, w.tone)), v.addColorStop(1, e.alpha(0, w.tone)), a.fillStyle = v, a.fillRect(w.offset - b, -p, b * 2, d), a.fillStyle = e.alpha(x * 0.8, 0), a.fillRect(w.offset - b * 0.6, -w.thickness / 2, b * 1.2, w.thickness);
    }
  }
}), Lo = P({
  metadata: {
    id: "shine-rainbow",
    displayName: "Shine Rainbow",
    description: "A prismatic band of spectral hues that sweeps across the target like light through a prism.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"]
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = Math.hypot(r, c), u = f / 2, d = f * 0.34, p = -u - d + (f + d * 2) * F(a), b = a * 90;
    e.globalCompositeOperation = "lighter", e.translate(n, h), e.rotate(-Math.PI / 7);
    const m = e.createLinearGradient(p - d, 0, p + d, 0), g = 7;
    for (let w = 0; w <= g; w += 1) {
      const S = w / g, x = (b + S * 300) % 360, v = Math.sin(Math.PI * S);
      m.addColorStop(S, `hsla(${x},100%,62%,${(0.4 * v * s.intensity).toFixed(3)})`);
    }
    e.fillStyle = m, e.fillRect(-u - d, -u, (u + d) * 2, f);
    const y = e.createLinearGradient(p - d * 0.18, 0, p + d * 0.18, 0);
    y.addColorStop(0, t.alpha(0, 0)), y.addColorStop(0.5, t.alpha(0.5 * s.intensity, 0)), y.addColorStop(1, t.alpha(0, 0)), e.fillStyle = y, e.fillRect(-u - d, -u, (u + d) * 2, f);
  }
}), Ho = P({
  metadata: {
    id: "laser-line",
    displayName: "Laser Line",
    description: "A crisp horizontal laser that draws itself across the target and flares out at the tip.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = r + n / 2, f = l + c * N(I(a * 1.5)), u = 1 - U(I((a - 0.65) / 0.35)), d = 0.85 + 0.15 * Math.sin(a * 34), p = u * d * s.intensity;
    e.globalCompositeOperation = "lighter", e.lineCap = "round";
    const b = [
      [11 * i, t.alpha(0.16 * p, 1)],
      [4.5 * i, t.alpha(0.42 * p, 0)],
      [1.5 * i, t.alpha(0.95 * p, 2)]
    ];
    for (const [m, g] of b)
      e.lineWidth = m, e.strokeStyle = g, e.beginPath(), e.moveTo(l, h), e.lineTo(f, h), e.stroke();
    e.fillStyle = t.alpha(0.9 * p, 2), e.beginPath(), e.arc(f, h, 2.5 * i, 0, Math.PI * 2), e.fill();
  }
}), Oo = P({
  metadata: {
    id: "laser-beam",
    displayName: "Laser Beam",
    description: "A sustained full-width energy beam that snaps on, shimmers with a hot core, and powers down.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = r + n / 2, f = N(I(a * 3)), u = 1 - U(I((a - 0.7) / 0.3)), d = 0.9 + 0.1 * Math.sin(a * 52), p = f * u * d * s.intensity, b = Math.max(4 * i, n * 0.3 * f);
    e.globalCompositeOperation = "lighter";
    const m = e.createLinearGradient(l, h - b, l, h + b);
    m.addColorStop(0, t.alpha(0, 1)), m.addColorStop(0.5, t.alpha(0.34 * p, 0)), m.addColorStop(1, t.alpha(0, 1)), e.fillStyle = m, e.fillRect(l, h - b, c, b * 2), e.lineCap = "round";
    const g = [
      [9 * i * (0.5 + 0.5 * f), t.alpha(0.3 * p, 1)],
      [4 * i * (0.5 + 0.5 * f), t.alpha(0.55 * p, 0)],
      [1.8 * i, t.alpha(p, 2)]
    ];
    for (const [y, w] of g)
      e.lineWidth = y, e.strokeStyle = w, e.beginPath(), e.moveTo(l, h), e.lineTo(l + c, h), e.stroke();
  }
}), Go = P({
  metadata: {
    id: "laser-scan",
    displayName: "Laser Scan",
    description: "A bright horizontal scan line that sweeps from top to bottom trailing a soft afterglow.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = r + n * F(a), f = Math.min(1, a * 10, (1 - a) * 10) * s.intensity, u = Math.max(6 * i, n * 0.28);
    e.globalCompositeOperation = "lighter";
    const d = e.createLinearGradient(l, h - u, l, h);
    d.addColorStop(0, t.alpha(0, 1)), d.addColorStop(1, t.alpha(0.22 * f, 0)), e.fillStyle = d, e.fillRect(l, h - u, c, u), e.lineCap = "round";
    const p = [
      [10 * i, t.alpha(0.18 * f, 1)],
      [4 * i, t.alpha(0.45 * f, 0)],
      [1.5 * i, t.alpha(0.95 * f, 2)]
    ];
    for (const [b, m] of p)
      e.lineWidth = b, e.strokeStyle = m, e.beginPath(), e.moveTo(l, h), e.lineTo(l + c, h), e.stroke();
  }
}), _o = P({
  metadata: {
    id: "laser-grid",
    displayName: "Laser Grid",
    description: "A neon grid of horizontal and vertical laser lines that pulse with staggered phases.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = 4, u = 3, d = s * Math.PI * 2;
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    const p = (m, g, y, w, S) => {
      const x = [
        [7 * l, e.alpha(0.14 * S, 1)],
        [1.2 * l, e.alpha(0.85 * S, 0)]
      ];
      for (const [v, M] of x)
        a.lineWidth = v, a.strokeStyle = M, a.beginPath(), a.moveTo(m, g), a.lineTo(y, w), a.stroke();
    };
    for (let m = 0; m <= f + 1; m++) {
      const g = t() * Math.PI * 2, y = (0.35 + 0.35 * Math.sin(d + g)) * i.intensity, w = r + n * m / (f + 1);
      p(w, c, w, c + h, y);
    }
    for (let m = 0; m <= u + 1; m++) {
      const g = t() * Math.PI * 2, y = (0.35 + 0.35 * Math.sin(d + g)) * i.intensity, w = c + h * m / (u + 1);
      p(r, w, r + n, w, y);
    }
    const b = (0.3 + 0.2 * Math.sin(d)) * i.intensity;
    a.fillStyle = e.alpha(b, 2);
    for (let m = 1; m <= f; m++)
      for (let g = 1; g <= u; g++)
        a.beginPath(), a.arc(r + n * m / (f + 1), c + h * g / (u + 1), 1.6 * l, 0, Math.PI * 2), a.fill();
  }
}), $o = P({
  metadata: {
    id: "laser-crosshair",
    displayName: "Laser Crosshair",
    description: "Full-span horizontal and vertical laser lines that home in on the centre and lock with a flash.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = (t() - 0.5) * n * 0.7, p = (t() - 0.5) * h * 0.7, b = N(I(s * 1.4)), m = f + d * (1 - b), g = u + p * (1 - b), w = (1 - U(I((s - 0.78) / 0.22))) * i.intensity;
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    const S = [
      [8 * l, e.alpha(0.16 * w, 1)],
      [3 * l, e.alpha(0.4 * w, 0)],
      [1.2 * l, e.alpha(0.9 * w, 2)]
    ];
    for (const [M, k] of S)
      a.lineWidth = M, a.strokeStyle = k, a.beginPath(), a.moveTo(r, g), a.lineTo(r + n, g), a.moveTo(m, c), a.lineTo(m, c + h), a.stroke();
    const x = Math.min(n, h) * (0.32 - 0.22 * b);
    a.lineWidth = 1.5 * l, a.strokeStyle = e.alpha(0.75 * w, 0), a.beginPath(), a.arc(m, g, Math.max(2 * l, x), 0, Math.PI * 2), a.stroke();
    const v = I((s - 0.55) / 0.15);
    if (v > 0) {
      const M = a.createRadialGradient(m, g, 0, m, g, x * 2.2);
      M.addColorStop(0, e.alpha(0.7 * v * w, 2)), M.addColorStop(1, e.alpha(0, 0)), a.fillStyle = M, a.fillRect(r, c, n, h);
    }
  }
}), Wo = P({
  metadata: {
    id: "laser-burst",
    displayName: "Laser Burst",
    description: "A radial volley of laser bolts firing outward from the centre with a bright ignition flash.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.62, p = Array.from({ length: 10 }, (g, y) => ({
      angle: y / 10 * Math.PI * 2 + (t() - 0.5) * 0.5,
      reach: 0.7 + t() * 0.3,
      tone: t()
    })), b = 1 - U(s);
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    const m = 1 - N(Math.min(1, s * 3));
    if (m > 0.01) {
      const g = a.createRadialGradient(f, u, 0, f, u, d * 0.4);
      g.addColorStop(0, e.alpha(0.85 * m * i.intensity, 2)), g.addColorStop(1, e.alpha(0, 0)), a.fillStyle = g, a.fillRect(r, c, n, h);
    }
    for (const g of p) {
      const y = d * g.reach * N(s), w = d * g.reach * U(s), S = b * (0.6 + 0.4 * g.tone) * i.intensity;
      if (S <= 0.01 || y - w < 1)
        continue;
      const x = Math.cos(g.angle), v = Math.sin(g.angle), M = [
        [6 * l, e.alpha(0.2 * S, 1)],
        [1.4 * l, e.alpha(0.9 * S, g.tone > 0.6 ? 2 : 0)]
      ];
      for (const [k, C] of M)
        a.lineWidth = k, a.strokeStyle = C, a.beginPath(), a.moveTo(f + x * w, u + v * w), a.lineTo(f + x * y, u + v * y), a.stroke();
    }
  }
}), qo = P({
  metadata: {
    id: "laser-fan",
    displayName: "Laser Fan",
    description: "A club-style fan of beams that spreads open from a bottom pivot and sweeps side to side.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h, d = Math.hypot(n, h), p = 6, b = 1.7 * N(I(s * 2.2)), m = (F(s) * 2 - 1) * 0.45, g = Math.min(1, s * 6, (1 - s) * 4) * i.intensity;
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    for (let w = 0; w < p; w++) {
      const S = (t() - 0.5) * 0.06, x = -Math.PI / 2 + (w / (p - 1) - 0.5) * b + m + S, v = f + Math.cos(x) * d, M = u + Math.sin(x) * d, k = [
        [8 * l, e.alpha(0.14 * g, 1)],
        [3 * l, e.alpha(0.32 * g, 0)],
        [1.2 * l, e.alpha(0.85 * g, 2)]
      ];
      for (const [C, R] of k)
        a.lineWidth = C, a.strokeStyle = R, a.beginPath(), a.moveTo(f, u), a.lineTo(v, M), a.stroke();
    }
    const y = a.createRadialGradient(f, u, 0, f, u, d * 0.2);
    y.addColorStop(0, e.alpha(0.5 * g, 2)), y.addColorStop(1, e.alpha(0, 0)), a.fillStyle = y, a.fillRect(r, c, n, h);
  }
}), zo = P({
  metadata: {
    id: "laser-ring",
    displayName: "Laser Ring",
    description: "Concentric neon shockwave rings that expand from the centre and dissolve at the edges.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = Math.hypot(c, n) / 2;
    e.globalCompositeOperation = "lighter";
    const d = 1 - N(Math.min(1, a * 2.6));
    if (d > 0.01) {
      const p = e.createRadialGradient(h, f, 0, h, f, u * 0.35);
      p.addColorStop(0, t.alpha(0.7 * d * s.intensity, 2)), p.addColorStop(1, t.alpha(0, 0)), e.fillStyle = p, e.fillRect(l, r, c, n);
    }
    for (const p of [0, 0.28]) {
      const b = I((a - p) / (1 - p));
      if (b <= 0)
        continue;
      const m = Math.max(1, u * N(b)), g = (1 - b) * (1 - b) * s.intensity, y = [
        [10 * i, t.alpha(0.18 * g, 1)],
        [4 * i, t.alpha(0.4 * g, 0)],
        [1.5 * i, t.alpha(0.95 * g, 2)]
      ];
      for (const [w, S] of y)
        e.lineWidth = w, e.strokeStyle = S, e.beginPath(), e.arc(h, f, m, 0, Math.PI * 2), e.stroke();
    }
  }
}), ie = (o) => {
  const t = o - Math.floor(o);
  return 1 - Math.abs(2 * t - 1);
}, Uo = P({
  metadata: {
    id: "laser-bounce",
    displayName: "Laser Bounce",
    description: "A laser bolt that ricochets off the target edges, dragging a fading light trail behind it.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = 4 * i, f = (w) => [
      l + h + (c - h * 2) * ie(w * 2.3 + 0.15),
      r + h + (n - h * 2) * ie(w * 3.1)
    ], u = Math.min(1, a * 8, (1 - a) * 6) * s.intensity;
    e.globalCompositeOperation = "lighter", e.lineCap = "round", e.lineJoin = "round";
    const d = 9, p = 0.08, b = [
      [8 * i, t.alpha(0.16 * u, 1)],
      [3 * i, t.alpha(0.38 * u, 0)],
      [1.4 * i, t.alpha(0.9 * u, 2)]
    ];
    for (const [w, S] of b) {
      e.lineWidth = w, e.strokeStyle = S, e.beginPath();
      for (let x = 0; x <= d; x++) {
        const v = Math.max(0, a - p + p * x / d), [M, k] = f(v);
        x === 0 ? e.moveTo(M, k) : e.lineTo(M, k);
      }
      e.stroke();
    }
    const [m, g] = f(a), y = e.createRadialGradient(m, g, 0, m, g, 10 * i * (0.6 + 0.4 * N(u)));
    y.addColorStop(0, t.alpha(0.9 * u, 2)), y.addColorStop(1, t.alpha(0, 0)), e.fillStyle = y, e.fillRect(l, r, c, n);
  }
}), Fo = P({
  metadata: {
    id: "laser-target",
    displayName: "Laser Target",
    description: "A rotating lock-on reticle that spins in, tightens onto the centre, and flashes on lock.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = N(I(a * 1.4)), d = Math.min(c, n) * (0.46 - 0.24 * u), p = (1 - u) * Math.PI * 1.5, b = 1 - U(I((a - 0.85) / 0.15)), m = Math.min(1, a * 8) * b * s.intensity;
    e.globalCompositeOperation = "lighter", e.lineCap = "round";
    const g = 4, y = 0.9, w = [
      [7 * i, t.alpha(0.18 * m, 1)],
      [1.6 * i, t.alpha(0.9 * m, 0)]
    ];
    for (const [x, v] of w) {
      e.lineWidth = x, e.strokeStyle = v;
      for (let M = 0; M < g; M++) {
        const k = p + M / g * Math.PI * 2;
        e.beginPath(), e.arc(h, f, d, k, k + y), e.stroke();
      }
    }
    e.lineWidth = 1.2 * i, e.strokeStyle = t.alpha(0.7 * m, 2);
    for (let x = 0; x < 4; x++) {
      const v = p * 0.5 + x / 4 * Math.PI * 2;
      e.beginPath(), e.moveTo(h + Math.cos(v) * d * 0.55, f + Math.sin(v) * d * 0.55), e.lineTo(h + Math.cos(v) * d * 0.8, f + Math.sin(v) * d * 0.8), e.stroke();
    }
    const S = Dt(I((a - 0.65) / 0.3)) * b;
    if (S > 0.01) {
      const x = e.createRadialGradient(h, f, 0, h, f, d * 1.4);
      x.addColorStop(0, t.alpha(0.8 * S * s.intensity, 2)), x.addColorStop(1, t.alpha(0, 0)), e.fillStyle = x, e.fillRect(l, r, c, n);
    }
  }
}), Do = P({
  metadata: {
    id: "laser-chase",
    displayName: "Laser Chase",
    description: "Glowing laser dashes that chase each other endlessly around the target's perimeter.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = 2 * (c + n), f = (m) => {
      let g = (m % 1 + 1) % 1 * h;
      return g < c ? [l + g, r] : (g -= c, g < n ? [l + c, r + g] : (g -= n, g < c ? [l + c - g, r + n] : (g -= c, [l, r + n - g])));
    }, u = 3, d = 0.12, p = 10, b = s.intensity;
    e.globalCompositeOperation = "lighter", e.lineCap = "round", e.lineJoin = "round";
    for (let m = 0; m < u; m++) {
      const g = a + m / u, y = [
        [8 * i, t.alpha(0.16 * b, 1)],
        [3 * i, t.alpha(0.4 * b, 0)],
        [1.4 * i, t.alpha(0.9 * b, 2)]
      ];
      for (const [x, v] of y) {
        e.lineWidth = x, e.strokeStyle = v, e.beginPath();
        for (let M = 0; M <= p; M++) {
          const [k, C] = f(g - d + d * M / p);
          M === 0 ? e.moveTo(k, C) : e.lineTo(k, C);
        }
        e.stroke();
      }
      const [w, S] = f(g);
      e.fillStyle = t.alpha(0.9 * b, 2), e.beginPath(), e.arc(w, S, 2.4 * i, 0, Math.PI * 2), e.fill();
    }
  }
}), Xo = P({
  metadata: {
    id: "laser-vortex",
    displayName: "Laser Vortex",
    description: "Spiralling laser arms that rotate around the centre while converging into a glowing core.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"]
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = Math.hypot(c, n) / 2, d = 6, p = a * Math.PI * 2, b = 2.4, m = 28, g = s.intensity;
    e.globalCompositeOperation = "lighter", e.lineCap = "round", e.lineJoin = "round";
    const y = e.createRadialGradient(h, f, 0, h, f, u * 0.52);
    y.addColorStop(0, t.alpha(0.16 * g, 2)), y.addColorStop(0.32, t.alpha(0.09 * g, 0)), y.addColorStop(1, t.alpha(0, 1)), e.fillStyle = y, e.fillRect(l, r, c, n);
    for (let x = 0; x < d; x++) {
      const v = p + x / d * Math.PI * 2, M = [
        [11 * i, t.alpha(0.08 * g, 1), 9 * i],
        [3.2 * i, t.alpha(0.42 * g, 0), 4 * i],
        [1.1 * i, t.alpha(0.95 * g, 2), 1.5 * i]
      ];
      for (const [k, C, R] of M) {
        e.lineWidth = k, e.strokeStyle = C, e.shadowBlur = R, e.shadowColor = t.alpha(0.8 * g, 0), e.beginPath();
        for (let E = 0; E <= m; E++) {
          const T = E / m, A = v + T * b, L = u * (1 - T * 0.92), B = h + Math.cos(A) * L, _ = f + Math.sin(A) * L;
          E === 0 ? e.moveTo(B, _) : e.lineTo(B, _);
        }
        e.stroke();
      }
    }
    e.shadowBlur = 0;
    const w = (0.45 + 0.25 * Math.sin(a * Math.PI * 4)) * g, S = e.createRadialGradient(h, f, 0, h, f, u * 0.22);
    S.addColorStop(0, t.alpha(w, 2)), S.addColorStop(1, t.alpha(0, 0)), e.fillStyle = S, e.fillRect(l, r, c, n), e.strokeStyle = t.alpha(0.65 * g, 2), e.lineWidth = 1.2 * i, e.beginPath(), e.arc(h, f, u * (0.075 + 0.012 * Math.sin(a * Math.PI * 4)), 0, Math.PI * 2), e.stroke();
  }
}), Yo = P({
  metadata: {
    id: "symbol-win-pulse",
    displayName: "Symbol Win Pulse",
    description: "Rhythmic golden pulse rings radiating from the symbol centre with twinkling corner sparkles.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.62, p = s * Math.PI * 2;
    a.globalCompositeOperation = "lighter";
    const b = 0.5 + 0.5 * Math.sin(p - Math.PI / 2), m = a.createRadialGradient(f, u, 0, f, u, d);
    m.addColorStop(0, e.alpha(0.3 * b * i.intensity, 1)), m.addColorStop(0.6, e.alpha(0.16 * b * i.intensity, 0)), m.addColorStop(1, e.alpha(0)), a.fillStyle = m, a.fillRect(r - d * 0.2, c - d * 0.2, n + d * 0.4, h + d * 0.4);
    for (let y = 0; y < 2; y += 1) {
      const w = (s + y * 0.5) % 1, S = N(w), x = (1 - S) * 0.75 * i.intensity;
      x <= 0.02 || (a.strokeStyle = e.alpha(x, y), a.lineWidth = (3.2 - S * 2.2) * l, a.beginPath(), a.arc(f, u, d * (0.34 + S * 0.6), 0, Math.PI * 2), a.stroke());
    }
    const g = [
      [r + n * 0.1, c + h * 0.1],
      [r + n * 0.9, c + h * 0.1],
      [r + n * 0.9, c + h * 0.9],
      [r + n * 0.1, c + h * 0.9]
    ];
    a.lineCap = "round";
    for (const [y, w] of g) {
      const S = t() * Math.PI * 2, x = 0.5 + 0.5 * Math.sin(p * 2 + S), v = (2.5 + x * 4) * l, M = (0.25 + 0.75 * x) * i.intensity;
      a.strokeStyle = e.alpha(M, 1), a.lineWidth = 1.4 * l, a.beginPath(), a.moveTo(y - v, w), a.lineTo(y + v, w), a.moveTo(y, w - v), a.lineTo(y, w + v), a.stroke();
    }
  }
}), jo = P({
  metadata: {
    id: "symbol-pop",
    displayName: "Symbol Pop",
    description: "A snappy overshooting burst ring and bright central flash that pops outward and dissolves into sparkles.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.58, p = I(1 - s);
    a.globalCompositeOperation = "lighter";
    const b = I(1 - s * 2.2);
    if (b > 0) {
      const y = a.createRadialGradient(f, u, 0, f, u, d * 0.7);
      y.addColorStop(0, e.alpha(0.9 * b * i.intensity, 1)), y.addColorStop(1, e.alpha(0)), a.fillStyle = y, a.fillRect(r, c, n, h);
    }
    const m = kt(I(s * 1.4)), g = Math.max(1, d * 0.28 + d * 0.62 * m);
    a.strokeStyle = e.alpha(0.8 * p * i.intensity, 0), a.lineWidth = Math.max(0.8, (4 - s * 3) * l), a.beginPath(), a.arc(f, u, g, 0, Math.PI * 2), a.stroke(), a.strokeStyle = e.alpha(0.45 * p * i.intensity, 2), a.lineWidth = 1.2 * l, a.beginPath(), a.arc(f, u, g * 0.82, 0, Math.PI * 2), a.stroke();
    for (let y = 0; y < 10; y += 1) {
      const w = t() * Math.PI * 2, S = 0.55 + t() * 0.45, x = 1.2 + t() * 2, v = t() > 0.6 ? 2 : 0, M = N(s) * S, k = f + Math.cos(w) * d * M, C = u + Math.sin(w) * d * M, R = p * 0.8 * i.intensity;
      R <= 0.02 || (a.fillStyle = e.alpha(R, v), a.beginPath(), a.arc(k, C, Math.max(0.6, x * (1 - s * 0.5) * l), 0, Math.PI * 2), a.fill());
    }
  }
}), Vo = P({
  metadata: {
    id: "symbol-bounce",
    displayName: "Symbol Bounce",
    description: "Outline ghosts hop along a damped bounce arc while a squash highlight flashes at each landing.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = 1 - a, f = Math.abs(Math.sin(a * Math.PI * 3)), u = Math.min(c, n) * 0.12;
    e.globalCompositeOperation = "lighter", e.lineJoin = "round";
    for (let p = 2; p >= 0; p -= 1) {
      const b = I(a - p * 0.045), m = Math.abs(Math.sin(b * Math.PI * 3)) * n * 0.22 * (1 - b), g = (p === 0 ? 0.75 : 0.28 / p) * h * s.intensity;
      g <= 0.02 || (e.strokeStyle = t.alpha(g, p === 0 ? 0 : 1), e.lineWidth = (p === 0 ? 2.4 : 1.4) * i, e.beginPath(), e.roundRect(l + 2 * i, r - m + 2 * i, c - 4 * i, n - 4 * i, u), e.stroke());
    }
    const d = I(1 - f * 3) * h;
    if (d > 0.02) {
      const p = e.createLinearGradient(l, r + n * 0.7, l, r + n);
      p.addColorStop(0, t.alpha(0)), p.addColorStop(1, t.alpha(0.55 * d * s.intensity, 1)), e.fillStyle = p, e.fillRect(l, r + n * 0.7, c, n * 0.3), e.strokeStyle = t.alpha(0.6 * d * s.intensity, 2), e.lineWidth = 2 * i, e.beginPath(), e.ellipse(l + c / 2, r + n - 2 * i, c * (0.3 + d * 0.18), 3 * i, 0, 0, Math.PI * 2), e.stroke();
    }
  }
}), Jo = P({
  metadata: {
    id: "symbol-shake",
    displayName: "Symbol Shake",
    description: "Rapid side-to-side outline echoes with directional glow smears that rattle the cell and settle.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = Math.pow(1 - s, 1.4), u = n * 0.09 * f * i.intensity, d = Math.min(n, h) * 0.12, p = (w, S) => Math.sin(w * Math.PI * 14 + S) * u, b = t() * Math.PI * 2;
    a.globalCompositeOperation = "lighter", a.lineJoin = "round";
    for (let w = 2; w >= 0; w -= 1) {
      const S = I(s - w * 0.03), x = p(S, b), v = (w === 0 ? 0.8 : 0.26 / w) * f * i.intensity;
      v <= 0.02 || (a.strokeStyle = e.alpha(v, w === 0 ? 0 : 2), a.lineWidth = (w === 0 ? 2.4 : 1.4) * l, a.beginPath(), a.roundRect(r + x + 2 * l, c + 2 * l, n - 4 * l, h - 4 * l, d), a.stroke());
    }
    const m = Math.abs(p(s, b)) / Math.max(1, n * 0.09), g = p(s, b) > 0 ? 1 : -1, y = a.createLinearGradient(r + n / 2, c, r + n / 2 + g * n * 0.5, c);
    y.addColorStop(0, e.alpha(0)), y.addColorStop(1, e.alpha(0.3 * m * f * i.intensity, 1)), a.fillStyle = y, a.fillRect(g > 0 ? r + n / 2 : r, c + h * 0.1, n / 2, h * 0.8);
  }
}), Zo = P({
  metadata: {
    id: "symbol-spin",
    displayName: "Symbol Spin",
    description: "A vertical-axis spin illusion: the outline narrows edge-on with horizontal glow smears and an edge flash.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = F(a) * Math.PI * 2, d = Math.abs(Math.cos(u)), p = s.loop ? 1 : I((1 - a) * 6), b = Math.min(c, n) * 0.12;
    e.globalCompositeOperation = "lighter", e.lineJoin = "round";
    for (let w = 2; w >= 0; w -= 1) {
      const S = u - w * 0.35, x = Math.abs(Math.cos(S)), v = Math.max(2 * i, (c / 2 - 3 * i) * x), M = (w === 0 ? 0.8 : 0.24 / w) * p * s.intensity;
      M <= 0.02 || (e.strokeStyle = t.alpha(M, w === 0 ? 0 : 2), e.lineWidth = (w === 0 ? 2.4 : 1.4) * i, e.beginPath(), e.roundRect(h - v, r + 3 * i, v * 2, n - 6 * i, b * x + 1), e.stroke());
    }
    const m = e.createLinearGradient(l, f, l + c, f), g = 0.35 * (1 - d) * p * s.intensity;
    m.addColorStop(0, t.alpha(0)), m.addColorStop(0.5, t.alpha(g, 1)), m.addColorStop(1, t.alpha(0)), e.fillStyle = m, e.fillRect(l, r + n * 0.12, c, n * 0.76);
    const y = I(1 - d * 4) * p;
    y > 0.02 && (e.fillStyle = t.alpha(0.8 * y * s.intensity, 1), e.fillRect(h - 1.5 * i, r + n * 0.08, 3 * i, n * 0.84));
  }
}), Qo = P({
  metadata: {
    id: "symbol-flip",
    displayName: "Symbol Flip",
    description: "A card-flip illusion: the outline collapses about its horizontal axis with a sweeping glint and mid-flip flash.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = r + n / 2, f = F(a) * Math.PI, u = Math.abs(Math.cos(f)), d = s.loop ? 1 : I((1 - a) * 5), p = Math.min(c, n) * 0.12;
    e.globalCompositeOperation = "lighter", e.lineJoin = "round";
    for (let y = 2; y >= 0; y -= 1) {
      const w = Math.abs(Math.cos(f - y * 0.3)), S = Math.max(2 * i, (n / 2 - 3 * i) * w), x = (y === 0 ? 0.8 : 0.24 / y) * d * s.intensity;
      x <= 0.02 || (e.strokeStyle = t.alpha(x, y === 0 ? 0 : 2), e.lineWidth = (y === 0 ? 2.4 : 1.4) * i, e.beginPath(), e.roundRect(l + 3 * i, h - S, c - 6 * i, S * 2, p * w + 1), e.stroke());
    }
    const b = r + F(a) * n, m = e.createLinearGradient(l, b - n * 0.14, l, b + n * 0.14);
    m.addColorStop(0, t.alpha(0)), m.addColorStop(0.5, t.alpha(0.4 * d * s.intensity, 1)), m.addColorStop(1, t.alpha(0)), e.fillStyle = m, e.fillRect(l + c * 0.06, b - n * 0.14, c * 0.88, n * 0.28);
    const g = I(1 - u * 4) * d;
    g > 0.02 && (e.fillStyle = t.alpha(0.85 * g * s.intensity, 1), e.fillRect(l + c * 0.08, h - 1.5 * i, c * 0.84, 3 * i));
  }
}), Ko = P({
  metadata: {
    id: "symbol-glow",
    displayName: "Symbol Glow",
    description: "A soft golden aura that breathes around the symbol with a warm inner halo.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = Math.max(c, n) * 0.7, d = 0.5 + 0.5 * Math.sin(a * Math.PI * 2 - Math.PI / 2), p = (0.55 + 0.45 * d) * s.intensity;
    e.globalCompositeOperation = "lighter";
    const b = e.createRadialGradient(h, f, 0, h, f, u * (0.85 + d * 0.15));
    b.addColorStop(0, t.alpha(0.42 * p, 1)), b.addColorStop(0.45, t.alpha(0.26 * p, 0)), b.addColorStop(1, t.alpha(0)), e.fillStyle = b, e.fillRect(l - u * 0.3, r - u * 0.3, c + u * 0.6, n + u * 0.6);
    const m = Math.min(c, n) * 0.14;
    e.strokeStyle = t.alpha(0.35 * p, 0), e.lineWidth = (2 + d * 2) * i, e.lineJoin = "round", e.beginPath(), e.roundRect(l + 3 * i, r + 3 * i, c - 6 * i, n - 6 * i, m), e.stroke();
  }
}), ts = P({
  metadata: {
    id: "symbol-outline",
    displayName: "Symbol Outline",
    description: "A glowing rounded outline with a bright comet highlight that travels around the cell perimeter.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = 3 * i, f = l + h, u = r + h, d = c - h * 2, p = n - h * 2, b = Math.min(d, p) * 0.14, m = 2 * (d + p);
    e.globalCompositeOperation = "lighter", e.lineJoin = "round", e.lineCap = "round", e.strokeStyle = t.alpha(0.28 * s.intensity, 0), e.lineWidth = 5 * i, e.beginPath(), e.roundRect(f, u, d, p, b), e.stroke(), e.strokeStyle = t.alpha(0.55 * s.intensity, 0), e.lineWidth = 2 * i, e.stroke();
    const g = m * 0.18, y = 14;
    e.setLineDash([m / y / 3, m]);
    for (let w = 0; w < y; w += 1) {
      const S = w / y * g, x = w / y;
      e.lineDashOffset = -(a * m - S), e.strokeStyle = t.alpha(0.85 * (1 - x) * s.intensity, 1), e.lineWidth = (3.4 - x * 2.2) * i, e.beginPath(), e.roundRect(f, u, d, p, b), e.stroke();
    }
    e.setLineDash([]), e.lineDashOffset = 0;
  }
}), es = P({
  metadata: {
    id: "symbol-explode",
    displayName: "Symbol Explode",
    description: "The cell shatters into spinning shards flung outward behind a shockwave ring and hot central flash.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.75, p = I(1 - s);
    a.globalCompositeOperation = "lighter";
    const b = I(1 - s * 3);
    if (b > 0) {
      const g = a.createRadialGradient(f, u, 0, f, u, d * 0.6);
      g.addColorStop(0, e.alpha(0.95 * b * i.intensity, 1)), g.addColorStop(1, e.alpha(0)), a.fillStyle = g, a.fillRect(r - d * 0.2, c - d * 0.2, n + d * 0.4, h + d * 0.4);
    }
    const m = N(I(s * 1.6));
    a.strokeStyle = e.alpha(0.6 * (1 - m) * i.intensity, 2), a.lineWidth = Math.max(1, (5 - m * 4) * l), a.beginPath(), a.arc(f, u, Math.max(1, d * m), 0, Math.PI * 2), a.stroke();
    for (let g = 0; g < 16; g += 1) {
      const y = t() * Math.PI * 2, w = 0.5 + t() * 0.5, S = (4 + t() * 7) * l, x = (t() - 0.5) * 9, v = g % 3, M = N(s) * w, k = f + Math.cos(y) * d * M, C = u + Math.sin(y) * d * M + s * s * h * 0.22, R = p * (0.55 + 0.35 * t()) * i.intensity;
      if (R <= 0.02)
        continue;
      const E = y + s * x, T = S * (1 - s * 0.45);
      a.fillStyle = e.alpha(R, v), a.beginPath(), a.moveTo(k + Math.cos(E) * T, C + Math.sin(E) * T), a.lineTo(k + Math.cos(E + 2.3) * T * 0.6, C + Math.sin(E + 2.3) * T * 0.6), a.lineTo(k + Math.cos(E + 4.2) * T * 0.8, C + Math.sin(E + 4.2) * T * 0.8), a.closePath(), a.fill();
    }
  }
}), as = P({
  metadata: {
    id: "symbol-particle-burst",
    displayName: "Symbol Particle Burst",
    description: "A dense fountain of golden and cyan particles that erupts from the centre, arcs under gravity, and twinkles out.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.7, p = I(1 - s);
    a.globalCompositeOperation = "lighter";
    const b = a.createRadialGradient(f, u, 0, f, u, d * 0.5);
    b.addColorStop(0, e.alpha(0.5 * I(1 - s * 1.8) * i.intensity, 1)), b.addColorStop(1, e.alpha(0)), a.fillStyle = b, a.fillRect(r, c, n, h);
    for (let m = 0; m < 34; m += 1) {
      const g = t() * Math.PI * 2, y = 0.35 + t() * 0.65, w = 1 + t() * 2.6, S = t() * Math.PI * 2, x = t(), v = N(s) * y, M = f + Math.cos(g) * d * v, k = u + Math.sin(g) * d * v * 0.85 + s * s * h * 0.4, C = 0.6 + 0.4 * Math.sin(s * 18 + S), R = p * C * i.intensity;
      R <= 0.02 || (a.fillStyle = e.alpha(R, x > 0.72 ? 2 : x > 0.4 ? 0 : 1), a.beginPath(), a.arc(M, k, Math.max(0.5, w * (1 - s * 0.55) * l), 0, Math.PI * 2), a.fill());
    }
  }
}), os = P({
  metadata: {
    id: "symbol-freeze",
    displayName: "Symbol Freeze",
    description: "Branching frost crystals creep inward from the cell edges beneath a cold translucent veil and glinting ice sparkles.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#dff6ff", "#9fd9ff", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = N(I(s * 1.25)), u = a.createLinearGradient(r, c, r, c + h);
    u.addColorStop(0, e.alpha(0.22 * f * i.intensity, 1)), u.addColorStop(0.5, e.alpha(0.1 * f * i.intensity, 0)), u.addColorStop(1, e.alpha(0.22 * f * i.intensity, 1)), a.fillStyle = u, a.fillRect(r, c, n, h), a.globalCompositeOperation = "lighter", a.lineCap = "round";
    for (let d = 0; d < 12; d += 1) {
      const p = d % 4, b = 0.12 + t() * 0.76, m = (0.2 + t() * 0.24) * Math.min(n, h), g = (t() - 0.5) * 0.9, y = 0.35 + t() * 0.35, w = p === 0 ? r + n * b : p === 1 ? r + n : p === 2 ? r + n * b : r, S = p === 0 ? c : p === 1 ? c + h * b : p === 2 ? c + h : c + h * b, v = (p === 0 ? Math.PI / 2 : p === 1 ? Math.PI : p === 2 ? -Math.PI / 2 : 0) + g, M = N(I(s * 1.6 - d * 0.035));
      if (M <= 0.01)
        continue;
      const k = w + Math.cos(v) * m * M, C = S + Math.sin(v) * m * M;
      a.strokeStyle = e.alpha(0.7 * M * i.intensity, 1), a.lineWidth = 1.8 * l, a.beginPath(), a.moveTo(w, S), a.lineTo(k, C), a.stroke();
      const R = I(M * 1.4 - y);
      if (R > 0.01) {
        const E = w + Math.cos(v) * m * M * y, T = S + Math.sin(v) * m * M * y;
        a.strokeStyle = e.alpha(0.55 * R * i.intensity, 2), a.lineWidth = 1.1 * l;
        for (const A of [-0.7, 0.7])
          a.beginPath(), a.moveTo(E, T), a.lineTo(E + Math.cos(v + A) * m * 0.3 * R, T + Math.sin(v + A) * m * 0.3 * R), a.stroke();
      }
    }
    for (let d = 0; d < 6; d += 1) {
      const p = r + t() * n, b = c + t() * h, m = t() * Math.PI * 2, g = Math.max(0, Math.sin(s * Math.PI * 6 + m)) * f;
      g <= 0.05 || (a.fillStyle = e.alpha(0.8 * g * i.intensity, 2), a.beginPath(), a.arc(p, b, 1.4 * l, 0, Math.PI * 2), a.fill());
    }
  }
}), ss = P({
  metadata: {
    id: "symbol-electrify",
    displayName: "Symbol Electrify",
    description: "Crackling blue-white lightning arcs snap around the cell rim with flickering bright cores and a static haze.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#7ef2ff", "#b9f6ff", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = s * Math.PI * 2;
    a.globalCompositeOperation = "lighter";
    const p = a.createRadialGradient(f, u, 0, f, u, Math.max(n, h) * 0.65);
    p.addColorStop(0, e.alpha(0.16 * i.intensity, 0)), p.addColorStop(1, e.alpha(0)), a.fillStyle = p, a.fillRect(r, c, n, h), a.lineJoin = "round", a.lineCap = "round";
    const b = n * 0.46, m = h * 0.46;
    for (let g = 0; g < 5; g += 1) {
      const y = t() * Math.PI * 2, w = 0.7 + t() * 0.9, S = 4 + Math.floor(t() * 5), x = t() * Math.PI * 2, v = 3 + Math.floor(t() * 4), M = 7, k = Array.from({ length: M + 1 }, () => (t() - 0.5) * 2), C = Math.sin(d * S + x), R = C > -0.35, E = Math.max(0, 0.3 + 0.7 * C);
      if (!R || E <= 0.02)
        continue;
      const T = [];
      for (let A = 0; A <= M; A += 1) {
        const L = A / M, B = y + w * L, q = 1 + (k[A] ?? 0) * (A === 0 || A === M ? 0.15 : 1) * Math.sin(d * v + A * 1.7) * Math.min(n, h) * 0.08 / Math.min(b, m);
        T.push([f + Math.cos(B) * b * q, u + Math.sin(B) * m * q]);
      }
      for (const A of [0, 1]) {
        a.strokeStyle = A === 0 ? e.alpha(0.3 * E * i.intensity, 0) : e.alpha(0.9 * E * i.intensity, 2), a.lineWidth = (A === 0 ? 4 : 1.4) * l, a.beginPath();
        for (const [L, B] of T)
          a.lineTo(L, B);
        a.stroke();
      }
    }
    for (let g = 0; g < 5; g += 1) {
      const y = t() * Math.PI * 2, w = t() * Math.PI * 2, S = Math.max(0, Math.sin(d * 6 + w));
      S <= 0.4 || (a.fillStyle = e.alpha(S * i.intensity, 1), a.beginPath(), a.arc(f + Math.cos(y) * b, u + Math.sin(y) * m, 1.6 * l, 0, Math.PI * 2), a.fill());
    }
  }
}), is = P({
  metadata: {
    id: "symbol-transform",
    displayName: "Symbol Transform",
    description: "Motes of light spiral inward and compress into a brilliant flash that blooms outward as the new symbol is revealed.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.65, p = I(s / 0.55), b = I((s - 0.55) / 0.45);
    if (a.globalCompositeOperation = "lighter", p < 1)
      for (let g = 0; g < 20; g += 1) {
        const y = t() * Math.PI * 2, w = 0.6 + t() * 0.4, S = 2.2 + t() * 1.4, x = g % 3, v = U(p), M = d * w * (1 - v), k = y + S * p, C = (0.35 + 0.55 * p) * i.intensity;
        a.fillStyle = e.alpha(C, x), a.beginPath(), a.arc(f + Math.cos(k) * M, u + Math.sin(k) * M * 0.9, Math.max(0.6, (1.2 + t() * 1.6) * l), 0, Math.PI * 2), a.fill();
      }
    const m = a.createRadialGradient(f, u, 0, f, u, Math.max(1, d * (0.12 + p * 0.25)));
    if (m.addColorStop(0, e.alpha(0.85 * p * (1 - b) * i.intensity, 1)), m.addColorStop(1, e.alpha(0)), a.fillStyle = m, a.fillRect(r, c, n, h), b > 0) {
      const g = N(b), y = 1 - b, w = a.createRadialGradient(f, u, 0, f, u, Math.max(1, d * (0.2 + g * 0.9)));
      w.addColorStop(0, e.alpha(0.95 * y * i.intensity, 1)), w.addColorStop(0.5, e.alpha(0.45 * y * i.intensity, 0)), w.addColorStop(1, e.alpha(0)), a.fillStyle = w, a.fillRect(r - d * 0.3, c - d * 0.3, n + d * 0.6, h + d * 0.6), a.strokeStyle = e.alpha(0.7 * y * i.intensity, 2), a.lineWidth = Math.max(1, (4 - g * 3) * l), a.beginPath(), a.arc(f, u, Math.max(1, d * g), 0, Math.PI * 2), a.stroke();
    }
  }
}), ns = P({
  metadata: {
    id: "symbol-wild-reveal",
    displayName: "Symbol Wild Reveal",
    description: "A blinding golden burst with a spinning star flare whose rays sweep round as sparkles shower outward.",
    category: "symbols",
    targets: ["symbol"]
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.72, p = kt(I(s * 1.6)), b = I((1 - s) * 2.5);
    a.globalCompositeOperation = "lighter";
    const m = a.createRadialGradient(f, u, 0, f, u, Math.max(1, d * (0.3 + p * 0.7)));
    m.addColorStop(0, e.alpha(0.9 * b * i.intensity, 1)), m.addColorStop(0.4, e.alpha(0.5 * b * i.intensity, 0)), m.addColorStop(1, e.alpha(0)), a.fillStyle = m, a.fillRect(r - d * 0.3, c - d * 0.3, n + d * 0.6, h + d * 0.6);
    const g = N(s) * Math.PI * 1.5;
    for (let y = 0; y < 6; y += 1) {
      const w = g + y / 6 * Math.PI * 2, S = d * (0.35 + p * 0.65) * (y % 2 === 0 ? 1 : 0.62), x = S * 0.12, v = 0.6 * b * i.intensity;
      v <= 0.02 || (a.fillStyle = e.alpha(v, y % 2 === 0 ? 0 : 1), a.beginPath(), a.moveTo(f + Math.cos(w) * S, u + Math.sin(w) * S), a.lineTo(f + Math.cos(w + Math.PI / 2) * x, u + Math.sin(w + Math.PI / 2) * x), a.lineTo(f + Math.cos(w + Math.PI) * S * 0.12, u + Math.sin(w + Math.PI) * S * 0.12), a.lineTo(f + Math.cos(w - Math.PI / 2) * x, u + Math.sin(w - Math.PI / 2) * x), a.closePath(), a.fill());
    }
    for (let y = 0; y < 14; y += 1) {
      const w = t() * Math.PI * 2, S = 0.4 + t() * 0.6, x = t() * Math.PI * 2, v = N(I(s * 1.2)) * S, M = b * (0.55 + 0.45 * Math.sin(s * 14 + x)) * i.intensity;
      M <= 0.02 || (a.fillStyle = e.alpha(M, y % 2 === 0 ? 1 : 2), a.beginPath(), a.arc(f + Math.cos(w) * d * v, u + Math.sin(w) * d * v, Math.max(0.6, (1 + t() * 1.8) * l), 0, Math.PI * 2), a.fill());
    }
  }
}), rs = P({
  metadata: {
    id: "reel-spin-blur",
    displayName: "Reel Spin Blur",
    description: "Soft vertical motion-blur streaks race down the reel with feathered top and bottom fades to sell fast spinning.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds();
    a.globalCompositeOperation = "lighter";
    for (let u = 0; u < 16; u += 1) {
      const d = r + n * (0.08 + t() * 0.84), p = h * (0.2 + t() * 0.3), b = t(), m = 2 + Math.floor(t() * 3), g = t() > 0.75 ? 2 : t() > 0.4 ? 1 : 0, y = (0.14 + t() * 0.22) * i.intensity, w = (b + s * m) % 1 * (h + p) - p, S = a.createLinearGradient(d, c + w, d, c + w + p);
      S.addColorStop(0, e.alpha(0, g)), S.addColorStop(0.7, e.alpha(y, g)), S.addColorStop(1, e.alpha(0, g)), a.strokeStyle = S, a.lineWidth = (1.5 + t() * 2.5) * l, a.beginPath(), a.moveTo(d, Math.max(c, c + w)), a.lineTo(d, Math.min(c + h, c + w + p)), a.stroke();
    }
    const f = a.createLinearGradient(r, c, r, c + h);
    f.addColorStop(0, e.alpha(0.22 * i.intensity, 2)), f.addColorStop(0.2, e.alpha(0)), f.addColorStop(0.8, e.alpha(0)), f.addColorStop(1, e.alpha(0.22 * i.intensity, 2)), a.fillStyle = f, a.fillRect(r, c, n, h);
  }
}), ls = P({
  metadata: {
    id: "reel-speed-lines",
    displayName: "Reel Speed Lines",
    description: "Thin high-velocity streaks with bright heads and tapering tails whip down the reel in staggered lanes.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds();
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    for (let f = 0; f < 10; f += 1) {
      const u = r + n * (0.1 + t() * 0.8), d = h * (0.12 + t() * 0.18), p = t(), b = 3 + Math.floor(t() * 3), m = f % 3 === 0 ? 0 : f % 3 === 1 ? 1 : 2, g = (0.35 + t() * 0.4) * i.intensity, y = c + (p + s * b) % 1 * (h + d) - d, w = y - d, S = Math.min(c + h, Math.max(c, y)), x = Math.min(c + h, Math.max(c, w));
      if (S - x < 1)
        continue;
      const v = a.createLinearGradient(u, x, u, S);
      v.addColorStop(0, e.alpha(0, m)), v.addColorStop(1, e.alpha(g, m)), a.strokeStyle = v, a.lineWidth = (0.8 + t() * 1.4) * l, a.beginPath(), a.moveTo(u, x), a.lineTo(u, S), a.stroke(), y > c && y < c + h && (a.fillStyle = e.alpha(g, 2), a.beginPath(), a.arc(u, y, 1.3 * l, 0, Math.PI * 2), a.fill());
    }
  }
}), cs = P({
  metadata: {
    id: "reel-stop-impact",
    displayName: "Reel Stop Impact",
    description: "A slamming flash bar hits the reel base, kicking up a horizontal shockwave and a spray of dust sparks.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = I(s / 0.3), u = I((s - 0.3) / 0.7), d = c + h * 0.92;
    if (a.globalCompositeOperation = "lighter", f < 1) {
      const g = c + U(f) * h * 0.92, y = a.createLinearGradient(r, g - h * 0.3, r, g);
      y.addColorStop(0, e.alpha(0)), y.addColorStop(1, e.alpha(0.5 * i.intensity, 2)), a.fillStyle = y, a.fillRect(r, g - h * 0.3, n, h * 0.3), a.fillStyle = e.alpha(0.85 * i.intensity, 0), a.fillRect(r, g - 2 * l, n, 4 * l);
      return;
    }
    const p = 1 - u, b = I(1 - u * 2.5);
    if (b > 0) {
      const g = a.createRadialGradient(r + n / 2, d, 0, r + n / 2, d, n * 0.8);
      g.addColorStop(0, e.alpha(0.85 * b * i.intensity, 2)), g.addColorStop(1, e.alpha(0)), a.fillStyle = g, a.fillRect(r, c, n, h);
    }
    const m = N(u);
    a.strokeStyle = e.alpha(0.7 * p * i.intensity, 0), a.lineWidth = Math.max(1, (4 - m * 3) * l), a.beginPath(), a.ellipse(r + n / 2, d, Math.max(1, n * 0.6 * m), Math.max(1, 8 * l * (1 - m * 0.5)), 0, 0, Math.PI * 2), a.stroke(), a.fillStyle = e.alpha(0.8 * p * i.intensity, 0), a.fillRect(r, d - 1.5 * l, n, 3 * l);
    for (let g = 0; g < 14; g += 1) {
      const y = -Math.PI * (0.15 + t() * 0.7), w = 0.3 + t() * 0.7, S = 1 + t() * 2, x = N(u) * w, v = r + n / 2 + Math.cos(y) * n * 0.7 * x, M = d + Math.sin(y) * h * 0.35 * x + u * u * h * 0.12, k = p * (0.4 + 0.5 * t()) * i.intensity;
      k <= 0.02 || (a.fillStyle = e.alpha(k, g % 2 === 0 ? 0 : 2), a.beginPath(), a.arc(v, M, Math.max(0.5, S * l * (1 - u * 0.5)), 0, Math.PI * 2), a.fill());
    }
  }
}), hs = P({
  metadata: {
    id: "reel-anticipation",
    displayName: "Reel Anticipation",
    description: "Tension-building edge glow that throbs brighter while rising heat shimmer ribbons drift up the reel.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = s * Math.PI * 2, u = 0.5 + 0.5 * Math.sin(f * 3 - Math.PI / 2), d = i.loop ? 0.75 : I(0.35 + s * 0.65), p = (0.4 + 0.6 * u) * d * i.intensity;
    a.globalCompositeOperation = "lighter";
    const b = n * (0.16 + u * 0.08), m = a.createLinearGradient(r, c, r + b, c);
    m.addColorStop(0, e.alpha(0.75 * p, 0)), m.addColorStop(1, e.alpha(0)), a.fillStyle = m, a.fillRect(r, c, b, h);
    const g = a.createLinearGradient(r + n, c, r + n - b, c);
    g.addColorStop(0, e.alpha(0.75 * p, 0)), g.addColorStop(1, e.alpha(0)), a.fillStyle = g, a.fillRect(r + n - b, c, b, h), a.strokeStyle = e.alpha(0.85 * p, 2), a.lineWidth = 2 * l, a.strokeRect(r + l, c + l, n - 2 * l, h - 2 * l), a.lineCap = "round";
    for (let y = 0; y < 7; y += 1) {
      const w = r + n * (0.15 + t() * 0.7), S = t(), x = 1 + Math.floor(t() * 2), v = t() * Math.PI * 2, M = h * (0.16 + t() * 0.14), k = (S + s * x) % 1, C = c + h - k * (h + M), R = 0.3 * Math.sin(Math.PI * k) * d * i.intensity;
      if (R <= 0.02)
        continue;
      a.strokeStyle = e.alpha(R, 1), a.lineWidth = 1.6 * l, a.beginPath();
      const E = 8;
      for (let T = 0; T <= E; T += 1) {
        const A = C + T / E * M, L = w + Math.sin(A * 0.05 + f * 2 + v) * n * 0.03;
        a.lineTo(L, A);
      }
      a.stroke();
    }
  }
}), ds = P({
  metadata: {
    id: "reel-nudge",
    displayName: "Reel Nudge",
    description: "Ghost chevrons and a highlight band step the reel down one position, finishing with a crisp landing flash.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = n / 3, f = F(I(a / 0.7)), u = I((1 - a) * 3.5);
    e.globalCompositeOperation = "lighter";
    const d = r + h + f * h, p = e.createLinearGradient(l, d - h * 0.5, l, d + h * 0.5);
    p.addColorStop(0, t.alpha(0)), p.addColorStop(0.5, t.alpha(0.35 * u * s.intensity, 0)), p.addColorStop(1, t.alpha(0)), e.fillStyle = p, e.fillRect(l + c * 0.06, d - h * 0.5, c * 0.88, h), e.lineJoin = "round", e.lineCap = "round";
    for (let g = 0; g < 3; g += 1) {
      const y = I(f - g * 0.12), w = r + h + y * h, S = (g === 0 ? 0.8 : 0.3 / g) * u * s.intensity;
      if (S <= 0.02)
        continue;
      e.strokeStyle = t.alpha(S, g === 0 ? 0 : 1), e.lineWidth = (g === 0 ? 2.6 : 1.6) * i;
      const x = c * 0.24, v = h * 0.16;
      e.beginPath(), e.moveTo(l + c / 2 - x, w - v), e.lineTo(l + c / 2, w + v), e.lineTo(l + c / 2 + x, w - v), e.stroke();
    }
    const m = I((a - 0.7) / 0.12) > 0 ? I(1 - (a - 0.7) / 0.3) : 0;
    if (m > 0.02) {
      e.fillStyle = t.alpha(0.75 * m * s.intensity, 2), e.fillRect(l + c * 0.08, r + h * 2 - 1.5 * i, c * 0.84, 3 * i);
      const g = e.createRadialGradient(l + c / 2, r + h * 2, 0, l + c / 2, r + h * 2, c * 0.5);
      g.addColorStop(0, t.alpha(0.4 * m * s.intensity, 0)), g.addColorStop(1, t.alpha(0)), e.fillStyle = g, e.fillRect(l, r + h, c, h * 2);
    }
  }
}), fs = P({
  metadata: {
    id: "reel-bounce",
    displayName: "Reel Bounce",
    description: "The reel frame visibly recoils: outline echoes and edge bands oscillate vertically with a damped settle.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.exp(-3.2 * a), f = Math.sin(a * Math.PI * 5) * n * 0.05 * h, u = Math.abs(f) / Math.max(1, n * 0.05);
    e.globalCompositeOperation = "lighter", e.lineJoin = "round";
    for (let b = 2; b >= 0; b -= 1) {
      const m = Math.max(0, a - b * 0.04), g = Math.sin(m * Math.PI * 5) * n * 0.05 * Math.exp(-3.2 * m), y = (b === 0 ? 0.7 : 0.24 / b) * h * s.intensity;
      y <= 0.02 || (e.strokeStyle = t.alpha(y, b === 0 ? 0 : 1), e.lineWidth = (b === 0 ? 2.4 : 1.4) * i, e.strokeRect(l + 2 * i, r + g + 2 * i, c - 4 * i, n - 4 * i));
    }
    const d = e.createLinearGradient(l, r + f, l, r + f + n * 0.14);
    d.addColorStop(0, t.alpha(0.5 * u * h * s.intensity, 2)), d.addColorStop(1, t.alpha(0)), e.fillStyle = d, e.fillRect(l, r + f, c, n * 0.14);
    const p = e.createLinearGradient(l, r + n + f, l, r + n + f - n * 0.14);
    p.addColorStop(0, t.alpha(0.5 * u * h * s.intensity, 2)), p.addColorStop(1, t.alpha(0)), e.fillStyle = p, e.fillRect(l, r + n + f - n * 0.14, c, n * 0.14);
  }
}), ps = P({
  metadata: {
    id: "reel-shake",
    displayName: "Reel Shake",
    description: "The reel frame judders side to side with lagging outline ghosts and directional glow smears that die down.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = Math.pow(1 - s, 1.3), u = n * 0.06 * f * i.intensity, d = t() * Math.PI * 2, p = (w) => Math.sin(w * Math.PI * 16 + d) * u;
    a.globalCompositeOperation = "lighter", a.lineJoin = "round";
    for (let w = 2; w >= 0; w -= 1) {
      const S = I(s - w * 0.025), x = p(S), v = (w === 0 ? 0.75 : 0.26 / w) * f * i.intensity;
      v <= 0.02 || (a.strokeStyle = e.alpha(v, w === 0 ? 0 : 1), a.lineWidth = (w === 0 ? 2.4 : 1.4) * l, a.strokeRect(r + x + 2 * l, c + 2 * l, n - 4 * l, h - 4 * l));
    }
    const b = p(s), m = b > 0 ? 1 : -1, g = Math.abs(b) / Math.max(1, n * 0.06), y = a.createLinearGradient((m > 0, r + n * 0.5), c, r + n * 0.5 + m * n * 0.5, c);
    y.addColorStop(0, e.alpha(0)), y.addColorStop(1, e.alpha(0.28 * g * f * i.intensity, 2)), a.fillStyle = y, a.fillRect(m > 0 ? r + n * 0.5 : r, c + h * 0.06, n * 0.5, h * 0.88);
  }
}), us = P({
  metadata: {
    id: "reel-glow",
    displayName: "Reel Glow",
    description: "A warm breathing halo hugging the reel border with a soft interior wash that swells and relaxes.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), f = (0.5 + 0.5 * (0.5 + 0.5 * Math.sin(a * Math.PI * 2 - Math.PI / 2))) * s.intensity;
    e.globalCompositeOperation = "lighter";
    const u = l + c / 2, d = r + n / 2, p = e.createRadialGradient(u, d, 0, u, d, Math.max(c, n) * 0.62);
    p.addColorStop(0, t.alpha(0.14 * f, 1)), p.addColorStop(1, t.alpha(0)), e.fillStyle = p, e.fillRect(l, r, c, n);
    for (let b = 0; b < 4; b += 1) {
      const m = (2 + b * 2.5) * i, g = (0.42 - b * 0.09) * f;
      g <= 0.02 || (e.strokeStyle = t.alpha(g, b === 0 ? 2 : 0), e.lineWidth = (2 + b * 1.5) * i, e.strokeRect(l + m, r + m, c - m * 2, n - m * 2));
    }
  }
}), gs = P({
  metadata: {
    id: "reel-win-frame",
    displayName: "Reel Win Frame",
    description: "An animated marching-ants golden frame circling the reel with glowing corner studs and a soft outer halo.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = 3 * i, f = l + h, u = r + h, d = c - h * 2, p = n - h * 2, b = 10 * i, m = 7 * i, g = b + m;
    e.globalCompositeOperation = "lighter", e.lineJoin = "round", e.strokeStyle = t.alpha(0.25 * s.intensity, 0), e.lineWidth = 6 * i, e.strokeRect(f, u, d, p), e.setLineDash([b, m]), e.lineDashOffset = -a * g * 4, e.strokeStyle = t.alpha(0.9 * s.intensity, 0), e.lineWidth = 2.4 * i, e.strokeRect(f, u, d, p), e.strokeStyle = t.alpha(0.5 * s.intensity, 2), e.lineWidth = 1 * i, e.strokeRect(f, u, d, p), e.setLineDash([]), e.lineDashOffset = 0;
    const y = 0.5 + 0.5 * Math.sin(a * Math.PI * 2 * 2), w = [
      [f, u],
      [f + d, u],
      [f + d, u + p],
      [f, u + p]
    ];
    for (const [S, x] of w) {
      const v = e.createRadialGradient(S, x, 0, S, x, 7 * i);
      v.addColorStop(0, t.alpha((0.6 + 0.4 * y) * s.intensity, 2)), v.addColorStop(0.5, t.alpha(0.4 * s.intensity, 0)), v.addColorStop(1, t.alpha(0)), e.fillStyle = v, e.beginPath(), e.arc(S, x, 7 * i, 0, Math.PI * 2), e.fill();
    }
  }
}), bs = P({
  metadata: {
    id: "reel-cascade",
    displayName: "Reel Cascade",
    description: "A glittering trail of sparkles tumbles down the reel, each mote trailing a soft luminous streak as it falls.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds();
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    for (let f = 0; f < 22; f += 1) {
      const u = r + n * (0.06 + t() * 0.88), d = t(), p = 1 + Math.floor(t() * 2), b = 1 + t() * 2, m = t() * Math.PI * 2, g = t() * Math.PI * 2, y = t(), w = (d + s * p) % 1, S = h * (0.08 + t() * 0.08), x = c + w * (h + S) - S, v = u + Math.sin(w * Math.PI * 4 + m) * n * 0.04, M = Math.min(1, Math.min((x - c + S) / (h * 0.15), (c + h - x + S) / (h * 0.15))), k = 0.55 + 0.45 * Math.sin(s * Math.PI * 2 * 5 + g), C = Math.max(0, M) * k * 0.8 * i.intensity;
      if (C <= 0.02)
        continue;
      const R = y > 0.7 ? 2 : y > 0.35 ? 0 : 1, E = a.createLinearGradient(v, x - S, v, x);
      E.addColorStop(0, e.alpha(0, R)), E.addColorStop(1, e.alpha(C * 0.5, R)), a.strokeStyle = E, a.lineWidth = b * l * 0.8, a.beginPath(), a.moveTo(v, Math.max(c, x - S)), a.lineTo(v, Math.min(c + h, Math.max(c, x))), a.stroke(), x >= c && x <= c + h && (a.fillStyle = e.alpha(C, R), a.beginPath(), a.arc(v, x, Math.max(0.6, b * l), 0, Math.PI * 2), a.fill());
    }
  }
}), ms = P({
  metadata: {
    id: "reel-wipe",
    displayName: "Reel Wipe",
    description: "A brilliant light band sweeps down the reel leaving a fading luminous wake and trailing sparkles.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = h * 0.22, u = F(s), d = c - f + u * (h + f * 2), p = I((1 - s) * 4);
    a.globalCompositeOperation = "lighter";
    const b = Math.max(c, d - h * 0.45);
    if (d > b) {
      const y = a.createLinearGradient(r, b, r, d);
      y.addColorStop(0, e.alpha(0)), y.addColorStop(1, e.alpha(0.22 * p * i.intensity, 1)), a.fillStyle = y, a.fillRect(r, b, n, d - b);
    }
    const m = a.createLinearGradient(r, d - f / 2, r, d + f / 2);
    m.addColorStop(0, e.alpha(0)), m.addColorStop(0.5, e.alpha(0.75 * p * i.intensity, 2)), m.addColorStop(1, e.alpha(0)), a.fillStyle = m, a.fillRect(r, d - f / 2, n, f), a.fillStyle = e.alpha(0.85 * p * i.intensity, 0);
    const g = Math.min(c + h, Math.max(c, d));
    a.fillRect(r, g - 1.5 * l, n, 3 * l);
    for (let y = 0; y < 12; y += 1) {
      const w = r + t() * n, S = t() * 0.3, x = t() * Math.PI * 2, v = d - S * h;
      if (v < c || v > c + h)
        continue;
      const M = 0.5 + 0.5 * Math.sin(s * 20 + x), k = p * M * (1 - S * 2.5) * i.intensity;
      k <= 0.02 || (a.fillStyle = e.alpha(k, y % 2 === 0 ? 0 : 2), a.beginPath(), a.arc(w, v, Math.max(0.6, (1 + t() * 1.6) * l), 0, Math.PI * 2), a.fill());
    }
  }
}), ys = P({
  metadata: {
    id: "reel-lock",
    displayName: "Reel Lock",
    description: "Heavy corner brackets clamp onto the reel with a locking flash, then hold with a pulsing golden bar and shackle.",
    category: "reels",
    targets: ["reel"]
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = s.loop ? 1 : kt(I(a / 0.28)), f = s.loop ? 0 : I(1 - Math.abs(a - 0.3) / 0.12), u = 0.5 + 0.5 * Math.sin(a * Math.PI * 2 * 2 - Math.PI / 2), d = l + c / 2, p = r + n / 2;
    e.globalCompositeOperation = "lighter", e.lineCap = "square";
    const b = Math.min(c, n) * 0.2, m = (1 - h) * Math.min(c, n) * 0.3, g = [
      [l + 4 * i, r + 4 * i, 1, 1],
      [l + c - 4 * i, r + 4 * i, -1, 1],
      [l + c - 4 * i, r + n - 4 * i, -1, -1],
      [l + 4 * i, r + n - 4 * i, 1, -1]
    ];
    for (const [x, v, M, k] of g) {
      const C = x - M * m, R = v - k * m, E = (0.55 + 0.35 * u) * I(h) * s.intensity;
      e.strokeStyle = t.alpha(E, 0), e.lineWidth = 4 * i, e.beginPath(), e.moveTo(C + M * b, R), e.lineTo(C, R), e.lineTo(C, R + k * b), e.stroke(), e.strokeStyle = t.alpha(E * 0.8, 2), e.lineWidth = 1.4 * i, e.stroke();
    }
    const y = (0.35 + 0.3 * u) * h * s.intensity, w = e.createLinearGradient(l, p, l + c, p);
    w.addColorStop(0, t.alpha(0)), w.addColorStop(0.5, t.alpha(y, 0)), w.addColorStop(1, t.alpha(0)), e.fillStyle = w, e.fillRect(l, p - 3 * i, c, 6 * i);
    const S = Math.min(c, n) * 0.12;
    if (e.strokeStyle = t.alpha((0.5 + 0.35 * u) * h * s.intensity, 1), e.lineWidth = 2.6 * i, e.lineCap = "round", e.beginPath(), e.arc(d, p - S * 0.4, S, Math.PI, Math.PI * 2), e.stroke(), f > 0.02) {
      const x = e.createRadialGradient(d, p, 0, d, p, Math.max(c, n) * 0.7);
      x.addColorStop(0, t.alpha(0.7 * f * s.intensity, 2)), x.addColorStop(1, t.alpha(0)), e.fillStyle = x, e.fillRect(l, r, c, n);
    }
  }
});
function ws(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
const xs = P({
  metadata: {
    id: "button-hover-glow",
    displayName: "Button Hover Glow",
    description: "A warm halo around the button rim that breathes gently while the pointer hovers.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = 0.5 + 0.5 * Math.sin(a * Math.PI * 2), f = (0.4 + 0.45 * h) * s.intensity, u = l + c / 2, d = r + n / 2, p = Math.max(c, n) * (0.62 + 0.08 * h);
    e.globalCompositeOperation = "lighter";
    const b = e.createRadialGradient(u, d, Math.min(c, n) * 0.2, u, d, p);
    b.addColorStop(0, t.alpha(0.22 * f, 0)), b.addColorStop(1, t.alpha(0, 0)), e.fillStyle = b, e.fillRect(u - p, d - p, p * 2, p * 2);
    const m = 1.5 * i * h, g = Math.min(c, n) * 0.22, y = [
      [9 * i, t.alpha(0.16 * f, 0)],
      [4 * i, t.alpha(0.35 * f, 0)],
      [1.5 * i, t.alpha(0.85 * f, 1)]
    ];
    for (const [w, S] of y)
      e.lineWidth = w, e.strokeStyle = S, ws(e, l - m, r - m, c + m * 2, n + m * 2, g + m), e.stroke();
  }
});
function ne(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
const Ss = P({
  metadata: {
    id: "button-press",
    displayName: "Button Press",
    description: "A quick tactile press: the face dims and sinks inward, then releases with a bright rebound ring.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.min(c, n) * 0.22, f = Math.sin(Math.PI * I(a / 0.6)), u = f * Math.min(c, n) * 0.07;
    f > 0.01 && (ne(e, l + u, r + u, c - u * 2, n - u * 2, h), e.fillStyle = `rgba(0,0,0,${0.3 * f * s.intensity})`, e.fill(), e.globalCompositeOperation = "lighter", e.lineWidth = 1.5 * i, e.strokeStyle = t.alpha(0.55 * f * s.intensity, 0), e.stroke(), e.globalCompositeOperation = "source-over");
    const d = I((a - 0.55) / 0.45);
    if (d > 0) {
      const p = N(d) * Math.min(c, n) * 0.3, b = (1 - d) * s.intensity;
      e.globalCompositeOperation = "lighter";
      const m = [
        [7 * i, t.alpha(0.2 * b, 0)],
        [1.6 * i, t.alpha(0.9 * b, 1)]
      ];
      for (const [g, y] of m)
        e.lineWidth = g, e.strokeStyle = y, ne(e, l - p, r - p, c + p * 2, n + p * 2, h + p), e.stroke();
    }
  }
}), vs = P({
  metadata: {
    id: "button-ripple",
    displayName: "Button Ripple",
    description: "Touch-style ripple rings that expand from the button centre and dissolve outward.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = l + c / 2, f = r + n / 2, u = Math.hypot(c, n) / 2;
    e.globalCompositeOperation = "lighter";
    const d = 1 - N(I(a / 0.35));
    if (d > 0.01) {
      const p = e.createRadialGradient(h, f, 0, h, f, u * 0.3);
      p.addColorStop(0, t.alpha(0.6 * d * s.intensity, 2)), p.addColorStop(1, t.alpha(0, 0)), e.fillStyle = p, e.fillRect(l, r, c, n);
    }
    for (const p of [0, 0.18, 0.34]) {
      const b = I((a - p) / (1 - p));
      if (b <= 0)
        continue;
      const m = Math.max(1, u * N(b)), g = (1 - b) * (1 - b) * s.intensity, y = [
        [7 * i, t.alpha(0.16 * g, 0)],
        [2.5 * i, t.alpha(0.38 * g, 0)],
        [1.2 * i, t.alpha(0.8 * g, 1)]
      ];
      for (const [w, S] of y)
        e.lineWidth = w, e.strokeStyle = S, e.beginPath(), e.arc(h, f, m, 0, Math.PI * 2), e.stroke();
    }
  }
});
function re(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
const Ms = P({
  metadata: {
    id: "button-pulse",
    displayName: "Button Pulse",
    description: "A steady heartbeat: an outline ring emitted from the button edge that expands and fades every cycle.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.min(c, n) * 0.22;
    e.globalCompositeOperation = "lighter";
    const f = (0.3 + 0.2 * Math.sin(a * Math.PI * 2)) * s.intensity;
    e.lineWidth = 1.5 * i, e.strokeStyle = t.alpha(f, 0), re(e, l, r, c, n, h), e.stroke();
    const u = N(a) * Math.min(c, n) * 0.45 + 2 * i, d = Math.pow(1 - a, 1.6) * s.intensity, p = [
      [8 * i, t.alpha(0.18 * d, 0)],
      [3 * i, t.alpha(0.4 * d, 0)],
      [1.4 * i, t.alpha(0.85 * d, 1)]
    ];
    for (const [b, m] of p)
      e.lineWidth = b, e.strokeStyle = m, re(e, l - u, r - u, c + u * 2, n + u * 2, h + u), e.stroke();
  }
});
function ks(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
const Cs = P({
  metadata: {
    id: "button-shine",
    displayName: "Button Shine",
    description: "A glossy diagonal sheen band that sweeps across the button face from left to right.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = Math.min(r, c) * 0.22, h = r * 0.24, f = c * 0.6, u = F(a), d = i - h - f + (r + (h + f) * 2) * u, p = 0.65 * s.intensity;
    e.globalCompositeOperation = "lighter";
    const b = e.createLinearGradient(d - h, l, d + h + f, l + c);
    b.addColorStop(0, t.alpha(0, 2)), b.addColorStop(0.42, t.alpha(0.25 * p, 1)), b.addColorStop(0.5, t.alpha(p, 2)), b.addColorStop(0.58, t.alpha(0.25 * p, 1)), b.addColorStop(1, t.alpha(0, 2)), ks(e, i, l, r, c, n), e.fillStyle = b, e.fill();
  }
}), Ps = P({
  metadata: {
    id: "button-spark",
    displayName: "Button Spark",
    description: "A crackle of tiny spark streaks that fly off the button and die out under gravity.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.7, p = Array.from({ length: 14 }, () => ({
      angle: t() * Math.PI * 2,
      speed: 0.4 + t() * 0.6,
      tone: t(),
      size: 0.8 + t() * 1.4
    })), b = Math.pow(1 - s, 1.4);
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    const m = (y, w) => {
      const S = N(w) * y.speed * d;
      return [
        f + Math.cos(y.angle) * S,
        u + Math.sin(y.angle) * S + w * w * h * 0.35
      ];
    };
    for (const y of p) {
      const w = b * (0.5 + 0.5 * y.tone) * i.intensity;
      if (w <= 0.01)
        continue;
      const [S, x] = m(y, s), [v, M] = m(y, Math.max(0, s - 0.08)), k = [
        [4 * l * y.size, e.alpha(0.2 * w, 0)],
        [1.3 * l * y.size, e.alpha(0.9 * w, y.tone > 0.6 ? 2 : 1)]
      ];
      for (const [C, R] of k)
        a.lineWidth = C, a.strokeStyle = R, a.beginPath(), a.moveTo(v, M), a.lineTo(S, x), a.stroke();
    }
    const g = 1 - N(Math.min(1, s * 3.2));
    if (g > 0.01) {
      const y = a.createRadialGradient(f, u, 0, f, u, d * 0.3);
      y.addColorStop(0, e.alpha(0.7 * g * i.intensity, 2)), y.addColorStop(1, e.alpha(0, 0)), a.fillStyle = y, a.fillRect(r, c, n, h);
    }
  }
});
function le(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
const Rs = P({
  metadata: {
    id: "button-charge",
    displayName: "Button Charge",
    description: "An energy meter that fills the button from the bottom, glows brighter as it rises, and discharges in a flash.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.min(c, n) * 0.22, f = F(a), u = 1 - U(I((a - 0.88) / 0.12)), d = (0.3 + 0.5 * f) * u * s.intensity, p = r + n * (1 - f);
    if (e.globalCompositeOperation = "lighter", f > 0.01) {
      const m = e.createLinearGradient(l, r + n, l, p);
      m.addColorStop(0, t.alpha(0.5 * d, 0)), m.addColorStop(1, t.alpha(0, 0)), le(e, l, r, c, n, h), e.fillStyle = m, e.fill(), e.lineCap = "round";
      const g = Math.min(h, n * f * 0.5), y = [
        [7 * i, t.alpha(0.25 * d, 0)],
        [1.5 * i, t.alpha(0.9 * d, 1)]
      ];
      for (const [w, S] of y)
        e.lineWidth = w, e.strokeStyle = S, e.beginPath(), e.moveTo(l + g, p), e.lineTo(l + c - g, p), e.stroke();
    }
    const b = I((a - 0.85) / 0.15);
    if (b > 0) {
      const m = Math.sin(Math.PI * b) * s.intensity;
      le(e, l, r, c, n, h), e.fillStyle = t.alpha(0.55 * m, 2), e.fill();
    }
  }
});
function ce(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
function he(o, t, e) {
  const { ctx: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.min(c, n) * 0.22;
  a.globalCompositeOperation = "saturation", ce(a, l + e, r, c, n, h), a.fillStyle = "rgba(128,128,128,0.8)", a.fill(), a.globalCompositeOperation = "source-over", ce(a, l + e, r, c, n, h), a.fillStyle = t.alpha(0.3 * s.intensity, 1), a.fill(), a.lineWidth = 1.2 * i, a.strokeStyle = t.alpha(0.4 * s.intensity, 0), a.stroke();
}
const Is = P({
  metadata: {
    id: "button-disabled",
    displayName: "Button Disabled",
    description: "A muted grey veil that desaturates the button, announced by a brief refusal shake.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#8a93a4", "#2c313c", "#b8bfcc"],
  render({ frame: o, paint: t }) {
    const { progress: e, dpr: a } = o, s = 1 - N(I(e / 0.25)), i = Math.sin(e * 60) * 3 * a * s;
    he(o, t, i);
  },
  renderReducedMotion({ frame: o, paint: t }) {
    he(o, t, 0);
  }
}), Es = P({
  metadata: {
    id: "button-win",
    displayName: "Button Win",
    description: "A celebratory golden payout: a centre flash, radiating light rays, an expanding ring, and scattering sparks.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = r + n / 2, u = c + h / 2, d = Math.max(n, h) * 0.75, p = 1 - U(s);
    a.globalCompositeOperation = "lighter", a.lineCap = "round";
    const b = N(Math.min(1, s * 2.8)) * p, m = a.createRadialGradient(f, u, 0, f, u, Math.max(1, d * 0.45 * b));
    m.addColorStop(0, e.alpha(0.9 * b * i.intensity, 2)), m.addColorStop(0.6, e.alpha(0.4 * b * i.intensity, 0)), m.addColorStop(1, e.alpha(0, 1)), a.fillStyle = m, a.fillRect(r, c, n, h);
    const g = 8;
    for (let w = 0; w < g; w++) {
      const S = w / g * Math.PI * 2 + s * 0.7 + t() * 0.2, x = d * 0.12, v = d * (0.3 + 0.7 * N(s)), M = p * i.intensity, k = [
        [6 * l, e.alpha(0.16 * M, 0)],
        [1.5 * l, e.alpha(0.75 * M, 1)]
      ];
      for (const [C, R] of k)
        a.lineWidth = C, a.strokeStyle = R, a.beginPath(), a.moveTo(f + Math.cos(S) * x, u + Math.sin(S) * x), a.lineTo(f + Math.cos(S) * v, u + Math.sin(S) * v), a.stroke();
    }
    const y = Math.max(1, d * N(s));
    a.lineWidth = 2 * l, a.strokeStyle = e.alpha(0.7 * p * i.intensity, 2), a.beginPath(), a.arc(f, u, y, 0, Math.PI * 2), a.stroke();
    for (let w = 0; w < 16; w++) {
      const S = t() * Math.PI * 2, x = 0.4 + t() * 0.6, v = t(), M = N(s) * x * d, k = f + Math.cos(S) * M, C = u + Math.sin(S) * M + s * s * h * 0.25, R = p * (0.4 + 0.6 * v) * i.intensity;
      R <= 0.01 || (a.fillStyle = e.alpha(R, v > 0.6 ? 2 : 0), a.beginPath(), a.arc(k, C, Math.max(0.6, (1 + v * 1.6) * l * (1 - s * 0.5)), 0, Math.PI * 2), a.fill());
    }
  }
});
function de(o, t, e, a, s, i) {
  const l = Math.max(0, Math.min(i, a / 2, s / 2));
  o.beginPath(), o.moveTo(t + l, e), o.arcTo(t + a, e, t + a, e + s, l), o.arcTo(t + a, e + s, t, e + s, l), o.arcTo(t, e + s, t, e, l), o.arcTo(t, e, t + a, e, l), o.closePath();
}
const As = P({
  metadata: {
    id: "button-attention",
    displayName: "Button Attention",
    description: "A double heartbeat of flash-and-ring pulses each cycle that nags the player to press the button.",
    category: "buttons",
    targets: ["button"]
  },
  palette: ["#ffd34f", "#fff3c2", "#ffffff"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s, dpr: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = Math.min(c, n) * 0.22;
    e.globalCompositeOperation = "lighter";
    for (const d of [0, 0.16]) {
      const p = I((a - d) / 0.45);
      if (p <= 0 || p >= 1)
        continue;
      const b = N(p) * Math.min(c, n) * 0.4 + 2 * i, m = (1 - p) * (1 - p) * s.intensity, g = [
        [7 * i, t.alpha(0.2 * m, 0)],
        [1.5 * i, t.alpha(0.9 * m, 1)]
      ];
      for (const [y, w] of g)
        e.lineWidth = y, e.strokeStyle = w, de(e, l - b, r - b, c + b * 2, n + b * 2, h + b), e.stroke();
    }
    const f = (d) => Math.exp(-Math.pow((a - d) * 16, 2)), u = Math.max(f(0.05), f(0.21)) * s.intensity;
    u > 0.01 && (de(e, l, r, c, n, h), e.fillStyle = t.alpha(0.35 * u, 2), e.fill(), e.lineWidth = 1.8 * i, e.strokeStyle = t.alpha(0.8 * u, 0), e.stroke());
  }
}), Ts = P({
  metadata: {
    id: "background-particles",
    displayName: "Background Particles",
    description: "Soft glowing motes that drift upward and sway gently across the whole panel.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = s * Math.PI * 2;
    a.globalCompositeOperation = "lighter";
    for (let u = 0; u < 46; u += 1) {
      const d = t(), p = t(), b = 1 + Math.floor(t() * 2), m = 0.01 + t() * 0.025, g = 1 + Math.floor(t() * 3), y = t() * Math.PI * 2, w = (1 + t() * 2.4) * l, S = t(), x = ((p - s * b) % 1 + 1) % 1, v = ((d + Math.sin(f * g + y) * m) % 1 + 1) % 1, M = Math.min(1, x * 5, (1 - x) * 5), k = 0.28 * (0.35 + 0.65 * S) * M * i.intensity;
      if (k <= 0.01)
        continue;
      const C = r + v * n, R = c + x * h, E = w * 4, T = a.createRadialGradient(C, R, 0, C, R, E), A = S > 0.7 ? 2 : 0;
      T.addColorStop(0, e.alpha(k, A)), T.addColorStop(1, e.alpha(0, A)), a.fillStyle = T, a.beginPath(), a.arc(C, R, E, 0, Math.PI * 2), a.fill();
    }
  }
}), Ns = [
  { speed: 1, base: 0.55, amp: 0.1, freq: 2, alpha: 0.1 },
  { speed: 2, base: 0.68, amp: 0.12, freq: 3, alpha: 0.16 },
  { speed: 3, base: 0.8, amp: 0.14, freq: 4, alpha: 0.24 }
], Bs = P({
  metadata: {
    id: "background-parallax",
    displayName: "Background Parallax",
    description: "Layered silhouette ridge bands drifting sideways at different speeds for a depth-scrolling horizon.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#2b1762", "#35d6ed", "#f6ca55"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = a.createLinearGradient(l, r, l, r + n);
    h.addColorStop(0, e.alpha(0.06 * i.intensity, 1)), h.addColorStop(1, e.alpha(0.03 * i.intensity, 0)), a.fillStyle = h, a.fillRect(l, r, c, n);
    const f = Math.max(24, Math.floor(c / 14));
    for (const u of Ns) {
      const d = t() * Math.PI * 2, p = t() * Math.PI * 2;
      a.fillStyle = e.alpha(u.alpha * i.intensity, 0), a.beginPath(), a.moveTo(l, r + n);
      for (let b = 0; b <= f; b += 1) {
        const m = b / f, g = m + s * u.speed, y = 0.6 * Math.sin(g * Math.PI * 2 * u.freq + d) + 0.4 * Math.sin(g * Math.PI * 2 * (u.freq * 2 + 1) + p), w = u.base - u.amp * (0.5 + 0.5 * y);
        a.lineTo(l + m * c, r + w * n);
      }
      a.lineTo(l + c, r + n), a.closePath(), a.fill();
    }
  }
}), Ls = [
  { widthScale: 1, alpha: 0.05 },
  { widthScale: 0.55, alpha: 0.09 },
  { widthScale: 0.22, alpha: 0.16 }
], Hs = P({
  metadata: {
    id: "background-aurora",
    displayName: "Background Aurora",
    description: "Flowing curtain ribbons of layered colour that undulate slowly across the sky.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i } = o, { x: l, y: r, width: c, height: n } = o.target.bounds(), h = s * Math.PI * 2;
    a.globalCompositeOperation = "lighter", a.lineCap = "round", a.lineJoin = "round";
    const f = Math.max(24, Math.floor(c / 18));
    for (let u = 0; u < 3; u += 1) {
      const d = 0.22 + u * 0.18 + t() * 0.08, p = 0.05 + t() * 0.05, b = 1 + Math.floor(t() * 2), m = 1 + Math.floor(t() * 2), g = t() * Math.PI * 2, y = n * (0.1 + t() * 0.08);
      for (const w of Ls) {
        a.strokeStyle = e.alpha(w.alpha * i.intensity, u), a.lineWidth = Math.max(1, y * w.widthScale), a.beginPath();
        for (let S = 0; S <= f; S += 1) {
          const x = S / f, v = Math.sin(x * Math.PI * 2 * b + h * m + g) + 0.5 * Math.sin(x * Math.PI * 2 * (b + 2) - h * m + g * 2), M = l + x * c, k = r + (d + v * p) * n;
          S === 0 ? a.moveTo(M, k) : a.lineTo(M, k);
        }
        a.stroke();
      }
    }
  }
}), Os = P({
  metadata: {
    id: "background-stars",
    displayName: "Background Stars",
    description: "A twinkling starfield over a faint nebula haze, crossed by the occasional shooting star.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render(o) {
    fe(o, o.frame.progress * Math.PI * 2, !0);
  },
  renderReducedMotion(o) {
    fe(o, 0, !1);
  }
});
function fe({ frame: o, random: t, paint: e }, a, s) {
  const { ctx: i, progress: l, options: r, dpr: c } = o, { x: n, y: h, width: f, height: u } = o.target.bounds(), d = i.createRadialGradient(n + f * 0.5, h + u * 0.35, 0, n + f * 0.5, h + u * 0.35, Math.max(f, u) * 0.75);
  d.addColorStop(0, e.alpha(0.1 * r.intensity, 1)), d.addColorStop(1, e.alpha(0, 1)), i.fillStyle = d, i.fillRect(n, h, f, u), i.globalCompositeOperation = "lighter";
  for (let p = 0; p < 80; p += 1) {
    const b = n + t() * f, m = h + t() * u, g = (0.4 + t() * 1.3) * c, y = 1 + Math.floor(t() * 3), w = t() * Math.PI * 2, S = t(), x = s ? 0.5 + 0.5 * Math.sin(a * y + w) : 0.65, v = (0.1 + 0.45 * x) * r.intensity;
    i.fillStyle = e.alpha(v, S > 0.8 ? 2 : 0), i.beginPath(), i.arc(b, m, g * (0.8 + 0.4 * x), 0, Math.PI * 2), i.fill();
  }
  if (s)
    for (let p = 0; p < 2; p += 1) {
      const b = t(), m = n + f * (0.15 + t() * 0.7), g = h + u * (0.05 + t() * 0.3), y = f * (0.12 + t() * 0.1), w = (l - b + 1) % 1 / 0.12;
      if (w >= 1)
        continue;
      const S = N(w), x = m + S * y, v = g + S * y * 0.35, M = x - y * 0.4, k = v - y * 0.14, C = i.createLinearGradient(M, k, x, v);
      C.addColorStop(0, e.alpha(0, 2)), C.addColorStop(1, e.alpha(0.7 * (1 - w) * r.intensity, 2)), i.strokeStyle = C, i.lineWidth = 1.2 * c, i.beginPath(), i.moveTo(M, k), i.lineTo(x, v), i.stroke();
    }
}
const Gs = P({
  metadata: {
    id: "background-bokeh",
    displayName: "Background Bokeh",
    description: "Soft out-of-focus light discs that drift lazily and breathe like a shallow depth of field.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render(o) {
    pe(o, o.frame.progress * Math.PI * 2, !0);
  },
  renderReducedMotion(o) {
    pe(o, 0, !1);
  }
});
function pe({ frame: o, random: t, paint: e }, a, s) {
  const { ctx: i, options: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds();
  i.globalCompositeOperation = "lighter";
  for (let f = 0; f < 18; f += 1) {
    const u = t(), d = t(), p = 0.02 + t() * 0.04, b = 0.015 + t() * 0.03, m = 1 + Math.floor(t() * 2), g = 1 + Math.floor(t() * 2), y = t() * Math.PI * 2, w = (0.04 + t() * 0.09) * Math.min(n, h), S = t(), x = s ? 0.85 + 0.15 * Math.sin(a * 2 + y * 3) : 1, v = r + (u + Math.sin(a * m + y) * p) * n, M = c + (d + Math.cos(a * g + y) * b) * h, k = (0.06 + 0.1 * S) * x * l.intensity, C = S > 0.72 ? 2 : S > 0.4 ? 0 : 1, R = i.createRadialGradient(v, M, 0, v, M, w);
    R.addColorStop(0, e.alpha(k * 0.7, C)), R.addColorStop(0.72, e.alpha(k, C)), R.addColorStop(1, e.alpha(0, C)), i.fillStyle = R, i.beginPath(), i.arc(v, M, w, 0, Math.PI * 2), i.fill();
  }
}
const _s = Object.freeze([
  { key: "strikes", label: "Strike count", description: "Primary strikes in each loop.", kind: "number", defaultValue: 3, min: 1, max: 6, step: 1 },
  { key: "branching", label: "Branching", description: "Density of forks and secondary arcs.", kind: "number", defaultValue: 1, min: 0.25, max: 2, step: 0.05 },
  { key: "chaos", label: "Bolt chaos", description: "Horizontal irregularity of each discharge.", kind: "number", defaultValue: 1, min: 0.2, max: 2, step: 0.05 },
  { key: "flash", label: "Flash energy", description: "Brightness of the scene-wide electrical flash.", kind: "number", defaultValue: 1, min: 0.25, max: 1.75, step: 0.05 },
  { key: "bloom", label: "Electric bloom", description: "Blue atmospheric glow around the white core.", kind: "number", defaultValue: 1, min: 0.25, max: 2, step: 0.05 }
]), $s = P({
  metadata: {
    id: "background-lightning",
    displayName: "Background Lightning",
    description: "White-hot forked lightning with deep branching, blue atmospheric bloom, impact glow, and secondary flashes.",
    category: "backgrounds",
    targets: ["background"]
  },
  parameters: _s,
  palette: ["#75a7ff", "#24104f", "#f8fbff", "#b9d7ff"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = mt(i.parameters?.strikes, 3), u = mt(i.parameters?.branching, 1), d = mt(i.parameters?.chaos, 1), p = mt(i.parameters?.flash, 1), b = mt(i.parameters?.bloom, 1), m = a.createLinearGradient(r, c, r, c + h);
    m.addColorStop(0, e.alpha(0.13 * i.intensity, 1)), m.addColorStop(0.5, e.alpha(0.055 * i.intensity, 0)), m.addColorStop(1, e.alpha(0.015 * i.intensity, 1)), a.fillStyle = m, a.fillRect(r, c, n, h);
    const g = Math.max(1, Math.round(f)), y = Array.from({ length: g }, (w, S) => 0.035 + S / g * 0.88 + t() * Math.min(0.045, 0.16 / g));
    for (let w = 0; w < y.length; w += 1) {
      const x = y[w], v = i.loop ? ((s - x) % 1 + 1) % 1 : s - x, M = w === g - 1 && g > 1 ? 2 : 1, k = Array.from({ length: M }, (_, Y) => Ws(t, r + n * (0.22 + t() * 0.56), c - h * 0.025, n, h * (0.78 + t() * 0.24), Y === 0 ? 16 : 11, u, d));
      if (v < 0 || v > 0.3)
        continue;
      const C = v / 0.3, R = Math.pow(1 - C, 1.55), E = Math.exp(-Math.pow((C - 0.38) / 0.085, 2)) * 0.68, T = Math.exp(-Math.pow((C - 0.68) / 0.055, 2)) * 0.28, A = Math.min(1.25, R + E + T) * i.intensity * p, L = 0.82 + 0.18 * Math.sin(C * 76 + w * 11), B = Math.max(0, A * L);
      a.globalCompositeOperation = "screen", a.fillStyle = e.alpha(0.07 * B, 2), a.fillRect(r, c, n, h);
      for (const _ of k) {
        const Y = _.path[0], q = _.path[_.path.length - 1], lt = a.createRadialGradient(Y[0], Y[1], 0, Y[0], Y[1], n * 0.14);
        lt.addColorStop(0, e.alpha(0.14 * B * b, 3)), lt.addColorStop(1, e.alpha(0, 0)), a.fillStyle = lt, a.fillRect(r, c, n, h * 0.42);
        const st = a.createRadialGradient(q[0], q[1], 0, q[0], q[1], Math.min(n, h) * 0.09);
        st.addColorStop(0, e.alpha(0.36 * B * b, 2)), st.addColorStop(0.28, e.alpha(0.17 * B * b, 0)), st.addColorStop(1, e.alpha(0, 0)), a.fillStyle = st, a.fillRect(q[0] - n * 0.15, q[1] - h * 0.15, n * 0.3, h * 0.3);
        const V = Math.max(1.2 * l, Math.min(n, h) * 65e-4);
        a.save(), a.lineCap = "round", a.lineJoin = "round", a.shadowColor = e.alpha(0.95 * B, 0), a.shadowBlur = V * 3.5 * b, bt(a, _.path, e.alpha(0.11 * B, 0), V * 4.1), a.shadowBlur = V * 1.8, bt(a, _.path, e.alpha(0.62 * B, 3), V * 1.8), a.shadowBlur = V * 0.8, bt(a, _.path, e.alpha(Math.min(1, 0.98 * B), 2), V * 0.62);
        for (const ut of _.branches)
          bt(a, ut, e.alpha(0.19 * B, 0), V * 2.4), bt(a, ut, e.alpha(0.82 * B, 2), V * 0.46);
        a.restore();
      }
    }
  },
  renderReducedMotion({ frame: o, paint: t }) {
    const { ctx: e, options: a } = o, { x: s, y: i, width: l, height: r } = o.target.bounds(), c = e.createRadialGradient(s + l * 0.55, i, 0, s + l * 0.55, i, Math.max(l, r) * 0.65);
    c.addColorStop(0, t.alpha(0.2 * a.intensity, 2)), c.addColorStop(0.45, t.alpha(0.08 * a.intensity, 0)), c.addColorStop(1, t.alpha(0, 1)), e.fillStyle = c, e.fillRect(s, i, l, r);
  }
});
function Ws(o, t, e, a, s, i, l, r) {
  const c = [[t, e]], n = (o() - 0.5) * a * 0.12;
  let h = t;
  for (let d = 1; d <= i; d += 1) {
    const p = d / i, b = (t + n * p - h) * 0.36;
    h += b + (o() - 0.5) * a * (0.055 - p * 0.025) * r, h = Math.min(t + a * 0.24, Math.max(t - a * 0.24, h)), c.push([h, e + s * p]);
  }
  const f = [], u = Math.max(1, Math.round((4 + o() * 3) * l));
  for (let d = 0; d < u; d += 1) {
    const p = 2 + Math.floor(o() * Math.max(2, i - 4)), b = c[p], m = o() < 0.5 ? -1 : 1, g = [b];
    let y = b[0], w = b[1];
    const S = 3 + Math.floor(o() * 4);
    for (let x = 1; x <= S; x += 1)
      y += m * a * (0.016 + o() * 0.035), w += s * (0.018 + o() * 0.038), g.push([y, w]);
    if (f.push(g), g.length >= 5 && o() > 0.38) {
      const x = g[2 + Math.floor(o() * (g.length - 3))], v = [x];
      let M = x[0], k = x[1];
      for (let C = 0; C < 3; C += 1)
        M += m * a * (0.012 + o() * 0.021), k += s * (0.012 + o() * 0.022), v.push([M, k]);
      f.push(v);
    }
  }
  return { path: c, branches: f };
}
function bt(o, t, e, a) {
  o.strokeStyle = e, o.lineWidth = a, o.beginPath();
  for (let s = 0; s < t.length; s += 1) {
    const [i, l] = t[s];
    s === 0 ? o.moveTo(i, l) : o.lineTo(i, l);
  }
  o.stroke();
}
function mt(o, t) {
  return typeof o == "number" && Number.isFinite(o) ? o : t;
}
const qs = P({
  metadata: {
    id: "background-confetti",
    displayName: "Background Confetti",
    description: "Vividly coloured confetti pieces that fall, sway, and tumble across the panel.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#ff5a7a", "#ffd34f", "#35d6ed", "#8affc1", "#c684ff", "#ff9d2e"],
  render({ frame: o, random: t, paint: e }) {
    const { ctx: a, progress: s, options: i, dpr: l } = o, { x: r, y: c, width: n, height: h } = o.target.bounds(), f = s * Math.PI * 2, u = i.loop ? 1 : I((1 - s) * 5) * I(s * 12);
    if (!(u <= 0.01))
      for (let d = 0; d < 60; d += 1) {
        const p = t(), b = t(), m = 1.25 * (1 + Math.floor(t() * 2)), g = 0.02 + t() * 0.04, y = 2 + Math.floor(t() * 3), w = (1 + Math.floor(t() * 3)) * (t() < 0.5 ? -1 : 1), S = t() * Math.PI * 2, x = (4 + t() * 5) * l, v = Math.floor(t() * 6), M = ((b + s * m) % 1.25 + 1.25) % 1.25 - 0.125, k = p + Math.sin(f * y + S) * g, C = r + k * n, R = c + M * h, E = f * w + S, T = Math.sin(f * (y + 2) + S * 2), A = x, L = x * 0.6 * Math.abs(T) + x * 0.15, B = Math.cos(E), _ = Math.sin(E);
        a.fillStyle = e.alpha(0.7 * u * (0.7 + 0.3 * Math.abs(T)) * i.intensity, v), a.beginPath(), a.moveTo(C - A / 2 * B + L / 2 * _, R - A / 2 * _ - L / 2 * B), a.lineTo(C + A / 2 * B + L / 2 * _, R + A / 2 * _ - L / 2 * B), a.lineTo(C + A / 2 * B - L / 2 * _, R + A / 2 * _ + L / 2 * B), a.lineTo(C - A / 2 * B - L / 2 * _, R - A / 2 * _ + L / 2 * B), a.closePath(), a.fill();
      }
  }
}), zs = P({
  metadata: {
    id: "background-radial-pulse",
    displayName: "Background Radial Pulse",
    description: "A breathing central glow with soft concentric rings that ripple outward in sequence.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = Math.hypot(r, c) / 2, u = 0.5 + 0.5 * Math.sin(a * Math.PI * 2);
    e.globalCompositeOperation = "lighter";
    const d = e.createRadialGradient(n, h, 0, n, h, Math.max(1, f * (0.3 + u * 0.12)));
    d.addColorStop(0, t.alpha((0.1 + 0.08 * u) * s.intensity, 0)), d.addColorStop(1, t.alpha(0, 0)), e.fillStyle = d, e.fillRect(i, l, r, c);
    for (let p = 0; p < 3; p += 1) {
      const b = (a + p / 3) % 1, m = N(b), g = Math.max(1, f * (0.08 + m * 0.95)), y = 0.16 * Math.sin(b * Math.PI) * s.intensity;
      if (y <= 0.01)
        continue;
      const w = Math.max(0, g * 0.78), S = e.createRadialGradient(n, h, w, n, h, g * 1.12), x = p % 3;
      S.addColorStop(0, t.alpha(0, x)), S.addColorStop(0.55, t.alpha(y, x)), S.addColorStop(1, t.alpha(0, x)), e.fillStyle = S, e.fillRect(i, l, r, c);
    }
  }
}), Us = P({
  metadata: {
    id: "background-color-cycle",
    displayName: "Background Color Cycle",
    description: "A slow ambient wash of orbiting colour glows that crossfade through the palette.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame: o, paint: t }) {
    const { ctx: e, progress: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = a * Math.PI * 2, h = Math.max(r, c) * 0.8, f = e.createLinearGradient(i, l, i + r, l + c);
    f.addColorStop(0, t.alpha(0.05 * s.intensity, 0)), f.addColorStop(0.5, t.alpha(0.05 * s.intensity, 1)), f.addColorStop(1, t.alpha(0.05 * s.intensity, 2)), e.fillStyle = f, e.fillRect(i, l, r, c);
    for (let u = 0; u < 3; u += 1) {
      const d = 0.5 + 0.5 * Math.cos(n - u * Math.PI * 2 / 3), p = n + u * Math.PI * 2 / 3, b = i + r * (0.5 + 0.32 * Math.cos(p)), m = l + c * (0.5 + 0.32 * Math.sin(p)), g = e.createRadialGradient(b, m, 0, b, m, h);
      g.addColorStop(0, t.alpha(0.14 * d * s.intensity, u)), g.addColorStop(1, t.alpha(0, u)), e.fillStyle = g, e.fillRect(i, l, r, c);
    }
  }
}), Fs = P({
  metadata: {
    id: "background-vignette",
    displayName: "Background Vignette",
    description: "A gently breathing dark vignette that frames the panel with a faint accent rim.",
    category: "backgrounds",
    targets: ["background"]
  },
  palette: ["#0b0d1f", "#2b1762", "#35d6ed"],
  render(o) {
    const t = 0.5 + 0.5 * Math.sin(o.frame.progress * Math.PI * 2);
    ue(o, t);
  },
  renderReducedMotion(o) {
    ue(o, 0.5);
  }
});
function ue({ frame: o, paint: t }, e) {
  const { ctx: a, options: s } = o, { x: i, y: l, width: r, height: c } = o.target.bounds(), n = i + r / 2, h = l + c / 2, f = Math.hypot(r, c) / 2, u = f * (0.45 + 0.06 * e), d = (0.42 + 0.08 * e) * s.intensity, p = a.createRadialGradient(n, h, u, n, h, f);
  p.addColorStop(0, t.alpha(0, 0)), p.addColorStop(0.6, t.alpha(d * 0.45, 0)), p.addColorStop(1, t.alpha(d, 0)), a.fillStyle = p, a.fillRect(i, l, r, c), a.globalCompositeOperation = "lighter";
  const b = a.createRadialGradient(n, h, u * 0.88, n, h, u * 1.18);
  b.addColorStop(0, t.alpha(0, 2)), b.addColorStop(0.5, t.alpha(0.05 * (0.6 + 0.4 * e) * s.intensity, 2)), b.addColorStop(1, t.alpha(0, 2)), a.fillStyle = b, a.fillRect(i, l, r, c);
}
const Xt = [
  // <effect-ids>
  "smoke-puff",
  "smoke-trail",
  "smoke-ring",
  "smoke-burst",
  "smoke-column",
  "smoke-floor-fog",
  "smoke-drift",
  "smoke-vortex",
  "smoke-impact",
  "smoke-reveal",
  "fire-flame",
  "fire-burst",
  "fire-trail",
  "fire-ring",
  "fire-embers",
  "fire-wall",
  "fire-aura",
  "fire-impact",
  "fire-wipe",
  "fire-inferno",
  "light-point-glow",
  "light-radial-pulse",
  "light-spotlight",
  "light-sweep",
  "light-beam",
  "light-rays",
  "light-neon-flicker",
  "light-strobe",
  "light-color-wash",
  "light-vignette-pulse",
  "light-backlight",
  "light-marquee",
  "shine-glint",
  "shine-sparkle",
  "shine-starburst",
  "shine-sweep",
  "shine-edge",
  "shine-halo",
  "shine-twinkle",
  "shine-gem",
  "shine-metal",
  "shine-rainbow",
  "laser-line",
  "laser-beam",
  "laser-scan",
  "laser-grid",
  "laser-crosshair",
  "laser-burst",
  "laser-fan",
  "laser-ring",
  "laser-bounce",
  "laser-target",
  "laser-chase",
  "laser-vortex",
  "symbol-win-pulse",
  "symbol-pop",
  "symbol-bounce",
  "symbol-shake",
  "symbol-spin",
  "symbol-flip",
  "symbol-glow",
  "symbol-outline",
  "symbol-explode",
  "symbol-particle-burst",
  "symbol-freeze",
  "symbol-electrify",
  "symbol-transform",
  "symbol-wild-reveal",
  "reel-spin-blur",
  "reel-speed-lines",
  "reel-stop-impact",
  "reel-anticipation",
  "reel-nudge",
  "reel-bounce",
  "reel-shake",
  "reel-glow",
  "reel-win-frame",
  "reel-cascade",
  "reel-wipe",
  "reel-lock",
  "button-hover-glow",
  "button-press",
  "button-ripple",
  "button-pulse",
  "button-shine",
  "button-spark",
  "button-charge",
  "button-disabled",
  "button-win",
  "button-attention",
  "background-particles",
  "background-parallax",
  "background-aurora",
  "background-stars",
  "background-bokeh",
  "background-lightning",
  "background-confetti",
  "background-radial-pulse",
  "background-color-cycle",
  "background-vignette"
  // </effect-ids>
], Le = [
  // <effect-definitions>
  qa,
  za,
  Ua,
  Fa,
  Da,
  Xa,
  Ya,
  ja,
  Va,
  Ja,
  Za,
  Qa,
  Ka,
  to,
  eo,
  ao,
  oo,
  so,
  io,
  no,
  po,
  uo,
  go,
  bo,
  mo,
  yo,
  wo,
  xo,
  So,
  vo,
  Mo,
  ko,
  Co,
  Po,
  Ro,
  Io,
  Eo,
  Ao,
  To,
  No,
  Bo,
  Lo,
  Ho,
  Oo,
  Go,
  _o,
  $o,
  Wo,
  qo,
  zo,
  Uo,
  Fo,
  Do,
  Xo,
  Yo,
  jo,
  Vo,
  Jo,
  Zo,
  Qo,
  Ko,
  ts,
  es,
  as,
  os,
  ss,
  is,
  ns,
  rs,
  ls,
  cs,
  hs,
  ds,
  fs,
  ps,
  us,
  gs,
  bs,
  ms,
  ys,
  xs,
  Ss,
  vs,
  Ms,
  Cs,
  Ps,
  Rs,
  Is,
  Es,
  As,
  Ts,
  Bs,
  Hs,
  Os,
  Gs,
  $s,
  qs,
  zs,
  Us,
  Fs
  // </effect-definitions>
], Yt = Ds(Le);
Object.freeze(Le.map((o) => o.metadata));
function Ds(o) {
  const t = /* @__PURE__ */ new Map();
  for (const e of o) {
    const a = e.metadata.id;
    if (t.has(a))
      throw new Error(`Duplicate slot effect registration: ${a}`);
    t.set(a, e);
  }
  return Object.freeze(Object.fromEntries(t));
}
class He {
  ctx;
  mode;
  dpr;
  reducedMotion;
  clearBeforeRender;
  #t = [];
  #n = 0;
  constructor(t, e = {}) {
    this.ctx = t, this.mode = e.mode ?? "production", this.dpr = e.dpr ?? globalThis.devicePixelRatio ?? 1, this.reducedMotion = e.reducedMotion ?? !1, this.clearBeforeRender = e.clearBeforeRender ?? !1;
  }
  play(t, e, a = {}, s = performance.now()) {
    const i = Yt[t];
    if (!i)
      throw new Error(`Unknown slot effect: ${t}`);
    if (!i.metadata.targets.includes(e.kind))
      throw new Error(`Effect ${t} does not support target kind ${e.kind}`);
    const l = i.create(e, a);
    return l.start(s), this.#t.push(l), l;
  }
  tick(t = performance.now()) {
    this.clearBeforeRender && this.#d();
    const e = this.#n === 0 ? 0 : Math.max(0, t - this.#n);
    this.#n = t, this.#t.sort((s, i) => s.options.zIndex - i.options.zIndex);
    for (const s of this.#t) {
      s.update(t, e);
      const i = Math.max(1, s.options.durationMs), l = s.elapsedMs(), r = {
        ctx: this.ctx,
        nowMs: t,
        deltaMs: e,
        elapsedMs: l,
        progress: s.options.loop ? l % i / i : Math.min(1, l / i),
        target: s.target,
        options: s.options,
        mode: this.mode,
        reducedMotion: this.reducedMotion,
        dpr: this.dpr
      };
      this.ctx.save();
      try {
        if (s.options.blendMode && (this.ctx.globalCompositeOperation = s.options.blendMode), s.target.clip) {
          const c = s.target.bounds();
          this.ctx.beginPath(), this.ctx.rect(c.x, c.y, c.width, c.height), this.ctx.clip();
        }
        s.render(r);
      } finally {
        this.ctx.restore();
      }
    }
    this.#t.filter((s) => s.isComplete()).forEach((s) => s.destroy()), this.#t = this.#t.filter((s) => !s.isComplete());
  }
  stop(t) {
    t.stop();
  }
  clear() {
    this.#t.forEach((t) => t.destroy()), this.#t = [], this.clearBeforeRender && this.#d();
  }
  destroy() {
    this.clear();
  }
  get activeCount() {
    return this.#t.length;
  }
  #d() {
    this.ctx.save();
    try {
      this.ctx.resetTransform(), this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    } finally {
      this.ctx.restore();
    }
  }
}
const J = (o) => ({ mode: "continuous", durationMs: o }), Tt = (o, t, e) => ({ mode: "random-interval", durationMs: o, minIntervalMs: t, maxIntervalMs: e }), Xs = Object.freeze([
  { effectId: "background-particles", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: J(4e3), defaultIntensity: 0.7 },
  { effectId: "background-stars", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: J(5e3), defaultIntensity: 0.7 },
  { effectId: "background-bokeh", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: J(5e3), defaultIntensity: 0.65 },
  { effectId: "background-aurora", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: J(6e3), defaultIntensity: 0.65 },
  { effectId: "background-color-cycle", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: J(7e3), defaultIntensity: 0.55 },
  { effectId: "light-beam", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: J(5e3), defaultIntensity: 0.65 },
  { effectId: "light-rays", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: J(7e3), defaultIntensity: 0.55 },
  { effectId: "light-point-glow", allowedScopes: ["full-background", "anchored"], defaultScope: "anchored", defaultPlayback: J(3500), defaultIntensity: 0.7 },
  { effectId: "smoke-drift", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: J(7e3), defaultIntensity: 0.6 },
  { effectId: "smoke-floor-fog", allowedScopes: ["full-background", "anchored"], defaultScope: "full-background", defaultPlayback: J(7e3), defaultIntensity: 0.6 },
  { effectId: "background-lightning", allowedScopes: ["full-background"], defaultScope: "full-background", defaultPlayback: Tt(2900, 6e3, 14e3), defaultIntensity: 0.8 },
  { effectId: "shine-sparkle", allowedScopes: ["anchored"], defaultScope: "anchored", defaultPlayback: Tt(1600, 2500, 7e3), defaultIntensity: 0.9 },
  { effectId: "shine-glint", allowedScopes: ["anchored"], defaultScope: "anchored", defaultPlayback: Tt(1200, 2500, 7e3), defaultIntensity: 0.9 },
  { effectId: "shine-twinkle", allowedScopes: ["anchored"], defaultScope: "anchored", defaultPlayback: J(3e3), defaultIntensity: 0.7 }
]);
Object.freeze(Xs.map((o) => o.effectId));
function Ys(o, t, e, a, s, i = !0, l) {
  return {
    kind: o,
    clip: i,
    bounds: () => ({ x: t, y: e, width: a, height: s })
  };
}
function js(o, t, e, a, s) {
  const i = Math.max(1, t), l = Math.max(1, e), r = Math.max(a / i, s / l), c = i * r, n = l * r, h = (a - c) / 2, f = (s - n) / 2;
  return {
    x: h + o.x * c,
    y: f + o.y * n,
    width: o.width * c,
    height: o.height * n
  };
}
class Vs {
  canvas;
  manager;
  reducedMotion;
  #t = [];
  #n = [];
  #d = 1;
  #r = 1;
  constructor(t, e = {}) {
    const a = t.getContext("2d");
    if (!a) throw new Error("Ambient effects require a 2D canvas context");
    this.canvas = t, this.reducedMotion = e.reducedMotion ?? !1, this.manager = new He(a, { mode: e.mode ?? "production", dpr: 1, reducedMotion: this.reducedMotion, clearBeforeRender: !0 });
  }
  setSourceSize(t, e) {
    this.#d = Math.max(1, t), this.#r = Math.max(1, e);
  }
  configure(t, e, a = performance.now()) {
    this.manager.clear(), this.#n = [...e], this.#t = [];
    for (const [s, i] of t.entries()) {
      const l = structuredClone(i);
      if (!l.enabled || !Xt.includes(l.effectId)) continue;
      const r = Be(l.options.seed), c = { config: l, random: r, nextAt: a, zIndex: s };
      l.playback.mode === "continuous" ? this.#m(c, !0, a) : c.nextAt = a + this.#G(c), this.#t.push(c);
    }
  }
  tick(t = performance.now()) {
    if (!this.reducedMotion)
      for (const e of this.#t)
        e.config.playback.mode !== "random-interval" || t < e.nextAt || (this.#m(e, !1, t), e.nextAt = t + e.config.playback.durationMs + this.#G(e));
    this.manager.tick(t);
  }
  trigger(t, e = performance.now()) {
    const a = this.#t.find((s) => s.config.instanceId === t);
    a && !this.reducedMotion && this.#m(a, !1, e);
  }
  destroy() {
    this.#t = [], this.manager.destroy();
  }
  #G(t) {
    if (t.config.playback.mode !== "random-interval") return t.config.playback.durationMs;
    const { minIntervalMs: e, maxIntervalMs: a } = t.config.playback;
    return e + t.random() * Math.max(0, a - e);
  }
  #m(t, e, a) {
    const s = t.config.effectId, i = Yt[s];
    if (!i) return;
    const l = this.#w(t.config, i.metadata.targets);
    l && this.manager.play(s, l, {
      durationMs: t.config.playback.durationMs,
      loop: e,
      intensity: t.config.options.intensity,
      seed: t.config.options.seed,
      zIndex: t.zIndex,
      palette: t.config.options.palette?.length ? t.config.options.palette : this.#n,
      ...t.config.options.parameters ? { parameters: t.config.options.parameters } : {}
    }, a);
  }
  #w(t, e) {
    const a = t.scope === "full-background" ? ["background", "overlay"].find((s) => e.includes(s)) : ["overlay", "background"].find((s) => e.includes(s));
    if (a)
      return {
        kind: a,
        id: t.instanceId,
        clip: !0,
        bounds: () => t.scope === "anchored" && t.anchor ? js(t.anchor, this.#d, this.#r, this.canvas.width, this.canvas.height) : { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
      };
  }
}
function Js(o, t) {
  const e = Math.min(1, Math.max(0, (t - o.startTime) / o.duration)), a = e * e, s = a * e, i = o.entryVelocity * o.duration, l = o.startPosition + (s - 2 * a + e) * i + (-2 * s + 3 * a) * o.distance, r = (3 * a - 4 * e + 1) * i + (-6 * a + 6 * e) * o.distance;
  return { position: e >= 1 ? o.targetPosition : l, velocity: e >= 1 ? 0 : Math.max(0, r / o.duration), complete: e >= 1 };
}
const Nt = "1.0";
function it(o, t) {
  if (!o || typeof o != "object" || Array.isArray(o))
    throw new Error(`${t} must be an object`);
  return o;
}
function Q(o, t, e = 400) {
  if (typeof o != "string" || !o.trim() || o.length > e || /[\u0000-\u001f\u007f]/.test(o))
    throw new Error(`${t} must be a non-empty printable string of at most ${e} characters`);
  return o;
}
function dt(o, t) {
  const e = Q(o, t, 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(e))
    throw new Error(`${t} must be a lower-case hyphenated id`);
  return e;
}
function X(o, t, e, a) {
  if (typeof o != "number" || !Number.isFinite(o) || o < e || o > a)
    throw new Error(`${t} must be between ${e} and ${a}`);
  return o;
}
function nt(o, t, e) {
  const a = Object.keys(o).filter((s) => !t.includes(s));
  if (a.length)
    throw new Error(`${e} contains unsupported fields: ${a.join(", ")}`);
}
function Zs(o, t) {
  const e = it(o, "Spine project");
  if (nt(e, ["schemaVersion", "sourceSha256", "sourcePath", "model", "imageType", "description", "kind", "anchors", "bones", "animations", "updatedAt"], "Spine project"), e.schemaVersion !== Nt)
    throw new Error(`Spine project schemaVersion must be ${Nt}`);
  const a = Q(e.sourceSha256, "sourceSha256", 64);
  if (!/^[a-f0-9]{64}$/.test(a))
    throw new Error("sourceSha256 must be a lower-case SHA-256 digest");
  const s = e.kind ?? "body";
  if (s !== "body" && s !== "head")
    throw new Error("kind must be body or head");
  if (!Array.isArray(e.anchors) || e.anchors.length < 1 || e.anchors.length > 128)
    throw new Error("anchors must contain 1-128 entries");
  const i = /* @__PURE__ */ new Set(), l = e.anchors.map((u, d) => {
    const p = it(u, `anchors[${d}]`);
    nt(p, ["id", "label", "x", "y", "type", "radius", "weight"], `anchors[${d}]`);
    const b = dt(p.id, `anchors[${d}].id`);
    if (i.has(b))
      throw new Error(`Duplicate anchor id: ${b}`);
    if (i.add(b), p.type !== "root" && p.type !== "joint" && p.type !== "tip")
      throw new Error(`anchors[${d}].type is invalid`);
    const m = p.type;
    return { id: b, label: Q(p.label, `anchors[${d}].label`, 80), x: X(p.x, `anchors[${d}].x`, 0, 1), y: X(p.y, `anchors[${d}].y`, 0, 1), type: m, radius: p.radius === void 0 ? void 0 : X(p.radius, `anchors[${d}].radius`, 1e-3, 0.5), weight: p.weight === void 0 ? void 0 : X(p.weight, `anchors[${d}].weight`, 0, 1) };
  });
  if (!Array.isArray(e.bones) || e.bones.length > 256)
    throw new Error("bones must contain 0-256 entries");
  const r = /* @__PURE__ */ new Set(), c = e.bones.map((u, d) => {
    const p = it(u, `bones[${d}]`);
    nt(p, ["id", "from", "to", "parent"], `bones[${d}]`);
    const b = dt(p.id, `bones[${d}].id`), m = dt(p.from, `bones[${d}].from`), g = dt(p.to, `bones[${d}].to`);
    if (r.has(b))
      throw new Error(`Duplicate bone id: ${b}`);
    if (r.add(b), !i.has(m) || !i.has(g) || m === g)
      throw new Error(`bones[${d}] must connect two different known anchors`);
    const y = p.parent === void 0 ? void 0 : dt(p.parent, `bones[${d}].parent`);
    return { id: b, from: m, to: g, ...y ? { parent: y } : {} };
  });
  for (const u of c)
    if (u.parent && (!r.has(u.parent) || u.parent === u.id))
      throw new Error(`Bone ${u.id} has an invalid parent`);
  const n = l.map((u) => {
    const d = c.filter((m) => m.from === u.id || m.to === u.id).flatMap((m) => {
      const g = m.from === u.id ? m.to : m.from, y = l.find((w) => w.id === g);
      return y ? [Math.hypot(u.x - y.x, u.y - y.y)] : [];
    }), p = d.length ? Math.max(...d) * (s === "head" ? 1.25 : 1.5) : s === "head" ? 0.02 : 0.1, b = u.radius ?? Math.min(s === "head" ? 0.05 : 0.25, Math.max(s === "head" ? 8e-3 : 0.04, p));
    return { id: u.id, label: u.label, x: u.x, y: u.y, type: u.type, radius: b, weight: u.weight ?? 1 };
  });
  if (!Array.isArray(e.animations) || e.animations.length < 1 || e.animations.length > 32)
    throw new Error("animations must contain 1-32 entries");
  const h = /* @__PURE__ */ new Set(), f = e.animations.map((u, d) => {
    const p = it(u, `animations[${d}]`);
    nt(p, ["id", "name", "description", "duration", "enabled", "intensity", "speed", "playback", "keyframes"], `animations[${d}]`);
    const b = dt(p.id, `animations[${d}].id`);
    if (h.has(b))
      throw new Error(`Duplicate animation id: ${b}`);
    h.add(b);
    const m = X(p.duration, `animations[${d}].duration`, 0.1, 60);
    if (typeof p.enabled != "boolean")
      throw new Error(`animations[${d}].enabled must be boolean`);
    const g = it(p.playback, `animations[${d}].playback`);
    let y;
    if (g.mode === "continuous")
      nt(g, ["mode"], `animations[${d}].playback`), y = { mode: "continuous" };
    else if (g.mode === "random-interval") {
      nt(g, ["mode", "minIntervalMs", "maxIntervalMs"], `animations[${d}].playback`);
      const x = X(g.minIntervalMs, `animations[${d}].playback.minIntervalMs`, 100, 6e5), v = X(g.maxIntervalMs, `animations[${d}].playback.maxIntervalMs`, x, 6e5);
      y = { mode: "random-interval", minIntervalMs: x, maxIntervalMs: v };
    } else
      throw new Error(`animations[${d}].playback.mode is invalid`);
    if (!Array.isArray(p.keyframes) || p.keyframes.length < 2 || p.keyframes.length > 256)
      throw new Error(`animations[${d}].keyframes must contain 2-256 entries`);
    let w = -1;
    const S = p.keyframes.map((x, v) => {
      const M = it(x, `animations[${d}].keyframes[${v}]`);
      nt(M, ["time", "anchors"], `animations[${d}].keyframes[${v}]`);
      const k = X(M.time, `animations[${d}].keyframes[${v}].time`, 0, m);
      if (k < w)
        throw new Error(`Animation ${b} keyframes must be time ordered`);
      w = k;
      const C = it(M.anchors, `animations[${d}].keyframes[${v}].anchors`), R = {};
      for (const [E, T] of Object.entries(C)) {
        if (!i.has(E))
          throw new Error(`Animation ${b} references unknown anchor ${E}`);
        const A = it(T, `${b}.${E}`);
        nt(A, ["rotation", "translateX", "translateY", "scale"], `${b}.${E}`), R[E] = { rotation: X(A.rotation, `${b}.${E}.rotation`, -180, 180), translateX: X(A.translateX, `${b}.${E}.translateX`, -1, 1), translateY: X(A.translateY, `${b}.${E}.translateY`, -1, 1), scale: X(A.scale, `${b}.${E}.scale`, 0.01, 10) };
      }
      return { time: k, anchors: R };
    });
    if (S[0].time !== 0 || S.at(-1).time !== m)
      throw new Error(`Animation ${b} must start at 0 and end at its duration`);
    return { id: b, name: Q(p.name, `animations[${d}].name`, 80), description: Q(p.description, `animations[${d}].description`, 240), duration: m, enabled: p.enabled, intensity: X(p.intensity, `animations[${d}].intensity`, 0, 5), speed: X(p.speed, `animations[${d}].speed`, 0.1, 3), playback: y, keyframes: S };
  });
  return { schemaVersion: Nt, sourceSha256: a, sourcePath: Q(e.sourcePath, "sourcePath", 240), model: Q(e.model, "model", 100), imageType: Q(e.imageType, "imageType", 80), description: Q(e.description, "description"), kind: s, anchors: n, bones: c, animations: f, updatedAt: Q(e.updatedAt, "updatedAt", 64) };
}
function St() {
  return { rotation: 0, translateX: 0, translateY: 0, scale: 1 };
}
function Qs(o) {
  return o * o * (3 - 2 * o);
}
function ge(o, t) {
  const e = o.keyframes;
  if (!e.length)
    return {};
  const a = Math.max(1e-3, o.duration), s = Math.min(a, Math.max(0, t));
  let i = e[0], l = e.at(-1);
  for (let h = 0; h < e.length - 1; h += 1)
    if (s >= e[h].time && s <= e[h + 1].time) {
      i = e[h], l = e[h + 1];
      break;
    }
  const r = l.time - i.time, c = Qs(r > 0 ? (s - i.time) / r : 0), n = {};
  for (const h of /* @__PURE__ */ new Set([...Object.keys(i.anchors), ...Object.keys(l.anchors)])) {
    const f = i.anchors[h] ?? St(), u = l.anchors[h] ?? St();
    n[h] = { rotation: f.rotation + (u.rotation - f.rotation) * c, translateX: f.translateX + (u.translateX - f.translateX) * c, translateY: f.translateY + (u.translateY - f.translateY) * c, scale: f.scale + (u.scale - f.scale) * c };
  }
  return n;
}
function Ks(o) {
  const t = {};
  for (const e of o)
    for (const [a, s] of Object.entries(e.transforms)) {
      const i = t[a] ??= St();
      i.rotation += s.rotation * e.intensity, i.translateX += s.translateX * e.intensity, i.translateY += s.translateY * e.intensity, i.scale *= 1 + (s.scale - 1) * e.intensity;
    }
  return t;
}
class ti {
  project;
  random;
  states = /* @__PURE__ */ new Map();
  constructor(t, e = Math.random) {
    this.project = t, this.random = e, this.reset();
  }
  reset(t = performance.now()) {
    this.states.clear();
    for (const e of this.project.animations)
      this.states.set(e.id, { startedAt: void 0, nextAt: t + this.interval(e) });
  }
  setProject(t) {
    this.project = t, this.reset();
  }
  interval(t) {
    return t.playback.mode === "continuous" ? 0 : t.playback.minIntervalMs + this.random() * Math.max(0, t.playback.maxIntervalMs - t.playback.minIntervalMs);
  }
  sample(t) {
    const e = [];
    for (const a of this.project.animations) {
      if (!a.enabled)
        continue;
      const s = this.states.get(a.id) ?? { startedAt: void 0, nextAt: t + this.interval(a) };
      this.states.set(a.id, s);
      const i = Math.max(0.1, a.speed);
      if (a.playback.mode === "continuous") {
        e.push({ transforms: ge(a, t / 1e3 * i % Math.max(1e-3, a.duration)), intensity: a.intensity });
        continue;
      }
      if (s.startedAt === void 0 && t >= s.nextAt && (s.startedAt = t), s.startedAt === void 0)
        continue;
      const l = (t - s.startedAt) / 1e3 * i;
      if (l >= a.duration) {
        s.startedAt = void 0, s.nextAt = t + this.interval(a);
        continue;
      }
      e.push({ transforms: ge(a, l), intensity: a.intensity });
    }
    return Ks(e);
  }
}
function Bt(o, t, e, a) {
  const s = o - e, i = t - a, l = Math.hypot(s, i);
  return l > 1e-3 ? { x: o + s / l * 0.75, y: t + i / l * 0.75 } : { x: o, y: t };
}
function ei(o, t, e, a = 1) {
  const s = {};
  let i = 0;
  for (const l of o.anchors) {
    const r = Math.hypot(t - l.x, (e - l.y) * a);
    if (r >= l.radius || l.weight <= 0)
      continue;
    const c = r / l.radius, n = (1 - c) ** 4 * (1 + 4 * c) * l.weight;
    n <= 0 || (s[l.id] = n, i += n);
  }
  if (i > 1)
    for (const l of Object.keys(s))
      s[l] = s[l] / i;
  return s;
}
function ai(o, t) {
  const e = Math.hypot(t.translateX, t.translateY), a = o.radius * 0.75, s = e > a && e > 0 ? a / e : 1;
  return { rotation: Math.min(45, Math.max(-45, t.rotation)), translateX: t.translateX * s, translateY: t.translateY * s, scale: Math.min(2, Math.max(0.25, t.scale)) };
}
function be(o, t, e, a) {
  const s = o + t, i = Array.from({ length: e + 1 }, (l, r) => o + r / e * t);
  for (const l of a)
    l > o && l < s && i.push(l);
  return [...new Map(i.sort((l, r) => l - r).map((l) => [l.toFixed(7), l])).values()];
}
function oi(o, t, e, a, s = 1) {
  const i = [], l = [];
  for (const r of o) {
    if (r.kind !== "head")
      continue;
    const c = new Set(r.animations.flatMap((n) => n.keyframes.flatMap((h) => Object.keys(h.anchors))));
    for (const n of r.anchors) {
      if (!c.has(n.id) || n.weight <= 0)
        continue;
      i.push(n.x - n.radius, n.x - n.radius * 0.5, n.x, n.x + n.radius * 0.5, n.x + n.radius);
      const h = n.radius / s;
      l.push(n.y - h, n.y - h * 0.5, n.y, n.y + h * 0.5, n.y + h);
    }
  }
  return { u: be(t.x, t.width, e, i), v: be(t.y, t.height, a, l) };
}
class si {
  canvas;
  image;
  context;
  baseColumns;
  baseRows;
  viewport;
  columns;
  rows;
  projects;
  vertices = [];
  triangles = [];
  constructor(t, e, a, s, i, l = { x: 0, y: 0, width: 1, height: 1 }) {
    this.canvas = t, this.image = e;
    const r = t.getContext("2d");
    if (!r)
      throw new Error("Canvas rendering is unavailable");
    this.context = r, this.projects = Array.isArray(a) ? a : [a];
    const c = this.projects.some((n) => n.kind === "head");
    this.baseColumns = s ?? (c ? 20 : 10), this.baseRows = i ?? (c ? 30 : 15), this.columns = this.baseColumns, this.rows = this.baseRows, this.viewport = l, this.rebuild();
  }
  get project() {
    return this.projects[0];
  }
  setProject(t) {
    this.projects = [t], this.rebuild();
  }
  setProjects(t) {
    this.projects = t, this.rebuild();
  }
  screen(t, e) {
    return { x: (t - this.viewport.x) / this.viewport.width * this.canvas.width, y: (e - this.viewport.y) / this.viewport.height * this.canvas.height };
  }
  imageAspect() {
    const t = this.image, e = t.naturalWidth || t.width, a = t.naturalHeight || t.height;
    return e > 0 ? a / e : 1;
  }
  rebuild() {
    this.vertices = [], this.triangles = [];
    const t = this.imageAspect(), e = oi(this.projects, this.viewport, this.baseColumns, this.baseRows, t);
    this.columns = e.u.length - 1, this.rows = e.v.length - 1;
    for (let a = 0; a <= this.rows; a += 1)
      for (let s = 0; s <= this.columns; s += 1) {
        const i = e.u[s], l = e.v[a], r = this.projects.map((c) => ei(c, i, l, t));
        this.vertices.push({ x: i, y: l, ox: i, oy: l, u: i, v: l, weights: r });
      }
    for (let a = 0; a < this.rows; a += 1)
      for (let s = 0; s < this.columns; s += 1) {
        const i = a * (this.columns + 1) + s, l = i + 1, r = (a + 1) * (this.columns + 1) + s, c = r + 1;
        this.triangles.push(i, l, r, l, c, r);
      }
  }
  deform(t) {
    const e = Array.isArray(t) ? t : [t];
    for (const a of this.vertices) {
      let s = 0, i = 0;
      for (let l = 0; l < this.projects.length; l += 1)
        for (const r of this.projects[l].anchors) {
          const c = a.weights[l]?.[r.id] ?? 0;
          if (c < 1e-4)
            continue;
          const n = ai(r, e[l]?.[r.id] ?? St()), h = n.rotation * Math.PI / 180, f = Math.cos(h), u = Math.sin(h), d = a.ox - r.x, p = a.oy - r.y;
          s += (r.x + (d * f - p * u) * n.scale + n.translateX - a.ox) * c, i += (r.y + (d * u + p * f) * n.scale + n.translateY - a.oy) * c;
        }
      a.x = a.ox + s, a.y = a.oy + i;
    }
  }
  render(t = {}, e = !1) {
    const a = Array.isArray(t) ? t : [t];
    this.deform(a);
    const s = this.context, i = this.canvas.width, l = this.canvas.height, r = this.image.width, c = this.image.height;
    s.clearRect(0, 0, i, l);
    for (let n = 0; n < this.triangles.length; n += 3) {
      const h = this.vertices[this.triangles[n]], f = this.vertices[this.triangles[n + 1]], u = this.vertices[this.triangles[n + 2]], d = this.screen(h.x, h.y), p = this.screen(f.x, f.y), b = this.screen(u.x, u.y), m = d.x, g = d.y, y = p.x, w = p.y, S = b.x, x = b.y, v = h.u * r, M = h.v * c, k = f.u * r, C = f.v * c, R = u.u * r, E = u.v * c, T = (k - v) * (E - M) - (R - v) * (C - M);
      if (Math.abs(T) < 1e-3)
        continue;
      const A = ((y - m) * (E - M) - (S - m) * (C - M)) / T, L = ((S - m) * (k - v) - (y - m) * (R - v)) / T, B = ((w - g) * (E - M) - (x - g) * (C - M)) / T, _ = ((x - g) * (k - v) - (w - g) * (R - v)) / T, Y = m - A * v - L * M, q = g - B * v - _ * M, lt = (m + y + S) / 3, st = (g + w + x) / 3, V = Bt(m, g, lt, st), ut = Bt(y, w, lt, st), jt = Bt(S, x, lt, st);
      s.save(), s.beginPath(), s.moveTo(V.x, V.y), s.lineTo(ut.x, ut.y), s.lineTo(jt.x, jt.y), s.closePath(), s.clip(), s.setTransform(A, B, L, _, Y, q), s.drawImage(this.image, 0, 0), s.restore();
    }
    e && this.drawRig(a);
  }
  drawRig(t) {
    const e = this.context;
    e.save(), e.lineWidth = Math.max(1.5, this.canvas.width / 300);
    for (let a = 0; a < this.projects.length; a += 1) {
      const s = this.projects[a], i = t[a] ?? {}, l = (r) => this.screen(r.x + (i[r.id]?.translateX ?? 0), r.y + (i[r.id]?.translateY ?? 0));
      e.strokeStyle = s.kind === "head" ? "#ffb45b" : "#f6c75e";
      for (const r of s.bones) {
        const c = s.anchors.find((u) => u.id === r.from), n = s.anchors.find((u) => u.id === r.to);
        if (!c || !n)
          continue;
        const h = l(c), f = l(n);
        e.beginPath(), e.moveTo(h.x, h.y), e.lineTo(f.x, f.y), e.stroke();
      }
      for (const r of s.anchors) {
        const c = l(r);
        e.fillStyle = r.type === "root" ? "#72e0b6" : r.type === "tip" ? "#ff9b62" : "#718cff", e.beginPath(), e.arc(c.x, c.y, r.type === "root" ? 6 : 5, 0, Math.PI * 2), e.fill();
      }
    }
    e.restore();
  }
  drawInfluence(t) {
    const e = this.screen(t.x, t.y), a = this.imageAspect(), s = t.radius / this.viewport.width * this.canvas.width, i = t.radius / a / this.viewport.height * this.canvas.height, l = this.context;
    l.save(), l.fillStyle = `rgba(113,140,255,${(0.06 + t.weight * 0.12).toFixed(3)})`, l.strokeStyle = `rgba(113,140,255,${(0.45 + t.weight * 0.5).toFixed(3)})`, l.lineWidth = Math.max(1.5, this.canvas.width / 360), l.setLineDash([7, 5]), l.beginPath(), l.ellipse(e.x, e.y, s, i, 0, 0, Math.PI * 2), l.fill(), l.stroke(), l.restore();
  }
}
async function ii(o, t) {
  if (o.shadowRoot?.querySelector("canvas.spine-runtime-character"))
    return;
  const e = t.assets.find((g) => g.role === "character-spine" || g.role === "character-spine-body"), a = t.assets.find((g) => g.role === "character-spine-head"), s = [e, a].filter((g) => !!g), i = t.assets.find((g) => g.role === "character" && (g.id === "character-idle" || !g.id.includes("win") && !g.id.includes("bonus"))), l = o.shadowRoot?.querySelector("img.character");
  if (!s.length || !i || !l || !o.shadowRoot)
    return;
  const r = (await Promise.all(s.map(async (g) => {
    const y = await fetch(new URL(g.path, o.assetBaseUrl));
    return y.ok ? Zs(await y.json()) : void 0;
  }))).filter((g) => !!g);
  if (!r.length || !l.isConnected)
    return;
  const c = new Image();
  if (c.decoding = "async", c.src = new URL(i.path, o.assetBaseUrl).href, await c.decode(), !c.naturalWidth || !l.isConnected)
    return;
  const n = document.createElement("canvas");
  n.className = "character spine-runtime-character", n.dataset.pose = "idle", n.dataset.rigCount = String(r.length), n.dataset.rigs = r.map((g) => g.kind ?? "body").join(","), n.setAttribute("aria-hidden", "true"), n.width = 512, n.height = Math.max(512, Math.round(512 * c.naturalHeight / c.naturalWidth)), n.style.aspectRatio = `${n.width} / ${n.height}`;
  const h = document.createElement("style");
  h.dataset.spineRuntime = "", h.textContent = `.spine-runtime-character{width:auto!important;aspect-ratio:${n.width}/${n.height}!important;visibility:hidden}.spine-runtime-character[data-active="true"]{visibility:visible}`, o.shadowRoot.append(h), l.after(n);
  const f = new si(n, c, r), u = r.map((g) => new ti(g)), d = matchMedia("(prefers-reduced-motion: reduce)").matches, p = () => {
    const g = (l.dataset.pose ?? "idle") === "idle";
    n.dataset.active = String(g), l.style.visibility = g ? "hidden" : "visible";
  }, b = new MutationObserver(p);
  b.observe(l, { attributes: !0, attributeFilter: ["data-pose", "src"] }), p();
  const m = (g) => {
    if (!n.isConnected || !o.isConnected) {
      b.disconnect(), l.style.visibility = "";
      return;
    }
    f.render(d ? r.map(() => ({})) : u.map((y) => y.sample(g))), requestAnimationFrame(m);
  };
  f.render(r.map(() => ({}))), requestAnimationFrame(m);
}
function ni(o, t) {
  const e = o?.[t];
  return e && Xt.includes(e) ? e : void 0;
}
function Ut(o, t) {
  if (!Array.isArray(o) || o.length !== t.length) return;
  const e = [];
  for (let a = 0; a < t.length; a += 1) {
    const s = o[a];
    if (!Array.isArray(s) || s.length !== t[a].length || s.some((i) => typeof i != "boolean")) return;
    e.push([...s]);
  }
  return e;
}
function ri(o, t, e) {
  const a = Ut(t, e);
  if (!a) return {};
  const s = Ut(o, e);
  return s ? s.every((l, r) => l.every((c, n) => !c || a[r][n])) ? { spinning: s, settled: a } : { settled: a } : { settled: a };
}
const li = `
:host([presentation="classic"]) {container-type:inline-size;font-family:Arial,sans-serif;width:100%}
:host([presentation="classic"]) .game.immersive {width:100%;height:auto;margin:0;background:#000;color:#fff;overflow:hidden}
:host([presentation="classic"]) .feature-strip,
:host([presentation="classic"]) .extras {display:none}
:host([presentation="classic"]) .bonus {background:rgba(0,0,0,.72);backdrop-filter:none}
:host([presentation="classic"]) .bonus-panel {width:min(760px,88%);padding:24px 28px;border:4px ridge #e7b545;border-radius:4px;background:linear-gradient(180deg,#6d2807,#2a0f05 72%,#120804);box-shadow:0 0 0 3px #301305,0 14px 42px #000;transform:translateY(10px) scale(.96)}
:host([presentation="classic"]) .bonus.active .bonus-panel {transform:none}
:host([presentation="classic"]) .bonus-panel h3 {font:700 clamp(22px,3.2cqw,42px)/1 Georgia,serif;color:#ffe66c;text-shadow:2px 2px #180600;letter-spacing:.04em}
:host([presentation="classic"]) .bonus-panel p {color:#fff1bf;font:700 clamp(12px,1.4cqw,19px)/1.2 Arial,sans-serif;letter-spacing:.04em}
:host([presentation="classic"]) .gamble-row {gap:clamp(18px,4cqw,44px);margin-top:18px}
:host([presentation="classic"]) .gamble-row .bonus-choice {min-width:clamp(130px,22cqw,240px);height:clamp(54px,8cqw,90px);border:5px ridge #b7b7b7;border-radius:50%;font:bold clamp(18px,2.4cqw,32px) Georgia,serif;text-transform:none;box-shadow:inset 0 8px 10px #fff8,inset 0 -10px 12px #000a,0 4px 0 #190b04}
:host([presentation="classic"]) .gamble-row .bonus-choice[data-style="red"] {background:linear-gradient(#ff9b9b 0 30%,#e22929 48%,#6d0505 100%);color:#fff}
:host([presentation="classic"]) .gamble-row .bonus-choice[data-style="black"] {background:linear-gradient(#d8d8d8 0 30%,#555 48%,#050505 100%);color:#fff}
:host([presentation="classic"]) .gamble-row .bonus-choice[data-style="gold"] {background:linear-gradient(#fff4b0,#d48f19 55%,#573006);color:#1b0d02}
:host([presentation="classic"]) .announce {border:4px ridge #e4b54a;border-radius:4px;background:linear-gradient(180deg,#f4d57b,#88420e 70%,#341507);box-shadow:0 0 0 3px #260d04,0 12px 36px #000;color:#fff}
:host([presentation="classic"]) .announce h3 {font-family:Georgia,serif;color:#fff4a9;text-shadow:2px 2px #3b1203}
:host([presentation="classic"]) dialog {width:min(820px,88%);max-height:80%;border:5px ridge #d9a631;border-radius:3px;padding:18px;background:linear-gradient(135deg,#e3c879,#76602c 55%,#d7be6c);color:#1a1005;box-shadow:0 0 0 3px #2d1405,0 18px 60px #000}
:host([presentation="classic"]) dialog::backdrop {background:rgba(0,0,0,.8)}
:host([presentation="classic"]) dialog h2 {font:700 clamp(22px,3cqw,38px) Georgia,serif;text-align:center;color:#3b1a05;text-shadow:1px 1px #fff2a4}
:host([presentation="classic"]) dialog table {width:100%;border-collapse:collapse;background:#170b05;color:#ffe36a;font:700 clamp(12px,1.4cqw,18px) Arial,sans-serif}
:host([presentation="classic"]) dialog th,:host([presentation="classic"]) dialog td {padding:8px;border:2px solid #8e6418;text-align:center}
:host([presentation="classic"]) dialog th {background:#552006;color:#fff1a5}
:host([presentation="classic"]) dialog .close {float:right;border:2px solid #7b4b12;background:#d7a72f;color:#211000;font:bold 22px Arial;cursor:pointer}
:host([presentation="classic"]) .game.immersive .stage {border-radius:0}
:host([presentation="classic"]) .game.immersive canvas.reel-canvas {aspect-ratio:1112/625}
:host([presentation="classic"]) .game.immersive .console.cabinet {position:relative;height:11.7cqw;margin:0;border:0;border-top:.35cqw solid #eead24;background:radial-gradient(ellipse at 48% -35%,#d05c16 0,#833110 65%,#39190c 100%);box-shadow:inset 0 .35cqw .4cqw #3b1a07}
:host([presentation="classic"]) .cab-message {position:absolute;left:9.35%;top:.65cqw;width:70.65%;height:5.9cqw;display:flex;align-items:center;justify-content:center;border:.25cqw solid #9d7b58;border-radius:1cqw;background:linear-gradient(#141518,#303033 55%,#171719);box-shadow:inset 0 0 .5cqw #000;font:bold 2.8cqw/1 Arial,sans-serif;color:#ffee42;letter-spacing:.06cqw}
:host([presentation="classic"]) .cab-meters {position:absolute;left:9.35%;top:6.95cqw;width:46%;height:5.7cqw;display:grid;grid-template-columns:1.15fr 1.05fr 1.35fr .88fr;gap:.7cqw;padding:0;border:0;border-radius:0;background:none;box-shadow:none}
:host([presentation="classic"]) .cab-meter {padding:0;border:0;background:none;box-shadow:none;overflow:visible}
:host([presentation="classic"]) .cab-meter small {height:1.4cqw;border:.14cqw solid #77624a;border-radius:.4cqw;background:linear-gradient(#232526,#414142);color:#eee;font:bold 1.1cqw/1.2 Arial,sans-serif;letter-spacing:0;text-transform:none}
:host([presentation="classic"]) .cab-meter strong {margin-top:.55cqw;height:3.4cqw;border:.3cqw ridge #aaa19a;border-radius:.6cqw;background:linear-gradient(#080606,#17110d);color:#ffee42;font:bold 2.25cqw/2.8cqw Arial,sans-serif;text-shadow:.1cqw .1cqw #443800}
:host([presentation="classic"]) .cab-meter {position:relative}
:host([presentation="classic"]) .cab-meter:nth-child(2) small,:host([presentation="classic"]) .cab-meter:nth-child(3) small {width:75%;margin:auto}
:host([presentation="classic"]) .cab-meter:nth-child(2) strong {width:36%;margin-left:32%}
:host([presentation="classic"]) .cab-meter:nth-child(3) strong {width:58%;margin-left:21%}
:host([presentation="classic"]) .meter-adjust {position:absolute;top:1.95cqw;width:26%;height:3.4cqw;padding:0;border:.3cqw ridge #a3a09b;border-radius:.45cqw;background:linear-gradient(#dadbd4,#8b8c86);color:#5b5d53;font:bold 2.3cqw Arial,sans-serif;opacity:1}
:host([presentation="classic"]) .meter-adjust:first-of-type {left:0}
:host([presentation="classic"]) .meter-adjust:last-of-type {right:0}
:host([presentation="classic"]) .cab-meter:nth-child(2) .meter-adjust:first-of-type,:host([presentation="classic"]) .cab-meter:nth-child(3) .meter-adjust:last-of-type {background:linear-gradient(#d0ffa5,#5ee036 50%,#339817);color:#145204}
:host([presentation="classic"]) .cab-meter:nth-child(3) .meter-adjust {width:19%}
:host([presentation="classic"]) .cab-meter.win-total {position:absolute;left:133%;top:-2.2cqw;width:17%;height:1cqw;display:flex;align-items:center;gap:.3cqw;opacity:.65}
:host([presentation="classic"]) .cab-meter.win-total small {background:none;border:0;font-size:.8cqw}
:host([presentation="classic"]) .cab-meter.win-total output {font:bold .9cqw Arial,sans-serif;color:#ffee42}
:host([presentation="classic"]) .cab-deck {display:contents}
:host([presentation="classic"]) .cab-key,:host([presentation="classic"]) .spin.cab-start {position:absolute;margin:0;min-width:0;padding:0;border:.36cqw ridge #c0b294;border-radius:.65cqw;text-transform:none;letter-spacing:0;font:bold 2cqw/1 Arial,sans-serif;text-shadow:.13cqw .13cqw #000;color:#fff;box-shadow:inset 0 .5cqw .45cqw #fff7,inset 0 -.5cqw .55cqw #0009;cursor:pointer}
:host([presentation="classic"]) .cab-key[data-key="autoplay"] {left:80.7%;top:.65cqw;width:12.35%;height:6.4cqw;background:linear-gradient(#deffc5 0,#8af236 25%,#3cbd04 48%,#087900 100%);color:#071900;text-shadow:0 .1cqw #aeed7d}
:host([presentation="classic"]) .cab-key.paytable {left:56.15%;top:6.1cqw;width:12.05%;height:3.2cqw;background:linear-gradient(#c0eaff,#2b8ef8 42%,#065daf 55%,#83c4f0)}
:host([presentation="classic"]) .cab-key[data-key="gamble"] {left:68.4%;top:6.1cqw;width:12%;height:3.2cqw;background:linear-gradient(#eee,#969696);color:#646464;text-shadow:0 .1cqw #eee;opacity:1}
:host([presentation="classic"]) .spin.cab-start {left:80.7%;top:6.1cqw;width:12.35%;height:3.2cqw;background:linear-gradient(#e8ffd9,#72ef2c 35%,#168f00 60%,#51d613);color:#082700;text-shadow:0 .1cqw #bdff8f}
:host([presentation="classic"]) .spin.cab-start:disabled {opacity:1;filter:none;cursor:default}
:host([presentation="classic"]) .cab-key:disabled {cursor:default;opacity:1;filter:none}
:host([presentation="classic"]) .spin.cab-start {display:flex;align-items:center;justify-content:center;gap:.55cqw}
:host([presentation="classic"]) .spin-icon {width:2.1cqw;height:2.1cqw;flex:none}
:host([presentation="classic"][reels-moving]) .spin-icon {animation:book-spin 1s linear infinite}
:host([presentation="classic"][reels-moving]) .win-message {opacity:0!important;transition:none}
:host([presentation="classic"][gamble-active]) .spin-icon {display:none}
@keyframes book-spin {to{transform:rotate(360deg)}}
/* Gamble replaces the reel window, with cabinet and lower controls preserved. */
:host([presentation="classic"]) .bonus.gamble-screen {inset:16.83% 6.74% 1.27% 8.72%;background:none;align-items:stretch}
:host([presentation="classic"]) .gamble-screen .bonus-panel {position:relative;width:100%;height:100%;padding:0;border:.55cqw ridge #ae6931;border-radius:2.5cqw;box-sizing:border-box;overflow:hidden;box-shadow:inset 0 0 0 .2cqw #f7c671;background:radial-gradient(ellipse at 69% 15%,#fff69e 0,#ffc34a 30%,#ed8a15 58%,#b12800 100%);transform:none}
:host([presentation="classic"]) .gamble-amount {position:absolute;left:3%;top:3%;color:#fff;font:bold 1.9cqw/1.4 Arial,sans-serif;text-shadow:.1cqw .1cqw #966622}
:host([presentation="classic"]) .gamble-amount output {display:block;color:#fff279;font-size:1.9cqw}
:host([presentation="classic"]) .gamble-history {position:absolute;left:19%;right:3%;top:18%;height:18%;display:flex;gap:3%;align-items:center;color:#fff;font:bold 1.65cqw Arial,sans-serif;text-shadow:.1cqw .1cqw #92651d}
:host([presentation="classic"]) .gamble-history>strong {width:38%;white-space:nowrap}
:host([presentation="classic"]) .gamble-history>div {display:flex;gap:.8cqw;flex:1;height:100%}
:host([presentation="classic"]) .card-back {display:block;box-sizing:border-box;border:.45cqw ridge #e8e7dd;background-color:#d76b85;background-image:repeating-conic-gradient(#fff5 0 25%,transparent 0 50%);background-size:4px 4px;box-shadow:0 0 0 .1cqw #8b5837,inset 0 0 0 .15cqw #fff8}
:host([presentation="classic"]) .gamble-history .card-back {flex:1}
:host([presentation="classic"]) .gamble-card {position:absolute;left:42.5%;top:44%;width:17%;height:44%;border-width:1cqw;border-radius:.5cqw;background-color:#2846a1;background-size:3px 3px}
:host([presentation="classic"]) .gamble-screen .gamble-row {position:absolute;inset:51% 7% 15%;display:flex;justify-content:space-between;margin:0;gap:0}
:host([presentation="classic"]) .gamble-screen .bonus-choice {width:30%;min-width:0;height:100%;border:.4cqw ridge #bdbdbd;font:bold 2.3cqw Arial,sans-serif;padding:0;letter-spacing:0;color:#111;text-shadow:0 .1cqw #fff9;background:linear-gradient(#f8f8f8,#dfdfdf 18%,#8a8a8a 34%,#e2e2e2 37%,#aaa 62%,#222 65%,#050505 95%);box-shadow:0 .2cqw .2cqw #4c220e,inset 0 0 0 .35cqw #202020}
:host([presentation="classic"]) .gamble-screen .bonus-choice[data-style="red"] {color:#b60000;background:linear-gradient(#ffe9e9,#fc8d8d 18%,#e50b0b 34%,#e2e2e2 37%,#aaa 62%,#d60000 65%,#6e0000 95%)}
:host([presentation="classic"]) .gamble-screen .bonus-choice[data-style="black"] {color:#111;background:linear-gradient(#f8f8f8,#aaa 18%,#333 34%,#e2e2e2 37%,#aaa 62%,#151515 65%,#000 95%)}
:host([presentation="classic"]) .gamble-screen .gamble-hint {position:absolute;bottom:2%;left:2%;right:2%;margin:0;font:1.3cqw Arial,sans-serif;letter-spacing:0;text-transform:none;color:#fff;text-shadow:1px 1px #632405}
:host([presentation="classic"][reference-state="06-gamble"]) .bonus.gamble-screen {left:18.895%;right:17.365%}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-screen .bonus-choice {font-size:1.85cqw}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-amount,:host([presentation="classic"][reference-state="06-gamble"]) .gamble-amount output {font-size:1.6cqw}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-history {font-size:1.6cqw}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-screen .gamble-hint {font-size:1.05cqw}
@media(prefers-reduced-motion:reduce){:host([presentation="classic"]) .spin-icon{animation:none!important}}
@media(min-width:601px) {
 :host([presentation="classic"][reference-state="06-gamble"]) .game.immersive canvas.reel-canvas {aspect-ratio:1/.423}
 :host([presentation="classic"]) .game.immersive .console.cabinet {height:14cqw}
 :host([presentation="classic"]) .cab-message {left:9.26%;top:.76cqw;width:70.77%;height:5.75cqw;font-size:2.8cqw}
 :host([presentation="classic"]) .cab-meters {top:6.84cqw}
 :host([presentation="classic"]) .cab-meter strong {font-size:2cqw;margin-top:.75cqw}
 :host([presentation="classic"]) .cab-meter:first-child small {width:88%;margin:auto}
 :host([presentation="classic"]) .cab-meter:nth-child(4) small {width:85%;margin:auto}
 :host([presentation="classic"]) .meter-adjust {top:2.15cqw}
 :host([presentation="classic"]) .cab-key.paytable,:host([presentation="classic"]) .cab-key[data-key="gamble"],:host([presentation="classic"]) .spin.cab-start {top:9cqw}
}
@media(max-width:600px) {
 :host([presentation="classic"]) .spin-icon {width:4.5cqw;height:4.5cqw}
 :host([presentation="classic"]) .gamble-amount,:host([presentation="classic"]) .gamble-amount output {font-size:3.1cqw}
 :host([presentation="classic"]) .gamble-history {left:5%;font-size:2.45cqw}
 :host([presentation="classic"]) .gamble-history>strong {white-space:normal;width:30%}
 :host([presentation="classic"]) .gamble-screen .bonus-choice {font-size:4cqw}
 :host([presentation="classic"]) .gamble-screen .gamble-hint {font-size:2.25cqw}
 :host([presentation="classic"]) .game.immersive canvas.reel-canvas {aspect-ratio:1/.78}
 :host([presentation="classic"]) .game.immersive .console.cabinet {height:48cqw;border-top-width:.8cqw}
 :host([presentation="classic"]) .cab-message {left:3%;width:94%;top:2cqw;height:9cqw;font-size:4.3cqw;border-width:.5cqw}
 :host([presentation="classic"]) .cab-meters {left:3%;top:13cqw;width:94%;height:12cqw;gap:1.2cqw;grid-template-columns:1.12fr .8fr 1.05fr 1fr}
 :host([presentation="classic"]) .cab-meter small {font-size:2.3cqw;height:3.4cqw;border-width:.3cqw}
 :host([presentation="classic"]) .cab-meter strong {font-size:4.5cqw;height:7cqw;line-height:6cqw;margin-top:.7cqw;border-width:.6cqw}
 :host([presentation="classic"]) .cab-meter:nth-child(2) strong,:host([presentation="classic"]) .cab-meter:nth-child(3) strong {width:100%;margin-left:0}
 :host([presentation="classic"]) .cab-meter:nth-child(2) small,:host([presentation="classic"]) .cab-meter:nth-child(3) small {width:100%}
 :host([presentation="classic"]) .meter-adjust {display:none}
 :host([presentation="classic"]) .cab-meter.win-total {left:35%;top:28.5cqw;width:30%;justify-content:center;opacity:1;gap:1cqw}
 :host([presentation="classic"]) .cab-meter.win-total small,:host([presentation="classic"]) .cab-meter.win-total output {font-size:2.6cqw}
 :host([presentation="classic"]) .cab-key,:host([presentation="classic"]) .spin.cab-start {top:27cqw!important;height:12cqw!important;border-width:.7cqw;border-radius:1cqw;font-size:3.15cqw}
 :host([presentation="classic"]) .cab-key[data-key="autoplay"] {left:3%;width:22%}
 :host([presentation="classic"]) .cab-key.paytable {left:27%;width:22%}
 :host([presentation="classic"]) .cab-key[data-key="gamble"] {left:51%;width:22%}
 :host([presentation="classic"]) .spin.cab-start {left:75%;width:22%}
}
`, Lt = (o, t, e) => {
  const a = o.createLinearGradient(t, 0, t + e, 0);
  for (const [s, i] of [[0, "#493008"], [0.12, "#926016"], [0.28, "#d89508"], [0.42, "#ffe374"], [0.52, "#a16a0a"], [0.7, "#e3ad29"], [0.88, "#795018"], [1, "#36200b"]]) a.addColorStop(s, i);
  return a;
};
function ci(o, t, e, a, s = "", i) {
  if (o.save(), o.scale(t / 1112, e / 630), !a) {
    o.fillStyle = "#000", o.fillRect(0, 0, 1112, 630);
    const n = o.createLinearGradient(0, 0, 0, 88);
    for (const [h, f] of [[0, "#260c29"], [0.35, "#7e294c"], [0.72, "#d06b83"], [1, "#f6d89a"]]) n.addColorStop(h, f);
    o.fillStyle = n, o.fillRect(0, 0, 1112, 90), o.fillStyle = "#fff5b9", o.beginPath(), o.arc(885, 53, 12, 0, Math.PI * 2), o.fill(), o.fillStyle = "#000", o.beginPath(), o.moveTo(0, 80), o.bezierCurveTo(320, 10, 550, 115, 855, 85), o.lineTo(900, 33), o.lineTo(931, 66), o.lineTo(965, 20), o.lineTo(1029, 85), o.lineTo(1112, 72), o.lineTo(1112, 110), o.lineTo(0, 110), o.fill(), o.restore();
    return;
  }
  s === "06-gamble" && (o.translate(137, 0), o.scale(0.754, 1));
  for (const [n, h] of [[92, 15], [622, 8]]) {
    const f = o.createLinearGradient(0, n, 0, n + h);
    f.addColorStop(0, "#6b2507"), f.addColorStop(0.25, "#e7b538"), f.addColorStop(0.5, "#ffdb58"), f.addColorStop(0.75, "#8d3902"), f.addColorStop(1, "#251704"), o.fillStyle = f, o.fillRect(88, n, 960, h);
  }
  for (const n of [0, 1038]) {
    const h = n === 0 ? 92 : 74;
    o.fillStyle = Lt(o, n, h), o.fillRect(n, 72, h, 550);
    for (let f = 0; f < 7; f++)
      o.fillStyle = "#ffcc4788", o.fillRect(n + 7 + f * 9, 80, 2, 542), o.fillStyle = "#492808aa", o.fillRect(n + 10 + f * 9, 80, 2, 542);
    o.fillStyle = Lt(o, n - 8, h + 16), o.beginPath(), o.moveTo(n - 15, 21), o.bezierCurveTo(n + 6, -6, n + 70, -6, n + 94, 21), o.lineTo(n + 78, 41), o.lineTo(n + 66, 91), o.lineTo(n + 4, 91), o.lineTo(n - 3, 41), o.closePath(), o.fill(), o.strokeStyle = "#b08b28", o.lineWidth = 3, o.stroke();
    for (const f of [21, 49, 91, 622])
      o.fillStyle = Lt(o, n - 10, h + 30), o.fillRect(n - 10, f, h + 30, 5), o.strokeStyle = "#4c2b0e", o.strokeRect(n - 10, f, h + 30, 5);
  }
  for (let n = 0; n <= 5; n++) {
    const h = 97 + n * 188;
    o.fillStyle = "#d49913", o.fillRect(h - 5, 106, 11, 516), o.fillStyle = "#b52813", o.fillRect(h - 2, 106, 5, 516);
    for (let f = 132; f < 618; f += 47)
      o.fillStyle = "#2a9dc0", o.fillRect(h - 2, f, 5, 20);
    o.fillStyle = "#f8e466", o.fillRect(h + 4, 106, 1.5, 516);
  }
  const l = ["#fbed53", "#f04f4b", "#f7c77a", "#c4ed61", "#54ade9", "#edb69c", "#9bd0df", "#5bbb4c", "#f08bd3"], r = [4, 2, 9, 6, 1, 7, 8, 3, 5], c = [4, 2, 8, 6, 1, 7, 9, 3, 5];
  for (const [n, h] of [[30, r], [1051, c]])
    for (let f = 0; f < 9; f++) {
      const u = 149 + f * 48.5;
      o.shadowColor = "#000", o.shadowBlur = 3, o.shadowOffsetY = 3, o.fillStyle = l[f], o.fillRect(n, u, 55, 39), o.shadowBlur = 0, o.shadowOffsetY = 0, o.strokeStyle = "#674310", o.lineWidth = 2, o.strokeRect(n, u, 55, 39), o.fillStyle = "#080704", o.font = "bold 28px Georgia", o.textAlign = "center", o.textBaseline = "middle", o.fillText(String(h[f]), n + 27.5, u + 20);
    }
  if (i)
    o.drawImage(i, 14, 118, 2144, 423, 346, 7, 420, 83);
  else {
    o.save(), o.translate(556, 48), o.scale(0.72, 0.72);
    for (const h of [-1, 1]) {
      o.save(), o.scale(h, 1);
      for (let f = 0; f < 18; f++) {
        const u = 25 + f * 14;
        o.beginPath(), o.moveTo(u, -27), o.quadraticCurveTo(u + 13, 38 - f * 0.5, u + 20, 48 - f * 2), o.quadraticCurveTo(u + 34, 16 - f, u + 46, -39 + f * 0.4), o.closePath();
        const d = o.createLinearGradient(0, -30, 0, 45);
        d.addColorStop(0, "#ffd55b"), d.addColorStop(0.5, "#9b570a"), d.addColorStop(0.7, "#e6a629"), d.addColorStop(1, "#492709"), o.fillStyle = d, o.strokeStyle = "#1a0c04", o.lineWidth = 3, o.fill(), o.stroke();
      }
      o.restore();
    }
    o.font = 'bold 80px "Comic Sans MS"', o.textAlign = "center", o.textBaseline = "middle", o.lineJoin = "round", o.lineWidth = 12, o.strokeStyle = "#0b0304", o.strokeText("BOOK OF RA", 0, -4, 580), o.lineWidth = 8, o.strokeStyle = "#eac35a", o.strokeText("BOOK OF RA", 0, -4, 580), o.lineWidth = 3, o.strokeStyle = "#432706", o.strokeText("BOOK OF RA", 0, -4, 580);
    const n = o.createLinearGradient(0, -40, 0, 30);
    n.addColorStop(0, "#b3f2f9"), n.addColorStop(0.45, "#0c94d8"), n.addColorStop(1, "#083974"), o.fillStyle = n, o.fillText("BOOK OF RA", 0, -4, 580), o.restore();
  }
  if (t / e > 1.5 && !["01-base", "03-paytable", "04-win", "06-gamble"].includes(s)) {
    o.fillStyle = "#f5f1e8", o.font = "bold 14px Arial", o.textAlign = "left", o.textBaseline = "alphabetic";
    for (const [n, h, f] of [["Account", 92, 15], ["Pay in", 190, 15], ["0.00", 91, 41], ["#2", 103, 74], ["Help", 903, 15], ["Exit", 992, 15], ["14:34", 1010, 72]]) o.fillText(n, h, f);
    o.font = "16px Arial", o.fillText("♪  ◀  ↕  ⛶", 962, 39);
  }
  o.restore();
}
const hi = 0.015, Ft = 0.075, di = `
  :host { display:block; --panel:#080c18; --ink:#f7f8ff; --accent:#ffd34f; color:var(--ink); font:650 16px/1.3 Inter,ui-sans-serif,system-ui,sans-serif; }
  * { box-sizing:border-box; }
  .game { position:relative; overflow:visible; isolation:isolate; border:1px solid #ffffff20; border-radius:clamp(18px,3vw,30px); background:linear-gradient(145deg,color-mix(in srgb,var(--panel),#fff 8%),var(--panel)); padding:clamp(9px,1.6vw,19px); box-shadow:0 28px 80px #000a,inset 0 1px #ffffff21; }
  .game::before { content:""; position:absolute; z-index:-1; inset:-35% 15% auto; height:55%; background:var(--accent); filter:blur(100px); opacity:.13; }
  .marquee { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:3px clamp(5px,1vw,12px) 8px; }
  .brand { min-width:0; }
  .brand small { display:block; color:color-mix(in srgb,var(--accent),#fff 25%); font-size:clamp(.58rem,1.3vw,.72rem); font-weight:900; letter-spacing:.2em; text-transform:uppercase; }
  .title { overflow:hidden; margin:1px 0 0; font:900 clamp(1.35rem,4.5vw,2.85rem)/1 ui-rounded,system-ui; letter-spacing:-.045em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; text-shadow:0 3px 0 #0007,0 0 24px color-mix(in srgb,var(--accent),transparent 60%); }
  .state { flex:0 0 auto; display:flex; align-items:center; gap:7px; border:1px solid #ffffff1d; border-radius:999px; padding:7px 10px; background:#02050ba6; color:#c9d1de; font-size:.67rem; font-weight:900; letter-spacing:.13em; }
  .state::before { content:""; width:7px; height:7px; border-radius:50%; background:#6ff2a6; box-shadow:0 0 11px #6ff2a6; }
  .state[data-state="SPINNING"]::before,.state[data-state="STOPPING"]::before,.state[data-state="CASCADE"]::before,.state[data-state="FEATURE"]::before { background:var(--accent); box-shadow:0 0 11px var(--accent); }
  .feature-strip { display:flex; flex-wrap:wrap; gap:6px; min-height:0; padding:0 clamp(5px,1vw,12px) 8px; }
  .feature-strip:empty { padding-bottom:2px; }
  .chip { display:inline-flex; align-items:center; gap:6px; border:1px solid color-mix(in srgb,var(--accent),transparent 55%); border-radius:999px; padding:4px 10px; background:#050a14d9; color:#ffe9a8; font-size:.66rem; font-weight:900; letter-spacing:.08em; text-transform:uppercase; animation:chip-in .28s cubic-bezier(.2,.9,.3,1.4); }
  .chip strong { color:#fff; font-size:.78rem; }
  .chip.bump { animation:chip-bump .34s cubic-bezier(.2,.9,.3,1.6); }
  @keyframes chip-in { from { opacity:0; transform:translateY(6px) scale(.8); } }
  @keyframes chip-bump { 40% { transform:scale(1.16); } }
  .stage { position:relative; overflow:visible; border:clamp(5px,1vw,10px) solid #111827; border-radius:clamp(14px,2vw,23px); background:#050812 center/cover no-repeat; box-shadow:inset 0 0 0 2px #ffffff24,inset 0 0 35px #000,0 7px 22px #0009; }
  .stage::before { content:""; position:absolute; z-index:2; pointer-events:none; inset:0; border-radius:inherit; box-shadow:inset 0 12px 24px #0009,inset 0 -12px 24px #0009; }
  canvas { display:block; width:100%; aspect-ratio:16/8.7; }
  .reel-canvas { position:relative; z-index:1; }
  .effect-canvas { position:absolute; z-index:2; inset:0; height:100%; pointer-events:none; }
  .reel-frame { position:absolute; z-index:3; left:4.5%; top:7.5%; width:91%; height:85%; object-fit:fill; pointer-events:none; user-select:none; transform:scale(var(--frame-scale,1.07)); transform-origin:center; }
  .float-layer { position:absolute; z-index:4; inset:0; overflow:hidden; pointer-events:none; }
  .payline-overlay { position:absolute; z-index:3; inset:0; width:100%; height:100%; pointer-events:none; opacity:0; transition:opacity .15s; }
  .payline-overlay.active { opacity:.92; }
  .payline-overlay polyline { fill:none; stroke:#d7ff4a; stroke-width:1.2; stroke-linejoin:round; stroke-linecap:round; filter:drop-shadow(0 0 2px #000); }
  .float-prize { position:absolute; left:50%; top:58%; transform:translate(-50%,0); color:#9dffc2; font:950 clamp(1rem,2.6vw,1.6rem)/1 ui-rounded,system-ui; letter-spacing:.04em; text-shadow:0 0 14px #37ff8f88,0 2px 0 #0008; animation:prize-float 1.15s cubic-bezier(.2,.7,.3,1) forwards; }
  @keyframes prize-float { 12% { opacity:1; transform:translate(-50%,-8px) scale(1.08); } 100% { opacity:0; transform:translate(-50%,-74px) scale(.94); } }
  .announce { position:absolute; z-index:5; left:50%; top:50%; width:max-content; max-width:92%; transform:translate(-50%,-50%) scale(.7); border:1px solid color-mix(in srgb,var(--accent),#fff 35%); border-radius:18px; padding:14px 30px; background:linear-gradient(160deg,#131a30f2,#070b16f5); opacity:0; pointer-events:none; text-align:center; box-shadow:0 0 60px color-mix(in srgb,var(--accent),transparent 45%),inset 0 1px #ffffff2e; transition:opacity .22s,transform .3s cubic-bezier(.2,.9,.3,1.45); }
  .announce.active { opacity:1; transform:translate(-50%,-50%) scale(1); }
  .announce h3 { margin:0; font:950 clamp(1.15rem,3.4vw,2.1rem)/1.08 ui-rounded,system-ui; letter-spacing:.05em; text-transform:uppercase; color:#fff3c2; text-shadow:0 0 22px color-mix(in srgb,var(--accent),transparent 30%),0 3px 0 #0008; }
  .announce p { margin:5px 0 0; color:#c8d2e6; font-size:clamp(.72rem,1.7vw,.92rem); font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
  .announce[data-tone="jackpot"] { border-color:#ffe08a; box-shadow:0 0 90px #ffb02faa,inset 0 1px #ffffff40; }
  .announce[data-tone="jackpot"] h3 { color:#ffe08a; }
  .announce[data-tone="loss"] { border-color:#ff7b8d66; box-shadow:0 0 40px #ff3b5d44; }
  .announce[data-tone="loss"] h3 { color:#ffb1bd; text-shadow:0 0 18px #ff3b5d66; }
  .win-message { position:absolute; z-index:4; left:50%; top:50%; width:max-content; max-width:90%; transform:translate(-50%,-50%) scale(.82); border:1px solid #fff6b8; border-radius:999px; padding:10px 22px; background:#080b16e8; color:#fff4ad; font:950 clamp(1rem,3vw,1.8rem)/1 ui-rounded,system-ui; letter-spacing:.06em; opacity:0; pointer-events:none; text-align:center; text-shadow:0 0 17px #ffcf42; box-shadow:0 0 50px #ffce4266; transition:opacity .18s,transform .22s cubic-bezier(.2,.8,.2,1); }
  .win-message.active { opacity:1; transform:translate(-50%,-50%) scale(1); }
  .bonus { position:absolute; z-index:6; inset:0; display:flex; align-items:center; justify-content:center; background:#02040bd8; backdrop-filter:blur(3px); opacity:0; pointer-events:none; transition:opacity .25s; }
  .bonus.active { opacity:1; pointer-events:auto; }
  .bonus-panel { width:min(520px,92%); border:1px solid color-mix(in srgb,var(--accent),#fff 25%); border-radius:20px; padding:clamp(14px,3vw,26px); background:linear-gradient(165deg,#141b31f6,#080c18fa); text-align:center; box-shadow:0 0 70px color-mix(in srgb,var(--accent),transparent 55%),inset 0 1px #ffffff26; transform:translateY(12px) scale(.94); transition:transform .3s cubic-bezier(.2,.9,.3,1.35); }
  .bonus.active .bonus-panel { transform:none; }
  .bonus-panel h3 { margin:0 0 4px; font:950 clamp(1.05rem,3vw,1.6rem)/1.1 ui-rounded,system-ui; letter-spacing:.06em; text-transform:uppercase; color:#fff3c2; text-shadow:0 0 18px color-mix(in srgb,var(--accent),transparent 40%); }
  .bonus-panel p { margin:0 0 14px; color:#aab6cc; font-size:.74rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
  .bonus-grid { display:flex; flex-wrap:wrap; gap:12px; justify-content:center; }
  .bonus-card { position:relative; width:clamp(84px,22%,120px); aspect-ratio:3/4; border:1px solid #ffffff2c; border-radius:14px; background:linear-gradient(155deg,#232f52,#101728); color:#ffe9a8; font:950 1.4rem/1 ui-rounded,system-ui; cursor:pointer; box-shadow:0 8px 20px #0009,inset 0 1px #ffffff22; transition:transform .18s,box-shadow .18s,opacity .3s; }
  .bonus-card::before { content:""; position:absolute; inset:7px; border:1px dashed color-mix(in srgb,var(--accent),transparent 45%); border-radius:9px; }
  .bonus-card small { position:absolute; left:0; right:0; bottom:9px; color:#93a2c0; font-size:.58rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
  .bonus-card:hover:not(:disabled) { transform:translateY(-4px) scale(1.04); box-shadow:0 14px 26px #000b,0 0 24px color-mix(in srgb,var(--accent),transparent 55%); }
  .bonus-card:disabled { cursor:default; opacity:.35; }
  .bonus-card.picked { animation:card-pop .5s cubic-bezier(.2,.9,.3,1.5); border-color:#ffe08a; opacity:1; }
  @keyframes card-pop { 45% { transform:scale(1.14) rotate(2deg); } }
  .wheel-wrap { display:grid; place-items:center; margin:0 auto 16px; }
  .wheel { width:clamp(150px,42vw,210px); aspect-ratio:1; border-radius:50%; border:6px solid #111827; background:conic-gradient(var(--accent) 0 25%,#3d2a7d 25% 50%,#c2452f 50% 75%,#1c7d64 75% 100%); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent),transparent 40%),0 0 44px color-mix(in srgb,var(--accent),transparent 55%),inset 0 0 30px #0009; transition:transform 2.1s cubic-bezier(.16,.9,.14,1); }
  .wheel-wrap::before { content:""; position:relative; z-index:1; top:9px; width:0; height:0; border:11px solid transparent; border-top:16px solid #fff3c2; filter:drop-shadow(0 2px 3px #000c); }
  .gamble-row { display:flex; gap:14px; justify-content:center; }
  .gamble-row .bonus-choice { min-width:130px; }
  .bonus-choice { border:1px solid #ffffff30; border-radius:999px; padding:13px 22px; background:linear-gradient(160deg,#27335c,#141b31); color:#fff; font:900 .85rem/1 inherit; letter-spacing:.09em; text-transform:uppercase; cursor:pointer; box-shadow:0 6px 16px #0008,inset 0 1px #ffffff28; transition:transform .15s,filter .15s; }
  .bonus-choice:hover:not(:disabled) { transform:translateY(-2px); filter:brightness(1.15); }
  .bonus-choice:disabled { opacity:.4; cursor:default; }
  .bonus-choice[data-style="red"] { background:linear-gradient(160deg,#a3243a,#5c0f1e); border-color:#ff8fa0aa; }
  .bonus-choice[data-style="black"] { background:linear-gradient(160deg,#2a2f3d,#0b0d14); border-color:#aab6ccaa; }
  .bonus-choice[data-style="gold"] { background:linear-gradient(160deg,color-mix(in srgb,var(--accent),#8a5200 25%),#6b3c05); border-color:#ffe08a; color:#1c1303; }
  .console { display:grid; grid-template-columns:minmax(90px,1fr) auto minmax(90px,1fr); align-items:center; gap:clamp(8px,2vw,18px); margin-top:12px; padding:clamp(8px,1.5vw,13px); border:1px solid #ffffff14; border-radius:18px; background:linear-gradient(180deg,#111827,#070b13); box-shadow:inset 0 1px #ffffff12; }
  .meters { display:flex; min-width:0; gap:clamp(8px,2vw,22px); }
  .meter { min-width:0; }
  .meter small { display:block; color:#8793a7; font-size:.62rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
  .meter strong,.meter output { display:block; overflow:hidden; color:#f8fbff; font-size:clamp(.83rem,2vw,1.07rem); font-weight:900; text-overflow:ellipsis; white-space:nowrap; }
  .win-total { justify-content:flex-end; text-align:right; }
  .spin { position:relative; width:clamp(74px,11vw,94px); aspect-ratio:1; border:4px solid color-mix(in srgb,var(--accent),#fff 30%); border-radius:50%; background:radial-gradient(circle at 35% 28%,#fff7bf 0 4%,var(--accent) 34%,color-mix(in srgb,var(--accent),#8b4d00 52%) 100%); color:#171103; font:950 clamp(.88rem,2vw,1.12rem)/1 ui-rounded,system-ui; letter-spacing:.07em; cursor:pointer; box-shadow:0 0 0 5px #02050b,0 0 0 7px #ffffff1c,0 8px 22px #000b,0 0 28px color-mix(in srgb,var(--accent),transparent 58%); transition:transform .12s,filter .12s; }
  .spin:hover:not(:disabled) { transform:translateY(-2px) scale(1.025); filter:brightness(1.08); }
  .spin:active:not(:disabled) { transform:translateY(1px) scale(.97); }
  .spin:disabled { cursor:wait; filter:saturate(.55); opacity:.72; }
  .paytable { border:1px solid #ffffff25; border-radius:999px; margin-top:10px; padding:8px 14px; background:#080d18b8; color:#dbe4f4; font:800 .74rem/1 inherit; cursor:pointer; }
  .error { margin:0 0 12px; padding:10px 14px; border:1px solid #ff7b8d88; border-radius:10px; background:#60182dcc; color:#fff; }
  dialog { width:min(720px,calc(100% - 24px)); max-height:80vh; color:var(--ink); background:#11162a; border:1px solid #ffffff2b; border-radius:14px; }
  dialog::backdrop { background:#02040bdc; }
  dialog .close { position:sticky; top:0; float:right; }
  dialog button { border:1px solid #ffffff28; border-radius:999px; padding:10px 16px; background:#1a2235; color:inherit; font:inherit; cursor:pointer; }
  table { border-collapse:collapse; width:100%; } td,th { padding:7px 10px; border-bottom:1px solid #ffffff1a; text-align:left; }
  .sr-grid { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .stage-row { position:relative; overflow:visible; border-radius:clamp(14px,2vw,23px); }
  .stage { position:relative; z-index:1; }
  .character-slot { display:contents; overflow:visible; }
  .character { position:absolute; z-index:3; right:-1.5%; bottom:calc(${Ft * 100}% + clamp(5px,1vw,10px)); height:88%; max-width:26%; object-fit:contain; object-position:bottom; pointer-events:none; filter:drop-shadow(0 10px 24px #000b); transform:translate(var(--character-offset-x,0%),var(--character-offset-y,0%)) scale(var(--character-scale,1)); transform-origin:center bottom; transition:transform .25s; }
  .character[data-pose="cast"] { filter:drop-shadow(0 10px 24px #000b) drop-shadow(0 0 34px #9db8ff88); }
  .game.immersive { border:0; border-radius:0; background:transparent; padding:0; box-shadow:none; }
  .game.immersive::before { display:none; }
  .game.immersive .marquee { display:none; }
  .game.immersive .feature-strip { padding:0 0 6px; }
  .game.immersive .stage-row:has(.character) { display:grid; grid-template-columns:minmax(0,1fr) clamp(190px,22%,270px); align-items:end; }
  .game.immersive .stage { border:0; border-radius:16px; background:transparent; box-shadow:none; }
  .game.immersive .stage::before { display:none; }
  .game.immersive canvas { aspect-ratio:16/8.5; }
  .game.immersive .reel-frame { left:0; top:0; width:100%; height:100%; }
  .game.immersive .character-slot { display:block; position:relative; min-width:0; align-self:stretch; overflow:visible; }
  .game.immersive .character { position:absolute; left:50%; right:auto; bottom:calc(${hi * 100}% - var(--character-bottom-shift,0px)); width:auto; height:var(--character-height,560px); max-width:none; object-fit:contain; object-position:center bottom; transform:translate(calc(-50% + var(--character-offset-x,0%)),var(--character-offset-y,0%)) scale(var(--character-scale,1)); transform-origin:center bottom; }
  .game.immersive .character[data-pose="cast"] { transform:translate(calc(-50% + var(--character-offset-x,0%)),var(--character-offset-y,0%)) scale(var(--character-scale,1)); }
  .game.character-overflow { overflow:visible; }
  .game.immersive.character-overflow .stage-row { overflow:visible; }
  .game.immersive .console { border-color:#ffffff10; background:#070b13c9; }
  .game.immersive .console.cabinet { margin:0 -1px; }
  .game.immersive .toggle,.game.immersive .buy,.game.immersive .paytable { background:#070b13c9; }
  /* Classic cabinet control deck: a flat brushed strip with pressed keys,
     deliberately not the rounded panel the default console uses. */
  .console.cabinet { display:block; margin:0; padding:0; border:0; border-radius:0; background:none; box-shadow:none; }
  .cab-meters { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:3px; padding:4px; border:2px solid #7a4a16; border-top-color:#e7b463; border-bottom-color:#2f1c06; border-radius:2px; background:linear-gradient(180deg,#a9742c,#7d4f16 42%,#4a2d0a); box-shadow:inset 0 1px #ffd98a88,0 3px 0 #2a1808,0 8px 18px #000a; }
  .cab-meter { min-width:0; padding:5px clamp(6px,1.2vw,14px); border:1px solid #000; border-radius:2px; background:radial-gradient(120% 140% at 50% 0%,#120d06,#050302); text-align:center; box-shadow:inset 0 2px 5px #000,inset 0 -1px #ffd98a1a; }
  .cab-meter small { display:block; color:#c79a58; font-size:.56rem; font-weight:900; letter-spacing:.18em; text-transform:uppercase; }
  .cab-meter strong,.cab-meter output { display:block; overflow:hidden; color:#ffd76a; font:900 clamp(.85rem,2vw,1.25rem)/1.25 ui-monospace,"Courier New",monospace; text-overflow:ellipsis; white-space:nowrap; text-shadow:0 0 10px #ffb02e66; }
  .cab-meter.win-total output { color:#fff3c2; }
  .cab-deck { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) auto; align-items:stretch; gap:clamp(4px,.9vw,10px); margin-top:6px; }
  .cab-key { border:2px solid #7a4a16; border-top-color:#e7b463; border-bottom-color:#2f1c06; border-radius:3px; padding:clamp(9px,1.6vw,16px) 6px; background:linear-gradient(180deg,#b57f2f 0%,#8a5a1c 46%,#5a3810 100%); color:#fff2d2; font:900 clamp(.62rem,1.45vw,.88rem)/1 inherit; letter-spacing:.14em; text-transform:uppercase; cursor:pointer; text-shadow:0 1px 0 #3a2409; box-shadow:inset 0 1px #ffd98a88,inset 0 -3px 6px #0006,0 4px 0 #2a1808,0 7px 14px #0009; }
  .cab-key:hover:not(:disabled) { background:linear-gradient(180deg,#54381a,#241609); }
  .cab-key:active:not(:disabled) { transform:translateY(2px); box-shadow:inset 0 1px #ffffff14,0 1px 0 #0f0a04; }
  .cab-key:disabled { opacity:.42; cursor:default; }
  .spin.cab-start { width:auto; min-width:clamp(110px,18vw,220px); aspect-ratio:auto; border-radius:3px; border:2px solid #1f6b22; border-top-color:#8ef07a; border-bottom-color:#0d3a10; background:linear-gradient(180deg,#8bea6a 0%,#3fbd3a 42%,#1f8a22 74%,#14631a 100%); color:#0d2b0c; font:900 clamp(.86rem,2.1vw,1.3rem)/1 inherit; letter-spacing:.22em; text-transform:uppercase; text-shadow:0 1px 0 #bff4a8; box-shadow:inset 0 2px #ffffff88,inset 0 -5px 10px #0005,0 5px 0 #0d3a10,0 9px 20px #000a,0 0 26px #5ee04a55; }
  .spin.cab-start:active:not(:disabled) { transform:translateY(3px); box-shadow:inset 0 2px #ffffff22,0 1px 0 #4d0f07; }
  .game.immersive .console.cabinet { background:none; border:0; }
  @media (max-width:560px) {
    .cab-meters { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .cab-deck { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .spin.cab-start { grid-column:1 / -1; }
  }
  .extras { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .extras:empty { display:none; }
  .toggle { display:inline-flex; align-items:center; gap:8px; border:1px solid #ffffff25; border-radius:999px; padding:8px 14px; background:#080d18b8; color:#dbe4f4; font:800 .74rem/1 inherit; cursor:pointer; }
  .toggle[aria-pressed="true"] { border-color:color-mix(in srgb,var(--accent),#fff 25%); background:color-mix(in srgb,var(--accent),#080d18 82%); color:#ffe9a8; box-shadow:0 0 18px color-mix(in srgb,var(--accent),transparent 65%); }
  .buy { border:1px solid #ffe08a88; border-radius:999px; padding:8px 14px; background:linear-gradient(160deg,color-mix(in srgb,var(--accent),#8a5200 30%),#3d2a05); color:#ffedc0; font:900 .74rem/1 inherit; letter-spacing:.05em; cursor:pointer; }
  .buy:hover:not(:disabled) { filter:brightness(1.15); }
  .buy:disabled,.toggle:disabled { opacity:.4; cursor:default; }
  .audio { display:inline-flex; align-items:center; gap:10px; margin-left:auto; }
  .vol { display:inline-flex; align-items:center; gap:6px; color:#8793a7; font-size:.62rem; font-weight:900; letter-spacing:.1em; text-transform:uppercase; }
  .vol input[type="range"] { width:clamp(70px,9vw,110px); height:4px; appearance:none; border-radius:999px; background:#ffffff28; accent-color:var(--accent); cursor:pointer; }
  .vol input[type="range"]::-webkit-slider-thumb { appearance:none; width:13px; height:13px; border-radius:50%; background:var(--accent); border:2px solid #08080f; box-shadow:0 0 8px color-mix(in srgb,var(--accent),transparent 40%); }
  .game.fit .feature-strip { min-height:34px; }
  .game.fit .extras { min-height:36px; }
  @media (max-width:560px) { .game { border-radius:17px; padding:7px; } .marquee { padding-bottom:6px; } .state { padding:6px 8px; } .console { grid-template-columns:1fr auto 1fr; } .meters { display:block; } .meters .meter + .meter { margin-top:5px; } .paytable { margin-top:7px; } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
`;
function z(o) {
  const t = BigInt(o), e = t < 0n, a = e ? -t : t;
  return `${e ? "−" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
function $(o, t = 0, e = 1) {
  return Math.min(e, Math.max(t, o));
}
function rt(o) {
  return o.split("-").map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" ");
}
const Ht = 1200, fi = 720, pi = 1.5;
class ui {
  #t = /* @__PURE__ */ new Map();
  #n = 0;
  /** Master gain applied on top of each cue's relative volume. */
  master = 1;
  register(t, e) {
    if (this.#t.has(t)) return;
    this.#t.set(t, e);
    const a = new Audio();
    a.preload = "auto", a.src = e;
  }
  play(t, e = 0.8) {
    const a = this.#t.get(t), s = $(e * this.master, 0, 1);
    if (!a || this.#n >= 8 || s <= 0) return;
    const i = new Audio(a);
    i.volume = s, this.#n += 1;
    const l = () => {
      this.#n = Math.max(0, this.#n - 1);
    };
    i.addEventListener("ended", l, { once: !0 }), i.addEventListener("error", l, { once: !0 }), i.play().catch(l);
  }
}
const Oe = "slot-skills:audio";
function gi() {
  try {
    const o = localStorage.getItem(Oe);
    if (o) {
      const t = JSON.parse(o);
      return {
        music: $(Number(t.music ?? 0.7), 0, 1),
        effects: $(Number(t.effects ?? 0.9), 0, 1),
        muted: !!t.muted
      };
    }
  } catch {
  }
  return { music: 0.7, effects: 0.9, muted: !1 };
}
class bi extends HTMLElement {
  #t;
  #n = new Ge();
  #d = "demo-player";
  #r = "100";
  #G = new Aa("en", { spin: "Spin", balance: "Balance", win: "Win", paytable: "Paytable" });
  #m = !1;
  #w = !1;
  #I;
  #$ = !1;
  #_;
  #x;
  #j;
  #W;
  #ot = document.baseURI;
  #E = /* @__PURE__ */ new Map();
  #y = [];
  #S;
  #s;
  #g;
  #f;
  #A = /* @__PURE__ */ new Set();
  #ut = 0;
  #T;
  #V = 0;
  #c = matchMedia("(prefers-reduced-motion: reduce)").matches;
  #J = new ui();
  #Z = [];
  #C = [];
  #P = !1;
  #q = 0n;
  #N;
  #st;
  #v;
  #it = 0;
  #Q = !1;
  #M = !1;
  #z;
  #K;
  #i = gi();
  #k;
  /** Optional frontend-only image registration. Keys remain existing symbol IDs. */
  symbolPresentation = {};
  titleImageUrl;
  #nt = /* @__PURE__ */ new Map();
  get classicPresentation() {
    return this.getAttribute("presentation") === "classic";
  }
  /** Static visual fixture only. Does not create a round or modify the game contract. */
  previewGrid(t) {
    if (!this.hasAttribute("visual-preview")) throw new Error("previewGrid requires visual-preview");
    if (t.length !== 5 || t.some((e) => e.length !== 3)) throw new Error("Visual fixture must be 5x3");
    this.#y = t.map((e) => [...e]), this.#H();
  }
  /** CSS-pixel geometry for visual comparison, without exposing gameplay state. */
  presentationGeometry() {
    const t = this.shadowRoot?.querySelector(".reel-canvas");
    if (!t) return;
    const e = t.getBoundingClientRect(), a = (s) => ({ x: e.x + s.x * e.width / t.width, y: e.y + s.y * e.height / t.height, width: s.width * e.width / t.width, height: s.height * e.height / t.height });
    return { glass: a(this.#ct(t.width, t.height)), cells: this.#R().map((s, i) => Array.from({ length: s }, (l, r) => a(this.#l(i, r, t)))) };
  }
  constructor() {
    super(), this.attachShadow({ mode: "open" });
  }
  static get observedAttributes() {
    return ["fit", "chrome"];
  }
  attributeChangedCallback(t) {
    if (t === "fit" && (this.#Q = this.getAttribute("fit") === "viewport", this.#rt()), t === "chrome") {
      const e = this.getAttribute("chrome") === "immersive";
      e !== this.#M && (this.#M = e, this.#t && this.render());
    }
  }
  /** Scale-to-fit mode: lay out at a fixed design width and letterbox-scale into the viewport. */
  set fitViewport(t) {
    t ? this.setAttribute("fit", "viewport") : this.removeAttribute("fit");
  }
  get fitViewport() {
    return this.#Q;
  }
  /** Immersive chrome: no card frame or marquee, taller reels, character in a side column; the host page provides the full-bleed background. */
  set immersive(t) {
    t ? this.setAttribute("chrome", "immersive") : this.removeAttribute("chrome");
  }
  get immersive() {
    return this.#M;
  }
  set game(t) {
    this.#t = t, this.#k = void 0, this.render();
  }
  get game() {
    return this.#t;
  }
  set transport(t) {
    this.#n = t;
  }
  set playerId(t) {
    this.#d = t;
  }
  set betUnits(t) {
    this.#r = t, this.#vt();
  }
  get betUnits() {
    return this.#r;
  }
  /** Quick-spin mode: reels settle with the same shortened timings free spins use. */
  turbo = !1;
  /** Programmatic spin for host-page autoplay. Resolves when the round presentation completes; no-op while a spin is in flight. */
  spin() {
    return this.#Y();
  }
  set messages(t) {
    this.#G = t, this.render();
  }
  set assetBaseUrl(t) {
    this.#ot = new URL(t, document.baseURI).href, this.#t && this.render();
  }
  get assetBaseUrl() {
    return this.#ot;
  }
  /** Optional page-level canvas used for theme ambience. The host controls its stacking and bounds. */
  set ambientCanvas(t) {
    this.#j !== t && (this.#j = t, this.#t && this.isConnected && this.render());
  }
  get ambientCanvas() {
    return this.#j;
  }
  previewConfiguration(t) {
    this.#k = {
      symbolScale: $(t.symbolScale, 0.6, 1.4),
      frameScale: $(t.frameScale, 0.8, 1.3),
      characterScale: $(t.characterScale, 0.5, 1.8),
      characterOffsetX: $(t.characterOffsetX, -0.5, 0.5),
      characterOffsetY: $(t.characterOffsetY, -0.5, 0.5),
      ambientEffects: structuredClone([...t.ambientEffects])
    }, this.#lt(), this.#bt();
  }
  clearConfigurationPreview() {
    this.#k = void 0, this.#lt(), this.#bt();
  }
  previewAmbientEffect(t) {
    this.#x?.trigger(t);
  }
  connectedCallback() {
    this.#Q = this.getAttribute("fit") === "viewport", this.#M = this.getAttribute("chrome") === "immersive", this.#z = () => this.#rt(), window.addEventListener("resize", this.#z), this.#t && this.render();
  }
  disconnectedCallback() {
    this.#_?.destroy(), this.#x?.destroy(), this.#W?.disconnect(), cancelAnimationFrame(this.#V), this.#s?.resolve?.(), this.#g?.resolve?.(), this.#f?.resolve?.(), this.#S = void 0, this.#N?.pause(), this.#v && clearTimeout(this.#v), this.#z && (window.removeEventListener("resize", this.#z), this.#z = void 0);
  }
  /**
   * Letterbox scaling: the component is laid out at FIT_DESIGN_WIDTH and transform-scaled so the
   * whole chrome (marquee, stage, console, extras) fits both viewport axes without page scrolling.
   * Below FIT_MIN_SCALE_WIDTH of available width the natural flow layout is kept, except for games
   * that explicitly require landscape presentation.
   */
  #rt() {
    const t = this.shadowRoot?.querySelector(".game");
    if (!t) return;
    const e = () => {
      t.classList.remove("fit"), t.style.removeProperty("width"), t.style.removeProperty("transform"), t.style.removeProperty("transform-origin"), this.style.removeProperty("width"), this.style.removeProperty("height"), this.style.removeProperty("margin");
    };
    if (!this.#Q || this.classicPresentation) {
      e(), this.#K?.();
      return;
    }
    const a = Number(getComputedStyle(this).getPropertyValue("--fit-margin")) || 24, s = Math.max(0, this.parentElement?.clientWidth ?? window.innerWidth), i = this.parentElement?.clientHeight ?? window.innerHeight, l = Math.max(0, Math.min(window.innerHeight, i) - a * 2);
    if (!(this.#t?.layout.orientation === "landscape") && s < fi || !l) {
      e(), this.#K?.();
      return;
    }
    t.classList.add("fit"), t.style.width = `${Ht}px`, t.style.transformOrigin = "top left";
    const c = t.offsetHeight;
    if (!c) {
      e();
      return;
    }
    const n = Math.min(pi, s / Ht, l / c);
    t.style.transform = `scale(${n})`, this.style.width = `${Math.round(Ht * n)}px`, this.style.height = `${Math.round(c * n)}px`, this.style.margin = "0 auto", this.#K?.();
  }
  #tt(t) {
    return this.#t?.assets.find((e) => e.id === t);
  }
  #p(t) {
    return t ? new URL(t, this.#ot).href : "";
  }
  render() {
    if (!this.#t || !this.shadowRoot) return;
    const t = this.#t;
    this.#s?.resolve?.(), this.#g?.resolve?.(), this.#f?.resolve?.(), this.#s = void 0, this.#g = void 0, this.#f = void 0, this.#S = void 0, this.#A.clear(), this.#Z = [], cancelAnimationFrame(this.#V), this.#_?.destroy(), this.#x?.destroy(), this.#W?.disconnect();
    const e = this.#gt();
    this.#y = t.math.reelStrips?.map((x, v) => Array.from({ length: e[v] ?? 0 }, (M, k) => x[k % x.length])) ?? Array.from({ length: t.layout.reels }, (x, v) => Array.from({ length: e[v] ?? 0 }, (M, k) => t.symbols[(k + v) % t.symbols.length].id));
    const a = t.assets.find((x) => x.role === "background"), s = a ? ` style="background-image:linear-gradient(#05081644,#05081677),url('${this.#p(a.path)}')"` : "", i = $(t.presentation.characterHeight ?? 560, 200, 1200), l = $(this.#k?.characterScale ?? t.presentation.characterScale ?? 1, 0.5, 1.8), r = $(this.#k?.characterOffsetX ?? t.presentation.characterOffsetX ?? 0, -0.5, 0.5), c = $(this.#k?.characterOffsetY ?? t.presentation.characterOffsetY ?? 0, -0.5, 0.5), n = $(t.presentation.frameScale ?? 1.07, 0.8, 1.3), h = Math.round($(t.presentation.characterBottomMargin ?? 0, 0, 0.2) * i), f = this.#M && t.presentation.characterOverflow ? " character-overflow" : "";
    this.shadowRoot.innerHTML = `<style>${di}${li}</style><section class="game${this.#M ? " immersive" : ""}${f}" style="--panel:${t.theme.palette[0]};--accent:${t.theme.palette[2] ?? t.theme.palette[1]};--character-height:${i}px;--character-bottom-shift:${h}px;--character-scale:${l};--character-offset-x:${r * 100}%;--character-offset-y:${c * 100}%;--frame-scale:${n}">
      <div class="marquee"><div class="brand"><small>Server-authoritative slot</small><h1 class="title">${t.title}</h1></div><div class="state" data-state="READY">READY</div></div>
      <div class="feature-strip" data-chips></div>
      <div class="error" role="alert" hidden></div><div class="stage-row"><div class="stage"${this.#M ? "" : s}><canvas class="reel-canvas" aria-label="${t.title} animated reels"></canvas><canvas class="effect-canvas"></canvas><svg class="payline-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>${this.#$t()}<div class="float-layer"></div><div class="announce" role="status"><h3></h3><p hidden></p></div><div class="win-message" aria-live="polite"></div><div class="bonus" aria-live="polite"></div><div class="sr-grid" aria-live="polite"></div></div>${this.#_t()}</div>
      <div class="console cabinet">
        ${this.classicPresentation ? '<div class="cab-message">Please place your bet</div>' : ""}
        <div class="cab-meters">
          <div class="cab-meter"><small>Credit</small><strong data-credit>0.00</strong></div>
          <div class="cab-meter"><small>Lines</small><strong data-lines>${t.math.paylines?.length ?? 0}</strong></div>
          <div class="cab-meter"><small>Bet/Line</small><strong data-betline>${z((BigInt(this.#r) / BigInt(Math.max(1, t.math.paylines?.length ?? 1))).toString())}</strong></div>
          <div class="cab-meter"><small>Bet</small><strong data-bet>${z(this.#r)}</strong></div>
          <div class="cab-meter win-total"><small>${this.#G.format("win")}</small><output>0.00</output></div>
        </div>
        <div class="cab-deck">
          <button class="cab-key" data-key="autoplay" type="button">Autoplay</button>
          <button class="cab-key paytable" type="button">Paytable</button>
          <button class="cab-key" data-key="gamble" type="button" disabled>Gamble</button>
          <button class="spin cab-start" type="button"><svg class="spin-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M27 13a11 11 0 0 0-19-5L4 12m0-8v8h8M5 19a11 11 0 0 0 19 5l4-4m0 8v-8h-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="spin-label">Start</span></button>
        </div>
      </div>
      <div class="extras">${this.#kt("ante-bet") ? `<button class="toggle" data-ante aria-pressed="${this.#P}">ANTE BET ×${this.#Ht()}</button>` : ""}${this.#kt("bonus-buy") ? `<button class="buy" data-buy>BUY BONUS ×${this.#Ot()}</button>` : ""}<div class="audio"><button class="toggle" data-mute aria-pressed="${this.#i.muted}">${this.#i.muted ? "SOUND OFF" : "SOUND ON"}</button><label class="vol">Music<input type="range" data-music-vol min="0" max="100" value="${Math.round(this.#i.music * 100)}" aria-label="Music volume"></label><label class="vol">Effects<input type="range" data-sfx-vol min="0" max="100" value="${Math.round(this.#i.effects * 100)}" aria-label="Effects volume"></label></div></div>
      <dialog><button class="close" aria-label="Close paytable">×</button><h2>${t.title} paytable</h2><table><thead><tr><th>Symbol</th><th>Count</th><th>Payout</th></tr></thead><tbody>${Ta(t).map((x) => `<tr><td>${x.symbolName}</td><td>${x.count}</td><td>${x.payout.numerator}/${x.payout.denominator} × ${x.basis}</td></tr>`).join("")}</tbody></table></dialog>
    </section>`, this.#C = [], this.#q = 0n, this.#H(), this.#Ct(), this.#Pt(), this.shadowRoot.querySelector(".spin").addEventListener("click", () => {
      this.#I ? this.#I() : this.#Y();
    }), this.shadowRoot.querySelector('[data-key="autoplay"]')?.addEventListener("click", () => {
      this.#w = !this.#w;
      const x = this.shadowRoot.querySelector('[data-key="autoplay"]');
      x.textContent = this.#w ? "Stop" : "Autoplay", this.#w && !this.#m && this.#Y();
    }), this.shadowRoot.querySelector("[data-ante]")?.addEventListener("click", () => this.#Gt()), this.shadowRoot.querySelector("[data-buy]")?.addEventListener("click", () => {
      this.#Y("bonus-buy");
    });
    const u = this.shadowRoot.querySelector(".character");
    u?.addEventListener("error", () => {
      const x = this.#t?.assets.find((v) => v.role === "character" && v.fallback)?.fallback;
      x && u.src !== this.#p(x) && (u.src = this.#p(x));
    });
    const d = this.shadowRoot.querySelector(".reel-frame");
    if (d?.addEventListener("error", () => {
      const x = this.#t?.assets.find((v) => v.role === "reel-frame")?.fallback;
      x && d.src !== this.#p(x) && (d.src = this.#p(x));
    }), ii(this, t).catch(() => {
    }), this.shadowRoot.querySelector("[data-mute]")?.addEventListener("click", () => {
      this.#i.muted = !this.#i.muted, this.#X();
    }), this.shadowRoot.querySelector("[data-music-vol]")?.addEventListener("input", (x) => {
      this.#i = { ...this.#i, music: $(Number(x.target.value) / 100, 0, 1), muted: !1 }, this.#X();
    }), this.shadowRoot.querySelector("[data-sfx-vol]")?.addEventListener("input", (x) => {
      this.#i = { ...this.#i, effects: $(Number(x.target.value) / 100, 0, 1), muted: !1 }, this.#X(), this.#e("reel-stop", 0.6);
    }), this.#X(), this.#et(), this.classicPresentation)
      for (const [x, v] of [[2, "lines"], [3, "bet per line"]]) {
        const M = this.shadowRoot.querySelector(`.cab-meter:nth-child(${x})`);
        for (const [k, C] of [["−", "Decrease"], ["+", "Increase"]]) {
          const R = document.createElement("button");
          R.type = "button", R.className = "meter-adjust", R.textContent = k, R.disabled = !0, R.setAttribute("aria-label", `${C} ${v}`), M.append(R);
        }
      }
    if (this.hasAttribute("visual-preview"))
      for (const x of this.shadowRoot.querySelectorAll(".spin,[data-key=autoplay]")) x.disabled = !0;
    const p = this.shadowRoot.querySelector("dialog");
    this.shadowRoot.querySelector(".paytable").addEventListener("click", () => p.showModal()), this.shadowRoot.querySelector(".close").addEventListener("click", () => p.close());
    const b = this.shadowRoot.querySelector(".reel-canvas"), m = this.shadowRoot.querySelector(".effect-canvas"), g = this.#j, y = m.getContext("2d");
    this.#_ = new He(y, { mode: "production", dpr: 1, reducedMotion: this.#c, clearBeforeRender: !0 }), this.#x = g ? new Vs(g, { mode: "production", reducedMotion: this.#c }) : void 0, this.#lt();
    const w = () => {
      const x = b.getBoundingClientRect(), v = devicePixelRatio || 1, M = Math.max(1, Math.round(x.width * v)), k = Math.max(1, Math.round(x.height * v));
      if ((b.width !== M || b.height !== k) && (b.width = M, b.height = k), (m.width !== M || m.height !== k) && (m.width = M, m.height = k), g) {
        const C = g.getBoundingClientRect(), R = Math.max(1, Math.round(C.width * v)), E = Math.max(1, Math.round(C.height * v));
        (g.width !== R || g.height !== E) && (g.width = R, g.height = E);
      }
    };
    w(), this.#W = new ResizeObserver(w), this.#W.observe(b), g && this.#W.observe(g), this.#K = w;
    const S = (x) => {
      this.isConnected && (this.#Rt(x), this.#x?.tick(x), this.#_?.tick(x), this.#V = requestAnimationFrame(S));
    };
    this.#V = requestAnimationFrame(S), this.#rt();
  }
  #gt() {
    return this.#t ? Array.isArray(this.#t.layout.rows) ? [...this.#t.layout.rows] : Array(this.#t.layout.reels).fill(this.#t.layout.rows) : [];
  }
  /** Current visible grid shape, following resized grids delivered by the server. */
  #R() {
    const t = this.#s?.target ?? this.#f?.toGrid ?? this.#y;
    return t.length ? t.map((e) => e.length) : this.#gt();
  }
  #Ct() {
    if (this.#E.clear(), this.titleImageUrl) {
      const t = new Image();
      t.addEventListener("load", () => this.#E.set("$book-title", t)), t.src = this.#p(this.titleImageUrl);
    }
    this.#nt.clear();
    for (const [t, e] of Object.entries(this.symbolPresentation)) {
      const a = new Image();
      a.src = this.#p(e.src), a.addEventListener("load", () => this.#nt.set(t, a));
    }
    for (const t of this.#t?.assets ?? []) {
      if (!t.mediaType?.startsWith("image/")) continue;
      const e = new Image();
      let a = !1;
      e.addEventListener("load", () => {
        this.#E.set(t.id, e), t.role === "background" && this.#x?.setSourceSize(e.naturalWidth, e.naturalHeight);
      }), e.addEventListener("error", () => {
        !a && t.fallback && (a = !0, e.src = this.#p(t.fallback));
      }), e.src = this.#p(t.path);
    }
  }
  #Pt() {
    for (const t of this.#t?.assets ?? [])
      t.mediaType?.startsWith("audio/") && this.#J.register(t.id, this.#p(t.path));
  }
  #bt() {
    const t = this.shadowRoot?.querySelector(".game");
    if (!t || !this.#t) return;
    const e = this.#k, a = this.#t.presentation;
    t.style.setProperty("--character-scale", String($(e?.characterScale ?? a.characterScale ?? 1, 0.5, 1.8))), t.style.setProperty("--character-offset-x", `${$(e?.characterOffsetX ?? a.characterOffsetX ?? 0, -0.5, 0.5) * 100}%`), t.style.setProperty("--character-offset-y", `${$(e?.characterOffsetY ?? a.characterOffsetY ?? 0, -0.5, 0.5) * 100}%`), t.style.setProperty("--frame-scale", String($(e?.frameScale ?? a.frameScale ?? 1.07, 0.8, 1.3)));
  }
  #lt() {
    if (!this.#x || !this.#t) return;
    const t = this.#t.assets.find((a) => a.role === "background"), e = t ? this.#E.get(t.id) : void 0;
    e?.naturalWidth && this.#x.setSourceSize(e.naturalWidth, e.naturalHeight), this.#x.configure(this.#k?.ambientEffects ?? this.#t.theme.ambientEffects ?? [], this.#t.theme.palette);
  }
  #Rt(t) {
    const e = this.shadowRoot?.querySelector(".reel-canvas"), a = e?.getContext("2d");
    if (!e || !a || !this.#t) return;
    const s = e.width, i = e.height;
    a.clearRect(0, 0, s, i), this.#It(a, s, i);
    const l = this.#s, r = this.#R().length;
    this.#mt(a, s, i);
    for (let h = 0; h < r; h += 1) this.#Tt(a, h, t, l);
    if (this.#mt(a, s, i, !0), l?.target && l.motions?.length) {
      const h = Math.max(...l.motions.map((f) => f.startTime + f.duration));
      if (t >= h) {
        this.#y = l.target.map((u) => [...u]);
        const f = l.resolve;
        this.#s = void 0, this.#h("READY"), this.#H(), this.#e("reel-stop", 0.55), f?.();
      }
    }
    const c = this.#g;
    c && !c.resolved && t >= c.startedAt + c.duration && (c.resolved = !0, c.resolve?.());
    const n = this.#f;
    n && t >= n.startedAt + n.duration && (this.#y = n.toGrid.map((h) => [...h]), this.#f = void 0, this.#H(), n.resolve?.()), this.#A.size && t >= this.#ut && this.#A.clear();
  }
  #It(t, e, a) {
    if (this.#M) return;
    const s = this.#t?.assets.find((r) => r.role === "background"), i = s ? this.#E.get(s.id) : void 0;
    if (t.save(), i?.naturalWidth) {
      const r = Math.max(e / i.naturalWidth, a / i.naturalHeight), c = i.naturalWidth * r, n = i.naturalHeight * r;
      t.drawImage(i, (e - c) / 2, (a - n) / 2, c, n);
    } else {
      const r = t.createLinearGradient(0, 0, e, a);
      r.addColorStop(0, this.#t?.theme.palette[1] ?? "#16213a"), r.addColorStop(1, this.#t?.theme.palette[0] ?? "#050812"), t.fillStyle = r, t.fillRect(0, 0, e, a);
    }
    const l = t.createRadialGradient(e * 0.5, a * 0.43, a * 0.05, e * 0.5, a * 0.5, e * 0.68);
    l.addColorStop(0, "#101b3440"), l.addColorStop(1, "#010207d9"), t.fillStyle = l, t.fillRect(0, 0, e, a), t.restore();
  }
  /**
   * Cabinet furniture: flanking columns, payline chips, reel border, logo.
   *
   * Proportions follow the reference captures rather than invention. The space
   * either side of the reels carries ornate columns with the payline numbers as
   * coloured chips - mirrored left and right - and the reel window itself is
   * bordered by a thin gold line rather than a heavy bezel.
   *
   * Called twice per frame: the black reel bed first, then all the furniture.
   */
  #mt(t, e, a, s = !1) {
    if (this.classicPresentation) {
      ci(t, e, a, s, this.getAttribute("reference-state") ?? "", this.#E.get("$book-title"));
      return;
    }
    const l = (this.#t?.theme.palette ?? [])[2] ?? "#ffd34f", r = this.#ct(e, a);
    if (!s) {
      t.save(), t.fillStyle = "#000", t.fillRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4), t.restore();
      return;
    }
    t.save();
    const c = e * 0.07;
    this.#yt(t, r.x - e * 8e-3 - c, r.y - a * 0.035, c, r.height + a * 0.07, l), this.#yt(t, r.x + r.width + e * 8e-3, r.y - a * 0.035, c, r.height + a * 0.07, l);
    const n = Math.max(1, this.#R().length), h = r.width / n, f = Math.max(3, e * 55e-4);
    for (let u = 1; u < n; u += 1) {
      const d = r.x + h * u - f / 2;
      t.fillStyle = "#8a1f14", t.fillRect(d, r.y, f, r.height), t.fillStyle = "#2f6fb0";
      const p = Math.max(4, r.height * 0.022);
      for (let b = r.y + p * 0.5; b < r.y + r.height - p; b += p * 2.1)
        t.fillRect(d, b, f, p);
    }
    t.beginPath(), t.rect(r.x - 2, r.y - 2, r.width + 4, r.height + 4), t.lineWidth = Math.max(2, e * 35e-4), t.strokeStyle = l, t.stroke(), this.#Et(t, e, a, r, c), this.#At(t, e, r.y), t.restore();
  }
  /** One ornate papyrus column: capital, fluted shaft, base. */
  #yt(t, e, a, s, i, l) {
    const r = t.createLinearGradient(e, 0, e + s, 0);
    r.addColorStop(0, "#5d3b12"), r.addColorStop(0.18, "#c79a58"), r.addColorStop(0.42, "#ffe9a8"), r.addColorStop(0.68, "#b0812f"), r.addColorStop(1, "#4a2d08");
    const c = Math.max(10, i * 0.055);
    t.save(), t.fillStyle = r, t.fillRect(e, a + c, s, i - c * 2), t.strokeStyle = "#00000055", t.lineWidth = Math.max(1, s * 0.03);
    for (let n = 1; n < 5; n += 1) {
      const h = e + s / 5 * n;
      t.beginPath(), t.moveTo(h, a + c), t.lineTo(h, a + i - c), t.stroke();
    }
    for (const n of [a, a + i - c])
      t.fillStyle = r, t.fillRect(e - s * 0.12, n, s * 1.24, c), t.strokeStyle = "#3a2409", t.lineWidth = Math.max(1, s * 0.035), t.strokeRect(e - s * 0.12, n, s * 1.24, c);
    t.strokeStyle = l, t.lineWidth = Math.max(1, s * 0.04), t.strokeRect(e, a + c, s, i - c * 2), t.restore();
  }
  /**
   * Payline numbers as coloured chips inside both columns, mirrored.
   * The reference uses one pastel per line so a lit line is identifiable.
   */
  #Et(t, e, a, s, i) {
    const l = this.#t?.math.paylines?.length ?? 0;
    if (!l) return;
    const r = ["#f5e04a", "#e8574f", "#a9d8f0", "#9ede5a", "#6fa8f5", "#f7b0a8", "#f5c98a", "#7ed957", "#f2a8d0", "#c9a8f0"], c = i * 0.62, n = s.height * 0.012, h = (s.height - n * (l - 1)) / l, f = Math.max(8, h * 0.56);
    t.save(), t.font = "900 " + f + "px ui-rounded, system-ui, sans-serif", t.textAlign = "center", t.textBaseline = "middle";
    const u = [
      s.x - e * 8e-3 - i + (i - c) / 2,
      s.x + s.width + e * 8e-3 + (i - c) / 2
    ];
    for (const d of u)
      for (let p = 0; p < l; p += 1) {
        const b = s.y + p * (h + n);
        t.fillStyle = r[p % r.length], t.fillRect(d, b, c, h), t.strokeStyle = "#2a1708", t.lineWidth = Math.max(1, c * 0.04), t.strokeRect(d, b, c, h), t.fillStyle = "#1a1005", t.fillText(String(p + 1), d + c / 2, b + h / 2 + f * 0.04);
      }
    t.restore();
  }
  /** The logo strip above the glass, sized to the reference's ~21% of width. */
  #At(t, e, a) {
    const s = (this.#t?.title ?? "").toUpperCase();
    if (!s) return;
    const i = a * 0.46;
    let l = Math.min(e * 0.05, a * 0.4);
    if (l < 10) return;
    t.save(), t.textAlign = "center", t.textBaseline = "middle", t.font = "900 " + l + 'px Georgia, "Times New Roman", serif';
    const r = e * 0.3, c = t.measureText(s).width;
    c > r && (l = l * (r / c), t.font = "900 " + l + 'px Georgia, "Times New Roman", serif');
    const n = t.createLinearGradient(0, i - l, 0, i + l);
    n.addColorStop(0, "#fff6d6"), n.addColorStop(0.42, "#f0c75e"), n.addColorStop(0.72, "#c9922a"), n.addColorStop(1, "#6b430a"), t.lineJoin = "round", t.lineWidth = l * 0.3, t.strokeStyle = "#1c2f6b", t.strokeText(s, e / 2, i), t.lineWidth = l * 0.12, t.strokeStyle = "#2a1708", t.strokeText(s, e / 2, i), t.fillStyle = n, t.fillText(s, e / 2, i), t.restore();
  }
  #ct(t, e) {
    if (this.classicPresentation) {
      const a = this.getAttribute("reference-state") === "06-gamble", s = a ? 0.754 : 1;
      return { x: t * ((a ? 137 : 0) + 97 * s) / 1112, y: e * 106 / 630, width: t * 940 * s / 1112, height: e * 516 / 630 };
    }
    return this.#M ? { x: t * 0.168, y: e * 0.18, width: t * 0.687, height: e * 0.757 } : { x: t * 0.045, y: e * Ft, width: t * 0.91, height: e * (1 - 2 * Ft) };
  }
  #l(t, e, a) {
    const s = a ?? this.shadowRoot.querySelector(".reel-canvas"), i = this.#ct(s.width, s.height), l = this.#R(), r = Math.max(1, l.length), c = Math.max(1, ...l), n = Math.max(3, s.width * 6e-3), h = i.width / r, f = i.height / c, u = l[t] ?? c, d = (c - u) * f / 2;
    return { x: i.x + t * h + n / 2, y: i.y + d + e * f + n / 2, width: h - n, height: f - n };
  }
  #Tt(t, e, a, s) {
    const i = t.canvas, r = this.#R()[e] ?? 0;
    if (!r) return;
    const c = this.#l(e, 0, i), n = this.#l(e, Math.max(0, r - 1), i), h = { x: c.x, y: c.y, width: c.width, height: n.y + n.height - c.y };
    t.save(), t.beginPath(), t.roundRect(h.x, h.y, h.width, h.height, 2), t.clip();
    const f = t.createLinearGradient(h.x, h.y, h.x, h.y + h.height);
    f.addColorStop(0, "#070604"), f.addColorStop(0.5, "#010101"), f.addColorStop(1, "#070604"), t.fillStyle = this.classicPresentation ? "#000" : f, t.fillRect(h.x, h.y, h.width, h.height);
    const u = s?.motions?.[e], d = u && a >= u.startTime ? Js(u, a) : void 0;
    if (!!(s && !d?.complete) && s) {
      const b = this.#t.symbols.map((v) => v.id), m = 0.012 + e * 75e-5, g = d?.position ?? Math.max(0, a - s.startedAt) * m, y = d?.velocity ?? m, w = Math.floor(g), S = g - w, x = d && u ? u.strip : void 0;
      t.save(), t.filter = `blur(${$(y * 1e3 / 18) * 3.6 * (devicePixelRatio || 1)}px)`;
      for (let v = -1; v <= r + 1; v += 1) {
        const M = w - v, k = x ? x[(M % x.length + x.length) % x.length] : b[(M + e * 3 + b.length * 100) % b.length], C = this.#l(e, 0, i);
        C.y = c.y + (v + S) * (c.height + Math.max(3, i.width * 6e-3)), this.#U(t, k, C, !1, a);
      }
      t.restore();
      for (let v = 0; v < r; v += 1) {
        if (!s.heldCells?.[e]?.[v]) continue;
        const M = this.#y[e]?.[v] ?? this.#t.symbols[0].id;
        this.#U(t, M, this.#l(e, v, i), !1, a);
      }
    } else if (!s && this.#f)
      this.#Nt(t, e, r, a, this.#f);
    else {
      const b = s?.target ?? this.#y, m = s ? void 0 : this.#g, g = m ? m.duration ? $((a - m.startedAt) / m.duration) : 1 : 0;
      for (let y = 0; y < r; y += 1) {
        const w = b[e]?.[y] ?? this.#t.symbols[0].id, S = this.#l(e, y, i), x = m?.cells.has(`${e}:${y}`) ?? !1;
        if (!(x && g >= 1))
          if (x) {
            const v = 1 - g;
            t.save(), t.globalAlpha = 1 - g, t.translate(S.x + S.width / 2, S.y + S.height / 2), t.scale(v, v), t.translate(-(S.x + S.width / 2), -(S.y + S.height / 2)), this.#U(t, w, S, !0, a), t.restore();
          } else {
            this.#U(t, w, S, this.#A.has(`${e}:${y}`), a);
            const v = this.#C[e]?.[y];
            typeof v == "number" && v > 0 && this.#Wt(t, S, v);
          }
      }
    }
    t.restore();
  }
  #Nt(t, e, a, s, i) {
    const l = $((s - i.startedAt) / i.duration), r = 1 - Math.pow(1 - l, 3), c = i.fromGrid[e] ?? [], n = i.toGrid[e] ?? [], h = c.map((p, b) => ({ symbolId: p, row: b })).filter(({ row: p }) => !i.removedCells.has(`${e}:${p}`)), f = Math.max(0, n.length - h.length), d = this.#l(e, 0, t.canvas).height + Math.max(3, t.canvas.width * 6e-3);
    t.save(), t.filter = `blur(${(1 - r) * 1.4 * (devicePixelRatio || 1)}px)`;
    for (let p = 0; p < a; p += 1) {
      const m = (p >= f ? h[p - f] : void 0)?.row ?? p - f, g = this.#l(e, p, t.canvas);
      g.y += (m - p) * d * (1 - r), this.#U(t, n[p] ?? this.#t.symbols[0].id, g, !1, s);
    }
    t.restore();
  }
  #U(t, e, a, s, i) {
    const l = this.symbolPresentation[e], r = this.#nt.get(e);
    if (l && r) {
      t.save(), t.beginPath(), t.rect(a.x, a.y, a.width, a.height), t.clip();
      const p = Math.min(a.width / 180, a.height / 166), b = l.width * p * l.scale, m = l.height * p * l.scale, g = a.x + a.width / 2 - b * l.anchorX + l.offsetX * p, y = a.y + a.height / 2 - m * l.anchorY + l.offsetY * p;
      s && (t.shadowColor = "#ffe961", t.shadowBlur = 15), l.crop ? t.drawImage(r, l.crop.x, l.crop.y, l.crop.width, l.crop.height, g, y, b, m) : t.drawImage(r, g, y, b, m), t.restore();
      return;
    }
    const c = this.#t?.symbols.find((p) => p.id === e), n = c ? this.#tt(c.asset) : void 0, h = n ? this.#E.get(n.id) : void 0, f = 0, u = s ? 0.5 + 0.5 * Math.sin(i / 90) : 0;
    if (t.save(), t.beginPath(), t.roundRect(a.x, a.y, a.width, a.height, f), t.clip(), s) {
      const p = t.createRadialGradient(a.x + a.width * 0.5, a.y + a.height * 0.45, 0, a.x + a.width * 0.5, a.y + a.height * 0.5, Math.max(a.width, a.height) * 0.7);
      p.addColorStop(0, `rgba(255,221,91,${0.3 + u * 0.2})`), p.addColorStop(1, "rgba(255,170,40,0)"), t.fillStyle = p, t.fillRect(a.x, a.y, a.width, a.height);
    }
    const d = $(this.#k?.symbolScale ?? this.#t?.presentation.symbolScale ?? 1, 0.6, 1.4);
    if (h?.naturalWidth) {
      const p = Math.min(a.width, a.height) * 0.03, b = a.width - p * 2, m = a.height - p * 2, g = Math.min(b / h.naturalWidth, m / h.naturalHeight) * d, y = h.naturalWidth * g, w = h.naturalHeight * g;
      t.shadowColor = s ? "#ffe46b" : "#000b", t.shadowBlur = s ? 24 + u * 18 : 9, t.drawImage(h, a.x + (a.width - y) / 2, a.y + (a.height - w) / 2, y, w);
    } else
      t.fillStyle = "#dbe6ff", t.font = `800 ${Math.max(10, a.width * 0.12 * d)}px system-ui`, t.textAlign = "center", t.textBaseline = "middle", t.fillText(c?.name ?? e, a.x + a.width / 2, a.y + a.height / 2, a.width * 0.82);
    s && (t.strokeStyle = `rgba(255,224,91,${0.72 + u * 0.28})`, t.lineWidth = Math.max(3, a.width * 0.025), t.strokeRect(a.x + 1, a.y + 1, a.width - 2, a.height - 2)), t.restore();
  }
  #F(t) {
    this.#s?.resolve?.(), this.#g?.resolve?.(), this.#f?.resolve?.(), this.#g = void 0, this.#f = void 0, this.#s = { startedAt: performance.now() }, this.#A.clear(), this.#Jt(), this.#h("SPINNING"), this.#e("spin-start", 0.5), this.#S = t?.map((e) => [...e]), t && (this.#s.heldCells = t.map((e) => [...e]));
  }
  #wt(t, e = !1, a) {
    if (this.#c)
      return this.#y = t.map((h) => [...h]), this.#s = void 0, this.#H(), this.#h("READY"), Promise.resolve();
    this.#s || this.#F(a);
    const s = this.#s;
    a ? s.heldCells = a.map((h) => [...h]) : delete s.heldCells, s.target = t.map((h) => [...h]);
    const i = this.#t.symbols.map((h) => h.id), l = e ? 140 : 680, r = e ? 55 : 115, c = e ? 480 : 780, n = Math.max(performance.now() + 90, s.startedAt + l);
    return s.motions = s.target.map((h, f) => {
      const u = 0.012 + f * 75e-5, d = n + f * r, p = Math.max(0, d - s.startedAt) * u, b = Math.max(Math.ceil(p) + 3, Math.floor(p + u * c * 0.58)), m = b - p, g = b + h.length + i.length + 2, y = Array.from({ length: g }, (w, S) => i[(S + f * 3) % i.length]);
      for (let w = 0; w < h.length; w += 1) y[b + w] = h[w];
      return { strip: y, startTime: d, duration: c, startPosition: p, targetPosition: b, distance: m, entryVelocity: u };
    }), this.#h("STOPPING"), new Promise((h) => {
      s.resolve = h;
    });
  }
  #Bt(t) {
    this.#g?.resolve?.();
    const e = { cells: new Set(t.map((a) => `${a.reel}:${a.row}`)), startedAt: performance.now(), duration: this.#c ? 0 : 240, resolved: this.#c };
    return this.#g = e, this.#h("CASCADE"), this.#c ? Promise.resolve() : new Promise((a) => {
      e.resolve = a;
    });
  }
  #xt(t) {
    const e = this.#g?.cells ?? /* @__PURE__ */ new Set();
    if (this.#g = void 0, this.#A.clear(), this.#c)
      return this.#y = t.map((s) => [...s]), this.#H(), Promise.resolve();
    this.#f?.resolve?.();
    const a = { fromGrid: this.#y.map((s) => [...s]), toGrid: t.map((s) => [...s]), removedCells: new Set(e), startedAt: performance.now(), duration: 380 };
    return this.#f = a, this.#h("CASCADE"), new Promise((s) => {
      a.resolve = s;
    });
  }
  #St() {
    const t = this.#s?.resolve;
    this.#s = void 0, this.#g?.resolve?.(), this.#f?.resolve?.(), this.#g = void 0, this.#f = void 0, this.#S = void 0, this.#h("READY"), t?.();
  }
  #h(t) {
    const e = this.shadowRoot?.querySelector(".state");
    e && (e.dataset.state = t, e.textContent = t), this.toggleAttribute("reels-moving", t === "SPINNING" || t === "STOPPING");
  }
  #vt() {
    const t = this.shadowRoot?.querySelector("[data-bet]");
    t && (t.textContent = z(this.#P ? this.#Lt() : this.#r));
  }
  #Mt(t) {
    return this.#t?.features.find((e) => e.id === t && e.enabled);
  }
  #kt(t) {
    return !!this.#Mt(t);
  }
  #ht(t, e, a) {
    const s = this.#Mt(t)?.config?.[e];
    return typeof s == "number" && Number.isFinite(s) ? s : a;
  }
  #Lt() {
    const t = Math.max(1e4, Math.floor(this.#ht("ante-bet", "stakeMultiplierBps", 12500)));
    return (BigInt(this.#r) * BigInt(t) / 10000n).toString();
  }
  #Ht() {
    return (Math.max(1e4, Math.floor(this.#ht("ante-bet", "stakeMultiplierBps", 12500))) / 1e4).toFixed(2).replace(/0$/, "");
  }
  #Ot() {
    return Math.max(1, Math.floor(this.#ht("bonus-buy", "costMultiplier", 100)));
  }
  #Gt() {
    this.#m || (this.#P = !this.#P, this.#vt(), this.#et());
  }
  /** Ante bet and bonus buy are mutually exclusive: the ante toggle disables the buy button and vice versa. */
  #et() {
    const t = this.shadowRoot?.querySelector("[data-ante]"), e = this.shadowRoot?.querySelector("[data-buy]");
    t && t.setAttribute("aria-pressed", String(this.#P)), e && (e.disabled = this.#P || this.#m), t && (t.disabled = this.#m);
  }
  #_t() {
    const t = this.#t?.assets.find((e) => e.role === "character");
    return t ? `<div class="character-slot"><img class="character" data-pose="idle" alt="" src="${this.#p(t.path)}"></div>` : "";
  }
  #$t() {
    const t = this.#t?.assets.find((e) => e.role === "reel-frame");
    return t ? `<img class="reel-frame" aria-hidden="true" alt="" src="${this.#p(t.path)}">` : "";
  }
  #B(t, e = 2400) {
    const a = this.shadowRoot?.querySelector(".character");
    if (!a || !this.#t) return;
    const s = performance.now(), i = Ba(a.dataset.pose, this.#it, s);
    if (i > 0) {
      this.#v && clearTimeout(this.#v), this.#v = setTimeout(() => this.#B(t, e), Math.ceil(i));
      return;
    }
    const l = this.#t.assets.filter((n) => n.role === "character"), r = l.find((n) => n.id.endsWith(`-${t}`) || n.id === t) ?? l[0];
    if (!r) return;
    if (a.dataset.pose = t, a.src = this.#p(r.path), this.#v && clearTimeout(this.#v), this.#v = void 0, t === "idle") {
      this.#it = 0;
      return;
    }
    const c = Na(r, this.#c ? 400 : e);
    this.#it = s + c, this.#v = setTimeout(() => this.#B("idle"), c);
  }
  #D(t, e = 2400) {
    if (!this.#t) return !1;
    const a = Ha(this.#t, t);
    return a ? (this.#B(a, e), !0) : !1;
  }
  /** Starts or switches the looping background-music track; browsers require a user gesture first. */
  #L(t) {
    const e = this.#t?.assets.filter((i) => i.role === "background-music") ?? [];
    if (!e.length) return;
    const a = e.find((i) => i.id.includes(t)) ?? e[0];
    if (this.#st === a.id && this.#N && !this.#N.paused) {
      this.#X();
      return;
    }
    this.#N?.pause();
    const s = new Audio(this.#p(a.path));
    s.loop = !0, s.volume = this.#i.muted ? 0 : this.#i.music, this.#N = s, this.#st = a.id, s.play().catch(() => {
      this.#st = void 0;
    });
  }
  /** Pushes the current audio preferences to the live music element, the SFX bank, and the controls. */
  #X() {
    this.#N && (this.#N.volume = this.#i.muted ? 0 : this.#i.music), this.#J.master = this.#i.muted ? 0 : this.#i.effects;
    const t = this.shadowRoot?.querySelector("[data-mute]");
    t && (t.setAttribute("aria-pressed", String(this.#i.muted)), t.textContent = this.#i.muted ? "SOUND OFF" : "SOUND ON");
    try {
      localStorage.setItem(Oe, JSON.stringify(this.#i));
    } catch {
    }
  }
  #Wt(t, e, a) {
    const s = `×${a}`;
    t.save();
    const i = Math.max(14, e.height * 0.3), l = e.x + e.width / 2, r = e.y + e.height * 0.68;
    t.font = `950 ${i * 0.62}px ui-rounded, system-ui`, t.textAlign = "center", t.textBaseline = "middle";
    const c = Math.max(t.measureText(s).width + i * 0.8, i * 1.4);
    t.beginPath(), t.roundRect(l - c / 2, r - i / 2, c, i, i / 2), t.fillStyle = "rgba(10,6,26,.88)", t.fill(), t.strokeStyle = "#ffd34f", t.lineWidth = Math.max(1.5, i * 0.08), t.stroke(), t.fillStyle = "#ffe9a8", t.shadowColor = "#ffd34f", t.shadowBlur = i * 0.4, t.fillText(s, l, r), t.restore();
  }
  #H() {
    const t = this.shadowRoot?.querySelector(".sr-grid");
    !t || !this.#t || (t.textContent = this.#y.map((e, a) => `Reel ${a + 1}: ${e.map((s) => this.#t.symbols.find((i) => i.id === s)?.name ?? s).join(", ")}`).join(". "));
  }
  #O(t) {
    return this.#c || t <= 0 ? Promise.resolve() : new Promise((e) => setTimeout(e, t));
  }
  #e(t, e = 0.8) {
    const a = this.#t?.theme.sounds?.[t] ?? (this.#tt(`sfx-${t}`) ? `sfx-${t}` : void 0);
    a && this.#tt(a) && this.#J.play(a, e);
  }
  #qt() {
    const t = this.shadowRoot?.querySelector(".effect-canvas");
    return { x: 0, y: 0, width: t?.width ?? 0, height: t?.height ?? 0 };
  }
  #a(t, e, a = {}) {
    if (!t || !this.#_ || !Xt.includes(t)) return;
    const s = Yt[t]?.metadata;
    if (!s) return;
    const i = e ?? this.#qt();
    if (i.width <= 0 || i.height <= 0) return;
    const r = (e ? ["symbol", "reel", "overlay", "button", "background"] : ["overlay", "background", "reel", "symbol", "button"]).find((c) => s.targets.includes(c)) ?? s.targets[0];
    r && this.#_.play(t, Ys(r, i.x, i.y, i.width, i.height, !!e), { durationMs: 850, intensity: 0.9, ...a });
  }
  #o(t) {
    return ni(this.#t?.theme.effects, t.type);
  }
  #dt(t) {
    const e = this.#R()[t] ?? 1, a = this.#l(t, 0), s = this.#l(t, Math.max(0, e - 1));
    return { x: a.x, y: a.y, width: a.width, height: s.y + s.height - a.y };
  }
  #u(t, e = "", a = "", s = 1250) {
    const i = this.shadowRoot?.querySelector(".announce");
    if (!i) return Promise.resolve();
    i.querySelector("h3").textContent = t;
    const l = i.querySelector("p");
    l.hidden = !e, l.textContent = e, a ? i.dataset.tone = a : delete i.dataset.tone, i.classList.add("active");
    const r = this.#c ? 350 : s;
    return new Promise((c) => setTimeout(() => {
      i.classList.remove("active"), c();
    }, r));
  }
  #at(t, e = "#9dffc2") {
    const a = this.shadowRoot?.querySelector(".float-layer");
    if (!a) return;
    const s = document.createElement("span");
    s.className = "float-prize", s.style.color = e, s.style.left = `${42 + Math.random() * 16}%`, s.textContent = t, a.append(s), setTimeout(() => s.remove(), this.#c ? 400 : 1300);
  }
  #b(t, e, a) {
    const s = this.shadowRoot?.querySelector("[data-chips]");
    if (!s) return;
    let i = s.querySelector(`[data-chip="${t}"]`);
    i || (i = document.createElement("span"), i.className = "chip", i.dataset.chip = t, s.append(i)), i.innerHTML = `${e} <strong></strong>`, i.querySelector("strong").textContent = a, i.classList.remove("bump"), i.offsetWidth, i.classList.add("bump");
  }
  #zt() {
    this.shadowRoot?.querySelector("[data-chips]")?.replaceChildren();
  }
  #Ut() {
    const t = this.shadowRoot?.querySelector(".payline-overlay");
    t && (t.replaceChildren(), t.classList.remove("active"));
  }
  #Ft(t) {
    const e = this.shadowRoot?.querySelector(".payline-overlay");
    if (!e || t.length < 2) return;
    const a = t.map((i) => {
      const l = this.#l(i.reel, i.row), r = this.shadowRoot.querySelector(".stage").getBoundingClientRect();
      return `${(l.x + l.width / 2) / r.width * 100},${(l.y + l.height / 2) / r.height * 100}`;
    }).join(" "), s = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    s.setAttribute("points", a), e.append(s), e.classList.add("active"), setTimeout(() => e.classList.remove("active"), 1300);
  }
  #Dt() {
    const t = this.#Z;
    this.#Z = [], t.forEach((e, a) => {
      const s = this.#c ? 0 : a * 70;
      setTimeout(() => this.#a(e.effect, this.#l(e.reel, e.row), { durationMs: 950, seed: a + 3 }), s);
    }), t.length && this.#e("symbol-transform", 0.6);
  }
  async #Y(t) {
    if (!this.#t || this.#m || this.#I || this.#$ || t && this.#P) return;
    this.#m = !0;
    const e = this.shadowRoot.querySelector(".spin");
    e.disabled = !0, this.#zt(), this.#Ut(), this.#et(), this.#L("base"), this.#q = 0n, this.#C = [], this.#F();
    try {
      const a = await this.#n.spin({
        gameId: this.#t.id,
        playerId: this.#d,
        betUnits: this.#r,
        idempotencyKey: crypto.randomUUID(),
        autoplay: this.#w,
        ...t ? { purchasedFeatureId: t } : {},
        ...this.#P ? { anteBet: !0 } : {}
      });
      await this.playResult(a);
    } catch (a) {
      this.#St(), this.#pt(a, "spin");
    } finally {
      this.#m = !1, e.disabled = this.#$, this.#et(), this.#w && !this.#I && this.isConnected && setTimeout(() => {
        this.#w && !this.#m && this.#Y();
      }, 650);
    }
  }
  async playResult(t) {
    if (!this.#t) throw new Error("A game must be assigned before playing a result");
    !this.#s && t.events.some((e) => e.type === "grid-reveal") && this.#F();
    try {
      for (const e of t.events)
        await this.#Xt(e, t), this.dispatchEvent(new CustomEvent("slot-event-played", { detail: { event: e, result: t }, bubbles: !0, composed: !0 }));
      this.shadowRoot.querySelector("output").value = z(t.totalWinUnits), t.roundState === "FREE_GAME_INTRO" || t.roundState === "FREE_GAME_ACTIVE" ? this.#h("FEATURE") : t.roundState === "GAMBLE_PENDING" && this.#h("FEATURE"), BigInt(t.totalWinUnits) > 0n && t.complete ? this.#Vt(t.totalWinUnits) : t.pendingAction || this.#h("READY"), t.pendingAction && this.#Qt(t), this.dispatchEvent(new CustomEvent("slot-round-result", { detail: { result: t }, bubbles: !0, composed: !0 }));
    } catch (e) {
      throw this.#St(), this.#pt(e, "playback"), e;
    }
  }
  async #Xt(t, e) {
    const a = t.data, s = a.grid, i = typeof a.featureId == "string" ? a.featureId : void 0, l = a.freeSpinIndex !== void 0;
    switch (t.type) {
      case "round-start":
        a.freeSpin !== void 0 && (this.#h("FEATURE"), this.#b("free-spins", "Free spins", String(a.freeSpin)));
        break;
      case "grid-reveal": {
        s && (this.#s || this.#F(), this.#C = [], await this.#wt(s, l || this.turbo), Array.isArray(a.orbValues) && (this.#C = a.orbValues), this.#Dt());
        break;
      }
      case "symbol-transform": {
        const r = Number(a.reel), c = Number(a.row), n = this.#o(t);
        n && Number.isFinite(r) && Number.isFinite(c) && this.#Z.push({ effect: n, reel: r, row: c });
        break;
      }
      case "reel-transform": {
        const r = Number(a.reel);
        if (Array.isArray(a.expandingReels) && typeof a.specialSymbol == "string" && (this.#b("special-symbol", "Expanding symbol", rt(a.specialSymbol)), this.#u("EXPANDING SYMBOL", `${a.expandingReels.length} reels`, "", 900)), Number.isFinite(r)) {
          const c = () => {
            this.#a(this.#o(t), this.#dt(r), { durationMs: 800 }), this.#e("reel-transform", 0.65);
          };
          this.#s ? setTimeout(c, 0) : c();
        }
        break;
      }
      case "colossal-transform": {
        const r = Number(a.reel), c = Number(a.row), n = Number(a.width) || 2, h = this.#l(r, c), f = this.#l(Math.min(r + n - 1, this.#R().length - 1), c + n - 1);
        this.#a(this.#o(t), { x: h.x, y: h.y, width: f.x + f.width - h.x, height: f.y + f.height - h.y }, { durationMs: 900 }), this.#e("colossal-transform", 0.75);
        break;
      }
      case "win": {
        const r = a.cells ?? [], c = oe(e.betUnits, e.totalWinUnits, this.#t);
        if ((a.regular === !0 || a.expanding === !0) && this.#Ft(r), this.#A = new Set(r.map((n) => `${n.reel}:${n.row}`)), this.#ut = performance.now() + (this.#c ? 0 : 850), c) {
          for (const n of r) this.#a(this.#o(t), this.#l(n.reel, n.row), { durationMs: 750, intensity: 0.9 });
          this.#e("win", 0.75);
        }
        typeof a.payoutUnits == "string" && (this.#q += BigInt(a.payoutUnits), this.shadowRoot.querySelector("output").value = z(this.#q.toString())), await this.#O(l ? 220 : 360);
        break;
      }
      case "win-multiplier": {
        const r = Number(a.multiplier) || 2;
        this.#a(this.#o(t), void 0, { durationMs: 900 }), this.#at(`×${r}`, "#ffe08a"), this.#b(`multiplier:${i ?? "round"}`, i ? rt(i) : "Multiplier", `×${r}`), this.#e("win-multiplier", 0.75), await this.#O(320);
        break;
      }
      case "symbols-remove": {
        const r = a.cells ?? [];
        for (const c of r) this.#a(this.#o(t), this.#l(c.reel, c.row), { durationMs: 420 });
        this.#e("symbols-remove", 0.6), await this.#Bt(r);
        break;
      }
      case "cascade-start": {
        this.#b("cascade", "Cascade", String(Number(a.cascadeIndex) || 1));
        break;
      }
      case "symbols-drop": {
        s && Number(a.cascadeIndex) > 0 && (this.#e("symbols-drop", 0.55), this.#C = [], await this.#xt(s), Array.isArray(a.orbValues) && (this.#C = a.orbValues));
        break;
      }
      case "symbol-value": {
        const r = Number(a.reel), c = Number(a.row), n = Number(a.valueMultiplier) || 0;
        Number.isFinite(r) && Number.isFinite(c) && ((this.#C[r] ??= [])[c] = n > 0 ? n : void 0, this.#a(this.#o(t), this.#l(r, c), { durationMs: 900, intensity: 0.95 })), this.#e("orb-land", 0.7), await this.#O(140);
        break;
      }
      case "tumble-multiplier": {
        const r = Number(a.sum) || 0, c = Number(a.totalMultiplier) || r, n = String(a.winAfterUnits ?? "0");
        this.#B("cast"), this.#a(this.#o(t), void 0, { durationMs: 1500, intensity: 1 }), this.#e("tumble-multiplier", 0.9), this.#at(`×${r}`, "#9db8ff"), a.phase === "free-spin" && this.#b("orb-total", "Total multiplier", `×${c}`), this.#q = BigInt(n), this.shadowRoot.querySelector("output").value = z(n), await this.#O(650);
        break;
      }
      case "max-win": {
        const r = String(a.capUnits ?? "0");
        this.#a(this.#o(t), void 0, { durationMs: 2e3, intensity: 1 }), this.#e("big-win", 1), await this.#u("MAX WIN", `Round capped at ${z(r)}`, "jackpot", 1900);
        break;
      }
      case "free-spins-start": {
        this.#h("FEATURE"), this.#L("bonus"), this.#D({ type: "feature-start", featureId: "free-spins" }, 8200) || this.#B("cast", 8200);
        const r = Number(a.spins) || 0;
        this.#b("free-spins", "Free spins", String(r)), this.#a(this.#o(t), void 0, { durationMs: 1400 }), this.#e("free-spins-start", 0.85), await this.#u(`${r} FREE SPINS`, "All wins from the feature are added to your total");
        break;
      }
      case "free-spin": {
        this.#b("free-spins", "Free spins", String(Number(a.remaining) || 0));
        const r = Number(a.multiplier) || 1;
        r > 1 && this.#b("free-spin-multiplier", "Multiplier", `×${r}`);
        break;
      }
      case "free-spins-end": {
        const r = String(a.totalWinUnits ?? "0");
        this.#L("base"), this.#e("free-spins-end", 0.85), BigInt(r) > 0n ? (this.#a(this.#o(t), void 0, { durationMs: 1600 }), await this.#u("FEATURE COMPLETE", `Feature win ${z(r)}`)) : await this.#u("FEATURE COMPLETE", "");
        break;
      }
      case "grid-resize": {
        this.#a(this.#o(t), void 0, { durationMs: 900 }), this.#e("grid-resize", 0.7), await this.#u("GRID EXPANDED", i ? rt(i) : "", "", 900);
        break;
      }
      case "respin": {
        const r = Number(a.locked) || 0;
        if (a.locked !== void 0 && this.#b("locked", "Locked", String(r)), a.lives !== void 0 && this.#b("lives", "Respins", String(Number(a.lives))), s) {
          const c = ri(this.#S, a.cells, s);
          this.#e("respin", 0.7), this.#s || this.#F(c.spinning), await this.#wt(s, !0, c.spinning), this.#S = c.settled, this.#a(this.#o(t), void 0, { durationMs: 700 });
        } else
          this.#e("respin", 0.5), await this.#O(260);
        break;
      }
      case "nudge": {
        this.#e("nudge", 0.75);
        const r = Number(a.reel);
        Number.isFinite(r) && this.#a(this.#o(t), this.#dt(r), { durationMs: 650 }), s && await this.#xt(s);
        break;
      }
      case "hold-win-start": {
        this.#h("FEATURE"), this.#L("bonus");
        const r = typeof a.featureId == "string" ? a.featureId : "hold-and-win";
        this.#D({ type: "feature-start", featureId: r }) || this.#B("cast"), this.#b("locked", "Locked", String(Number(a.locked) || 0));
        const c = a.grid, n = c ? Ut(a.cells, c) : void 0;
        c && n ? (this.#y = c.map((h) => [...h]), this.#S = n, this.#H()) : this.#S = void 0, this.#a(this.#o(t), void 0, { durationMs: 1200 }), this.#e("hold-win-start", 0.85), await this.#u("HOLD & WIN", "Lock coins to grow the prize");
        break;
      }
      case "hold-win-end": {
        const r = String(a.awardUnits ?? "0");
        this.#a(this.#o(t), void 0, { durationMs: 1500 }), this.#e("hold-win-end", 0.9), await this.#u(`${Number(a.coins) || 0} COINS`, `Awarded ${z(r)}`), this.#S = void 0, this.#L("base");
        break;
      }
      case "collection-update": {
        const r = typeof a.meter == "string" ? a.meter : typeof a.symbolId == "string" ? a.symbolId : i ?? "collection", c = a.total ?? a.remaining ?? 0, n = a.target ? `/${a.target}` : "";
        this.#b(`meter:${r}`, rt(r), `${c}${n}`), this.#a(this.#o(t), void 0, { durationMs: 600, intensity: 0.6 }), this.#e("collection-update", 0.45);
        break;
      }
      case "prize-award": {
        const r = String(a.awardUnits ?? "0");
        this.#a(this.#o(t), void 0, { durationMs: 1e3 }), this.#at(`+${z(r)}`), this.#e("prize-award", 0.8), await this.#O(420);
        break;
      }
      case "jackpot-contribution": {
        i && a.poolUnits && this.#b(`pool:${i}`, rt(i.replace("-jackpot", "")) + " pool", z(String(a.poolUnits)));
        break;
      }
      case "jackpot-award": {
        const r = typeof a.tier == "string" ? a.tier.toUpperCase() : "JACKPOT", c = String(a.awardUnits ?? "0");
        this.#a(this.#o(t), void 0, { durationMs: 1900, intensity: 1 }), this.#e("jackpot-award", 1), await this.#u(`${r} JACKPOT`, `Awarded ${z(c)}`, "jackpot", 1900);
        break;
      }
      case "near-miss": {
        const r = Number(a.required) || 3, c = Math.min(this.#R().length - 1, r);
        this.#a(this.#o(t), this.#dt(c), { durationMs: 1100 }), this.#e("near-miss", 0.7), await this.#u("SO CLOSE", `${a.scatterCount ?? "?"} of ${r} scatters`, "loss", 950);
        break;
      }
      case "feature-start": {
        i && (this.#D({ type: "feature-start", featureId: i }), this.#a(this.#o(t), void 0, { durationMs: 900 }), this.#e("feature-start", 0.7), await this.#u(rt(i), this.#Yt(i, a), "", 1e3));
        break;
      }
      case "choice-required": {
        this.#h("FEATURE"), this.#L("bonus");
        const r = a.action && typeof a.action == "object" ? a.action : void 0, c = typeof r?.featureId == "string" ? r.featureId : "pick-and-click-bonus";
        this.#D({ type: "feature-start", featureId: c }) || this.#B("cast"), this.#e("choice-required", 0.8);
        break;
      }
      case "choice-resolved": {
        const r = String(a.awardUnits ?? "0"), c = r.startsWith("-");
        this.#a(this.#o(t), void 0, { durationMs: 1100 }), this.#e(c ? "gamble-lost" : "choice-resolved", 0.85), c ? await this.#u("GAMBLE LOST", "Better luck next time", "loss") : BigInt(r) > 0n ? (this.#at(`+${z(r)}`), await this.#u("BONUS WIN", `Awarded ${z(r)}`)) : await this.#u("COLLECTED", "Winnings banked", "", 850), this.#L("base");
        break;
      }
    }
    this.#jt(t, e);
  }
  #Yt(t, e) {
    return e.addedSpins !== void 0 ? `+${e.addedSpins} free spins` : e.level !== void 0 ? `Level ${e.level}` : e.position !== void 0 ? `Advanced to tile ${e.position}` : e.modifier !== void 0 ? rt(String(e.modifier)) : e.multiplier !== void 0 ? `×${e.multiplier}` : e.outcome === "won" ? "Gamble won" : e.outcome === "lost" ? "Gamble lost" : e.costUnits !== void 0 ? `Cost ${z(String(e.costUnits))}` : e.locked !== void 0 ? `${e.locked} locked` : t === "chain-reactions" ? "Adjacent symbols join the reaction" : "";
  }
  /** Backwards-compatible: themes may still map raw event types directly to sound assets. */
  #jt(t, e) {
    if (t.type === "win" && !oe(e.betUnits, e.totalWinUnits, this.#t)) return;
    const a = this.#t?.theme.sounds?.[t.type], s = a ? this.#tt(a) : void 0;
    s && this.#J.play(s.id, 0.8);
  }
  #Vt(t) {
    const e = this.shadowRoot?.querySelector(".win-message");
    if (!e) return;
    const a = BigInt(this.#r), s = BigInt(t), i = La(this.#r, t);
    i && this.#D({ type: "win-size", size: i });
    const l = s >= a * 250n ? "EPIC WIN" : s >= a * 100n ? "MEGA WIN" : s >= a * 25n ? "BIG WIN" : s >= a * 10n ? "NICE WIN" : void 0;
    l ? (this.#e("big-win", 1), e.textContent = `${l} ${z(t)}`) : e.textContent = `WIN ${z(t)}`, this.#T && clearTimeout(this.#T), e.classList.add("active"), this.#h("WIN"), this.#T = setTimeout(() => {
      e.classList.remove("active"), this.#T = void 0, !this.#s && !this.#I && this.#h("READY");
    }, this.#c ? 0 : l ? 2200 : 1400);
  }
  #Jt() {
    this.#T && clearTimeout(this.#T), this.#T = void 0, this.shadowRoot?.querySelector(".win-message")?.classList.remove("active");
  }
  #ft(t, e, a) {
    const s = this.#G.format(t.labelKey);
    return s !== t.labelKey ? s : t.id === "collect" ? "Collect" : t.id === "double" ? "Double" : t.id === "red" ? "Red" : t.id === "black" ? "Black" : t.id === "spin" ? "Spin the wheel" : a === "path" ? `Path ${e + 1}` : a === "board" ? `Move ${e + 1}` : a === "skill" ? `Target ${e + 1}` : `Pick ${e + 1}`;
  }
  #Zt(t) {
    const e = rt(t.featureId);
    switch (t.type) {
      case "wheel":
        return { title: e, hint: "Spin the wheel to reveal your prize" };
      case "gamble":
        return { title: e, hint: "Risk your win or bank it now" };
      case "path":
        return { title: e, hint: "Choose your path" };
      case "board":
        return { title: e, hint: "Make your move" };
      case "skill":
        return { title: e, hint: "Pick your target" };
      default:
        return { title: e, hint: "Make your pick to reveal the prize" };
    }
  }
  #Qt(t) {
    const e = this.shadowRoot.querySelector(".bonus"), a = t.pendingAction, { title: s, hint: i } = this.#Zt(a), l = document.createElement("div");
    l.className = "bonus-panel", l.innerHTML = `<h3>${s}</h3><p>${i}</p>`;
    const r = this.classicPresentation && a.type === "gamble";
    e.classList.toggle("gamble-screen", r);
    const c = this.shadowRoot.querySelector(".spin"), n = c.querySelector(".spin-label"), h = this.shadowRoot.querySelector('[data-key="autoplay"]'), f = this.shadowRoot.querySelector(".cab-message"), u = /* @__PURE__ */ new Map();
    let d = !1;
    const p = async (b, m) => {
      if (!d) {
        d = !0, this.#$ = !0, c.disabled = !0, l.querySelectorAll("button").forEach((g) => {
          g.disabled = !0;
        }), this.#e("choice-click", 0.6);
        try {
          m && await m(), u.has(b) || u.set(b, crypto.randomUUID());
          const g = await this.#n.action({ roundId: t.roundId, playerId: this.#d, actionId: a.id, choiceId: b, idempotencyKey: u.get(b) });
          e.classList.remove("active"), e.replaceChildren(), this.#I = void 0, this.#$ = !1, this.removeAttribute("gamble-active"), n.textContent = "Start", c.disabled = !1, h.disabled = !1, f && (f.textContent = "Please place your bet"), await this.playResult(g);
        } catch (g) {
          d = !1, this.#$ = !1, c.disabled = !1, l.querySelectorAll("button").forEach((y) => {
            y.disabled = !1;
          }), this.#pt(g, "action");
        }
      }
    };
    if (a.type === "wheel") {
      const b = document.createElement("div");
      b.className = "wheel-wrap";
      const m = document.createElement("div");
      m.className = "wheel", b.append(m), l.append(b);
      const g = document.createElement("div");
      g.className = "bonus-grid";
      for (const [y, w] of a.choices.entries()) {
        const S = document.createElement("button");
        S.className = "bonus-choice", S.dataset.style = "gold", S.textContent = this.#ft(w, y, a.type), S.addEventListener("click", () => {
          p(w.id, () => this.#c ? Promise.resolve() : (m.style.transform = `rotate(${1440 + Math.floor(Math.random() * 360)}deg)`, this.#e("wheel-spin", 0.8), new Promise((x) => setTimeout(x, 2150))));
        }), g.append(S);
      }
      l.append(g);
    } else if (a.type === "gamble") {
      if (r) {
        this.#w = !1, h.textContent = "Autoplay", h.disabled = !0, this.setAttribute("gamble-active", "");
        const m = z(t.totalWinUnits);
        l.innerHTML = `<div class="gamble-amount"><strong>GAMBLE AMOUNT</strong><output>${m}</output></div><div class="gamble-history"><strong>PREVIOUS CARDS</strong><div>${'<i class="card-back" aria-hidden="true"></i>'.repeat(6)}</div></div><div class="gamble-card card-back" aria-label="Face-down gamble card"></div><p class="gamble-hint">Choose Red or Black to gamble, or take the win!</p>`, f && (f.textContent = `${m} won`);
      }
      const b = document.createElement("div");
      b.className = "gamble-row";
      for (const [m, g] of a.choices.entries()) {
        if (r && g.id === "collect") {
          this.#I = () => {
            p(g.id);
          }, n.textContent = "Collect", c.disabled = !1;
          continue;
        }
        const y = document.createElement("button");
        y.className = "bonus-choice", y.dataset.style = g.id === "red" ? "red" : g.id === "black" ? "black" : g.id === "double" ? "red" : "gold", y.textContent = this.#ft(g, m, a.type), y.addEventListener("click", () => {
          p(g.id);
        }), b.append(y);
      }
      l.append(b);
    } else {
      const b = document.createElement("div");
      b.className = "bonus-grid";
      for (const [m, g] of a.choices.entries()) {
        const y = document.createElement("button");
        y.className = "bonus-card", y.innerHTML = `?<small>${this.#ft(g, m, a.type)}</small>`, y.addEventListener("click", () => {
          y.classList.add("picked"), y.textContent = "★", p(g.id, () => this.#O(this.#c ? 0 : 620));
        }), b.append(y);
      }
      l.append(b);
    }
    e.replaceChildren(l), e.classList.add("active");
  }
  #pt(t, e) {
    const a = t instanceof Error ? t : new Error(String(t)), s = this.shadowRoot?.querySelector(".error");
    s && (s.hidden = !1, s.textContent = `Unable to ${e === "spin" ? "complete the spin" : e === "action" ? "resolve the choice" : "play this result"}: ${a.message}`), this.dispatchEvent(new CustomEvent("slot-error", { detail: { error: a, operation: e }, bubbles: !0, composed: !0 }));
  }
}
function mi(o = "slot-game") {
  customElements.get(o) || customElements.define(o, bi);
}
export {
  Vs as AmbientEffectRenderer,
  Ge as HttpSlotTransport,
  Aa as MessageCatalog,
  bi as SlotGameElement,
  Na as characterAnimationDurationMs,
  La as characterWinSize,
  mi as defineSlotGame,
  js as mapCoverAnchor,
  Ha as mappedCharacterAnimation,
  oe as mayCelebrate,
  Ta as paytableRows,
  Ba as remainingCharacterPoseLockMs
};
//# sourceMappingURL=slot-client.js.map
