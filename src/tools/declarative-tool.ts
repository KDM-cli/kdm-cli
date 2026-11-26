/**
 * Declarative Tool Abstraction — KDM v4.0.0
 * =========================================
 * Base declarative tool interfaces, parameter schema validation with Zod,
 * safety classification, and conversion to @google/genai FunctionDeclaration.
 */

import { z } from 'zod';
import { Type, type FunctionDeclaration, type Schema } from '@google/genai';

export type ToolSafetyLevel = 'read_only' | 'mutating';
export type ToolRiskLevel = 'low' | 'medium' | 'high';

export interface ToolExecutionContext {
  signal?: AbortSignal;
  dryRun?: boolean;
  namespace?: string;
  auditTrail?: any;
  [key: string]: unknown;
}

export interface DeclarativeToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  safetyLevel?: ToolSafetyLevel;
  safety?: ToolSafetyLevel; // Harness compatibility
  riskLevel?: ToolRiskLevel;
  schema?: z.ZodType<TInput>;
  parameters?: z.ZodType<TInput>; // Harness compatibility
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>;
}

/**
 * Converts a Zod schema into a @google/genai OpenAPI 3.03 Schema object.
 */
export function zodToGenAiSchema(schema: z.ZodType<any>): Schema {
  let current: any = schema;
  let isNullable = false;
  let defaultValue: unknown = undefined;
  let description = schema.description;

  // Unwrap wrapper types
  while (current) {
    if (current.description && !description) {
      description = current.description;
    }

    if (current._def.typeName === 'ZodOptional') {
      current = current._def.innerType;
    } else if (current._def.typeName === 'ZodNullable') {
      isNullable = true;
      current = current._def.innerType;
    } else if (current._def.typeName === 'ZodDefault') {
      try {
        defaultValue = current._def.defaultValue();
      } catch {
        // ignore default evaluation errors
      }
      current = current._def.innerType;
    } else if (current._def.typeName === 'ZodEffects') {
      current = current._def.schema;
    } else {
      break;
    }
  }

  const typeName = current._def.typeName;
  const baseSchema: Schema = {};
  if (description) baseSchema.description = description;
  if (isNullable) baseSchema.nullable = true;
  if (defaultValue !== undefined) baseSchema.default = defaultValue;

  switch (typeName) {
    case 'ZodString':
      baseSchema.type = Type.STRING;
      break;

    case 'ZodNumber': {
      const isInt = current._def.checks?.some((c: any) => c.kind === 'int');
      baseSchema.type = isInt ? Type.INTEGER : Type.NUMBER;
      break;
    }

    case 'ZodBoolean':
      baseSchema.type = Type.BOOLEAN;
      break;

    case 'ZodEnum':
      baseSchema.type = Type.STRING;
      baseSchema.enum = current._def.values;
      break;

    case 'ZodNativeEnum':
      baseSchema.type = Type.STRING;
      baseSchema.enum = Object.values(current._def.values);
      break;

    case 'ZodArray':
      baseSchema.type = Type.ARRAY;
      baseSchema.items = zodToGenAiSchema(current._def.type);
      break;

    case 'ZodObject': {
      baseSchema.type = Type.OBJECT;
      const shape = current._def.shape();
      const properties: Record<string, Schema> = {};
      const required: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shape)) {
        const fieldZod = fieldSchema as z.ZodType<any>;
        properties[key] = zodToGenAiSchema(fieldZod);

        // Check if field is required (not optional and does not have default)
        let isFieldOptional = false;
        let checkField: any = fieldZod;
        while (checkField) {
          if (
            checkField._def.typeName === 'ZodOptional' ||
            checkField._def.typeName === 'ZodDefault'
          ) {
            isFieldOptional = true;
            break;
          }
          if (checkField._def.typeName === 'ZodNullable' || checkField._def.typeName === 'ZodEffects') {
            checkField = checkField._def.innerType || checkField._def.schema;
          } else {
            break;
          }
        }

        if (!isFieldOptional) {
          required.push(key);
        }
      }

      baseSchema.properties = properties;
      if (required.length > 0) {
        baseSchema.required = required;
      }
      break;
    }

    default:
      baseSchema.type = Type.STRING;
      break;
  }

  return baseSchema;
}

/**
 * Base abstract class for declarative tools.
 */
export abstract class BaseDeclarativeTool<TInput = any, TOutput = any> {
  abstract readonly name: string;
  abstract readonly description: string;
  readonly safetyLevel: ToolSafetyLevel = 'read_only';
  readonly riskLevel: ToolRiskLevel = 'low';
  abstract readonly schema: z.ZodType<TInput>;

  /** Getter alias for harness compatibility */
  get safety(): ToolSafetyLevel {
    return this.safetyLevel;
  }

  /** Getter alias for harness compatibility */
  get parameters(): z.ZodType<TInput> {
    return this.schema;
  }

  abstract execute(input: TInput, context?: ToolExecutionContext): Promise<TOutput>;

  /**
   * Validates raw input arguments against the tool's Zod schema.
   */
  validate(rawArgs: unknown): TInput {
    return this.schema.parse(rawArgs);
  }

  /**
   * Converts the tool's parameter schema to @google/genai FunctionDeclaration format.
   */
  toGeminiToolDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToGenAiSchema(this.schema),
    };
  }
}

/**
 * Concrete DeclarativeTool implementation supporting object-based initialization.
 */
export class DeclarativeTool<TInput = any, TOutput = any> extends BaseDeclarativeTool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly safetyLevel: ToolSafetyLevel;
  readonly riskLevel: ToolRiskLevel;
  readonly schema: z.ZodType<TInput>;
  private readonly executeFn: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>;

  constructor(def: DeclarativeToolDefinition<TInput, TOutput>) {
    super();
    this.name = def.name;
    this.description = def.description;
    this.safetyLevel = def.safetyLevel ?? def.safety ?? 'read_only';
    this.riskLevel = def.riskLevel ?? (this.safetyLevel === 'mutating' ? 'high' : 'low');
    const s = def.schema ?? def.parameters;
    if (!s) {
      throw new Error(`Tool '${def.name}' must have a schema or parameters defined.`);
    }
    this.schema = s;
    this.executeFn = def.execute;
  }

  execute(input: TInput, context?: ToolExecutionContext): Promise<TOutput> {
    return this.executeFn(input, context);
  }
}

/**
 * Convenience factory function to create a DeclarativeTool.
 */
export function createDeclarativeTool<TInput = any, TOutput = any>(
  def: DeclarativeToolDefinition<TInput, TOutput>
): DeclarativeTool<TInput, TOutput> {
  return new DeclarativeTool(def);
}
