/**
 * Catálogo cerrado de falacias. El modelo elige un `kind` de esta lista (o
 * `other`) además del nombre libre en el idioma del resumen: el nombre es para
 * leer, el tipo es para que la interfaz pueda distinguirlas de un vistazo.
 */

export const FALLACY_KINDS = [
  'ad-hominem',
  'straw-man',
  'false-dilemma',
  'slippery-slope',
  'appeal-to-authority',
  'appeal-to-emotion',
  'appeal-to-popularity',
  'hasty-generalization',
  'circular-reasoning',
  'false-cause',
  'red-herring',
  'tu-quoque',
  'false-analogy',
  'appeal-to-ignorance',
  'loaded-question',
  'anecdotal',
  'other',
] as const;

export type FallacyKind = (typeof FALLACY_KINDS)[number];

interface KindInfo {
  /** Icono del emblema. Elegido para que cada tipo se reconozca sin leer. */
  icon: string;
  /** Descripción corta para el prompt, en español (idioma de los prompts). */
  hint: string;
}

const KINDS: Record<FallacyKind, KindInfo> = {
  'ad-hominem': { icon: '👤', hint: 'ataca a la persona en vez de a su argumento' },
  'straw-man': { icon: '🌾', hint: 'hombre de paja: refuta una versión deformada del argumento ajeno' },
  'false-dilemma': { icon: '⚖️', hint: 'falso dilema: presenta solo dos opciones cuando hay más' },
  'slippery-slope': { icon: '🎿', hint: 'pendiente resbaladiza: encadena consecuencias extremas sin justificarlas' },
  'appeal-to-authority': { icon: '🎓', hint: 'apelación a la autoridad: vale porque lo dice alguien, no por las razones' },
  'appeal-to-emotion': { icon: '💔', hint: 'apelación a la emoción: sustituye razones por miedo, lástima o indignación' },
  'appeal-to-popularity': { icon: '👥', hint: 'apelación a la popularidad: es verdad porque muchos lo creen' },
  'hasty-generalization': { icon: '🎲', hint: 'generalización apresurada: concluye sobre todos a partir de pocos casos' },
  'circular-reasoning': { icon: '🔁', hint: 'razonamiento circular o petición de principio: la conclusión está en las premisas' },
  'false-cause': { icon: '🔗', hint: 'falsa causa (post hoc): toma una coincidencia o secuencia por causalidad' },
  'red-herring': { icon: '🐟', hint: 'pista falsa: desvía hacia un tema irrelevante' },
  'tu-quoque': { icon: '🪞', hint: 'tu quoque: descalifica el argumento porque quien lo hace no lo cumple' },
  'false-analogy': { icon: '🍎', hint: 'falsa analogía: compara cosas que no son comparables en lo relevante' },
  'appeal-to-ignorance': { icon: '❓', hint: 'apelación a la ignorancia: es verdad porque no se ha demostrado lo contrario' },
  'loaded-question': { icon: '🪤', hint: 'pregunta cargada: da por supuesto lo que habría que demostrar' },
  anecdotal: { icon: '📌', hint: 'evidencia anecdótica: un caso aislado como prueba general' },
  other: { icon: '⚠', hint: 'cualquier otra falacia clara que no encaje en las anteriores' },
};

export function isFallacyKind(value: unknown): value is FallacyKind {
  return typeof value === 'string' && (FALLACY_KINDS as readonly string[]).includes(value);
}

/** Normaliza lo que devuelva el modelo: minúsculas, guiones; lo desconocido es `other`. */
export function coerceFallacyKind(value: unknown): FallacyKind {
  if (typeof value !== 'string') return 'other';
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return isFallacyKind(normalized) ? normalized : 'other';
}

export function fallacyIcon(kind: FallacyKind): string {
  return KINDS[kind].icon;
}

/** Lista para el prompt: `kind: descripción`, una por línea. */
export function fallacyKindsForPrompt(): string {
  return FALLACY_KINDS.map((kind) => `  ${kind}: ${KINDS[kind].hint}`).join('\n');
}
