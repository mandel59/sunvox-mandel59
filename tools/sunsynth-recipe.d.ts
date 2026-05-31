import type {
  ControllerPatch,
  ControllerValue,
  HexColor,
  ModuleOptions,
  ModuleSelector,
  ScratchCreateOptions,
  SunSynthLab,
  SunSynthModule,
  UserControllerPatch,
} from "./sunsynth-lab.d.ts";

export type MaybePromise<T> = T | Promise<T>;
export type SweepParamValue = string | number | boolean;
export type SweepParamLists = Record<string, readonly SweepParamValue[]>;

export type SweepValues<TParams extends SweepParamLists> = {
  [Key in keyof TParams]: TParams[Key] extends readonly (infer Value)[] ? Value : never;
};

export type TemplateString<TParams extends Record<string, unknown>> =
  | string
  | ((params: TParams, index: number) => string);

export interface RootModuleCreateOptions extends ModuleOptions {
  moduleType: string;
}

export type RecipeCreateOption = true | string | ScratchCreateOptions | RootModuleCreateOptions;

export interface ModuleControllerEdit {
  selector: ModuleSelector;
  controllers?: ControllerPatch;
}

export interface ModulesByTypeEdit {
  type: string;
  update: (module: SunSynthModule, index: number, ordinal: number) => ControllerPatch | undefined | void;
}

export interface UserControllerEdit extends UserControllerPatch {
  index: number;
}

export interface RecipeApplyContext {
  recipe: SunSynthRecipe;
  options: SunSynthGenerateOptions;
}

export interface SunSynthRecipeVariant {
  name?: string;
  fileName?: string;
  json?: boolean;
  probes?: string[];
  params?: Record<string, SweepParamValue>;
  create?: RecipeCreateOption;
  rootControllers?: ControllerPatch;
  modules?: ModuleControllerEdit[];
  modulesByType?: ModulesByTypeEdit[];
  userControllers?: UserControllerEdit[];
  apply?: (synth: SunSynthLab, context: RecipeApplyContext) => MaybePromise<void>;
}

export type SunSynthRecipeVariantFunction = (
  synth: SunSynthLab,
  context: RecipeApplyContext,
) => MaybePromise<void>;

export type SunSynthRecipeVariantLike = SunSynthRecipeVariant | SunSynthRecipeVariantFunction;

export interface SunSynthRecipe {
  name?: string;
  template?: string;
  outDir?: string;
  json?: boolean;
  create?: RecipeCreateOption;
  variants: SunSynthRecipeVariantLike[];
}

export interface SweepConfig<TParams extends SweepParamLists = SweepParamLists> {
  name?: TemplateString<SweepValues<TParams>>;
  fileName?: TemplateString<SweepValues<TParams>>;
  params?: TParams;
  probes?: string[];
  build: (synth: SunSynthLab, params: SweepValues<TParams>, index: number) => MaybePromise<void>;
}

export interface SunSynthRecipeContext {
  create: (name?: string, options?: ScratchCreateOptions) => SunSynthLab;
  createModule: (type: string, options?: ModuleOptions) => SunSynthLab;
  sweep: <TParams extends SweepParamLists>(config: SweepConfig<TParams>) => SunSynthRecipeVariant[];
}

export type SunSynthRecipeFactory = (context: SunSynthRecipeContext) => MaybePromise<SunSynthRecipe>;

export interface SunSynthGenerateOptions {
  json?: boolean;
  outDir?: string;
  recipePath?: string;
}

export type HexModuleColor = HexColor;
export type RootControllerValue = ControllerValue;
