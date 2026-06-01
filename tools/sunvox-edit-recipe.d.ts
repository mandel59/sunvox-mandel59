export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;
export type HexColor = `#${string}`;

export interface Position3D {
  x: number;
  y: number;
  z?: number;
}

export type ControllerValue = JsonValue | undefined;

export interface ControllerPatch {
  [path: string]: ControllerValue;
}

export interface ModuleFlags {
  [flag: string]: boolean | undefined;
}

export interface ModuleSpec {
  name?: string;
  flags?: ModuleFlags;
  finetune?: number;
  relativeNote?: number;
  position?: Position3D;
  scale?: number;
  visualizerParameters?: Record<string, JsonValue>;
  color?: HexColor;
  controllers?: ControllerPatch;
  dataChunks?: JsonValue[];
}

export interface ModuleSelector {
  index?: number;
  name?: string;
  type?: string;
  nameOrType?: string;
}

export type ModuleRefLike = string | number | ModuleSelector | ModuleEditor;
export type ControllerSelector = string | number;

export interface LinkOptions {
  slot?: number;
  peerSlot?: number;
}

export interface DisconnectOptions {
  slot?: number;
  peerSlot?: number;
}

export interface RemoveModuleOptions {
  mode?: "leaveHole";
}

export interface ControllerCollectionEditor {
  set(controllers: ControllerPatch): void;
  get(path: string): unknown;
}

export interface ModuleEditor {
  readonly index: number;
  readonly name?: string;
  readonly type?: string;
  readonly controllers: ControllerCollectionEditor;
  rename(name: string): void;
}

export interface UserControllerEditor {
  set(valueOrPatch: ControllerValue | UserControllerPatch): void;
  get(path?: string): unknown;
}

export interface SunVoxProjectEditor {
  readonly inputs: Record<string, RecipeInputAsset>;
  readonly params: Record<string, JsonValue>;
  readonly output: ModuleEditor;

  setOutput(options?: ModuleSpec): ModuleEditor;
  addModule(type: string, options?: ModuleSpec): ModuleEditor;
  findModule(selector: ModuleRefLike): ModuleEditor;
  connect(from: ModuleRefLike, to: ModuleRefLike, options?: LinkOptions): void;
  disconnect(from: ModuleRefLike, to: ModuleRefLike, options?: DisconnectOptions): number;
  removeModule(selector: ModuleRefLike, options?: RemoveModuleOptions): number;
}

export interface SunSynthEditor {
  readonly inputs: Record<string, RecipeInputAsset>;
  readonly params: Record<string, JsonValue>;
  readonly rootModule: ModuleEditor;

  embeddedProject(): SunVoxProjectEditor;
  setInputModule(module: ModuleRefLike): ModuleEditor;
  expose(label: string, module: ModuleRefLike, controller: ControllerSelector, options?: ControllerExposeOptions): void;
  userController(selector: string | number): UserControllerEditor;
}

export interface ControllerExposeOptions {
  index?: number;
  value?: ControllerValue;
  group?: number;
}

export interface UserControllerPatch {
  value?: ControllerValue;
  label?: string;
  group?: number;
}

export interface RecipeInputAsset {
  kind: "sunvox" | "sunsynth";
  path: string;
}

export interface SunSynthCreateSpec extends ModuleSpec {
  module?: string;
  name?: string;
  volume?: number;
  bpm?: number;
  tpl?: number;
  output?: ModuleSpec;
  inputModule?: number;
  version?: number;
  baseVersion?: number;
}

export interface SunSynthOutputSpec {
  kind: "sunsynth";
  file: string;
  from?: string;
  create?: SunSynthCreateSpec;
  params?: Record<string, JsonValue>;
  apply?: (synth: SunSynthEditor) => MaybePromise<void>;
}

export interface SunVoxOutputSpec {
  kind: "sunvox";
  file: string;
  from?: string;
  params?: Record<string, JsonValue>;
  apply?: (project: SunVoxProjectEditor) => MaybePromise<void>;
}

export type SunVoxEditRecipeOutput = SunSynthOutputSpec | SunVoxOutputSpec;

export interface SunVoxEditRecipe {
  schemaVersion: 1;
  inputs?: Record<string, RecipeInputAsset>;
  outputs: Record<string, SunVoxEditRecipeOutput>;
}

export interface SunVoxEditRecipeRunOptions {
  recipePath?: string;
  outDir?: string;
}
