import type { JsonValue } from "./sunvox-edit-recipe.d.ts";

export type MaybePromise<T> = T | Promise<T>;

export interface SunVoxMusicRecipeContext {
  recipePath: string;
  recipeDir: string;
  outputId: string;
  output: SunVoxMusicRecipeOutput;
  recipe: SunVoxMusicRecipe;
}

export interface SunVoxMusicRecipeOutput {
  file: string;
  title?: string;
  summaryFile?: string;
  params?: Record<string, JsonValue>;
  document?: JsonValue;
  buildDocument?: (context: SunVoxMusicRecipeContext) => MaybePromise<JsonValue>;
}

export interface SunVoxMusicRecipe {
  schemaVersion: 1;
  tags?: string[];
  issue?: number;
  outputs: Record<string, SunVoxMusicRecipeOutput>;
  buildDocument?: (context: SunVoxMusicRecipeContext) => MaybePromise<JsonValue>;
}

export interface SunVoxMusicRecipeRunOptions {
  recipePath?: string;
  outDir?: string;
}
