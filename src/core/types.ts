// Shared types for BinSplit.

/** Canonical material classes the rule engine reasons about. */
export type MaterialClass =
  | 'paper'
  | 'cardboard'
  | 'beverage-carton'
  | 'paper-composite'
  | 'plastic'
  | 'plastic-foam'
  | 'biodegradable-plastic'
  | 'plastic-metal-laminate'
  | 'glass'
  | 'aluminium'
  | 'steel'
  | 'metal'
  | 'wood'
  | 'other'
  | 'unknown';

/** Canonical shape classes. */
export type ShapeClass =
  | 'bottle'
  | 'jar'
  | 'can'
  | 'aerosol-can'
  | 'cap'
  | 'seal'
  | 'label'
  | 'box'
  | 'brick'
  | 'tray'
  | 'pot'
  | 'cup'
  | 'bag'
  | 'film'
  | 'sachet'
  | 'blister'
  | 'tube'
  | 'capsule'
  | 'cutlery'
  | 'straw'
  | 'other'
  | 'unknown';

/** Plastic resin identification code, when known (1 PET ... 7 other). */
export type ResinCode = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Confidence = 'high' | 'medium' | 'low';

/** Where a piece of evidence came from in the Open Food Facts record. */
export type EvidenceSource =
  | 'packagings'
  | 'packaging_text'
  | 'packaging_tags'
  | 'shape_material_tags'
  | 'user';

export interface Evidence {
  source: EvidenceSource;
  /** The raw value as it appeared in the record. */
  raw: string;
  shape?: ShapeClass;
  material?: MaterialClass;
}

/** One physical packaging part of a product after reconciliation. */
export interface Part {
  id: string;
  shape: ShapeClass;
  material: MaterialClass;
  resin?: ResinCode;
  /** Original taxonomy id of the material, e.g. en:pet-1-polyethylene-terephthalate */
  materialTag?: string;
  shapeTag?: string;
  units?: number;
  confidence: Confidence;
  /** Why the confidence is what it is, in plain words. */
  reasons: string[];
  evidence: Evidence[];
  /** Alternatives when sources disagree (e.g. plastic vs glass for the same jar). */
  alternatives?: Array<{ material: MaterialClass; source: EvidenceSource; raw: string }>;
  /** True when the shape or material is missing and the user must answer. */
  needsInput: boolean;
  /** Set when the records make it doubtful that this part exists at all. */
  doubt?: 'existence';
}

export interface Reconciled {
  parts: Part[];
  /** Product-level notes, e.g. "no packaging data at all". */
  notes: string[];
  /** Whether any packaging information at all was present. */
  hasData: boolean;
}

/** Subset of the Open Food Facts product we use. */
export interface OffProduct {
  code: string;
  product_name?: string;
  brands?: string;
  image_front_small_url?: string;
  categories_tags?: string[];
  packagings?: Array<{
    shape?: string;
    material?: string;
    number_of_units?: number;
    recycling?: string;
    quantity_per_unit?: string;
    weight_measured?: number;
  }>;
  packaging_tags?: string[];
  packaging_text?: string;
  packaging_materials_tags?: string[];
  packaging_shapes_tags?: string[];
  packaging_recycling_tags?: string[];
  packagings_complete?: number;
}

// ---------- Rule packs ----------

export interface Bin {
  id: string;
  name: string;
  /** Name in the local language, if the source uses one. */
  localName?: string;
  /** UI colour token. Not an official bin colour unless the source says so. */
  tone: string;
  description: string;
  /** True for "not recyclable here" style bins. */
  residual?: boolean;
}

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  fetched: string;
  note?: string;
  sha256?: string;
}

export interface RuleMatch {
  materials: MaterialClass[];
  /** If omitted the rule applies to any shape of these materials. */
  shapes?: ShapeClass[];
}

export interface Rule {
  id: string;
  match: RuleMatch;
  bin: string;
  /** Preparation steps, in order, each worded from the source. */
  prep: string[];
  /** The item wording in the source that this rule encodes. */
  sourceItem: string;
  source: string;
  /** Location inside the source, e.g. "Summary table, S/N 20". */
  ref: string;
  /**
   * listed: the source names this kind of item explicitly.
   * category: the source names the material category but not this exact item.
   */
  specificity: 'listed' | 'category';
}

export interface RulePack {
  id: string;
  name: string;
  shortName: string;
  region: string;
  /** Where this pack applies, from the source. */
  scope: string;
  /** Places it does NOT cover, from the source. */
  notCovered?: string;
  bins: Bin[];
  sources: Source[];
  /** Applies to every recyclable part (e.g. "dirty items go to residual"). */
  generalRules: Array<{ text: string; source: string; ref: string }>;
  rules: Rule[];
  /** Materials this pack's sources do not cover at all, with the reason. */
  gaps: Array<{ materials: MaterialClass[]; shapes?: ShapeClass[]; reason: string; /** The source that was checked and does not cover it. */ source?: string }>;
}

export type Verdict =
  | { kind: 'rule'; rule: Rule; bin: Bin }
  | { kind: 'gap'; reason: string; source?: string }
  | { kind: 'needs-input'; missing: Array<'shape' | 'material'> };

export interface SortedPart {
  part: Part;
  verdict: Verdict;
}
