export const TEXT_FORMAT: "sunvox-structured-text-v1";
export const EDITABLE_TEXT_FORMAT: "sunvox-editable-text-v1";
export const VERBOSE_TEXT_FORMAT: "sunvox-container-text-v1";
export const SUPPORTED_MAGICS: Set<SunVoxMagic>;

export type SunVoxMagic = "SVOX" | "SSYN";

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

export interface ModuleDataChunk {
  index: number;
  name?: string;
  controller?: number;
  count?: number;
  links?: Array<{ index: number; module: number; controller: number }>;
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

export type EditablePatternEvent =
  | [note: number, velocity: number, module: number, controller: number, value: number]
  | PatternNote;

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
  flags?: number;
  sessionFlags?: number;
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
  currentLine?: number;
  time?: number;
  selectionStart?: number;
  lastGenerator?: number;
  patternCount?: number;
  extraChunks?: EditableSunVoxChunk[];
  chunks?: EditableSunVoxChunk[];
}

export interface StructuredPattern {
  index?: number;
  layer?: number;
  name?: string;
  position?: { x?: number; y?: number };
  tracks?: number;
  lines?: number;
  ySize?: number;
  displayFlags?: number;
  iconBase64?: string;
  foreground?: string;
  background?: string;
  parent?: number;
  flags?: number;
  events?: EditablePatternEvent[];
  extraChunks?: EditableSunVoxChunk[];
  chunks?: EditableSunVoxChunk[];
}

export interface StructuredModule {
  name?: string;
  type?: string;
  position?: { x?: number; y?: number; z?: number };
  color?: string;
  flags?: number;
  finetune?: number;
  relativeNote?: number;
  scale?: number;
  version?: number;
  midi?: {
    inputIndex?: number;
    name?: string;
    inputChannel?: number;
    inputBank?: number;
    inputProgram?: number;
  };
  inputLinks?: number[];
  auxInputLinks?: number[];
  outputLinks?: number[];
  auxOutputLinks?: number[];
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
