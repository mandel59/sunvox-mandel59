export type HexColor = `#${string}`;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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

export interface ModuleOptions {
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

export interface ScratchCreateOptions {
  volume?: number;
  bpm?: number;
  tpl?: number;
  color?: HexColor;
  inputModule?: number;
  version?: number;
  baseVersion?: number;
}

export interface SunSynthModule {
  index?: number;
  name?: string;
  kind?: string;
  type?: string;
  flags?: ModuleFlags;
  controllers?: ControllerPatch;
  position?: Position3D;
  color?: HexColor;
  inputs?: Array<{ slot?: number; module: number; peerSlot?: number }>;
  outputs?: Array<{ slot?: number; module: number; peerSlot?: number }>;
  dataChunks?: JsonValue[];
  [key: string]: unknown;
}

export interface ModuleSelectorObject {
  index?: number;
  name?: string;
  type?: string;
  nameOrType?: string;
  match?: (module: SunSynthModule, index: number) => boolean;
}

export type ModuleSelector = string | number | ModuleSelectorObject;

export type ControllerSelector = string | number;

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

export class ModuleHandle {
  match(): { module: SunSynthModule; index: number };
  set(controllers: ControllerPatch): SunSynthLab;
  get(path: string): unknown;
  rename(name: string): SunSynthLab;
}

export class UserControllerHandle {
  match(): { controller: UserControllerPatch & { index?: number }; index: number };
  set(valueOrPatch: ControllerValue | UserControllerPatch): SunSynthLab;
  get(path?: string): unknown;
}

export class SunSynthLab {
  document: JsonValue & { module: SunSynthModule };

  constructor(document: JsonValue);

  static fromFile(filePath: string): Promise<SunSynthLab>;
  static create(name?: string, options?: ScratchCreateOptions): SunSynthLab;
  static createModule(type: string, options?: ModuleOptions): SunSynthLab;

  clone(): SunSynthLab;
  rename(name: string): this;
  embeddedProject(): unknown;
  modules(): SunSynthModule[];
  addOutput(nameOrOptions?: string | ModuleOptions, options?: ModuleOptions): this;
  addInput(nameOrOptions?: string | ModuleOptions, options?: ModuleOptions): this;
  addModule(type: string, options?: ModuleOptions): this;
  findModules(selector: ModuleSelector): Array<{ module: SunSynthModule; index: number }>;
  findModule(selector: ModuleSelector): { module: SunSynthModule; index: number };
  module(selector: ModuleSelector): ModuleHandle;
  setRootController(path: string, value: ControllerValue): this;
  setRootControllers(controllers: ControllerPatch): this;
  setModuleControllers(selector: ModuleSelector, controllers: ControllerPatch): this;
  setModulesByType(
    type: string,
    updater: (module: SunSynthModule, index: number, ordinal: number) => ControllerPatch | undefined | void,
  ): this;
  connect(fromSelector: ModuleSelector, toSelector: ModuleSelector, options?: { slot?: number; peerSlot?: number }): this;
  exposeController(
    label: string,
    moduleSelector: ModuleSelector,
    controllerSelector: ControllerSelector,
    options?: ControllerExposeOptions,
  ): this;
  userController(selector: string | number): UserControllerHandle;
  findUserController(selector: string | number): { controller: UserControllerPatch & { index?: number }; index: number };
  setUserController(selector: string | number, valueOrPatch: ControllerValue | UserControllerPatch): this;
  getModuleController(selector: ModuleSelector, path: string): unknown;
  toBuffer(): Uint8Array;
  writeSunsynth(filePath: string): Promise<this>;
  writeJson(filePath: string): Promise<this>;
}

export function loadSunsynthTemplate(filePath: string): Promise<SunSynthLab>;
