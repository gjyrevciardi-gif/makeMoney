import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import type { GameConfig } from "./types.js";

const integerString = { type: "string", pattern: "^(0|[1-9][0-9]*)$" } as const;

export const gameSchema = {
  $id: "https://slot-skills.local/schema/game-2.0.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "engineApi", "id", "version", "title", "layout", "symbols", "math",
    "features", "assets", "theme", "locales", "jurisdiction", "providers", "presentation",
  ],
  properties: {
    schemaVersion: { const: "2.0" },
    engineApi: { const: "1.0" },
    id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    title: { type: "string", minLength: 1, maxLength: 120 },
    layout: {
      type: "object",
      additionalProperties: false,
      required: ["reels", "rows"],
      properties: {
        reels: { type: "integer", minimum: 1, maximum: 12 },
        rows: {
          anyOf: [
            { type: "integer", minimum: 1, maximum: 12 },
            { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 1, maximum: 12 } },
          ],
        },
        orientation: { enum: ["landscape", "portrait", "responsive"] },
        maxVisibleCells: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    symbols: {
      type: "array",
      minItems: 2,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "kind", "asset"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          name: { type: "string", minLength: 1 },
          kind: { enum: ["normal", "wild", "scatter", "bonus", "collect", "jackpot"] },
          asset: { type: "string", minLength: 1 },
          animation: { type: "string" },
          tags: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
      },
    },
    math: {
      type: "object",
      additionalProperties: false,
      required: ["evaluator", "outcomeGenerator", "targets", "paytable"],
      properties: {
        evaluator: { enum: ["paylines", "ways", "count", "cluster"] },
        outcomeGenerator: { enum: ["reel-strips", "weighted-grid"] },
        targets: {
          type: "object",
          additionalProperties: false,
          required: ["rtpBps", "volatility", "hitRateBps", "maxWinMultiplier"],
          properties: {
            rtpBps: { type: "integer", minimum: 1, maximum: 10000 },
            volatility: { enum: ["low", "medium", "high"] },
            hitRateBps: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              prefixItems: [{ type: "integer", minimum: 0, maximum: 10000 }, { type: "integer", minimum: 0, maximum: 10000 }],
            },
            maxWinMultiplier: { $ref: "#/$defs/rational" },
          },
        },
        paytable: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["symbolId", "count", "payout", "basis"],
            properties: {
              symbolId: { type: "string" },
              count: { type: "integer", minimum: 1, maximum: 100 },
              payout: { $ref: "#/$defs/rational" },
              basis: { enum: ["bet", "line-bet", "coin"] },
            },
          },
        },
        paylines: { type: "array", items: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 } } },
        reelStrips: { type: "array", items: { type: "array", minItems: 1, items: { type: "string" } } },
        symbolWeights: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        featureWeights: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
        maxCascades: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "enabled"],
        properties: { id: { type: "string" }, enabled: { type: "boolean" }, config: { type: "object" } },
      },
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "role", "path"],
        properties: {
          id: { type: "string" }, role: { type: "string" }, path: { type: "string" }, fallback: { type: "string" },
          mediaType: { type: "string" }, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 },
          animationDurationMs: { type: "integer", minimum: 1 },
          sha256: { type: "string" }, generation: { type: "object" }, rights: { type: "object" },
        },
      },
    },
    theme: {
      type: "object",
      required: ["id", "palette", "components"],
      properties: {
        id: { type: "string" }, palette: { type: "array", minItems: 1, items: { type: "string" } },
        typography: { type: "object" }, components: { type: "object", additionalProperties: { type: "string" } },
        effects: { type: "object", additionalProperties: { type: "string" } },
        ambientEffects: {
          type: "array", maxItems: 8,
          items: {
            type: "object", additionalProperties: false,
            required: ["instanceId", "effectId", "enabled", "scope", "playback", "options"],
            properties: {
              instanceId: { type: "string", minLength: 1 }, effectId: { type: "string", minLength: 1 }, enabled: { type: "boolean" },
              scope: { enum: ["full-background", "anchored"] },
              anchor: {
                type: "object", additionalProperties: false, required: ["x", "y", "width", "height"],
                properties: {
                  x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 },
                  width: { type: "number", minimum: 0.02, maximum: 1 }, height: { type: "number", minimum: 0.02, maximum: 1 },
                },
              },
              playback: {
                oneOf: [
                  { type: "object", additionalProperties: false, required: ["mode", "durationMs"], properties: { mode: { const: "continuous" }, durationMs: { type: "integer", minimum: 400, maximum: 10000 } } },
                  { type: "object", additionalProperties: false, required: ["mode", "durationMs", "minIntervalMs", "maxIntervalMs"], properties: { mode: { const: "random-interval" }, durationMs: { type: "integer", minimum: 400, maximum: 10000 }, minIntervalMs: { type: "integer", minimum: 500, maximum: 60000 }, maxIntervalMs: { type: "integer", minimum: 500, maximum: 60000 } } },
                ],
              },
              options: {
                type: "object", additionalProperties: false, required: ["intensity", "seed"],
                properties: {
                  intensity: { type: "number", minimum: 0.1, maximum: 2 }, seed: { type: "integer", minimum: 1, maximum: 999999 },
                  palette: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } },
                  parameters: { type: "object", additionalProperties: { type: ["number", "string", "boolean"] } },
                },
              },
            },
            allOf: [
              { if: { properties: { scope: { const: "anchored" } } }, then: { required: ["anchor"] } },
              { if: { properties: { scope: { const: "full-background" } } }, then: { not: { required: ["anchor"] } } },
            ],
          },
        },
        sounds: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    locales: {
      type: "object",
      required: ["default", "packs"],
      properties: { default: { type: "string" }, packs: { type: "object", additionalProperties: { type: "string" } } },
    },
    jurisdiction: {
      type: "object",
      required: ["profileId", "reviewedAt", "reviewBy", "sourceUrls"],
      properties: {
        profileId: { type: "string" }, reviewedAt: { type: "string", format: "date" }, reviewBy: { type: "string", format: "date" },
        sourceUrls: { type: "array", minItems: 1, items: { type: "string", format: "uri" } }, overrides: { type: "object" },
      },
    },
    providers: {
      type: "object",
      required: ["rng", "wallet", "jackpot", "session", "audit"],
      properties: {
        rng: { type: "string" }, wallet: { type: "string" }, jackpot: { type: "string" }, session: { type: "string" },
        audit: { type: "string" }, image: { type: "string" }, video: { type: "string" }, audio: { type: "string" },
      },
    },
    presentation: {
      type: "object",
      additionalProperties: false,
      required: ["cycleDurationMs", "autoPlay", "turbo", "slamStop", "celebrateReturnAtOrBelowStake", "reducedMotionFallback"],
      properties: {
        cycleDurationMs: { type: "integer", minimum: 0 }, autoPlay: { type: "boolean" }, turbo: { type: "boolean" },
        slamStop: { type: "boolean" }, celebrateReturnAtOrBelowStake: { type: "boolean" }, reducedMotionFallback: { type: "boolean" },
        characterHeight: { type: "number", minimum: 200, maximum: 1200 }, characterOverflow: { type: "boolean" },
        symbolScale: { type: "number", minimum: 0.6, maximum: 1.4 },
        frameScale: { type: "number", minimum: 0.8, maximum: 1.3 },
        characterScale: { type: "number", minimum: 0.5, maximum: 1.8 },
        characterOffsetX: { type: "number", minimum: -0.5, maximum: 0.5 },
        characterOffsetY: { type: "number", minimum: -0.5, maximum: 0.5 },
        characterBottomMargin: { type: "number", minimum: 0, maximum: 0.2 },
        characterAnimationMappings: {
          type: "array", maxItems: 32,
          items: {
            type: "object", additionalProperties: false, required: ["animationId", "trigger"],
            properties: {
              animationId: { type: "string", minLength: 1, maxLength: 80 },
              trigger: {
                oneOf: [
                  { type: "object", additionalProperties: false, required: ["type", "size"], properties: { type: { const: "win-size" }, size: { enum: ["small", "nice", "big", "mega", "epic"] } } },
                  { type: "object", additionalProperties: false, required: ["type", "featureId"], properties: { type: { const: "feature-start" }, featureId: { type: "string", minLength: 1, maxLength: 80 } } },
                ],
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    rational: {
      type: "object",
      additionalProperties: false,
      required: ["numerator", "denominator"],
      properties: { numerator: integerString, denominator: { type: "string", pattern: "^[1-9][0-9]*$" } },
    },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat("uri", /^https?:\/\//);
const validate = ajv.compile(gameSchema);

export class SchemaValidationError extends Error {
  readonly errors: ErrorObject[];
  constructor(errors: ErrorObject[]) {
    super(errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; "));
    this.name = "SchemaValidationError";
    this.errors = errors;
  }
}

export function validateGameConfig(value: unknown): asserts value is GameConfig {
  if (!validate(value)) throw new SchemaValidationError(validate.errors ?? []);
}
