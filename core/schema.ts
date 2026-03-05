// -----------------------------------------------------------------
// AETHER Schema Validator
//
// Structured output validation for LLM responses. Define expected
// output schemas per agent/task. Validates, retries with correction
// prompt on failure.
// -----------------------------------------------------------------

import type { OutputSchema, AgentDefinition } from "./types.ts";

// -----------------------------------------------------------------
// Validation Result
// -----------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Parsed JSON if output was valid JSON, null otherwise */
  parsed: Record<string, unknown> | unknown[] | null;
}

// -----------------------------------------------------------------
// Schema Validator
// -----------------------------------------------------------------

export class SchemaValidator {
  /**
   * Validate an LLM output string against a schema.
   * Attempts to parse JSON from the output and validate structure.
   */
  validate(output: string, schema: OutputSchema): ValidationResult {
    const errors: string[] = [];

    // Try to extract JSON from the output
    const json = this.extractJSON(output);
    if (json === null) {
      return {
        valid: false,
        errors: ["Output does not contain valid JSON"],
        parsed: null,
      };
    }

    // Validate the structure
    this.validateValue(json, schema, "root", errors);

    return {
      valid: errors.length === 0,
      errors,
      parsed: json as Record<string, unknown> | unknown[],
    };
  }

  /**
   * Generate a correction prompt when validation fails.
   * Includes the original output, errors, and expected schema.
   */
  generateCorrectionPrompt(
    originalOutput: string,
    errors: string[],
    schema: OutputSchema,
  ): string {
    const schemaDesc = this.describeSchema(schema);
    const errorList = errors.map((e) => "- " + e).join("\n");

    return [
      "Your previous output did not match the required schema.",
      "",
      "## Errors",
      errorList,
      "",
      "## Expected Schema",
      schemaDesc,
      "",
      "## Your Previous Output",
      originalOutput.slice(0, 2000),
      "",
      "Please provide a corrected response that matches the schema exactly.",
      "Respond with valid JSON only.",
    ].join("\n");
  }

  /**
   * Check if an agent definition has an output schema configured.
   */
  static hasSchema(agent: AgentDefinition): boolean {
    return !!(
      agent.metadata &&
      typeof agent.metadata === "object" &&
      "outputSchema" in agent.metadata &&
      agent.metadata.outputSchema
    );
  }

  /**
   * Extract the output schema from an agent's metadata.
   */
  static getSchema(agent: AgentDefinition): OutputSchema | null {
    if (!SchemaValidator.hasSchema(agent)) return null;
    return (agent.metadata as Record<string, unknown>)
      .outputSchema as OutputSchema;
  }

  // -- Private helpers ------------------------------------------

  /**
   * Try to extract JSON from an LLM response.
   * Handles: raw JSON, JSON in code blocks, JSON embedded in text.
   */
  private extractJSON(text: string): unknown | null {
    // Try raw parse first
    try {
      return JSON.parse(text.trim());
    } catch {
      // continue
    }

    // Try extracting from ```json ... ``` code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // continue
      }
    }

    // Try finding first { ... } or [ ... ] in text
    const braceStart = text.indexOf("{");
    const bracketStart = text.indexOf("[");

    if (braceStart === -1 && bracketStart === -1) return null;

    // Pick whichever comes first
    const start =
      braceStart === -1
        ? bracketStart
        : bracketStart === -1
          ? braceStart
          : Math.min(braceStart, bracketStart);

    const isObject = text[start] === "{";
    const closer = isObject ? "}" : "]";

    // Find matching closer by counting depth
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  /**
   * Recursively validate a value against a schema node.
   */
  private validateValue(
    value: unknown,
    schema: OutputSchema,
    path: string,
    errors: string[],
  ): void {
    if (value === null || value === undefined) {
      errors.push(path + ": value is null or undefined");
      return;
    }

    switch (schema.type) {
      case "object":
        this.validateObject(value, schema, path, errors);
        break;
      case "array":
        this.validateArray(value, schema, path, errors);
        break;
      case "string":
        if (typeof value !== "string") {
          errors.push(path + ": expected string, got " + typeof value);
        }
        break;
    }
  }

  private validateObject(
    value: unknown,
    schema: OutputSchema,
    path: string,
    errors: string[],
  ): void {
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push(
        path +
          ": expected object, got " +
          (Array.isArray(value) ? "array" : typeof value),
      );
      return;
    }

    const obj = value as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          errors.push(path + "." + field + ": required field is missing");
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          this.validatePropertyType(
            obj[key],
            propSchema.type,
            path + "." + key,
            errors,
          );

          // Recurse into nested schemas
          if (
            propSchema.items &&
            propSchema.type === "array" &&
            Array.isArray(obj[key])
          ) {
            const arr = obj[key] as unknown[];
            for (let i = 0; i < arr.length; i++) {
              this.validateValue(
                arr[i],
                propSchema.items,
                path + "." + key + "[" + i + "]",
                errors,
              );
            }
          }
        }
      }
    }
  }

  private validateArray(
    value: unknown,
    schema: OutputSchema,
    path: string,
    errors: string[],
  ): void {
    if (!Array.isArray(value)) {
      errors.push(path + ": expected array, got " + typeof value);
      return;
    }

    // If properties.items is defined at schema level, validate each element
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (propSchema.items) {
          for (let i = 0; i < value.length; i++) {
            this.validateValue(
              value[i],
              propSchema.items,
              path + "[" + i + "]",
              errors,
            );
          }
        }
      }
    }
  }

  private validatePropertyType(
    value: unknown,
    expectedType: string,
    path: string,
    errors: string[],
  ): void {
    if (value === null || value === undefined) return;

    switch (expectedType) {
      case "string":
        if (typeof value !== "string") {
          errors.push(path + ": expected string, got " + typeof value);
        }
        break;
      case "number":
        if (typeof value !== "number") {
          errors.push(path + ": expected number, got " + typeof value);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          errors.push(path + ": expected boolean, got " + typeof value);
        }
        break;
      case "array":
        if (!Array.isArray(value)) {
          errors.push(path + ": expected array, got " + typeof value);
        }
        break;
      case "object":
        if (typeof value !== "object" || Array.isArray(value)) {
          errors.push(
            path +
              ": expected object, got " +
              (Array.isArray(value) ? "array" : typeof value),
          );
        }
        break;
    }
  }

  /**
   * Generate a human-readable description of a schema.
   */
  private describeSchema(schema: OutputSchema, indent: number = 0): string {
    const pad = "  ".repeat(indent);
    const lines: string[] = [];

    if (schema.description) {
      lines.push(pad + "// " + schema.description);
    }

    if (schema.type === "object" && schema.properties) {
      lines.push(pad + "{");
      for (const [key, prop] of Object.entries(schema.properties)) {
        const req = schema.required?.includes(key)
          ? " (required)"
          : " (optional)";
        const desc = prop.description ? " // " + prop.description : "";
        if (prop.items) {
          lines.push(pad + "  " + key + ": " + prop.type + "<");
          lines.push(this.describeSchema(prop.items, indent + 2));
          lines.push(pad + "  >" + req + desc);
        } else {
          lines.push(pad + "  " + key + ": " + prop.type + req + desc);
        }
      }
      lines.push(pad + "}");
    } else if (schema.type === "array") {
      lines.push(pad + "Array<...>");
    } else {
      lines.push(pad + schema.type);
    }

    return lines.join("\n");
  }
}

// -----------------------------------------------------------------
// Common Pre-built Schemas
// -----------------------------------------------------------------

/** Schema for code block responses */
export const CodeBlockSchema: OutputSchema = {
  type: "object",
  description: "Response containing code blocks",
  properties: {
    language: { type: "string", description: "Programming language" },
    code: { type: "string", description: "The code content", required: true },
    explanation: { type: "string", description: "Explanation of the code" },
    filename: { type: "string", description: "Suggested filename" },
  },
  required: ["code"],
};

/** Schema for plan/step responses */
export const PlanSchema: OutputSchema = {
  type: "object",
  description: "A structured plan with steps",
  properties: {
    summary: {
      type: "string",
      description: "Brief summary of the plan",
      required: true,
    },
    steps: {
      type: "array",
      description: "Ordered list of steps",
      required: true,
      items: {
        type: "object",
        properties: {
          step: { type: "number", description: "Step number", required: true },
          action: { type: "string", description: "What to do", required: true },
          agent: { type: "string", description: "Which agent handles this" },
          dependencies: { type: "array", description: "Steps this depends on" },
        },
        required: ["step", "action"],
      },
    },
    estimatedComplexity: {
      type: "string",
      description: "low, medium, or high",
    },
  },
  required: ["summary", "steps"],
};

/** Schema for code review responses */
export const ReviewSchema: OutputSchema = {
  type: "object",
  description: "Code review response",
  properties: {
    approved: {
      type: "boolean",
      description: "Whether the code is approved",
      required: true,
    },
    issues: {
      type: "array",
      description: "List of issues found",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            description: "critical, warning, or info",
            required: true,
          },
          file: { type: "string", description: "File path" },
          line: { type: "number", description: "Line number" },
          message: {
            type: "string",
            description: "Issue description",
            required: true,
          },
          suggestion: { type: "string", description: "Suggested fix" },
        },
        required: ["severity", "message"],
      },
    },
    summary: {
      type: "string",
      description: "Overall review summary",
      required: true,
    },
  },
  required: ["approved", "summary"],
};

/** Schema for generic JSON responses */
export const JSONResponseSchema: OutputSchema = {
  type: "object",
  description: "Generic JSON response",
  properties: {
    status: { type: "string", description: "success or error", required: true },
    data: { type: "object", description: "Response data" },
    message: { type: "string", description: "Human-readable message" },
  },
  required: ["status"],
};
