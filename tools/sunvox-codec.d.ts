export const TEXT_FORMAT: "sunvox-structured-text-v1";
export const EDITABLE_TEXT_FORMAT: "sunvox-editable-text-v1";
export const VERBOSE_TEXT_FORMAT: "sunvox-container-text-v1";
export const SUPPORTED_MAGICS: Set<SunVoxMagic>;

export type SunVoxMagic = "SVOX" | "SSYN";
export type SunVoxJumpAddressMode =
  | "absolute"
  | "patternPositionPlus"
  | "patternPositionMinus"
  | "nextLinePlus"
  | "nextLineMinus";
export type SunVoxSyncFlags = Partial<Record<
  "midiStartStopContinue" | "midiClock" | "midiPosition" | "otherStartStopContinue" | "otherClock" | "otherPosition" | "unknown",
  boolean | number | undefined
>>;
export type ModuleMidiInputFlags = {
  alwaysActive?: "off" | "on";
  channel?:
    | "any"
    | "channel1"
    | "channel2"
    | "channel3"
    | "channel4"
    | "channel5"
    | "channel6"
    | "channel7"
    | "channel8"
    | "channel9"
    | "channel10"
    | "channel11"
    | "channel12"
    | "channel13"
    | "channel14"
    | "channel15"
    | "channel16"
    | number;
  never?: "off" | "on";
};
export type ModuleVisualizerParameters = {
  levelMode?: "off" | "mono" | "stereo" | "color" | "glow" | number;
  levelFlags?: Partial<Record<"vertical" | "db" | "peak" | "unknown", boolean | number | undefined>>;
  oscilloscopeMode?:
    | "off"
    | "points"
    | "lines"
    | "bars"
    | "bars2"
    | "phaseScopeX1"
    | "phaseScopeX2"
    | "xy"
    | number;
  oscilloscopeFlags?: Partial<Record<"sync" | "unknown", boolean | number | undefined>>;
  oscilloscopeSizeMs?: number;
  backgroundTransparency?: number;
  shadowOpacity?: number;
  flags?: Partial<Record<
    "noBackgroundOutline" | "noBackgroundFill" | "noPeakValues" | "levelRms" | "unknown",
    boolean | number | undefined
  >>;
};

export interface SunVoxStructTextLayout {
  kind: "lineMajorTupleArray" | "sparsePatternEvents";
  path: string;
  columnsPath?: string;
  rowsPath?: string;
  columnsOverridePath?: string;
  rowsOverridePath?: string;
  positionFields?: string[];
  tupleFields: string[];
  emptyTuple?: number[];
  fieldSemantics?: Record<
    string,
    {
      description?: string;
      encoding?: string;
      reference?: string;
      zero?: string;
      range?: string;
      aliases?: string[];
      packedFields?: Array<{
        name: string;
        shift: number;
        bits: number;
        offset?: number;
        scale?: number;
        omitStoredValue?: number;
        min?: number;
        max?: number;
        enum?: string;
        bitflags?: string;
        reference?: string;
      }>;
    }
  >;
}

export interface SunVoxStructDefinition {
  kind?: string;
  path?: string;
  recordSize: number;
  textLayout?: SunVoxStructTextLayout;
  fields: Array<{
    name: string;
    type: string;
    offset: number;
    count?: number;
    default?: unknown;
    invert?: boolean;
    enum?: string;
    bitfield?: string;
    bitflags?: string;
    flatten?: boolean;
  }>;
}

export interface SunVoxPackedFieldDefinition {
  name: string;
  shift: number;
  bits: number;
  offset?: number;
  scale?: number;
  omitStoredValue?: number;
  min?: number;
  max?: number;
  enum?: string;
  bitflags?: string;
  reference?: string;
}

export interface SunVoxPatternEffectParameterDefinition {
  description?: string;
  sourceSymbol?: string;
  packedFields?: SunVoxPackedFieldDefinition[];
  variants?: Array<{
    description?: string;
    sourceSymbol?: string;
    match?: { mask: number; value: number };
    valueRange?: { min: number; max: number };
    packedFields: SunVoxPackedFieldDefinition[];
  }>;
}

export interface SunVoxPatternEffectRangeDefinition {
  name: string;
  min: number;
  max: number;
  description?: string;
  sourceSymbol?: string;
  field: {
    name: string;
    offset?: number;
    scale?: number;
  };
}

export interface SunVoxRuntimeConstraintDefinition {
  id: string;
  scope: "project" | "module" | "moduleLink" | "patternEffectParameter";
  path: string;
  effect?: string;
  relation?: string;
  kind: "integerRange" | "maxUtf8Bytes";
  min?: number;
  max?: number;
  maxBytes?: number;
  severity: SunVoxValidationSeverity;
  source?: string;
  trackingIssue?: number;
  observedBehavior?: {
    probeValue?: unknown;
    loadedValue?: unknown;
    savedValue?: unknown;
    description?: string;
  };
  description: string;
}

export interface SunVoxKnowledgeScopeDefinition {
  id: string;
  scope: "moduleInfo";
  source: string;
  status: "inCodecScope" | "outOfCodecScope" | "candidate";
  trackingIssue?: number;
  description: string;
}

export interface SunVoxDatabase {
  version: number;
  knowledgeScopes?: SunVoxKnowledgeScopeDefinition[];
  chunks: Array<Record<string, unknown>>;
  enums: Record<string, Record<string, string>>;
  patternEffectRanges?: SunVoxPatternEffectRangeDefinition[];
  patternEffectParameters?: Record<string, SunVoxPatternEffectParameterDefinition>;
  parameterlessPatternEffects?: Record<string, { description?: string; sourceSymbol?: string }>;
  bitfields?: Record<string, unknown>;
  bitflags?: Record<string, Array<{ name: string; bit: number }>>;
  structs?: Record<string, SunVoxStructDefinition>;
  grammar: Record<string, unknown>;
  runtimeConstraints: SunVoxRuntimeConstraintDefinition[];
  modules: Record<string, unknown>;
}

export const SUNVOX_DB: SunVoxDatabase;

export type SunVoxValidationSeverity = "warning" | "error";

export interface SunVoxValidationIssue {
  severity: SunVoxValidationSeverity;
  rule: string;
  path: string;
  value?: unknown;
  message: string;
  source?: string;
  trackingIssue?: number;
  moduleType?: string;
  controller?: string;
  controllerIndex?: number;
}

export interface SunVoxValidationResult {
  ok: boolean;
  issues: SunVoxValidationIssue[];
}

export type DecodedChunk =
  | { kind: "empty"; _description?: string }
  | { kind: "string"; value: string; _description?: string }
  | { kind: "stringPreview"; value: string; _description?: string }
  | { kind: "rgb"; value: RgbValue; _description?: string }
  | { kind: "int32"; value: number; _description?: string }
  | { kind: "uint32"; value: number; _description?: string }
  | { kind: "int32Array"; value: number[]; _description?: string }
  | { kind: "uint32Array"; value: number[]; _description?: string }
  | { kind: "midiBindings"; value: MidiBinding[]; _description?: string }
  | { kind: "patternNotes"; value: PatternNotes; _description?: string }
  | { _description: string };

export interface RgbValue {
  r: number;
  g: number;
  b: number;
  hex: string;
}

export interface MidiBinding {
  type: number | string;
  channel: number;
  mode: number | string;
  parameter: number;
  min: number;
  max: number;
}

export type PackedMidiBinding = [midiPars1: number, midiPars2: number];
export type EditableMidiBinding = PackedMidiBinding | MidiBinding | { midiPars1: number; midiPars2: number };
export type ModuleControllerValue =
  | number
  | string
  | ModuleControllerValue[]
  | { [key: string]: ModuleControllerValue }
  | undefined;
export type ModuleControllers = number[] | ({ extra?: Record<string, number> } & Record<string, ModuleControllerValue>);

export interface ModuleLink {
  slot: number;
  module: number;
  peerSlot?: number;
  _moduleName?: string;
  _moduleType?: string;
}

export interface MetaModuleControllerLink {
  index: number;
  module: number;
  controller: number;
  _moduleName?: string;
  _moduleType?: string;
  _controllerName?: string;
  _controllerLabel?: string;
}

export interface ModuleDataChunk {
  index: number;
  name?: string;
  dataSize?: number;
  controller?: number;
  count?: number;
  links?: MetaModuleControllerLink[];
  slots?: Array<{
    index: number;
    min?: number;
    max?: number;
    controller?: number;
    flags?: number;
    futureUse?: number[];
  }>;
  values?: number[];
  options?: {
    [key: string]: unknown;
    userControllers?: number;
    arpeggiator?: boolean;
    useVelocity?: boolean;
    eventOutput?: boolean;
    flags?: Record<string, boolean>;
  };
  group?: number;
  label?: string;
  text?: string;
  base64?: string;
  container?: StructuredSunVoxTextDocument;
  flags?: number;
  sampleRate?: number;
  chunk?: EditableSunVoxChunk;
}

export interface PatternNote {
  note: number;
  velocity: number;
  module: number;
  controller: number;
  value: number;
}

export interface SemanticPatternEvent {
  line: number;
  track: number;
  note?: string | number;
  velocity?: number | "default";
  module?: number;
  _moduleName?: string;
  _moduleType?: string;
  controller?: string | number;
  _controllerIndex?: number;
  midiController?: number;
  effect?: number;
  value?: number;
  parameter?: number;
}

export type EditablePatternEvent =
  | [note: number, velocity: number, module: number, controller: number, value: number]
  | PatternNote
  | SemanticPatternEvent;

export interface PatternNotes {
  eventSize: 8;
  events: PatternNote[];
  eventCount: number;
  nonEmptyEventCount: number;
}

export interface EditablePatternNotes {
  events: EditablePatternEvent[];
}

export interface EditableSunVoxChunk {
  id: string;
  _label?: string;
  _comment?: string;
  _comments?: string[];
  value?: number;
  values?: number[];
  text?: string;
  textSize?: number;
  rgb?: string;
  midiBindings?: EditableMidiBinding[];
  pattern?: EditablePatternNotes;
  base64?: string;
}

export interface VerboseSunVoxChunk {
  id: string;
  offset: number;
  size: number;
  sha256: string;
  dataBase64: string;
  _decoded?: DecodedChunk;
}

export interface EditableSunVoxTextDocument {
  format: typeof EDITABLE_TEXT_FORMAT;
  _sourceName?: string;
  magic: SunVoxMagic;
  headerTailHex: string;
  _comments?: string[];
  chunks: EditableSunVoxChunk[];
}

export interface StructuredProject {
  version?: number;
  baseVersion?: number;
  flags?: number | Record<string, boolean>;
  syncFlags?: number | SunVoxSyncFlags;
  name?: string;
  bpm?: number;
  speed?: number;
  globalVolume?: number;
  timeline?: {
    grid?: number;
    grid2?: number;
  };
  view?: {
    moduleScale?: number;
    moduleZoom?: number;
    xOffset?: number;
    yOffset?: number;
  };
  layerMask?: number;
  currentLayer?: number;
  lineCounter?: number;
  restartPosition?: number;
  selectedModule?: number;
  lastSelectedGenerator?: number;
  currentPattern?: number;
  currentPatternTrack?: number;
  currentPatternLine?: number;
  supertrackMuteWords?: number[];
  jumpAddressMode?: SunVoxJumpAddressMode | number;
  extraChunks?: EditableSunVoxChunk[];
  chunks?: EditableSunVoxChunk[];
}

export interface StructuredPattern {
  name?: string;
  position?: { x?: number; y?: number };
  tracks?: number;
  lines?: number;
  eventColumns?: number;
  eventRows?: number;
  ySize?: number;
  flags?: number | Record<string, boolean>;
  iconBase64?: string;
  foreground?: string;
  background?: string;
  parent?: number;
  parentId?: number;
  infoFlags?: number | Record<string, boolean>;
  events?: EditablePatternEvent[];
  extraChunks?: EditableSunVoxChunk[];
  chunks?: EditableSunVoxChunk[];
}

export interface StructuredModule {
  name?: string;
  type?: string;
  position?: { x?: number; y?: number; z?: number };
  color?: string;
  flags?: number | Record<string, boolean>;
  finetune?: number;
  relativeNote?: number;
  scale?: number;
  visualizerParameters?: number | ModuleVisualizerParameters;
  midi?: {
    inputFlags?: number | ModuleMidiInputFlags;
    outputName?: string;
    outputChannel?:
      | "channel1"
      | "channel2"
      | "channel3"
      | "channel4"
      | "channel5"
      | "channel6"
      | "channel7"
      | "channel8"
      | "channel9"
      | "channel10"
      | "channel11"
      | "channel12"
      | "channel13"
      | "channel14"
      | "channel15"
      | "channel16"
      | number;
    outputBank?: number;
    outputProgram?: number;
  };
  inputs?: ModuleLink[];
  inputSlotCount?: number;
  outputs?: ModuleLink[];
  outputSlotCount?: number;
  inputLinks?: number[];
  inputLinkSlots?: number[];
  outputLinks?: number[];
  outputLinkSlots?: number[];
  controllers?: ModuleControllers;
  midiBindings?: EditableMidiBinding[];
  dataChunkCount?: number;
  dataChunks?: ModuleDataChunk[];
  extraChunks?: EditableSunVoxChunk[];
  chunks?: EditableSunVoxChunk[];
}

export interface StructuredSunVoxProjectDocument {
  format: typeof TEXT_FORMAT;
  _sourceName?: string;
  magic: "SVOX";
  headerTailHex: string;
  _comments?: string[];
  project: StructuredProject;
  patterns: StructuredPattern[];
  modules: StructuredModule[];
  trailingChunks?: EditableSunVoxChunk[];
}

export interface StructuredSunSynthDocument {
  format: typeof TEXT_FORMAT;
  _sourceName?: string;
  magic: "SSYN";
  headerTailHex: string;
  _comments?: string[];
  preludeChunks?: EditableSunVoxChunk[];
  module: StructuredModule;
  trailingChunks?: EditableSunVoxChunk[];
}

export interface VerboseSunVoxTextDocument {
  format: typeof VERBOSE_TEXT_FORMAT;
  _sourceName?: string;
  magic: SunVoxMagic;
  headerTailHex: string;
  size: number;
  sha256: string;
  chunks: VerboseSunVoxChunk[];
}

export type StructuredSunVoxTextDocument = StructuredSunVoxProjectDocument | StructuredSunSynthDocument;
export type SunVoxTextDocument = StructuredSunVoxTextDocument | EditableSunVoxTextDocument | VerboseSunVoxTextDocument;

export function sha256(buffer: Buffer | Uint8Array): string;
export function decodeChunkData(id: string, data: Buffer): DecodedChunk | undefined;
export function parseContainer(buffer: Buffer): StructuredSunVoxTextDocument;
export function parseEditableContainer(buffer: Buffer): EditableSunVoxTextDocument;
export function parseVerboseContainer(buffer: Buffer): VerboseSunVoxTextDocument;
export function buildContainer(document: SunVoxTextDocument): Buffer;
export function encode(inputPath: string, outputPath: string): Promise<void>;
export function decode(inputPath: string, outputPath: string): Promise<void>;
export function verify(inputPath: string): Promise<void>;
export function validate(inputPath: string): Promise<void>;
export function validateContainer(document: SunVoxTextDocument | Record<string, unknown>): SunVoxValidationResult;
export function formatValidationIssue(issue: SunVoxValidationIssue): string;
